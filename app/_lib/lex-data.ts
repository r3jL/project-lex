// Static content + types for the Project Lex workspace.
//
// The "Ask" module talks to the real /api/chat backend; the canned SAMPLES here
// drive the example chips and serve as an offline fallback when the API is not
// reachable. Every other module is "Planned" in the design and is rendered from
// the showcase data below.

// Display / heading typeface. Historically a serif; now Inter (the free Söhne
// stand-in) so the whole UI matches ChatGPT's neo-grotesque look. Name kept as
// SERIF since it's referenced widely.
export const SERIF =
  "var(--font-sans), -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

// Monospace — stands in for Söhne Mono, used for code and user inputs.
export const MONO =
  "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, monospace";

export type Confidence = "high" | "medium" | "low";
export type Role = "staff" | "reviewer";
export type TaxFilter = "All" | "Corporate Tax" | "VAT";

// Session HISTORY (the browsable sidebar archive + notification bell) is
// feature-flagged OFF for now, pending real auth (Entra ID) — the current
// username is a claimable handle, not an identity, so a browsable archive
// keyed to it is premature. The flag only hides the archive UI: the live
// conversation still uses its session server-side for multi-turn context,
// files and compaction. Re-enable with NEXT_PUBLIC_SESSION_HISTORY=on.
export const SESSION_HISTORY_ENABLED = process.env.NEXT_PUBLIC_SESSION_HISTORY === "on";

export type ModuleKey =
  | "ask"
  | "vendor"
  | "invoice"
  | "register"
  | "queue"
  | "alerts"
  | "reports"
  | "history";

export interface Citation {
  chunkId?: number;
  articleRef: string;
  sourceUrl: string;
  effectiveDate: string | null;
}

// Mirrors the /api/chat AnswerContract, plus an optional transport error.
export interface AnswerResult {
  status: "answered" | "escalate";
  answer: string;
  reasoning: string;
  citations: Citation[];
  confidence: Confidence;
  flaggedPremise: string | null;
  escalationReason: string | null;
  error?: string;
}

export type Message =
  | { role: "user"; text: string; files?: string[] }
  | { role: "assistant"; resp: AnswerResult; showReasoning: boolean }
  // A human answer sent back from the Review Queue into this thread.
  | { role: "reviewer"; text: string; from?: string; messageId?: number }
  // An inline invoice VAT check (the merged Ask+Invoice workspace). Progresses
  // extracting → review (editable fields) → determining → done; "error" keeps
  // the card with a message instead of losing the upload.
  | {
      role: "invoice";
      // Client-side key for in-place updates while the flow progresses.
      // Absent on cards reloaded from history (no further interaction).
      uid?: number;
      fileName: string;
      phase: "extracting" | "review" | "determining" | "done" | "error";
      fields?: InvoiceFieldsData;
      det?: Determination;
      error?: string;
    };

// A saved chat session shown in the sidebar (from GET /api/sessions).
export interface SessionSummary {
  id: number;
  title: string;
  updatedAt: string;
}

// An unread "your question was answered" ping (from GET /api/notifications).
export interface NotificationItem {
  id: number;
  sessionId: number;
  messageId: number | null;
  title: string;
  createdAt: string;
}

export interface Sample {
  key: string;
  label: string;
  filter: TaxFilter;
  q: string;
  resp: AnswerResult;
}

// ── Invoice Upload / Vendor VAT Check ────────────────────────────────────────
// Mirrors invoiceFieldsContract + determinationContract from lib/ai/contracts.
export type SupplyType = "goods" | "services" | "mixed" | "unknown";
export type InvoiceLanguage = "en" | "ar" | "mixed" | "unknown";

export interface InvoiceFieldsData {
  vendorName: string;
  vendorCountry: string;
  vendorTRN: string | null;
  currency: string;
  subtotal: string;
  vatAmount: string;
  total: string;
  invoiceDate: string | null;
  description: string;
  lineItems: { description: string; amount: string }[];
  supplyType: SupplyType;
  language: InvoiceLanguage;
}

export type Treatment =
  | "standard_5"
  | "zero_rated"
  | "exempt"
  | "out_of_scope"
  | "reverse_charge"
  | "designated_zone"
  | "unknown";

