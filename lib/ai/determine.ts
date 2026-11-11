import { generateObject } from "ai";
import { REASONING_MODEL } from "./models";
import { determinationContract, type DeterminationContract, type InvoiceFields } from "./contracts";
import { getRelevantChunks } from "../rag/context";
import { computeInvoiceVat, type VatComputation } from "../tax/compute";
import { loadParameters, buildRateTable, getNumber, parseAsOf } from "../tax/parameters";
import { db } from "../db";
import { queryLog } from "../db/schema";

// Decides the UAE VAT treatment of a vendor purchase/invoice, grounded in the
// retrieved VAT corpus and cited — the procurement-side sibling of answerQuestion.

const SYSTEM = `You are Lex, helping a UAE finance team decide the VAT treatment of a vendor purchase. Decide ONLY from the provided UAE VAT law passages (each tagged [chunkId:N]).

Return:
- treatment: standard_5 | zero_rated | exempt | out_of_scope | reverse_charge | designated_zone | unknown
- inputVatRecoverable: yes | no | partial | na
- whatToDo: a warm, plain-language next step a non-tax colleague can act on (do NOT mention chunkIds)
- explanation: 3-6 sentences the user reads under the treatment. Name the governing provisions IN THE PROSE (e.g. "Article 45(1) of the VAT Decree-Law", "Article 53 of the Executive Regulations") — never chunkId tags. Explicitly flag anything wrong or worth checking on THIS invoice: VAT charged that differs from the expected rate, a missing/malformed vendor TRN on a standard-rated UAE supply (a valid tax invoice needs one for input VAT recovery), items whose input VAT is blocked or apportioned, or line items that don't fit the stated treatment. If everything is in order, briefly say what was checked and found correct.
- confirmWithFA: true when this needs a human reviewer (low confidence, unusual, or high value)
- confidence, and citations (put the chunkId of every passage you rely on in the citations array)

Grounding to keep in mind: imported SERVICES from a non-UAE supplier are usually reverse-charge (the recipient self-accounts 5% output VAT and may recover it as input VAT, subject to use); imported GOODS attract import VAT / reverse charge; a supplier inside a Designated Zone needs the designated-zone rules checked; a UAE supplier charging 5% is standard-rated (input VAT recoverable when used for taxable supplies).

PARTIAL EXEMPTION / INPUT-TAX APPORTIONMENT: when the recipient uses the purchase for BOTH taxable and exempt supplies — common for a mixed-use real-estate developer buying marketing, agency or general overheads that relate partly to exempt (subsequent residential) and partly to taxable (commercial, or zero-rated first residential supply) outputs — the supplier's charge is still standard-rated, but the recipient's input VAT is recoverable in PART. Set treatment="standard_5" and inputVatRecoverable="partial", and explain that directly-attributable input follows the linked supply (recoverable when linked to taxable/zero-rated, blocked when linked to exempt) while residual/general input is apportioned by the recovery ratio (standard method, with annual wash-up). This IS answerable — do NOT escalate merely because recovery is partial.

BLOCKED INPUT VAT: input VAT on motor vehicles available for personal use, and on employee personal benefits (e.g. entertainment, gym), is blocked even with a valid tax invoice — recoverable="no" for those, while other lines stay recoverable.

Only set confirmWithFA=true for genuinely unusual, high-value, or out-of-scope cases. If the passages don't support a confident call, set treatment="unknown", confirmWithFA=true, confidence="low". Never invent a citation.`;

