# Project Lex — Technical Architecture

How the system is built and how every part functions. Stack is **Vercel-native** (the deployment target).

---

## 1. Stack at a glance

| Layer | Choice | Why |
|-------|--------|-----|
| **Framework** | Next.js 16 (App Router) + TypeScript | One codebase for UI + API; deploys natively to Vercel |
| **UI** | Tailwind CSS + shadcn/ui | Fast, clean, accessible components |
| **AI orchestration** | Vercel AI SDK v6 + AI Gateway | Streaming, tool-calling, structured output; provider failover |
| **Model (reasoning)** | Claude (Opus/Sonnet) via Gateway (`anthropic/claude-...`) | Strong at grounded reasoning + citation discipline |
| **Model (extraction/vision)** | Claude vision | Reads invoices → structured data |
| **Embeddings** | Embedding model via AI Gateway | Turns law text + queries into vectors |
| **Database + vectors** | **Neon Postgres + pgvector** (Vercel Marketplace) | *One* store for both relational compliance data **and** vector search |
| **ORM** | Drizzle | Type-safe schema + migrations |
| **File storage** | Vercel Blob (private) | Holds uploaded invoices, generated PDFs/Excel |
| **Auth** | Open in this portfolio demo (the internal build used a passcode gate); Clerk/SSO planned | Internal-staff access control |
| **Background jobs** | Vercel Cron + Functions | Reminders, nightly source crawls |
| **Durable multi-step** | Vercel Workflow (WDK) | Change-impact re-runs that must survive crashes/retries |
| **Email reminders** | Resend | 30/15/7/1-day deadline alerts (SMS/WhatsApp later via Twilio) |
| **Reports** | PDF + Excel generation | Compliance register exports |
| **Evals** | Lightweight eval harness | Scores cited-answer accuracy against the F&A test set |

> **The one rule the architecture enforces:** no answer, determination, or report is emitted without a citation to a retrieved source. If the model can't ground a claim, it escalates to F&A instead of guessing.

---

## 2. System architecture

```
                          ┌─────────────────────────────────────────┐
                          │              Next.js app                 │
   Staff (F&A,            │  Chat UI · Invoice upload · Register     │
   procurement, AP) ─────▶│  dashboard · Admin / review queue        │
                          └───────────────┬─────────────────────────┘
                                          │  (API routes / Server Actions)
              ┌───────────────────────────┼───────────────────────────┐
              ▼                           ▼                           ▼
     ┌─────────────────┐        ┌──────────────────┐        ┌──────────────────┐
     │  RAG / Answer    │        │  Determination   │        │  Compliance      │
     │  engine          │        │  engine          │        │  register +      │
     │  (cited Q&A)     │        │  (VAT triage)    │        │  reminders       │
     └────────┬─────────┘        └────────┬─────────┘        └────────┬─────────┘
              │                           │                           │
              ▼                           ▼                           ▼
     ┌──────────────────────────────────────────────────────────────────────┐
     │            Neon Postgres + pgvector  (single source of truth)         │
     │  law_chunks(embeddings) · documents · compliance_items · invoices ·   │
     │  query_log · law_changes · users/roles · audit_log                    │
     └──────────────────────────────────────────────────────────────────────┘
              ▲                           ▲                           ▲
              │ nightly                   │ on upload                 │ cron
     ┌────────┴─────────┐        ┌────────┴─────────┐        ┌────────┴─────────┐
     │  Ingestion       │        │  Vercel Blob     │        │  Cron + Workflow │
     │  pipeline        │        │  (invoice files) │        │  (reminders,     │
     │  (crawl→chunk→   │        │                  │        │   change monitor)│
     │   embed)         │        │                  │        │                  │
     └────────┬─────────┘        └──────────────────┘        └──────────────────┘
              │
     Official tax sources (tax.gov.ae — Corporate Tax + VAT; UAE only)
```

---

## 3. The RAG + citation pipeline (the heart of the system)

