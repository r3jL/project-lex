# Project Lex — UAE Tax Bot

An AI assistant that answers UAE **VAT & Corporate Tax** questions for finance
teams — grounded in official FTA law, **every answer cited**, decision-support
only (a human reviews; the bot never files anything).

> Built during an internship as an internal tool for a UAE real-estate
> developer's finance team. This public copy is a portfolio demo: company names
> and sample data are fictional, and the internal access gate has been removed.

## What it does (Phase 1)
- **Cited Q&A** on UAE VAT + Corporate Tax (answers trace to the actual Decree-Law / Decision / Guide)
- **Vendor VAT / tax-invoice check** — "is this invoice valid to claim input VAT?" (the priority use case)
- **Escalates** instead of guessing when the corpus doesn't support an answer

Read [ROADMAP.md](ROADMAP.md) for phases/features and [ARCHITECTURE.md](ARCHITECTURE.md) for the full technical design.

---

## Get running

```bash
git clone https://github.com/<you>/lex-tax.git
cd lex-tax
npm install
cp .env.example .env.local        # then pick your AI providers — see below
```

Configure **chat** and **embeddings** providers in `.env.local` (see
[AI providers](#ai-providers-swappable)), then build the knowledge base and run.

With a database (`DATABASE_URL` set → Neon + pgvector — the current setup):

```bash
npm run db:setup              # enable pgvector (first time only)
npm run db:push -- --force    # create tables at the configured embedding size
npm run db:migrate-additive   # add versioning/supersession cols + law_changes + tax_parameters
npm run db:seed-params        # seed the versioned tax_parameters (rates/thresholds)
npm run ingest                # corpus PDFs → chunks → embeddings → DB (incremental)
npm run dev                   # http://localhost:3000
```

No database? Leave `DATABASE_URL` unset and just `npm run ingest && npm run dev`
— it embeds to `lib/rag/corpus-index.json` instead (one less moving part).

### Updating the corpus when a law changes

Ingestion is **incremental and idempotent** — drop the updated official file into
`corpus/` (and set its `effectiveDate`/`version` in `corpus/manifest.json`) and run:

```bash
npm run db:migrate-additive   # no-op if already applied
npm run ingest                # diffs by content hash: re-embeds only changed chunks
```

Re-running on an unchanged corpus does nothing. Changed chunks are inserted fresh
and the old ones are marked `superseded` (kept for audit/history, excluded from
retrieval). Every diff is recorded in `law_changes`. You no longer need the
destructive `db:reset` for routine updates — keep it only for an embedding-dimension
change (the one case the pgvector column must be recreated).

To change a **rate/threshold** (e.g. VAT 5% → 7%), don't edit code: insert a new
effective-dated row in `tax_parameters` and set `superseded_at` on the old one. The
new value is picked up within one cache TTL (`TAX_PARAM_TTL_MS`, default 5 min).

---

## AI providers (swappable)

**Chat** (answers + reranker) and **embeddings** (retrieval) are configured
**independently**. Set `REASONING_PROVIDER` and `EMBEDDING_PROVIDER` (or
`AI_PROVIDER` to default both). All non-gateway backends speak the OpenAI API,
so one client handles them — only the base URL + key differ.

| provider | role | key / URL |
|---|---|---|
| `gateway` *(default)* | Vercel AI Gateway → Claude / OpenAI / … | `AI_GATEWAY_API_KEY` |
| `openrouter` | free + paid hosted LLMs *(chat only)* | `OPENROUTER_API_KEY` |
| `groq` | fast free-tier LLMs *(chat only)* | `GROQ_API_KEY` |
| `google` | Gemini + **free embeddings** | `GOOGLE_API_KEY` ([AI Studio](https://aistudio.google.com/apikey)) |
| `ollama` | self-hosted LAN box / VM | `OLLAMA_BASE_URL` |

Chat-only backends (OpenRouter, Groq) have no embeddings endpoint — embeddings
then fall back to the Gateway automatically.

**Current POC setup (fully free): chat on OpenRouter, embeddings on local Ollama.**

```env
# chat — OpenRouter free tier
REASONING_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-...
REASONING_MODEL=nvidia/nemotron-3-super-120b-a12b:free   # fast fallback: openai/gpt-oss-20b:free
RERANK_ENABLED=false                                     # free tiers are rate-limited; halves LLM calls

# embeddings — local Ollama (free + unlimited; Ollama must be running)
EMBEDDING_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434/v1
EMBEDDING_MODEL=nomic-embed-text                         # `ollama pull nomic-embed-text` (~270 MB)
EMBEDDING_DIMENSIONS=768
```

> Embeddings run on the Mac via Ollama, so **Ollama must be running** (`ollama serve`)
> both to `npm run ingest` and to answer questions. Google AI Studio
> (`EMBEDDING_PROVIDER=google`, `gemini-embedding-001`) also works but its free tier
> caps at 1,000 embeds/day — too small for the 3,029-chunk corpus in one run; set
> `EMBED_RPM=90` if you use it.

### Switching chat to a self-hosted Ollama box / VM
Pull the model on the box (`ollama pull qwen2.5:14b`) and make Ollama listen on
`0.0.0.0:11434`. Then point the **chat** provider at it — embeddings stay on
Google, so there's nothing to re-ingest:

```env
REASONING_PROVIDER=ollama
OLLAMA_BASE_URL=http://<vm-ip>:11434/v1
REASONING_MODEL=qwen2.5:14b      # use the EXACT tag from `ollama list` (there is no qwen3.5)
```

Restart `npm run dev` and chat runs on your VM.

### Changing the embedding model → re-index
The pgvector column size is fixed at create time, so whenever you change
`EMBEDDING_MODEL` / `EMBEDDING_DIMENSIONS` (or want to clear duplicate rows),
rebuild the index:

```bash
npm run db:reset              # drop documents + law_chunks
npm run db:push -- --force    # recreate at the new dimension
npm run db:migrate-additive   # re-add versioning cols + law_changes + tax_parameters
npm run db:seed-params        # re-seed tax_parameters
npm run ingest                # re-embed the corpus
```

---

## How it works (short version)
```
question → embed → retrieve top chunks from corpus index
        → rank (semantic + authority: Decree-Law > Decision > Guide)
        → the configured LLM generates a CITED answer (or escalates)  → UI
```
- `lib/rag/` — chunking, retrieval, the seed/local-index/DB sources
- `lib/ai/` — model config, the **cited-or-escalate answer contract**, the answer engine
- `app/` — chat UI + `/api/chat`
- `scripts/ingest.ts` — corpus → searchable index (PDF-aware, article-aware, authority-tagged)
- `corpus/` — 55 official FTA documents (VAT + CT laws, decisions, guides, public clarifications)

## Knowledge base
`corpus/` holds the committed **public** FTA grounding docs. Drop new public
docs into the right subfolder and re-run `npm run ingest`.
**Confidential** material (sample invoices, internal checklists) goes in
`corpus/confidential/` — it's git-ignored, never commit it.

---

## Working together
- `git pull` before you start.
- Branch per change: `git checkout -b feature/x`, open a PR into `main`.
- Don't commit `.env.local` (ignored) or anything under `corpus/confidential/`.

## What's next (open tasks)
1. **Bilingual support** — FTA PDFs are Arabic+English; segment chunks by language (`en`/`ar`) so Arabic queries work + the binding Arabic text is preserved.
2. **Cross-encoder reranker** — re-score top candidates before the LLM (precision boost).
3. **Model tiering** — Haiku for simple invoice checks, Sonnet for Q&A, Opus for hard QFZP/multi-hop questions (cost control).
4. **F&A eval set** — ~20–30 real questions + correct cited answers to benchmark accuracy.
5. Phase 2: compliance register + deadline tracker.

## Decisions already made (don't re-litigate)
- **RAG over a frontier model (Claude), not a self-trained/3B model** — accuracy + cost win for a high-stakes tax tool (see chat history / cost analysis).
- **Cited-or-escalate is structural** — no answer ships without a source.
- **No autonomous filing** — draft + human sign-off only.
