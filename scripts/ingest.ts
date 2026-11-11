// MUST be first: loads .env.local before lib/ai/models (imported transitively
// below) resolves the active provider at module-eval time. See load-env.ts.
import "./load-env";
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "fs";
import { join, extname, basename, relative } from "path";
import { embedMany } from "ai";
import { and, eq, asc, isNull } from "drizzle-orm";
import { documents, lawChunks, lawChanges } from "../lib/db/schema";
import { chunkDocument, hashContent, type DocKind } from "../lib/rag/chunk";
import { bytesToText } from "../lib/rag/extract";
import { EMBEDDING_MODEL } from "../lib/ai/models";
import { LOCAL_INDEX_PATH, type LocalEntry } from "../lib/rag/context";

// Incremental ingestion pipeline. Auto-discovers every PDF/TXT/MD under ./corpus
// (skipping folders that start with "_"), extracts text, chunks by article,
// embeds, and stores with citation metadata. Run with `npm run ingest`.
//
// This is IDEMPOTENT and diff-based: re-running on an unchanged corpus does
// nothing (no inserts, no embeddings). When a document changes, only the changed
// chunks are re-embedded; superseded chunks are retired (status='superseded')
// rather than deleted, and every change is recorded in law_changes. So updating
// the corpus is now: drop the new official file into corpus/ → `npm run ingest`.
//
// Per-file metadata (clean title, version, effectiveDate, sourceUrl, watch) can
// be overridden via corpus/manifest.json, keyed by corpus-relative path.

const CORPUS = join(process.cwd(), "corpus");
const SUPPORTED = new Set([".pdf", ".txt", ".md"]);
const BATCH = 64; // embeddings per request
// Client-side throttle for rate-limited embedding tiers (quota is counted per
// chunk, not per request). e.g. Google AI Studio free = 100/min → set EMBED_RPM=90.
// 0 = no throttle (default; gateway/local providers don't need it).
const EMBED_RPM = Number(process.env.EMBED_RPM ?? 0);
const MS_PER_ITEM = EMBED_RPM > 0 ? 60_000 / EMBED_RPM : 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Type of the lazily-imported db client (imported AFTER dotenv runs, below).
type DB = (typeof import("../lib/db"))["db"];

interface ManifestEntry {
  title?: string;
  version?: string;
  effectiveDate?: string; // ISO date
  sourceUrl?: string;
  taxType?: "VAT" | "CT" | "GEN";
  instrument?: string;
  watch?: boolean;
  supersedes?: string[];
}
type Manifest = Record<string, ManifestEntry>;

function loadManifest(): Manifest {
  const p = join(CORPUS, "manifest.json");
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as Manifest;
  } catch (e) {
    console.warn(`  manifest.json parse failed — ignoring: ${(e as Error).message}`);
    return {};
  }
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith("_") || name.startsWith(".")) continue; // skip _set-aside, hidden
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (SUPPORTED.has(extname(name).toLowerCase())) out.push(full);
  }
  return out;
}

// Authority hierarchy — higher beats lower when sources conflict.
const AUTHORITY: Record<string, number> = {
  decree_law: 6,
  cabinet_decision: 5,
  ministerial_decision: 4,
  fta_decision: 3,
  public_clarification: 2,
  fta_guide: 2,
  reference: 1,
};

// Chunking strategy implied by a legal instrument type.
function kindFor(instrument: string): DocKind {
  return instrument === "decree_law" ||
    instrument === "cabinet_decision" ||
    instrument === "ministerial_decision" ||
    instrument === "fta_decision"
    ? "law"
    : instrument === "public_clarification"
      ? "clarification"
      : "guide";
}

