import { child, children, parseXml, text, type XmlNode } from "./xml.js";

/** Form D industry groups (leaf values in the XML) by category. */
export const INDUSTRY_CATEGORIES: Record<string, string[]> = {
  Agriculture: ["Agriculture"],
  "Banking & Financial Services": [
    "Commercial Banking",
    "Insurance",
    "Investing",
    "Investment Banking",
    "Pooled Investment Fund",
    "Other Banking and Financial Services",
  ],
  "Business Services": ["Business Services"],
  Energy: [
    "Coal Mining",
    "Electric Utilities",
    "Energy Conservation",
    "Environmental Services",
    "Oil and Gas",
    "Other Energy",
  ],
  "Health Care": [
    "Biotechnology",
    "Health Insurance",
    "Hospitals and Physicians",
    "Pharmaceuticals",
    "Other Health Care",
  ],
  Manufacturing: ["Manufacturing"],
  "Real Estate": [
    "Commercial",
    "Construction",
    "REITS and Finance",
    "Residential",
    "Other Real Estate",
  ],
  Retailing: ["Retailing"],
  Restaurants: ["Restaurants"],
  Technology: ["Computers", "Telecommunications", "Other Technology"],
  Travel: [
    "Airlines and Airports",
    "Lodging and Conventions",
    "Tourism and Travel Services",
    "Other Travel",
  ],
  Other: ["Other"],
};

const CATEGORY_OF = new Map(
  Object.entries(INDUSTRY_CATEGORIES).flatMap(([cat, groups]) =>
    groups.map((g) => [g.toLowerCase(), cat] as const),
  ),
);

export const industryCategory = (group: string | null): string | null =>
  group ? (CATEGORY_OF.get(group.toLowerCase()) ?? null) : null;

const SECURITY_TYPES: [string, string][] = [
  ["isEquityType", "Equity"],
  ["isDebtType", "Debt"],
  ["isOptionToAcquireType", "Option, warrant or other right to acquire"],
  ["isSecurityToBeAcquiredType", "Security to be acquired on exercise"],
  ["isPooledInvestmentFundType", "Pooled investment fund interests"],
  ["isTenantInCommonType", "Tenant-in-common securities"],
  ["isMineralPropertyType", "Mineral property securities"],
];

export interface Address {
  street: string | null;
  street2: string | null;
  city: string | null;
  /** State code, or EDGAR country code for foreign addresses. */
  state: string | null;
  /** State or country name. */
  stateName: string | null;
  zip: string | null;
}

export interface RelatedPerson {
  name: string;
  roles: string[];
  title: string | null;
  city: string | null;
  state: string | null;
}

export interface SalesRecipient {
  name: string;
  crdNumber: string | null;
  brokerDealer: string | null;
  brokerDealerCrd: string | null;
}

export interface FilingRecord {
  issuerName: string | null;
  cik: string | null;
  accessionNumber: string;
  formType: string;
  filingDate: string | null;
  isAmendment: boolean;
  previousAccessionNumber: string | null;
  entityType: string | null;
  yearOfIncorporation: number | null;
  incorporatedWithinFiveYears: boolean | null;
  stateOfIncorporation: string | null;
  address: Address | null;
  phone: string | null;
  industryGroup: string | null;
  industryCategory: string | null;
  investmentFundType: string | null;
  revenueRange: string | null;
  securityTypes: string[];
  dateOfFirstSale: string | null;
  totalOfferingAmount: number | null;
  offeringAmountIndefinite: boolean;
  totalAmountSold: number | null;
  totalRemaining: number | null;
  minimumInvestment: number | null;
  totalInvestors: number | null;
  nonAccreditedInvestors: number | null;
  salesCommissions: number | null;
  findersFees: number | null;
  exemptions: string[];
  relatedPersons: RelatedPerson[];
  salesRecipients: SalesRecipient[];
  otherIssuers: string[];
  filingUrl: string;
  xmlUrl: string;
}

/** Filing identity from the EDGAR full-text search index. */
export interface FilingRef {
  accessionNumber: string;
  /** Filer CIK without leading zeros. */
  cik: string;
  formType: string;
  filingDate: string | null;
}

export const stripCik = (cik: string): string =>
  String(Number(cik.replace(/\D/g, "")) || cik);

export function filingUrls(ref: Pick<FilingRef, "accessionNumber" | "cik">): {
  filingUrl: string;
  xmlUrl: string;
} {
  const dir = `https://www.sec.gov/Archives/edgar/data/${ref.cik}/${ref.accessionNumber.replace(/-/g, "")}`;
  return {
    filingUrl: `${dir}/${ref.accessionNumber}-index.htm`,
    xmlUrl: `${dir}/primary_doc.xml`,
  };
}