export interface VatComputationData {
  currency: string;
  net: number | null;
  vatCharged: number | null;
  total: number | null;
  expectedRate: number | null;
  expectedVat: number | null;
  selfAccountedVat: number | null;
  recoverableInputVat: number | null;
  mismatch: {
    status: "match" | "overcharged" | "undercharged" | "vat_not_expected" | "unknown";
    delta: number | null;
    message: string;
  };
  notes: string[];
}

export interface Determination {
  treatment: Treatment;
  inputVatRecoverable: "yes" | "no" | "partial" | "na";
  whatToDo: string;
  // Law-citing rationale + anything wrong on this invoice. Absent on checks
  // persisted before the field existed — render conditionally.
  explanation?: string;
  confirmWithFA: boolean;
  citations: Citation[];
  confidence: Confidence;
  computation?: VatComputationData;
  error?: string;
}

export const MISMATCH_LABELS: Record<VatComputationData["mismatch"]["status"], string> = {
  match: "VAT matches",
  overcharged: "Overcharged",
  undercharged: "Undercharged",
  vat_not_expected: "VAT shouldn’t apply",
  unknown: "Not compared",
};

// A SIMULATED (canned) invoice result — instant demo, no backend/model call.
export const SAMPLE_INVOICE: { fields: InvoiceFieldsData; determination: Determination } = {
  fields: {
    vendorName: "Example Ready-Mix Concrete LLC",
    vendorCountry: "United Arab Emirates",
    vendorTRN: "100000000000003",
    currency: "AED",
    subtotal: "100,800.00",
    vatAmount: "5,040.00",
    total: "105,840.00",
    invoiceDate: "04 May 2026",
    description: "Ready-mix concrete supply & delivery and concrete pump hire",
    lineItems: [
      { description: "Ready-mix concrete, Grade C40 (supply & delivery)", amount: "AED 91,200.00" },
      { description: "Concrete pump hire", amount: "AED 9,600.00" },
    ],
    supplyType: "goods",
    language: "en",
  },
  determination: {
    treatment: "standard_5",
    inputVatRecoverable: "yes",
    whatToDo:
      "Record the supplier's invoice and claim the AED 5,040 VAT as input tax on your next VAT return — the concrete and pump hire are used for your taxable property development, so the input VAT is recoverable. Keep the supplier's TRN on file.",
    confirmWithFA: false,
    confidence: "high",
    citations: [
      {
        articleRef: "VAT Real Estate Guide (VATGRE1)",
        sourceUrl: "https://tax.gov.ae/en/taxes/vat.aspx",
        effectiveDate: null,
      },
    ],
    computation: {
      currency: "AED",
      net: 100800,
      vatCharged: 5040,
      total: 105840,
      expectedRate: 0.05,
      expectedVat: 5040,
      selfAccountedVat: null,
      recoverableInputVat: 5040,
      mismatch: { status: "match", delta: 0, message: "VAT charged matches the expected 5%." },
      notes: [],
    },
  },
};

// Human labels for the detected invoice language, shown as a badge on the card.
export const INVOICE_LANGUAGE_LABELS: Record<InvoiceLanguage, string> = {
  en: "English",
  ar: "Arabic",
  mixed: "Bilingual · AR / EN",
  unknown: "Language unknown",
};

// Editable field rows shown in the "Extracted fields — confirm" card.
export const INVOICE_FIELD_LABELS: { key: keyof InvoiceFieldsData; label: string }[] = [
  { key: "vendorName", label: "Vendor" },
  { key: "vendorCountry", label: "Country" },
  { key: "vendorTRN", label: "Vendor TRN" },
  { key: "description", label: "Description" },
  { key: "currency", label: "Currency" },
  { key: "subtotal", label: "Subtotal" },
  { key: "vatAmount", label: "VAT shown" },
  { key: "total", label: "Total" },
];

// Static fallback labels. The two rate-bearing labels (standard/zero) are made
// live via treatmentLabel() below so the displayed % tracks tax_parameters.
export const TREATMENT_LABELS: Record<Treatment, string> = {
  standard_5: "Standard-rated (5%)",
  zero_rated: "Zero-rated (0%)",
  exempt: "Exempt",
  out_of_scope: "Out of scope",
  reverse_charge: "Reverse charge",
  designated_zone: "Designated Zone",
  unknown: "Needs review",
};