function deriveMeta(file: string) {
  const rel = relative(CORPUS, file).toLowerCase();
  const name = basename(file);

  // Instrument (legal authority type) from path + filename.
  let instrument = "reference";
  if (/decree-law/.test(rel)) instrument = "decree_law";
  else if (/ministerial-decision|md-no|md-\d/.test(rel))
    instrument = "ministerial_decision";
  else if (/cabinet-decision|cabient-decision/.test(rel))
    instrument = "cabinet_decision";
  else if (/fta-decision/.test(rel)) instrument = "fta_decision";
  else if (/public-clarification|vatp\d|ctp\d/.test(rel))
    instrument = "public_clarification";
  else if (/guide/.test(rel)) instrument = "fta_guide";
  else if (/legislation/.test(rel)) instrument = "cabinet_decision";

  const authorityRank = AUTHORITY[instrument] ?? 1;
  const kind = kindFor(instrument);

  // Tax type for the UI filter. VAT vs CT vs GEN (applies to both).
  let taxType: "VAT" | "CT" | "GEN" = "GEN";
  if (/ct-|corporate|ctp\d|qfzp|265|100-2023|47-2022|nexus|investment-funds/.test(rel))
    taxType = "CT";
  else if (/vat|vatp\d|value-added|decree-law-8|executive-regulation/.test(rel))
    taxType = "VAT";
  else if (/procedure|penalt|public-benefit/.test(rel)) taxType = "GEN";

  const sourceUrl =
    taxType === "CT"
      ? "https://tax.gov.ae/en/taxes/corporate.tax.aspx"
      : "https://tax.gov.ae/en/taxes/vat.aspx";

  const title = name.replace(/\.(pdf|txt|md)$/i, "").replace(/[-_]+/g, " ").trim();
  return { taxType, instrument, authorityRank, kind, sourceUrl, title };
}

// Merge manifest overrides over derived metadata. Returns the resolved metadata
// used for ingest, plus the parsed effectiveDate/version.
function resolveMeta(file: string, rel: string, manifest: Manifest) {
  const base = deriveMeta(file);
  const m = manifest[rel] ?? {};
  const instrument = m.instrument ?? base.instrument;
  return {
    ...base,
    instrument,
    kind: m.instrument ? kindFor(instrument) : base.kind,
    taxType: m.taxType ?? base.taxType,
    sourceUrl: m.sourceUrl ?? base.sourceUrl,
    title: m.title ?? base.title,
    // The DERIVED title is what legacy rows (pre-manifest) were stored under, so
    // first-run matching keys on it even when the manifest renames the doc.
    derivedTitle: base.title,
    version: m.version ?? null,
    effectiveDate: m.effectiveDate ? new Date(m.effectiveDate) : null,
  };
}

async function readDocText(file: string): Promise<string> {
  const bytes = new Uint8Array(readFileSync(file));
  return bytesToText(bytes, extname(file).toLowerCase() === ".pdf");
}

async function embedInBatches(values: string[]): Promise<number[][]> {
  const all: number[][] = [];
  for (let i = 0; i < values.length; i += BATCH) {
    const slice = values.slice(i, i + BATCH);
    const started = Date.now();
    const { embeddings } = await embedMany({
      model: EMBEDDING_MODEL,
      values: slice,
      // Ride out brief per-minute rate-limit windows (the SDK honours retry-after).
      maxRetries: 6,
    });
    all.push(...embeddings);
    // Pace to stay under EMBED_RPM (per-chunk quota).
    if (MS_PER_ITEM) {
      const wait = slice.length * MS_PER_ITEM - (Date.now() - started);
      if (wait > 0) await sleep(wait);
    }
  }
  return all;
}

type ResolvedMeta = ReturnType<typeof resolveMeta>;
type NewChunk = { content: string; articleRef: string | null; hash: string };
type OldChunk = { id: number; contentHash: string; articleRef: string | null };

interface SyncResult {
  status: "unchanged" | "added" | "changed";
  added: number;
  modified: number;
  removed: number;
}

