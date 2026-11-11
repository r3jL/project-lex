# Project Lex — Phases & Features

**AI Tax Compliance & Intelligence for a UAE finance team**
Internal · MD's Office / F&A · Status: Proposed for review

---

## Guiding principles (apply to every phase)

1. **Grounded & cited** — no answer, report, or determination is produced without a citation to current official law (statute / circular / FTA article) with its date.
2. **Human-in-the-loop** — the system drafts and recommends; a person reviews and signs off. It is **decision-support, not authority**.
3. **No autonomous filing — ever.** Returns are *prepared as drafts*, never submitted by the bot.
4. **Deterministic where it matters** — dates, rates, and figures are computed in code, not guessed by the model.
5. **Walled-off data** — invoices and filings stay in a private, access-controlled pipeline.
6. **UAE only** — one jurisdiction (UAE), two tax types (CT + VAT). Multi-jurisdiction is not a current goal; optimise for UAE accuracy.

---

## Phase overview

| Phase | Theme | Jurisdiction(s) | Risk | Primary value |
|-------|-------|-----------------|------|---------------|
| **0** | Foundation & knowledge pipeline | UAE | Low | Enables everything else |
| **1** | Cited VAT/Tax Q&A + Vendor Determination | UAE | Medium | Deflects routine queries from F&A |
| **1.5** | Invoice upload & extraction | UAE | Medium | The "wow" demo; AP/procurement self-serve |
| **2** | Compliance Register + Deadline Tracker | UAE | **Low** | Highest-value, zero hallucination |
| **3** | Change-Impact Engine *(foundation built)* | UAE | High | Keeps everything current automatically |
| **4** | Return Preparation (draft only) + Reporting | UAE | High | Biggest time-saver, tightest guardrails |

---

## Phase 0 — Foundation & Knowledge Pipeline
**Goal:** a private, repeatable pipeline that ingests official UAE tax sources and makes them searchable with citations.

**Features**
- Source ingestion from official sites (tax.gov.ae — Corporate Tax + VAT to start)
- Document chunking + embeddings into a vector store
- Every chunk tagged with **source URL, article/clause ref, and date**
- Retrieval layer that returns text *with* its citation
- Project scaffolding, auth, hosting, CI

**Need from F&A:** confirmation of priority jurisdiction (UAE) and tax types (CT + VAT).
**Success:** ask a question, get back the correct source passages with citations.

---

## Phase 1 — Cited VAT/Tax Q&A + Vendor Determination Assistant
**Goal:** non-F&A staff (procurement, AP, projects) resolve routine tax questions instantly; F&A handle only the genuine edge cases.

**Features**
- Chat interface, grounded answers, **every answer cites the source clause + date**
- **Vendor VAT determination (question + context mode):** describe a transaction → likely treatment (5% standard / zero-rated / exempt / out-of-scope / **reverse charge** / designated zone) + recoverable vs. blocked input VAT
- **Confidence + escalation routing:** clear cases answered instantly; ambiguous ones flagged *"needs F&A — here's why"*
- Standard disclaimer on every output: *decision-support, confirm with F&A for edge cases*
- Query logging (for accuracy review + to measure F&A time saved)

**Need from F&A:** ~20–30 sample real questions with their correct answers (the eval set).
**Success:** answers the eval set with correct, cited treatment; reviewed and approved by Chahat's team.
**Maps to:** email points 3 & 5; Project Lex "Cited Q&A".

---

## Phase 1.5 — Invoice Upload & Extraction
**Goal:** "upload a vendor invoice + context → get the VAT treatment and what to do, cited."

**Features**
- Upload PDF/image invoice → extract vendor, country, amount, line items, tax shown
- Feed extracted data + user context into the Phase 1 determination engine
- Output: likely treatment, what to do next, what to confirm with F&A — cited
- Handles the common cross-border case (imported services → reverse charge)