export async function determineVat(
  fields: InvoiceFields,
): Promise<DeterminationContract & { retrievedChunkIds: number[]; computation: VatComputation }> {
  const supply =
    fields.supplyType === "goods"
      ? "Goods"
      : fields.supplyType === "services"
        ? "Services"
        : "A supply";
  const query = [
    `${supply} purchased from ${fields.vendorName || "a vendor"} in ${fields.vendorCountry || "an unknown country"}.`,
    fields.vendorTRN ? `Vendor UAE TRN: ${fields.vendorTRN}.` : "Vendor has no UAE TRN shown.",
    fields.vatAmount && fields.vatAmount.toLowerCase() !== "none"
      ? `VAT charged on the invoice: ${fields.vatAmount}.`
      : "No VAT was charged on the invoice.",
    fields.description ? `Description: ${fields.description}.` : "",
    fields.lineItems?.length
      ? `Line items: ${fields.lineItems.map((li) => li.description).join("; ")}.`
      : "",
    "What is the UAE VAT treatment for the recipient, and is input VAT recoverable?",
  ]
    .filter(Boolean)
    .join(" ");

  const chunks = await getRelevantChunks(query, { taxType: "VAT", topK: 8 });
  const context = chunks
    .map(
      (c) =>
        `[chunkId:${c.id}] ${c.articleRef ?? "no ref"}` +
        `${c.docTitle ? ` | doc: ${c.docTitle}` : ""}` +
        `${c.sourceUrl ? ` | source: ${c.sourceUrl}` : ""}\n${c.content}`,
    )
    .join("\n\n---\n\n");

  // Free models occasionally return malformed JSON; generateObject doesn't
  // retry schema failures itself, so give it a couple of extra attempts.
  // One shared deadline across the retries so a stall can't hang forever.
  const deadline = AbortSignal.timeout(120_000);
  let object: DeterminationContract | undefined;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3 && !object && !deadline.aborted; attempt++) {
    try {
      ({ object } = await generateObject({
        model: REASONING_MODEL,
        schema: determinationContract,
        temperature: 0,
        maxOutputTokens: 2500, // room for reasoning models (gpt-oss) before the JSON
        abortSignal: deadline,
        system: SYSTEM,
        prompt: `Vendor purchase:\n${query}\n\nUAE VAT law passages:\n\n${
          context || "(none retrieved)"
        }\n\nDetermine the VAT treatment.`,
      }));
    } catch (e) {
      lastErr = e;
    }
  }
  if (!object) throw lastErr;

  // Same structural guard as the answer engine: drop citations that don't map
  // to a retrieved chunk, then enrich them from the real chunk metadata (so the
  // article reference / source link are accurate, not whatever the model typed).
  // "no ref" is the placeholder used in the prompt's context lines — models
  // sometimes copy it verbatim into citations; treat it as empty so the real
  // document title wins instead of a literal "no ref" in the UI.
  const firstOf = (...vals: (string | null | undefined)[]) =>
    vals.find((v) => v && v.trim() && v.trim().toLowerCase() !== "no ref") ?? "";
  const byId = new Map(chunks.map((c) => [c.id, c]));
  const seen = new Set<number>();
  const citations = object.citations
    .filter((c) => byId.has(c.chunkId) && !seen.has(c.chunkId) && seen.add(c.chunkId))
    .map((c) => {
      const ch = byId.get(c.chunkId)!;
      return {
        chunkId: c.chunkId,
        articleRef: firstOf(ch.articleRef, c.articleRef, ch.docTitle) || "FTA source",
        sourceUrl: firstOf(ch.sourceUrl, c.sourceUrl),
        effectiveDate: ch.effectiveDate ?? c.effectiveDate ?? null,
      };
    });
  const result: DeterminationContract = { ...object, citations };
  if (citations.length === 0) {
    result.confirmWithFA = true;
    if (result.confidence === "high") result.confidence = "low";
  }

  // Deterministic numbers: the model chose the treatment above; the arithmetic
  // (expected VAT, charged-vs-expected mismatch, recoverable amount) is code.
  // Rates come from the versioned tax_parameters store, as of the invoice/supply
  // date where parseable — so a rate change is a data edit, not a redeploy.
  const params = await loadParameters();
  const asOf = parseAsOf(fields.invoiceDate) ?? new Date();
  const computation = computeInvoiceVat(fields, result, {
    rates: buildRateTable(params, asOf),
    selfAccountRate: getNumber(params, "vat.standard_rate", asOf) ?? undefined,
  });

  const retrievedChunkIds = chunks.map((c) => c.id);

  // Best-effort audit log; reuse query_log so determinations share the trail.
  try {
    await db.insert(queryLog).values({
      question: `[invoice] ${query}`,
      answer: `${result.treatment} | recoverable: ${result.inputVatRecoverable} | ${result.whatToDo}`,
      status: result.confirmWithFA ? "escalate" : "answered",
      confidence: result.confidence,
      retrievedChunkIds,
      citations: result.citations,
    });
  } catch (e) {
    console.warn("[determine] query_log insert failed:", (e as Error).message);
  }

  return { ...result, retrievedChunkIds, computation };
}