// Diff one document against the live DB and apply the minimal set of changes.
// Identity: document by sourcePath (fallback title on first run); chunk by
// content hash (unchanged) then articleRef-group positional pairing (modified
// vs added/removed). Embeddings are spent ONLY on inserted chunks.
async function syncDocument(
  db: DB,
  rel: string,
  meta: ResolvedMeta,
  fullText: string,
): Promise<SyncResult> {
  const docHash = hashContent(fullText);

  // Locate the existing document by stable sourcePath, then title (first run).
  let doc = (
    await db.select().from(documents).where(eq(documents.sourcePath, rel)).limit(1)
  )[0];
  if (!doc) {
    // Match legacy rows by the derived title they were originally stored under.
    const byTitle = await db
      .select()
      .from(documents)
      .where(eq(documents.title, meta.derivedTitle))
      .orderBy(asc(documents.id))
      .limit(1);
    doc = byTitle[0];
  }

  // Doc-level fast skip: identical full-text hash ⇒ nothing to do, no chunking,
  // no embedding. This is what makes re-running on an unchanged corpus free.
  if (doc && doc.contentHash === docHash) {
    return { status: "unchanged", added: 0, modified: 0, removed: 0 };
  }

  const newChunks: NewChunk[] = chunkDocument(fullText, meta.kind).map((c) => ({
    content: c.content,
    articleRef: c.articleRef ?? null,
    hash: hashContent(c.content),
  }));

  // --- Brand-new document ---
  if (!doc) {
    const [inserted] = await db
      .insert(documents)
      .values({
        title: meta.title,
        instrument: meta.instrument,
        taxType: meta.taxType,
        sourceUrl: meta.sourceUrl,
        version: meta.version,
        effectiveDate: meta.effectiveDate,
        contentHash: docHash,
        sourcePath: rel,
        status: "active",
      })
      .returning();

    const embeddings = await embedInBatches(newChunks.map((c) => c.content));
    const rows = await db
      .insert(lawChunks)
      .values(
        newChunks.map((c, i) => ({
          documentId: inserted.id,
          articleRef: c.articleRef,
          content: c.content,
          contentHash: c.hash,
          embedding: embeddings[i],
          taxType: meta.taxType,
          effectiveDate: meta.effectiveDate,
          version: meta.version,
          status: "active",
        })),
      )
      .returning({ id: lawChunks.id });

    if (rows.length) {
      await db.insert(lawChanges).values(
        rows.map((r, i) => ({
          documentId: inserted.id,
          chunkId: r.id,
          changeType: "added",
          newContentHash: newChunks[i].hash,
          articleRef: newChunks[i].articleRef,
          source: "ingest",
          detail: { sourcePath: rel },
        })),
      );
    }
    return { status: "added", added: newChunks.length, modified: 0, removed: 0 };
  }

  // --- Existing document whose text changed: chunk-level diff ---
  const oldActive: OldChunk[] = await db
    .select({
      id: lawChunks.id,
      contentHash: lawChunks.contentHash,
      articleRef: lawChunks.articleRef,
    })
    .from(lawChunks)
    .where(and(eq(lawChunks.documentId, doc.id), eq(lawChunks.status, "active")));

  // Step 1 — exact content-hash matches are UNCHANGED (keep old row + embedding).
  const oldByHash = new Map<string, OldChunk[]>();
  for (const o of oldActive) {
    const arr = oldByHash.get(o.contentHash) ?? [];
    arr.push(o);
    oldByHash.set(o.contentHash, arr);
  }
  const matchedOldIds = new Set<number>();
  const leftoverNew: NewChunk[] = [];
  for (const c of newChunks) {
    const avail = oldByHash.get(c.hash)?.find((o) => !matchedOldIds.has(o.id));
    if (avail) matchedOldIds.add(avail.id);
    else leftoverNew.push(c);
  }
  const leftoverOld = oldActive.filter((o) => !matchedOldIds.has(o.id));

  // Step 2 — pair the leftovers within each articleRef group (positional). A
  // pair = modified; extra new = added; extra old = removed.
  const groupKey = (ref: string | null) => ref ?? "__noref__";
  const groupBy = <T extends { articleRef: string | null }>(items: T[]) => {
    const m = new Map<string, T[]>();
    for (const it of items) {
      const k = groupKey(it.articleRef);
      const arr = m.get(k) ?? [];
      arr.push(it);
      m.set(k, arr);
    }
    return m;
  };
  const newGroups = groupBy(leftoverNew);
  const oldGroups = groupBy(leftoverOld);

  type Insert = { chunk: NewChunk; predecessor: OldChunk | null };
  const toInsert: Insert[] = [];
  const toRemove: OldChunk[] = [];
  for (const key of new Set([...newGroups.keys(), ...oldGroups.keys()])) {
    const ns = newGroups.get(key) ?? [];
    const os = oldGroups.get(key) ?? [];
    const pairs = Math.min(ns.length, os.length);
    for (let i = 0; i < pairs; i++) toInsert.push({ chunk: ns[i], predecessor: os[i] });
    for (let i = pairs; i < ns.length; i++) toInsert.push({ chunk: ns[i], predecessor: null });
    for (let i = pairs; i < os.length; i++) toRemove.push(os[i]);
  }

  const now = new Date();

  // Insert the new/changed chunks (embed only these).
  let insertedRows: { id: number }[] = [];
  if (toInsert.length) {
    const embeddings = await embedInBatches(toInsert.map((t) => t.chunk.content));
    insertedRows = await db
      .insert(lawChunks)
      .values(
        toInsert.map((t, i) => ({
          documentId: doc!.id,
          articleRef: t.chunk.articleRef,
          content: t.chunk.content,
          contentHash: t.chunk.hash,
          embedding: embeddings[i],
          taxType: meta.taxType,
          effectiveDate: meta.effectiveDate,
          version: meta.version,
          status: "active",
        })),
      )
      .returning({ id: lawChunks.id });
  }

  // Retire superseded predecessors and removed chunks; record law_changes.
  const changeRows: (typeof lawChanges.$inferInsert)[] = [];
  for (let i = 0; i < toInsert.length; i++) {
    const newId = insertedRows[i].id;
    const pred = toInsert[i].predecessor;
    if (pred) {
      await db
        .update(lawChunks)
        .set({ status: "superseded", supersededAt: now, supersededByChunkId: newId })
        .where(eq(lawChunks.id, pred.id));
      changeRows.push({
        documentId: doc.id,
        chunkId: newId,
        previousChunkId: pred.id,
        changeType: "modified",
        oldContentHash: pred.contentHash,
        newContentHash: toInsert[i].chunk.hash,
        articleRef: toInsert[i].chunk.articleRef,
        source: "ingest",
        detail: { sourcePath: rel },
      });
    } else {
      changeRows.push({
        documentId: doc.id,
        chunkId: newId,
        changeType: "added",
        newContentHash: toInsert[i].chunk.hash,
        articleRef: toInsert[i].chunk.articleRef,
        source: "ingest",
        detail: { sourcePath: rel },
      });
    }
  }
  for (const o of toRemove) {
    await db
      .update(lawChunks)
      .set({ status: "superseded", supersededAt: now })
      .where(eq(lawChunks.id, o.id));
    changeRows.push({
      documentId: doc.id,
      previousChunkId: o.id,
      changeType: "removed",
      oldContentHash: o.contentHash,
      articleRef: o.articleRef,
      source: "ingest",
      detail: { sourcePath: rel },
    });
  }
  if (changeRows.length) await db.insert(lawChanges).values(changeRows);

  // Refresh document metadata (and backfill sourcePath if matched by title).
  await db
    .update(documents)
    .set({
      contentHash: docHash,
      sourcePath: rel,
      version: meta.version,
      effectiveDate: meta.effectiveDate,
      instrument: meta.instrument,
      sourceUrl: meta.sourceUrl,
      title: meta.title,
      fetchedAt: now,
      status: "active",
    })
    .where(eq(documents.id, doc.id));

  // Backfill effectiveDate/version onto still-active chunks that predate this
  // metadata (one-time, for chunks ingested before manifest dates existed).
  if (meta.effectiveDate) {
    await db
      .update(lawChunks)
      .set({ effectiveDate: meta.effectiveDate, version: meta.version })
      .where(
        and(
          eq(lawChunks.documentId, doc.id),
          eq(lawChunks.status, "active"),
          isNull(lawChunks.effectiveDate),
        ),
      );
  }

  const added = toInsert.filter((t) => !t.predecessor).length;
  const modified = toInsert.length - added;
  return { status: "changed", added, modified, removed: toRemove.length };
}