**Need from F&A:** a handful of sample (anonymised) vendor invoices across treatment types.
**Success:** correctly triages a test set of real invoices.
**Maps to:** the new vendor-department use case.

---

## Phase 2 — Compliance Register + Deadline Tracker
**Goal:** one source of truth for *what is due, when, where* — with reminders. Deterministic, no AI hallucination risk.

**Features**
- **Compliance Register:** Jurisdiction | Compliance Type | Due Date | Frequency | Governing Authority | Status
- **Deadline Tracker / calendar:** Due This Week | This Month | Overdue | Completed
- **Auto-reminders** at 30 / 15 / 7 / 1 days (email first; SMS/WhatsApp later)
- Overdue items flagged red with escalation
- Export register to **PDF / Excel**

**Need from F&A:** existing compliance checklist (any format) + list of entities/jurisdictions.
**Success:** a live register for UAE with working reminders, validated by F&A.
**Maps to:** email points 1 & 2; Project Lex "Compliance Register" + "Deadline Tracker".
> Note: lowest-risk, high-value module — recommended to build **in parallel** with Phase 1.

---

## Phase 3 — Change-Impact Engine  *(foundation built)*
**Goal:** when a UAE law changes, the system detects it and re-runs every answer/report that relied on the old rule.

**Built (foundation)**
- **Versioned corpus + temporal correctness** — ingestion is incremental and idempotent; a changed provision's old chunk is `superseded` (kept for audit) and retrieval returns only law currently in force, so answers never cite repealed law.
- **Law Monitor (scheduled detection)** — a weekly Vercel Cron re-fetches curated FTA sources, diffs them by content hash, and flags changes into a `law_changes` audit table (flag-only; a human reviews and re-ingests).
- **Rates/thresholds as versioned data** (`tax_parameters`) — changing a rate (e.g. VAT 5% → 7%) is a data edit, not a redeploy.

**Still to build**
- On a detected change, **automatically flag** the affected register entries, cached answers, and reports for human re-review (a durable Vercel Workflow; the citation→chunk links already exist in `query_log`).

**Success:** a real amendment is detected and the affected items are flagged automatically.
**Maps to:** Project Lex "Change-Impact Engine".

---

## Phase 4 — Return Preparation (Draft Only) + Reporting
**Goal:** prepare return drafts and structured compliance reports — strictly draft + human sign-off.

**Features**
- Draft return preparation from source data (**never filed by the bot**)
- Figures computed in code, fully traceable; reconciled for review
- Monthly compliance reports (PDF/Excel) per the register format
- Full audit log of every draft and the human who signed off

**Success:** a return draft a reviewer accepts with only minor edits.
**Maps to:** email point 4 (de-risked to draft-only); Project Lex "Return Preparation".

---

## Explicitly OUT of scope
- ❌ **Autonomous / automatic tax-return filing** — drafts only, human files.
- ❌ Tax *optimisation* / aggressive positions — lawful compliance only.
- ❌ Multi-jurisdiction support — **UAE only** for now; other jurisdictions are not in scope.
- ❌ Any answer or determination without a citation.

---

## Traceability — original asks → phases

| Original request | Where it lives |
|------------------|----------------|
| Email 1 — compliance reports per jurisdiction | Phase 2 + 4 |
| Email 2 — compliance tracker + reminders | Phase 2 |
| Email 3 — chatbot for tax consultation | Phase 1 |
| Email 4 — automate tax returns | Phase 4 (draft-only) |
| Email 5 — accuracy + time reduction | Cross-cutting (principles, eval set, logging) |
| New — vendor VAT self-check for other departments | Phase 1 + 1.5 |

---

## Decisions needed from F&A before build
1. Confirm **UAE + Corporate Tax & VAT** as the Phase 1 scope.
2. Provide the **eval set** (~20–30 Q&A) and existing **compliance checklist**.
3. Provide **sample anonymised invoices** (for Phase 1.5).
4. Agree the definition of "done" for Phase 1 (eval pass rate + F&A sign-off).
