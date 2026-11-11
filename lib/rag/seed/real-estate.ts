import type { SeedChunk } from "./types";

const VAT_URL = "https://tax.gov.ae/en/taxes/vat.aspx";

// Real estate & contracts — the developer-relevant treatment matrix plus the
// contract/VAT-clause points that recur in property deals. IDs 500–599.
export const REAL_ESTATE_SEED: SeedChunk[] = [
  {
    id: 500,
    category: "Real Estate",
    articleRef: "Real estate VAT — First supply of residential (zero-rated)",
    sourceUrl: VAT_URL,
    taxType: "VAT",
    effectiveDate: "2018-01-01",
    content:
      "The first supply of a new residential building — by sale or lease — within 3 years of the building's completion is zero-rated (0%). Because it is taxable at 0% (not exempt), the developer can recover the related input VAT on construction. This is the key relief for a developer's new residential stock.",
  },
  {
    id: 501,
    category: "Real Estate",
    articleRef: "Real estate VAT — Subsequent residential supplies (exempt)",
    sourceUrl: VAT_URL,
    taxType: "VAT",
    effectiveDate: "2018-01-01",
    content:
      "Any supply of a residential building after the first supply (subsequent sale or lease) is exempt from VAT. Exempt means no VAT is charged AND related input tax is generally not recoverable — the opposite input-tax outcome from the zero-rated first supply.",
  },
  {
    id: 502,
    category: "Real Estate",
    articleRef: "Real estate VAT — Commercial property (5%)",
    sourceUrl: VAT_URL,
    taxType: "VAT",
    effectiveDate: "2018-01-01",
    content:
      "The sale or lease of commercial real estate in the UAE is standard-rated at 5%. Input VAT on developing/operating commercial property is recoverable as it relates to taxable supplies. Owners'-association service charges on commercial (and the management of property) are also standard-rated.",
  },
  {
    id: 503,
    category: "Real Estate",
    articleRef: "Real estate VAT — Bare land vs covered land",
    sourceUrl: VAT_URL,
    taxType: "VAT",
    effectiveDate: "2018-01-01",
    content:
      "The supply of bare land (land with no completed/partially-completed buildings or civil engineering works) is exempt from VAT. 'Covered' land — land with buildings or in active development — does not qualify as bare land and follows the treatment of what is on it (e.g. commercial at 5%).",
  },
  {
    id: 504,
    category: "Real Estate",
    articleRef: "Real estate VAT — Mixed-use buildings",
    sourceUrl: VAT_URL,
    taxType: "VAT",
    effectiveDate: "2018-01-01",
    content:
      "For a mixed-use building (e.g. ground-floor retail with residential above), the consideration is apportioned: the residential portion follows residential rules (first supply zero-rated, later exempt) and the commercial portion is standard-rated at 5%. Input tax is attributed/apportioned to match. A single contract for the whole building does not change this — each part keeps its own treatment.",
  },
  {
    id: 505,
    category: "Real Estate",
    articleRef: "Real estate — Off-plan sales and date of supply",
    sourceUrl: VAT_URL,
    taxType: "VAT",
    effectiveDate: "2018-01-01",
    content:
      "For off-plan/under-construction sales with milestone or instalment payments, VAT is accounted for at the date of supply for each payment: the earliest of the payment-due date on the invoice, the date of receipt of payment, or 12 months from handover. The treatment (zero-rated first residential supply vs 5% commercial) is fixed by the nature of the unit.",
  },
  {
    id: 506,
    category: "Real Estate",
    articleRef: "Contract — VAT clauses (inclusive vs exclusive)",
    sourceUrl: VAT_URL,
    taxType: "VAT",
    effectiveDate: "2018-01-01",
    content:
      "A sale/lease contract should state whether the price is VAT-inclusive or VAT-exclusive. If silent, the law's default rules on consideration apply and can leave the supplier bearing VAT out of the stated price. Well-drafted SPAs/leases include a clause allowing the supplier to add VAT to the consideration and requiring the buyer to pay it against a valid tax invoice.",
  },
  {
    id: 507,
    category: "Real Estate",
    articleRef: "Real estate CT — Free Zone immovable property carve-out",
    sourceUrl: "https://tax.gov.ae/en/taxes/corporate.tax.aspx",
    taxType: "CT",
    effectiveDate: "2023-06-01",
    content:
      "For a Qualifying Free Zone Person, income from Commercial Property located in a Free Zone derived from transactions with other Free Zone Persons can be Qualifying Income (0%). Income from other immovable property in a Free Zone (residential, or commercial dealt with non-Free Zone persons) is taxed at 9%, and such immovable-property revenue is excluded from the de minimis calculation. A natural person's UAE real-estate investment income (not a licensed business) is generally outside Corporate Tax.",
  },
];