// Label for a determination. For standard/zero-rated, show the LIVE computed
// rate (which now comes from the versioned tax_parameters store) instead of a
// hardcoded "5%". Falls back to the static label when no computation is present.
export function treatmentLabel(
  treatment: Treatment,
  computation?: VatComputationData,
): string {
  const rate = computation?.expectedRate;
  if (rate != null && (treatment === "standard_5" || treatment === "zero_rated")) {
    const base = treatment === "standard_5" ? "Standard-rated" : "Zero-rated";
    return `${base} (${+(rate * 100).toFixed(2)}%)`;
  }
  return TREATMENT_LABELS[treatment];
}

export const RECOVERABLE_LABELS: Record<Determination["inputVatRecoverable"], string> = {
  yes: "Input VAT recoverable",
  no: "Input VAT not recoverable",
  partial: "Input VAT partially recoverable",
  na: "Recoverability N/A",
};

export interface ModuleMeta {
  title: string;
  sub: string;
  desc: string;
}

export const MODULES: Record<ModuleKey, ModuleMeta> = {
  ask: { title: "Ask", sub: "Q&A + invoice checks", desc: "" },
  vendor: {
    title: "Vendor VAT Check",
    sub: "Transaction treatment",
    desc: "Describe a transaction or vendor and get the likely VAT treatment, whether input VAT is recoverable, what to do next, and citations. Low-confidence cases route to the review queue.",
  },
  invoice: {
    title: "Invoice Upload",
    sub: "Extract & determine",
    desc: "Drag in a PDF or image invoice. Lex extracts the fields for your confirmation, then runs the Vendor VAT Check and returns a cited treatment with a next step.",
  },
  register: {
    title: "Compliance Register & Deadlines",
    sub: "Filings & due dates",
    desc: "Track every entity’s filing obligations, due dates and status across the FTA and other authorities, with reminders and exports.",
  },
  queue: {
    title: "Review Queue",
    sub: "Awaiting sign-off",
    desc: "Escalated questions and flagged determinations waiting for a Finance Reviewer to approve, edit, or send back.",
  },
  alerts: {
    title: "Change Alerts",
    sub: "When the law moves",
    desc: "When UAE FTA law changes, see which past answers, register items and reports relied on the old rule and now need re-review.",
  },
  reports: {
    title: "Reports & Draft Returns",
    sub: "Prepare, never file",
    desc: "Generate compliance reports and prepare DRAFT tax returns. Computed figures are shown for review and fully traceable — Lex never files.",
  },
  history: {
    title: "History",
    sub: "Audit trail",
    desc: "A log of past questions and determinations with their answers and citations.",
  },
};

// "invoice" is intentionally absent: invoice checks now live inline in the
// Ask thread (the merged workspace), not behind their own tab.
export const NAV_ORDER: ModuleKey[] = [
  "ask",
  "queue",
  "vendor",
  "register",
  "alerts",
  "history",
  "reports",
];

// Claude-style sidebar: a few primary modules always visible, the rest tucked
// under an expandable "More".
export const PRIMARY_NAV: ModuleKey[] = ["ask", "queue", "vendor"];
export const MORE_NAV: ModuleKey[] = ["register", "alerts", "history", "reports"];

export const REVIEWER_ONLY: Partial<Record<ModuleKey, boolean>> = { queue: true };

export const CONF_MAP: Record<Confidence, { label: string; color: string }> = {
  high: { label: "High confidence", color: "#2f7a52" },
  medium: { label: "Medium confidence", color: "#9a6b18" },
  low: { label: "Low confidence", color: "#b0453a" },
};

export const STATUS_MAP: Record<string, { color: string; bg: string }> = {
  Due: { color: "#9a6b18", bg: "#f7efdd" },
  Upcoming: { color: "#6b6b66", bg: "#f0efec" },
  Overdue: { color: "#b0453a", bg: "#f6e7e4" },
  Completed: { color: "#2f7a52", bg: "#eaf3ee" },
};

export const HIST_MAP: Record<string, { label: string; color: string; bg: string }> = {
  answered: { label: "Answered", color: "#2f7a52", bg: "#eaf3ee" },
  escalated: { label: "Escalated", color: "#9a6b18", bg: "#f7efdd" },
};

// ── Showcase data for the "Planned" modules ──────────────────────────────────

export const INVOICE_FIELDS: { k: string; v: string }[] = [
  { k: "Vendor", v: "Bright Consulting Ltd" },
  { k: "Country", v: "United Kingdom" },
  { k: "Currency", v: "GBP" },
  { k: "Amount", v: "£10,500.00" },
  { k: "Tax shown", v: "None (0%)" },
];

