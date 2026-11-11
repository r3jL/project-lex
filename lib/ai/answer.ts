import { generateObject, generateText, stepCountIs } from "ai";
import { CALC_MODEL, REASONING_MODEL } from "./models";
import { answerContract, type AnswerContract } from "./contracts";
import { taxCalculatorTools } from "./tools";
import { getRelevantChunks } from "../rag/context";
import { db } from "../db";
import { queryLog } from "../db/schema";

const SYSTEM_PROMPT = `You are Lex, a friendly UAE tax assistant for finance teams. You help with UAE Corporate Tax and VAT.

TONE: Write like a helpful, knowledgeable colleague — warm, clear and conversational, in plain language a non-tax person can follow. Lead with the direct answer, then briefly explain why. Be personable and concise; keep the rigour, drop the legalese.

FORMAT: The answer is rendered as markdown — use it where it aids clarity (**bold** for key terms, bullet or numbered lists for steps, and a markdown table when comparing options, rates, or treatments). Don't overformat short answers.

NON-NEGOTIABLE RULES:
1. Answer ONLY from the provided context passages. Each passage is tagged [chunkId:N] for your reference.
2. Ground every claim in a source. Put the source's chunkId in the "citations" array — that is how the system verifies you. But in the "answer" and "reasoning" TEXT, refer to sources by their article or law name (e.g. "Article 18 of the Corporate Tax Law"), NEVER as "[chunkId:N]" — those tags are internal and must not appear in what the user reads.
3. If the context does not contain enough to answer, set status="escalate" and explain warmly, in plain language, what's missing in escalationReason. NEVER guess or use outside knowledge to fill gaps.
4. You are DECISION-SUPPORT, not authority. A human reviews your output — it's fine to say so.
5. Resist false premises. If the question assumes something incorrect, gently point it out in flaggedPremise instead of agreeing.
6. Set confidence honestly: "high" only when settled law is clearly on point; "low" for interpretation or unsettled areas.
7. In "reasoning", give a short, plain-language explanation a finance colleague can follow — not a legal brief. For multi-part questions, address each part. Reference provisions by name, not chunkId.
8. Sources carry a "type" showing legal authority. When passages conflict, the controlling order is: decree_law > cabinet_decision > ministerial_decision > fta_decision > public_clarification / fta_guide. Rely on the higher-authority provision and cite it; a guide or clarification may support the explanation, not override the rule.

CONVERSATION: A "CONVERSATION SO FAR" block may precede the context — the prior turns of this chat (and a summary of older ones). The current question may refer back to it ("that invoice", "recompute with…"). Use it to resolve references, but answer the CURRENT question; legal grounding still comes only from the provided passages.

ATTACHED DOCUMENTS: The user may upload their own document(s) — a contract, invoice, tax notice, etc. When present, their text appears under "ATTACHED DOCUMENT(S)" in the context — including files uploaded in EARLIER turns of this chat, which remain fully usable. Use them to answer questions about their specifics, and apply the UAE tax provisions to them. You may quote the attached document directly. Ground any conclusion about the LAW in the provided provisions and cite their chunkId; facts that come only from the attached document don't need a chunkId. If a document is attached but unreadable or irrelevant to the question, say so plainly.

COMPUTED SCHEDULE: When the context includes a "COMPUTED SCHEDULE" block, its numbers were produced by a deterministic calculator and are AUTHORITATIVE. Present those figures exactly as given — restate them, never recalculate, re-derive, or "correct" them. Surface every warning in the schedule to the user (as assumptions/caveats). Your own arithmetic is not trusted.

You serve a real-estate group, so VAT on real estate (residential vs commercial, first vs subsequent supply) and Corporate Tax (Free Zone / QFZP, thresholds) come up a lot.`;

// ── Calculator phase (Phase A) ────────────────────────────────────────────────
// For computational questions, a short tool-calling pass classifies the facts
// and runs the deterministic calculators BEFORE the answer is composed. Any
// failure here degrades gracefully to the old behaviour (no schedule block).

const CALC_INTENT =
  /calculat|comput|liabilit|taxable income|payable|refundable|how much (tax|vat)|net vat|vat return|(final|total).{0,20}(tax|vat)/i;