### 3a. Ingestion (Phase 0, runs nightly)
1. **Crawl** official sources (start: tax.gov.ae — CT + VAT).
2. **Clean** HTML/PDF → plain text.
3. **Chunk** by article/section so a citation maps to a real legal unit.
4. **Embed** each chunk → vector.
5. **Store** in `law_chunks` with metadata: `source_url`, `article_ref`, `effective_date`, `jurisdiction`, `tax_type`, `version`, `content_hash`.
6. **Diff** against the stored corpus by `content_hash` — **now built**. Ingestion is incremental and idempotent: unchanged chunks are skipped, changed chunks are re-embedded and the old ones marked `superseded` (kept for audit, hidden from retrieval), and every add/modify/remove is recorded in `law_changes`. Re-running on an unchanged corpus is a no-op. Metadata (`effective_date`, `version`) is set from `corpus/manifest.json`.

### 3b. Query (every question)
1. User question (+ jurisdiction/tax-type filter) → **embed**.
2. **Retrieve** top-k chunks from pgvector, filtered to `status='active'` and `effective_date <= now` — so superseded/repealed or not-yet-in-force law is excluded (enforced in `lib/rag/retrieve.ts`; an `asOf`/`includeSuperseded` path supports historical/audit queries).
3. **Generate** with Claude under a strict contract:
   - *Answer only from the provided context.*
   - *Attach a citation (article_ref + date + url) to every claim.*
   - *If the context doesn't cover it → return `escalate` with a reason, don't guess.*
4. **Validate** the structured output: every statement must reference a real retrieved chunk id. If not → escalate.
5. **Render** the answer with inline citations + a confidence signal.
6. **Log** the question, retrieved sources, answer, and confidence to `query_log` (audit + eval + measuring F&A time saved).

### 3c. The answer contract (structured output)
```ts
{
  status: "answered" | "escalate",
  answer: string,                    // empty if escalate
  citations: [{ chunkId, articleRef, sourceUrl, effectiveDate }],
  confidence: "high" | "medium" | "low",
  escalationReason?: string          // when status = escalate
}
```
This contract is what makes "grounded & cited, or it escalates" a *structural guarantee*, not a prompt suggestion.

---

## 4. Vendor VAT Determination engine (Phase 1)

For "is there VAT on this, and what do I do?" — a hybrid of **deterministic rules + RAG**:

1. **Deterministic rule layer** handles known-clear cases first (e.g. imported services from abroad → reverse charge; designated-zone rules). Fast, exact, no model.
2. **RAG fallback** for everything else → cited reasoning via the answer engine.
3. **Structured determination output:**
```ts
{
  treatment: "standard_5" | "zero_rated" | "exempt" | "out_of_scope" | "reverse_charge" | "designated_zone",
  inputVatRecoverable: boolean | "partial",
  whatToDo: string,
  confirmWithFA: boolean,            // true → routes to F&A review queue
  citations: [...],
  confidence: "high" | "medium" | "low"
}
```
4. **Escalation routing:** low confidence or flagged scenarios → the **F&A review queue** instead of a final answer.

---

## 5. Invoice upload & extraction (Phase 1.5)
1. Upload PDF/image → **Vercel Blob (private)**.
2. **Claude vision** extracts structured fields → `{ vendor, country, currency, amount, lineItems[], taxShown }`.
3. Extracted data + user context → **Determination engine** (Section 4).
4. Output: treatment + what to do + what to confirm — cited.
5. File + extraction + determination logged against the invoice record (audit).

---

## 6. Compliance Register + Deadline Tracker (Phase 2)
- **Data:** `compliance_items` — `entity, jurisdiction, type, due_date, frequency, authority, status`. Deterministic — **no model in the loop**, so no hallucination risk.
- **Dashboard:** Due This Week / This Month / Overdue / Completed.
- **Reminders:** a **Vercel Cron** job runs daily → finds items due in 30/15/7/1 days → sends via **Resend** → logs to `audit_log`. Overdue → red + escalation.
- **Exports:** generate **PDF/Excel** of the register on demand → Blob.

---

## 7. Change-Impact Engine (Phase 3 — foundation built)

**Built today:**
- **Versioned, temporally-correct corpus.** Incremental, idempotent ingestion (Section 3a): a changed provision's old chunk is marked `superseded` (never deleted), the new one becomes `active`, and retrieval returns only law in force — so **Lex never cites repealed law**.
- **Change audit (`law_changes`).** Every added/modified/removed chunk is recorded with old/new `content_hash`, article ref, and `source` (`ingest` | `cron`).
- **Scheduled detection (Law Monitor).** A weekly **Vercel Cron** (`/api/cron/detect-changes`) re-fetches the curated `watch` sources in `corpus/manifest.json`, diffs them by extracted-text hash, and flags changes into `law_changes` + `audit_log`. It is **flag-only** — a human reviews and re-ingests; the corpus is never auto-mutated.
- **Rates/thresholds as data (`tax_parameters`).** Versioned, effective-dated values; changing a rate (e.g. VAT 5%→7%) is a data edit, not a redeploy.