export const TILES: { n: string; label: string; color: string }[] = [
  { n: "2", label: "Due this week", color: "#9a6b18" },
  { n: "5", label: "Due this month", color: "#1a1a1a" },
  { n: "1", label: "Overdue", color: "#b0453a" },
  { n: "12", label: "Completed (YTD)", color: "#2f7a52" },
];

export interface RegisterRow {
  entity: string;
  type: string;
  due: string;
  freq: string;
  authority: string;
  status: "Due" | "Upcoming" | "Overdue" | "Completed";
}

export const REGISTER: RegisterRow[] = [
  { entity: "Example Developments FZ-LLC", type: "VAT Return", due: "28 Jul 2026", freq: "Quarterly", authority: "FTA", status: "Due" },
  { entity: "Example Contracting LLC", type: "Corporate Tax Return", due: "30 Sep 2026", freq: "Annual", authority: "FTA", status: "Upcoming" },
  { entity: "Example Developments FZ-LLC", type: "VAT Return", due: "28 Apr 2026", freq: "Quarterly", authority: "FTA", status: "Overdue" },
  { entity: "Example Holdings LLC", type: "Economic Substance", due: "30 Jun 2026", freq: "Annual", authority: "MoF", status: "Due" },
  { entity: "Example Contracting LLC", type: "VAT Return", due: "28 Jan 2026", freq: "Quarterly", authority: "FTA", status: "Completed" },
];

export interface QueueItem {
  q: string;
  from: string;
  when: string;
  type: string;
  reason: string;
  // Set on real (cloud-backed) escalations; absent on the mock showcase rows.
  id?: number;
  confidence?: Confidence | null;
  taxType?: string | null;
}

// A row from GET /api/review-queue (escalated query_log entries). Dates arrive
// as ISO strings over JSON.
export interface ReviewQueueRow {
  id: number;
  question: string;
  escalationReason: string | null;
  confidence: Confidence | null;
  taxType: string | null;
  username: string | null;
  createdAt: string;
}

// Compact "2h ago" style timestamp for the Review Queue. Client-only.
export function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-AE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Map a cloud row into the QueueItem shape the list + Drawer already render.
export function reviewRowToQueueItem(r: ReviewQueueRow): QueueItem {
  return {
    id: r.id,
    q: r.question,
    from: r.username ? `@${r.username}` : "Ask",
    when: relativeTime(r.createdAt),
    type: "Escalated question",
    reason:
      r.escalationReason ??
      "No grounded answer in the source corpus — routed to a finance reviewer.",
    confidence: r.confidence,
    taxType: r.taxType,
  };
}

export const QUEUE: QueueItem[] = [
  { q: "How should we price the intercompany loan from our Cyprus parent to stay transfer-pricing compliant?", from: "J. Smith", when: "2h ago", type: "Escalated question", reason: "Cross-border transfer pricing, non-UAE jurisdiction." },
  { q: "Vendor VAT Check — imported consulting (UK), AED 50,000", from: "M. Garcia", when: "5h ago", type: "Flagged determination", reason: "Low confidence: reverse-charge vs out-of-scope." },
  { q: "Is staff accommodation lease exempt or zero-rated?", from: "K. Lee", when: "1d ago", type: "Escalated question", reason: "Ambiguous residential vs serviced classification." },
];

export interface AlertItem {
  title: string;
  date: string;
  impact: string;
  needsReview: boolean;
  dot: string;
}

export const ALERTS: AlertItem[] = [
  { title: "VAT Executive Regulation amended — Art. 53 (input tax on motor vehicles)", date: "10 Jun 2026", impact: "3 past answers and 1 register item relied on the previous wording.", needsReview: true, dot: "#c9952a" },
  { title: "Corporate Tax — Free Zone Cabinet Decision 100/2023 updated", date: "22 May 2026", impact: "2 determinations need re-review.", needsReview: true, dot: "#c9952a" },
  { title: "FTA public clarification issued (VATP0xx)", date: "30 Apr 2026", impact: "No prior answers affected.", needsReview: false, dot: "#b4b4ae" },
];

export interface ReportItem {
  name: string;
  meta: string;
  draft: boolean;
}