// Computational = has real amounts to work with AND asks for figures.
function needsComputation(question: string): boolean {
  return /\d[\d,]{2,}/.test(question) && CALC_INTENT.test(question);
}

const CALC_SYSTEM = `You extract the facts of a UAE tax computation question and call the right calculator tool. You NEVER do arithmetic yourself — your only job is classification:
- Corporate Tax questions → computeCorporateTax. Classify each item: non-deductible expenses in accounting profit are add_back; exempt income (e.g. participation-exempt dividends) is exempt_income; pass entertainment and net interest via their dedicated fields, not as adjustments. If a figure needed for a sub-rule is absent (e.g. EBITDA), omit it — the tool reports what it could not compute.
- SIGN DISCIPLINE: add_back is ONLY for expenses or losses already deducted in accounting profit — it INCREASES taxable income. An INCOME item (gain, dividend, revenue) is NEVER add_back: either leave it out entirely (it stays taxable, no adjustment) or classify it exempt_income/deduct to exclude it. Unrealised accounting gains stay taxable under the default accruals basis — make NO adjustment for them unless the question says a realisation-basis election applies (then: deduct).
- VAT scenario/return questions → computeVatReturn. Categorise every supply and purchase; imports under reverse charge are category reverse_charge; entertainment and partly-personal vehicles are blocked/partial recovery.
Use amounts EXACTLY as stated (net of VAT unless clearly stated otherwise). Call ONE tool once with everything, then stop — no commentary needed.`;

interface CalcResult {
  tool: string;
  input: unknown;
  output: unknown;
}

async function runCalculators(
  question: string,
  attachedSection: string,
  conversationSection = "",
): Promise<CalcResult[] | null> {
  try {
    const res = await generateText({
      model: CALC_MODEL,
      tools: taxCalculatorTools,
      stopWhen: stepCountIs(3),
      temperature: 0,
      abortSignal: AbortSignal.timeout(60_000),
      system: CALC_SYSTEM,
      prompt: `${conversationSection}${question}${attachedSection}`,
    });
    const results: CalcResult[] = res.steps
      .flatMap((s) => s.toolResults ?? [])
      .map((tr) => ({ tool: tr.toolName, input: tr.input, output: tr.output }));
    return results.length ? results : null;
  } catch (e) {
    console.warn("[calc] tool phase failed, answering without a schedule:", (e as Error).message);
    return null;
  }
}

// Deterministic markdown rendering of a computation — used when the model's
// prose omits or mangles the authoritative figures.
function renderComputation(r: CalcResult): string {
  const o = r.output as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || "error" in o) return "";
  const fmt = (n: unknown) =>
    typeof n === "number" ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(n);
  const lines: string[] = ["", "**Computed schedule (deterministic):**", ""];
  if (r.tool === "computeCorporateTax") {
    const sched = o.schedule as { label: string; amount: number; running: number }[];
    lines.push("| Item | AED | Running |", "|---|---:|---:|");
    for (const s of sched) lines.push(`| ${s.label} | ${fmt(s.amount)} | ${fmt(s.running)} |`);
    lines.push(
      `| **Taxable income** | | **${fmt(o.taxableIncome)}** |`,
      `| **Corporate Tax due** | | **${fmt(o.taxDue)}** |`,
    );
  } else if (r.tool === "computeVatReturn") {
    const b = o.boxes as Record<string, number>;
    lines.push("| Return box | AED |", "|---|---:|");
    lines.push(
      `| Standard-rated supplies | ${fmt(b.standardRatedSupplies)} |`,
      `| Zero-rated supplies | ${fmt(b.zeroRatedSupplies)} |`,
      `| Output VAT (incl. reverse charge ${fmt(b.reverseChargeOutputVat)}) | ${fmt(b.totalOutputVat)} |`,
      `| Recoverable input VAT | ${fmt(b.recoverableInputVat)} |`,
      `| Blocked input VAT | ${fmt(b.blockedInputVat)} |`,
      `| **Net VAT payable** | **${fmt(b.netVatPayable)}** |`,
    );
  }
  const warnings = (o.warnings as string[]) ?? [];
  if (warnings.length) {
    lines.push("", "Assumptions / caveats:");
    for (const w of warnings) lines.push(`- ${w}`);
  }
  return lines.join("\n");
}