const num = (s: string | null): number | null => {
  if (s === null) return null;
  const n = Number(s.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

const bool = (s: string | null): boolean | null =>
  s === null ? null : s.toLowerCase() === "true";

const clean = (s: string | null): string | null =>
  s && !/^(none|n\/a)$/i.test(s) ? s : null;

function address(node: XmlNode | undefined): Address | null {
  if (!node) return null;
  const a: Address = {
    street: text(node, "street1"),
    street2: text(node, "street2"),
    city: text(node, "city"),
    state: text(node, "stateOrCountry"),
    stateName: text(node, "stateOrCountryDescription"),
    zip: text(node, "zipCode"),
  };
  return Object.values(a).some((v) => v !== null) ? a : null;
}

function personName(node: XmlNode | undefined): string {
  return ["firstName", "middleName", "lastName"]
    .map((k) => text(node, k))
    .filter((v): v is string => !!v && v !== "-" && !/^n\/a$/i.test(v))
    .join(" ");
}

function nonAccredited(investors: XmlNode | undefined): number | null {
  const has = bool(text(investors, "hasNonAccreditedInvestors"));
  if (has === null) return null;
  return has ? num(text(investors, "numberNonAccreditedInvestors")) : 0;
}

/** Parse a Form D `primary_doc.xml` into a flat record. */
export function parseFormD(xml: string, ref: FilingRef): FilingRecord {
  const doc = parseXml(xml);
  if (doc.name !== "edgarSubmission") {
    throw new Error(`Unexpected document root <${doc.name}>.`);
  }
  const issuer = child(doc, "primaryIssuer");
  const offering = child(doc, "offeringData");
  const filingType = child(offering, "typeOfFiling");
  const amounts = child(offering, "offeringSalesAmounts");
  const industry = child(offering, "industryGroup");
  const industryGroup = text(industry, "industryGroupType");
  const isAmendmentXml = bool(
    text(filingType, "newOrAmendment", "isAmendment"),
  );
  const submissionType = text(doc, "submissionType") ?? ref.formType;

  const securities = child(offering, "typesOfSecuritiesOffered");
  const securityTypes = SECURITY_TYPES.filter(
    ([tag]) => bool(text(securities, tag)) === true,
  ).map(([, label]) => label);
  if (bool(text(securities, "isOtherType"))) {
    const d = text(securities, "descriptionOfOtherType");
    securityTypes.push(d ? `Other: ${d}` : "Other");
  }

  const offeringTotal = text(amounts, "totalOfferingAmount");
  const yearOfInc = child(issuer, "yearOfInc");
  const year = num(text(yearOfInc, "value"));

  const relatedPersons = children(
    child(doc, "relatedPersonsList"),
    "relatedPersonInfo",
  ).map((p): RelatedPerson => {
    const addr = child(p, "relatedPersonAddress");
    return {
      name: personName(child(p, "relatedPersonName")),
      roles: children(child(p, "relatedPersonRelationshipList"), "relationship")
        .map((r) => r.text.trim())
        .filter(Boolean),
      title: clean(text(p, "relationshipClarification")),
      city: text(addr, "city"),
      state: text(addr, "stateOrCountry"),
    };
  });

  const salesRecipients = children(
    child(offering, "salesCompensationList"),
    "recipient",
  )
    .map((r): SalesRecipient => ({
      name: clean(text(r, "recipientName")) ?? "",
      crdNumber: clean(text(r, "recipientCRDNumber")),
      brokerDealer: clean(text(r, "associatedBDName")),
      brokerDealerCrd: clean(text(r, "associatedBDCRDNumber")),
    }))
    .filter((r) => r.name || r.brokerDealer);

  const cik = text(issuer, "cik");
  return {
    issuerName: text(issuer, "entityName"),
    cik: cik ? stripCik(cik) : ref.cik,
    accessionNumber: ref.accessionNumber,
    formType: submissionType,
    filingDate: ref.filingDate,
    isAmendment: isAmendmentXml ?? submissionType.endsWith("/A"),
    previousAccessionNumber: text(
      filingType,
      "newOrAmendment",
      "previousAccessionNumber",
    ),
    entityType:
      text(issuer, "entityType") === "Other"
        ? (text(issuer, "entityTypeOtherDesc") ?? "Other")
        : text(issuer, "entityType"),
    yearOfIncorporation: year,
    incorporatedWithinFiveYears:
      bool(text(yearOfInc, "withinFiveYears")) ??
      (bool(text(yearOfInc, "overFiveYears")) ? false : null),
    stateOfIncorporation: text(issuer, "jurisdictionOfInc"),
    address: address(child(issuer, "issuerAddress")),
    phone: text(issuer, "issuerPhoneNumber"),
    industryGroup,
    industryCategory: industryCategory(industryGroup),
    investmentFundType: text(
      industry,
      "investmentFundInfo",
      "investmentFundType",
    ),
    revenueRange:
      text(offering, "issuerSize", "revenueRange") ??
      text(offering, "issuerSize", "aggregateNetAssetValueRange"),
    securityTypes,
    dateOfFirstSale: bool(text(filingType, "dateOfFirstSale", "yetToOccur"))
      ? null
      : text(filingType, "dateOfFirstSale", "value"),
    totalOfferingAmount: num(offeringTotal),
    offeringAmountIndefinite:
      /indefinite/i.test(offeringTotal ?? "") ||
      bool(text(amounts, "isIndefinite")) === true,
    totalAmountSold: num(text(amounts, "totalAmountSold")),
    totalRemaining: num(text(amounts, "totalRemaining")),
    minimumInvestment: num(text(offering, "minimumInvestmentAccepted")),
    totalInvestors: num(
      text(offering, "investors", "totalNumberAlreadyInvested"),
    ),
    nonAccreditedInvestors: nonAccredited(child(offering, "investors")),
    salesCommissions: num(
      text(
        offering,
        "salesCommissionsFindersFees",
        "salesCommissions",
        "dollarAmount",
      ),
    ),
    findersFees: num(
      text(
        offering,
        "salesCommissionsFindersFees",
        "findersFees",
        "dollarAmount",
      ),
    ),
    exemptions: children(child(offering, "federalExemptionsExclusions"), "item")
      .map((i) => i.text.trim())
      .filter(Boolean),
    relatedPersons,
    salesRecipients,
    otherIssuers: children(child(doc, "issuerList"), "issuer")
      .map((i) => text(i, "entityName"))
      .filter((n): n is string => !!n),
    ...filingUrls(ref),
  };
}