export const REPORTS: ReportItem[] = [
  { name: "VAT Return — Q2 2026", meta: "Period 01 Apr – 30 Jun 2026 · 14 determinations", draft: true },
  { name: "Corporate Tax Return — FY2025", meta: "Period 01 Jan – 31 Dec 2025", draft: true },
  { name: "VAT Reconciliation Report", meta: "Output vs input tax, by entity", draft: false },
  { name: "Input Tax Recovery Summary", meta: "Recoverable vs blocked, by category", draft: false },
];

export const RETURN_ROWS: { label: string; val: string }[] = [
  { label: "Standard-rated supplies (5%)", val: "AED 4,820,000" },
  { label: "Zero-rated supplies", val: "AED 1,150,000" },
  { label: "Output VAT due", val: "AED 241,000" },
  { label: "Recoverable input VAT", val: "AED 188,400" },
  { label: "Net VAT payable", val: "AED 52,600" },
];

export interface HistoryItem {
  q: string;
  status: "answered" | "escalated";
  conf: Confidence | null;
  when: string;
  refs: string;
}

export const HISTORY: HistoryItem[] = [
  { q: "Is the first sale of a new residential building zero-rated for VAT?", status: "answered", conf: "high", when: "Today 09:14", refs: "Art. 45(9) +1 source" },
  { q: "Can we recover input VAT on the company car for the sales director?", status: "answered", conf: "medium", when: "Yesterday 16:02", refs: "Exec. Reg. Art. 53" },
  { q: "Does Free Zone rental income count as Qualifying Income at 0%?", status: "answered", conf: "low", when: "2 days ago", refs: "CT Art. 18 +1 source" },
  { q: "Intercompany loan pricing (Cyprus parent)", status: "escalated", conf: null, when: "2 days ago", refs: "Routed to review" },
];

// ── Canned Q&A samples (example chips + offline fallback) ─────────────────────

export const SAMPLES: Sample[] = [
  {
    key: "residential",
    label: "Residential first supply",
    filter: "VAT",
    q: "Is the first sale of a new residential building zero-rated for VAT?",
    resp: {
      status: "answered",
      confidence: "high",
      flaggedPremise: null,
      escalationReason: null,
      answer:
        "Yes. The first supply of a newly constructed residential building is zero-rated for VAT, provided the supply is made within three years of the building’s completion. This applies whether the first supply is by sale or by lease.\n\nBecause the first supply is zero-rated rather than exempt, the developer can recover input VAT incurred on the construction, subject to the normal input-tax recovery rules. Any subsequent supply of the same residential building is exempt, not zero-rated.",
      reasoning:
        "1. Identify the supply: the first sale of a newly built residential building.\n2. VAT treatment of residential property turns on whether it is the “first supply.”\n3. Art. 45(9) of the VAT Decree-Law zero-rates the first supply of residential buildings made within 3 years of completion.\n4. Executive Regulation Art. 41 confirms the 3-year window and that the first supply may be by sale or lease.\n5. Conclusion: zero-rated, with input-tax recovery on construction costs.",
      citations: [
        { articleRef: "Article 45(9)", effectiveDate: "2018-01-01", sourceUrl: "https://tax.gov.ae/" },
        { articleRef: "Exec. Regulation Art. 41", effectiveDate: "2018-01-01", sourceUrl: "https://tax.gov.ae/" },
      ],
    },
  },
  {
    key: "car",
    label: "Input VAT on a company car",
    filter: "VAT",
    q: "Can we recover the input VAT on the company car bought for the sales director’s personal use?",
    resp: {
      status: "answered",
      confidence: "medium",
      escalationReason: null,
      flaggedPremise:
        "Your question assumes the car is available for the director’s personal use. Input VAT on a motor vehicle that is available for personal use is specifically blocked — so that detail changes the answer.",
      answer:
        "No — not where the vehicle is available for personal use. Input VAT incurred on the purchase of a motor vehicle is non-recoverable if the vehicle is available for the personal use of any person.\n\nInput tax is only recoverable where the motor vehicle is used exclusively for business — for example a pool car not allocated to an individual, a taxi, or a vehicle used in a vehicle-rental business. A car allocated to the sales director and available for personal use falls outside that exception.",
      reasoning:
        "1. The expense is the purchase of a motor vehicle.\n2. Executive Regulation Art. 53 blocks input tax on motor vehicles available for personal use.\n3. Exception: vehicles used exclusively for business (pool cars, taxis, rental fleet, emergency vehicles).\n4. The stated personal use by the director removes the exclusive-business exception.\n5. Conclusion: input VAT is blocked.",
      citations: [
        { articleRef: "Exec. Regulation Art. 53", effectiveDate: "2018-01-01", sourceUrl: "https://tax.gov.ae/" },
      ],
    },
  },
  {
    key: "freezone",
    label: "Free Zone rental income",
    filter: "Corporate Tax",
    q: "Does rental income from our Free Zone property count as Qualifying Income taxed at 0%?",
    resp: {
      status: "answered",
      confidence: "low",
      flaggedPremise: null,
      escalationReason: null,
      answer:
        "Likely not at 0% — but this depends on specifics that should be confirmed. Income from immovable property located in a Free Zone is treated differently by property type and counterparty. Income from commercial property transacted with other Free Zone Persons can be Qualifying Income; income from non-commercial property, or from non-Free Zone persons, is generally excluded and taxed at 9%.\n\nBecause the 0% treatment hinges on the property’s classification and the tenant, this answer is low-confidence without those details.",
      reasoning:
        "1. The Qualifying Free Zone Person regime taxes Qualifying Income at 0%.\n2. Cabinet Decision 100 of 2023 sets out qualifying and excluded activities.\n3. Immovable-property income is generally an Excluded Activity — with a carve-out for commercial property transacted with Free Zone Persons.\n4. The classification here is ambiguous: property type? tenant?\n5. Conclusion: probably 9%, but low confidence pending the missing facts.",
      citations: [
        { articleRef: "CT Law Art. 18", effectiveDate: "2023-06-01", sourceUrl: "https://tax.gov.ae/" },
        { articleRef: "Cabinet Decision 100/2023", effectiveDate: "2023-06-01", sourceUrl: "https://tax.gov.ae/" },
      ],
    },
  },
  {
    key: "loan",
    label: "Intercompany loan pricing",
    filter: "Corporate Tax",
    q: "How should we price the intercompany loan from our Cyprus parent to stay transfer-pricing compliant?",
    resp: {
      status: "escalate",
      confidence: "low",
      flaggedPremise: null,
      answer: "",
      escalationReason:
        "This needs an arm’s-length benchmarking analysis of a specific related-party loan and touches a non-UAE jurisdiction (Cyprus). It can’t be grounded in UAE FTA law text alone and involves facts and treaty matters outside this tool’s scope. Routed to the finance team for review.",
      reasoning:
        "1. The question concerns arm’s-length pricing of a cross-border related-party loan.\n2. UAE TP rules (CT Law Arts. 34–36) require arm’s-length terms, but the specific rate depends on facts not in published guidance.\n3. Determining a compliant rate requires a benchmarking study — not answerable from law text alone.\n4. Cross-jurisdiction (Cyprus) treaty considerations are outside UAE-only scope.\n5. Conclusion: escalate to the finance team.",
      citations: [],
    },
  },
];