// The headline figures the answer text MUST contain when a schedule exists.
function keyFigures(results: CalcResult[]): number[] {
  return results.flatMap((r) => {
    const o = r.output as Record<string, unknown> | null;
    if (!o || typeof o !== "object") return [];
    const boxes = o.boxes as Record<string, number> | undefined;
    return [
      o.taxDue,
      o.taxableIncome,
      o.taxableIncomeBeforeLosses,
      boxes?.netVatPayable,
      boxes?.totalOutputVat,
    ].filter((n): n is number => typeof n === "number" && n !== 0);
  });
}

export async function answerQuestion(
  question: string,
  opts: {
    taxType?: "CT" | "VAT";
    attachedDocs?: { name: string; text: string }[];
    // Prior context of this chat: compaction summary + recent verbatim turns.
    conversation?: {
      summary: string | null;
      turns: { role: string; content: string }[];
    };
    // Identity, so an escalation can be routed back to the asker's session.
    username?: string | null;
    sessionId?: number | null;
  } = {},
): Promise<AnswerContract & { retrievedChunkIds: number[]; queryLogId?: number }> {
  // The user's own uploaded files (contract, invoice, notice…) as extra context.
  const attached = opts.attachedDocs ?? [];
  const attachedSection = attached.length
    ? `\n\nATTACHED DOCUMENT(S) the user uploaded:\n\n${attached
        .map((d) => `=== ${d.name} ===\n${d.text}`)
        .join("\n\n---\n\n")}`
    : "";

  const convo = opts.conversation;
  const conversationSection =
    convo && (convo.summary || convo.turns.length)
      ? `CONVERSATION SO FAR (the current question may refer back to this):\n${
          convo.summary ? `[Summary of earlier discussion]\n${convo.summary}\n\n` : ""
        }${convo.turns.map((t) => `${t.role.toUpperCase()}: ${t.content}`).join("\n\n")}\n\n`
      : "";

  // Short follow-ups ("is that recoverable?") embed to nothing useful on their
  // own — anchor the retrieval query with the last substantive user turn.
  const lastUserTurn = [...(convo?.turns ?? [])].reverse().find((t) => t.role === "user");
  const retrievalQuery =
    question.length < 120 && lastUserTurn
      ? `${lastUserTurn.content.slice(0, 500)}\nFollow-up: ${question}`
      : question;

  // Calculator phase FIRST, then retrieval — deliberately sequential. Both the
  // calculator and retrieval's decompose step call the Gateway, and on the free
  // tier two concurrent calls collide with the per-minute rate limit (the 429
  // retry-backoff then eats the whole timeout).
  const calc = needsComputation(question + (lastUserTurn?.content ?? ""))
    ? await runCalculators(question, attachedSection, conversationSection)
    : null;
  const chunks = await getRelevantChunks(retrievalQuery, { taxType: opts.taxType, topK: 8 });

  const context = chunks
    .map(
      (c) =>
        `[chunkId:${c.id}] ${c.articleRef ?? "no ref"}` +
        `${c.docTitle ? ` | doc: ${c.docTitle}` : ""}` +
        `${c.instrument ? ` | type: ${c.instrument}` : ""}` +
        `${c.sourceUrl ? ` | source: ${c.sourceUrl}` : ""}` +
        `${c.effectiveDate ? ` | effective: ${c.effectiveDate}` : ""}\n${c.content}`,
    )
    .join("\n\n---\n\n");

  // Deterministic calculator output, injected as authoritative context.
  const calcSection = calc
    ? `\n\nCOMPUTED SCHEDULE (authoritative — restate these numbers exactly; do not recalculate):\n${JSON.stringify(calc, null, 1)}`
    : "";

  // Reasoning models (gpt-oss) occasionally emit malformed JSON, and routed
  // providers vary — so retry a few times within one deadline before failing.
  const deadline = AbortSignal.timeout(120_000);
  let object: AnswerContract | undefined;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3 && !object && !deadline.aborted; attempt++) {
    try {
      ({ object } = await generateObject({
        model: REASONING_MODEL,
        schema: answerContract,
        temperature: 0, // deterministic, auditable answers for the same question
        // Headroom for reasoning models (gpt-oss "thinks" in output tokens before
        // the JSON); non-reasoning models stop early, so this is just a ceiling.
        // 2500 truncated long multi-part answers mid-JSON now that multi-query
        // retrieval feeds up to 12 chunks of context.
        maxOutputTokens: 4000,
        abortSignal: deadline,
        system: {
          role: "system",
          content: SYSTEM_PROMPT,
          // Cache the (fixed) system prompt so repeat calls within the cache TTL
          // don't re-bill it. Harmlessly ignored by providers that don't support it.
          providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
        },
        prompt: `${conversationSection}Context (retrieved UAE tax provisions):\n\n${
          context || "(no passages retrieved)"
        }${attachedSection}${calcSection}\n\nQuestion: ${question}`,
      }));
    } catch (e) {
      lastErr = e;
    }
  }
  if (!object) throw lastErr;

  // Structural citation guard: drop any citation that doesn't map to a real
  // retrieved chunk, and force escalation if an "answered" response has none.
  const validIds = new Set(chunks.map((c) => c.id));
  const citations = object.citations.filter((c) => validIds.has(c.chunkId));
  const result: AnswerContract = { ...object, citations };

  // Smaller models sometimes leak internal "[chunkId:N]" tags into the prose
  // despite the prompt rule — strip them so users never see them.
  const stripTags = (s: string) =>
    s.replace(/[【\[(]\s*chunkId:\s*\d+\s*[】\])]/gi, "").replace(/ {2,}/g, " ");
  result.answer = stripTags(result.answer);
  if (result.reasoning) result.reasoning = stripTags(result.reasoning);

  // Arithmetic guard. If a computed schedule exists, the answer must contain
  // its headline figures; if any is missing (the model "restated" it wrongly
  // or dropped it), append the deterministic rendering so the user always sees
  // the authoritative numbers.
  if (calc && result.status === "answered") {
    const digitsOnly = result.answer.replace(/[,\s  ]/g, "");
    const missing = keyFigures(calc).some((n) => !digitsOnly.includes(String(n)));
    if (missing) {
      console.warn("[calc] answer text diverged from the computed schedule — appending it.");
      result.answer += "\n" + calc.map(renderComputation).join("\n");
    }
  }
  // A computational question answered with numbers but WITHOUT a successful
  // calculator run means the model did its own arithmetic — don't let that
  // carry "high" confidence.
  if (!calc && needsComputation(question) && result.confidence === "high") {
    result.confidence = "medium";
  }

  // Normally an answered response with no grounded citation is forced to
  // escalate. But when the user attached documents, the answer may legitimately
  // be grounded in those (e.g. "your contract says…") with no corpus citation,
  // so we don't force escalation in that case.
  if (result.status === "answered" && citations.length === 0 && attached.length === 0) {
    result.status = "escalate";
    result.escalationReason =
      result.escalationReason ??
      "No answer could be grounded in the source corpus. Routed to F&A.";
    result.answer = "";
  }

  const retrievedChunkIds = chunks.map((c) => c.id);

  // Best-effort audit log; never block the response on a logging failure.
  let queryLogId: number | undefined;
  try {
    const [row] = await db
      .insert(queryLog)
      .values({
        question,
        answer: result.answer,
        status: result.status,
        confidence: result.confidence,
        taxType: opts.taxType ?? null,
        // Only escalations carry a reason; answered rows store null. This is what
        // the Review Queue shows reviewers, so persist it alongside the question.
        escalationReason:
          result.status === "escalate" ? result.escalationReason ?? null : null,
        retrievedChunkIds,
        citations: result.citations,
        computation: calc,
        // Route-back identity: an escalation is only actionable in the Review
        // Queue when it carries a username + session to return the answer to.
        username: opts.username ?? null,
        sessionId: opts.sessionId ?? null,
      })
      .returning({ id: queryLog.id });
    queryLogId = row?.id;
  } catch (e) {
    console.warn("[answer] query_log insert failed:", (e as Error).message);
  }

  return { ...result, retrievedChunkIds, queryLogId };
}
