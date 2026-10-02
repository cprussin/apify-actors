/** Raw actor input, as defined in .actor/input_schema.json. */
export interface RawInput {
  companies?: string[];
  maxReviewsPerCompany?: number;
  stars?: (string | number)[];
  language?: string;
  sort?: string;
  sinceDate?: string;
  includeCompanyInfo?: boolean;
  onlyNew?: boolean;
  proxyConfiguration?: {
    useApifyProxy?: boolean;
    apifyProxyGroups?: string[];
    apifyProxyCountry?: string;
    proxyUrls?: string[];
  };
}

export type Sort = "recency" | "relevance";

export interface NormalizedInput {
  /** Trustpilot business identifiers (usually the domain), deduplicated. */
  companies: string[];
  maxReviewsPerCompany: number;
  /** Selected star ratings, ascending; empty = all. */
  stars: number[];
  /** ISO 639-1 code or "all". */
  language: string;
  sort: Sort;
  /** YYYY-MM-DD; only reviews published on or after this date. */
  sinceDate?: string;
  includeCompanyInfo: boolean;
  /** Skip reviews returned by earlier runs with the same input (monitoring). */
  onlyNew: boolean;
}

export const DEFAULT_INPUT = {
  companies: ["apify.com"],
  maxReviewsPerCompany: 20,
  language: "all",
  sort: "recency",
  includeCompanyInfo: true,
} satisfies RawInput;

/** Trustpilot shows logged-out visitors at most 10 pages of 20 per filter. */
export const PAGE_SIZE = 20;
export const MAX_PAGES_PER_FILTER = 10;
export const MAX_PER_FILTER = PAGE_SIZE * MAX_PAGES_PER_FILTER;
/** Splitting by star rating gives 5 filters of 200. */
export const MAX_REVIEWS_PER_COMPANY = MAX_PER_FILTER * 5;
export const MAX_COMPANIES = 500;

export class InputError extends Error {}

const DOMAIN_RE = /^(?=.{3,253}$)([a-z0-9-]+\.)+[a-z0-9-]{2,}$/;

/**
 * Accepts a domain ("amazon.com", "https://www.amazon.com/path") or a
 * Trustpilot review URL ("https://uk.trustpilot.com/review/www.amazon.co.uk")
 * and returns the Trustpilot business identifier, lowercased.
 */
export function parseCompany(value: string): string {
  let s = value.trim();
  if (!s) throw new InputError("Empty company.");
  const tp = s.match(/trustpilot\.[a-z.]+\/review\/([^/?#\s]+)/i);
  if (tp) {
    s = decodeURIComponent(tp[1]!);
  } else {
    s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
    s = s.replace(/^[^@/]*@/, "");
    s = s.split(/[/?#]/)[0]!;
    s = s.replace(/:\d+$/, "");
  }
  s = s.toLowerCase().replace(/\.$/, "");
  if (!DOMAIN_RE.test(s)) {
    throw new InputError(
      `"${value}" is not a domain or Trustpilot review URL. Use e.g. "amazon.com" or "https://www.trustpilot.com/review/www.amazon.com".`,
    );
  }
  return s;
}

const optionalNumber = (v: unknown, name: string): number | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new InputError(`${name} must be a number.`);
  return n;
};

export function normalizeInput(
  raw: RawInput | null | undefined,
): NormalizedInput {
  const r: RawInput = { ...DEFAULT_INPUT, ...(raw ?? {}) };

  if (!Array.isArray(r.companies)) {
    throw new InputError("companies must be an array.");
  }
  const companies = [
    ...new Set(
      r.companies
        .filter((c): c is string => typeof c === "string" && c.trim() !== "")
        .map(parseCompany),
    ),
  ];
  if (!companies.length) {
    throw new InputError("Add at least one company domain or Trustpilot URL.");
  }
  if (companies.length > MAX_COMPANIES) {
    throw new InputError(`At most ${MAX_COMPANIES} companies per run.`);
  }

  const max = Math.floor(
    optionalNumber(r.maxReviewsPerCompany, "maxReviewsPerCompany") ??
      DEFAULT_INPUT.maxReviewsPerCompany,
  );
  if (max < 1) throw new InputError("maxReviewsPerCompany must be >= 1.");

  const stars = [
    ...new Set(
      (Array.isArray(r.stars) ? r.stars : []).map((s) => {
        const n = Number(s);
        if (!Number.isInteger(n) || n < 1 || n > 5) {
          throw new InputError(`Star rating "${s}" must be 1 to 5.`);
        }
        return n;
      }),
    ),
  ].sort();

  const language = String(r.language ?? "all")
    .trim()
    .toLowerCase();
  if (!/^(all|[a-z]{2})$/.test(language)) {
    throw new InputError(
      `language must be "all" or a 2-letter code like "en" (got "${r.language}").`,
    );
  }

  const sort = String(r.sort ?? "recency").toLowerCase();
  if (sort !== "recency" && sort !== "relevance") {
    throw new InputError('sort must be "recency" or "relevance".');
  }

  let sinceDate: string | undefined;
  if (r.sinceDate !== undefined && r.sinceDate !== null && r.sinceDate !== "") {
    sinceDate = String(r.sinceDate).trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sinceDate) || isNaN(Date.parse(sinceDate)))
      throw new InputError("sinceDate must be a date in YYYY-MM-DD format.");
  }

  return {
    companies,
    maxReviewsPerCompany: Math.min(max, MAX_REVIEWS_PER_COMPANY),
    stars,
    language,
    // Delta modes need newest-first order to stop paging early.
    sort: sinceDate || r.onlyNew === true ? "recency" : sort,
    sinceDate,
    includeCompanyInfo: r.includeCompanyInfo !== false,
    onlyNew: r.onlyNew === true,
  };
}