export const FALLBACK: AnswerResult = {
  status: "escalate",
  confidence: "low",
  flaggedPremise: null,
  answer: "",
  escalationReason:
    "I couldn’t find UAE FTA law text that grounds this question with enough confidence to answer it. Rather than guess, I’ve routed it to the finance team for review.",
  reasoning:
    "1. Attempted to match the question to grounding provisions in the UAE VAT and Corporate Tax law.\n2. No provision settles the question with sufficient confidence.\n3. Per policy, an ungrounded answer is escalated rather than estimated.",
  citations: [],
};

// Offline matcher used as a fallback when /api/chat is unreachable.
export function resolveSample(q: string): AnswerResult {
  const t = q.trim().toLowerCase();
  let s = SAMPLES.find((x) => x.q.toLowerCase() === t);
  if (!s) {
    if (/residential|first supply|first sale|building/.test(t))
      s = SAMPLES.find((x) => x.key === "residential");
    else if (/\bcar\b|vehicle|motor/.test(t))
      s = SAMPLES.find((x) => x.key === "car");
    else if (/free.?zone|qualifying/.test(t))
      s = SAMPLES.find((x) => x.key === "freezone");
    else if (/loan|transfer.?pric|intercompany|related.?party|arm.?s.?length/.test(t))
      s = SAMPLES.find((x) => x.key === "loan");
  }
  return s ? s.resp : FALLBACK;
}

// Maps the UI filter to the /api/chat taxType param.
export function filterToTaxType(filter: TaxFilter): "CT" | "VAT" | undefined {
  if (filter === "Corporate Tax") return "CT";
  if (filter === "VAT") return "VAT";
  return undefined;
}