**Still to build (next iteration):**
- A **Vercel Workflow** (durable, retry-safe) that, on a detected change, identifies the `compliance_items`, cached answers (`query_log`), and reports that cited the old rule and flags them for **human re-review** (never silently auto-edits). The citation→chunk links this needs already exist in `query_log`. Durable execution matters here: a re-run touching many records must survive timeouts/retries without double-processing.

---

## 8. Data model (Postgres, simplified)

| Table | Purpose |
|-------|---------|
| `documents` | Source docs: url, authority, jurisdiction, fetched_at, version, **status, content_hash, source_path** |
| `law_chunks` | Chunk text + `embedding vector` + article_ref, effective_date, content_hash, **status (active/superseded/repealed), superseded_by** |
| `law_changes` | **Built** — audit of every corpus diff: change_type, old/new content_hash, article_ref, source (ingest\|cron) |
| `tax_parameters` | **Built** — versioned, effective-dated rates/thresholds/dates (param_key, value, unit, effective_date, superseded_at) |
| `query_log` | Every Q&A / determination: question, retrieved chunk ids, citations, answer, confidence |
| `audit_log` | Who saw/approved/sent what, when — the trust backbone |
| `compliance_items` | *(planned, Phase 2)* the register: entity, jurisdiction, type, due_date, frequency, authority, status |
| `invoices` | *(planned, Phase 1.5)* Blob ref + extracted fields + determination result |
| `users` / `roles` | *(planned)* Staff, role (F&A reviewer vs. general staff), permissions |

`pgvector` lives on `law_chunks.embedding`; everything else is ordinary relational data in the **same** database — one store, simpler ops.

---

## 9. Security, roles & audit
- **Auth:** Clerk; internal SSO. Two base roles: **F&A reviewer** (approves, sees everything) and **general staff** (asks, uploads, sees own queries).
- **Data isolation:** invoices and filings in **private** Blob; DB access-controlled. Nothing leaves the private pipeline.
- **Audit everything:** every answer, determination, reminder, and sign-off is logged. This is what lets the tax team *trust* the routine work.
- **Model safety:** answers grounded in retrieved context only; the answer contract blocks ungrounded claims.

---

## 10. Component → phase mapping

| Component | Built in |
|-----------|----------|
| Ingestion pipeline + pgvector + answer contract | Phase 0 |
| Chat UI + Cited Q&A + Determination engine | Phase 1 |
| Invoice upload + vision extraction | Phase 1.5 |
| Register + dashboard + cron reminders + exports | Phase 2 |
| Versioned corpus + temporal retrieval + `tax_parameters` + change-detection cron | Phase 3 (built) |
| Impact-flagging workflow (past answers / register entries) | Phase 3 (planned) |
| Draft return preparation + reporting | Phase 4 |

---

## 11. Proposed repo structure
```
tax-bot/
├─ app/                    # Next.js routes (chat, invoices, register, admin)
│  ├─ (chat)/
│  ├─ invoices/
│  ├─ register/
│  └─ api/                 # API routes / server actions
├─ lib/
│  ├─ ai/                  # AI SDK setup, prompts, answer contract
│  ├─ rag/                 # retrieval, ingestion, chunking
│  ├─ determination/       # VAT rules + engine
│  └─ db/                  # Drizzle schema, queries
├─ ingestion/              # crawlers per authority
├─ workflows/              # Vercel Workflow definitions (change-impact)
├─ jobs/                   # cron handlers (reminders)
├─ evals/                  # cited-answer accuracy harness
└─ ROADMAP.md / ARCHITECTURE.md
```

---

## Open technical decisions
1. **Neon Postgres+pgvector** (recommended — one store) vs. a dedicated vector DB (Upstash/Pinecone). Recommend pgvector to keep ops simple since we need relational compliance data anyway.
2. **Crawl vs. manual upload** of source law for Phase 0 — start with a small curated set (CT + VAT core pages), automate crawling later.
3. **Clerk vs. an existing corporate SSO** — confirm whether to integrate with internal identity.