async function main() {
  // Embeddings always need Gateway auth: an API key, or the OIDC token that
  // `vercel env pull` writes. The database is optional: with no DATABASE_URL we
  // build a local index file instead (the "keep it simple" path).
  if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
    console.error("Ingestion needs AI_GATEWAY_API_KEY (or VERCEL_OIDC_TOKEN from `vercel env pull`) in .env.local.");
    process.exit(1);
  }
  const useDb = !!process.env.DATABASE_URL;
  console.log(
    useDb
      ? "Mode: database (Neon + pgvector) — incremental\n"
      : "Mode: local index file (no database)\n",
  );

  // Import the DB client lazily, AFTER dotenv (loaded at module top) has
  // populated DATABASE_URL — otherwise lib/db binds to its placeholder URL
  // because ESM hoists imports above the config() calls above.
  const { db } = await import("../lib/db");

  const manifest = loadManifest();
  const files = walk(CORPUS);
  if (files.length === 0) {
    console.error("No documents found under ./corpus.");
    process.exit(1);
  }
  console.log(`Found ${files.length} document(s).\n`);

  const localEntries: LocalEntry[] = [];
  let localId = 1000;
  const tally = { unchanged: 0, added: 0, modified: 0, removed: 0, docs: 0 };

  for (const file of files) {
    const rel = relative(CORPUS, file);
    const meta = resolveMeta(file, rel, manifest);
    let text: string;
    try {
      text = await readDocText(file);
    } catch (e) {
      console.warn(`  skip (extract failed): ${meta.title} — ${(e as Error).message}`);
      continue;
    }

    if (useDb) {
      const r = await syncDocument(db, rel, meta, text);
      if (r.status === "unchanged") {
        console.log(`  unchanged: ${meta.title}`);
      } else {
        console.log(
          `  ${r.status}: ${meta.title} — +${r.added} ~${r.modified} -${r.removed}`,
        );
        tally.docs++;
        tally.added += r.added;
        tally.modified += r.modified;
        tally.removed += r.removed;
      }
      if (r.status === "unchanged") tally.unchanged++;
      continue;
    }

    // No-DB local index path (unchanged behaviour: full rebuild).
    const chunks = chunkDocument(text, meta.kind);
    if (chunks.length === 0) {
      console.warn(`  skip (no text): ${meta.title}`);
      continue;
    }
    console.log(`Ingesting "${meta.title}" — ${chunks.length} chunks`);
    const embeddings = await embedInBatches(chunks.map((c) => c.content));
    chunks.forEach((c, i) => {
      localEntries.push({
        id: localId++,
        content: c.content,
        articleRef: c.articleRef ?? meta.title,
        sourceUrl: meta.sourceUrl,
        taxType: meta.taxType,
        instrument: meta.instrument,
        authorityRank: meta.authorityRank,
        docTitle: meta.title,
        embedding: embeddings[i],
      });
    });
  }

  if (!useDb) {
    writeFileSync(LOCAL_INDEX_PATH, JSON.stringify(localEntries));
    console.log(`\nWrote local index → ${LOCAL_INDEX_PATH}`);
    console.log(`\nDone. ${localEntries.length} chunks from ${files.length} files.`);
    process.exit(0);
  }

  console.log(
    `\nDone. ${tally.unchanged} unchanged, ${tally.docs} doc(s) changed: ` +
      `+${tally.added} added, ~${tally.modified} modified, -${tally.removed} removed.`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
