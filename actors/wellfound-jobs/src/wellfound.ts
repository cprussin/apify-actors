import * as cheerio from "cheerio";

export const BASE_URL = "https://wellfound.com";

/** One listing page to scrape: a role, a location, or both. */
export interface Search {
  /** Role slug, e.g. "software-engineer". */
  role: string | null;
  /** Location slug, e.g. "san-francisco", or "remote". */
  location: string | null;
}

export const REMOTE = "remote";

/** Lowercase, dash-separated slug: "San Francisco" -> "san-francisco". */
export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Listing page URL. Wellfound's public SEO pages:
 * /role/l/{role}/{location}, /role/r/{role} (remote), /role/{role} and
 * /location/{location}. Page 1 has no `page` parameter.
 */
export function listingUrl(s: Search, page = 1): string {
  let path: string;
  if (s.role && s.location === REMOTE) path = `/role/r/${s.role}`;
  else if (s.role && s.location) path = `/role/l/${s.role}/${s.location}`;
  else if (s.role) path = `/role/${s.role}`;
  else if (s.location && s.location !== REMOTE)
    path = `/location/${s.location}`;
  else throw new Error("A search needs a role, a location, or both.");
  return `${BASE_URL}${path}${page > 1 ? `?page=${page}` : ""}`;
}

const SLUG = "([a-z0-9][a-z0-9-]*)";
const URL_PATTERNS: [RegExp, (m: RegExpExecArray) => Search][] = [
  [
    new RegExp(`^/role/l/${SLUG}/${SLUG}/?$`),
    (m) => ({ role: m[1]!, location: m[2]! }),
  ],
  [
    new RegExp(`^/role/r/${SLUG}/?$`),
    (m) => ({ role: m[1]!, location: REMOTE }),
  ],
  [new RegExp(`^/role/${SLUG}/?$`), (m) => ({ role: m[1]!, location: null })],
  [
    new RegExp(`^/location/${SLUG}/?$`),
    (m) => ({ role: null, location: m[1]! }),
  ],
];

/** Parse a Wellfound listing URL into a search and its start page. */
export function parseListingUrl(
  raw: string,
): { search: Search; page: number } | null {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (!/(^|\.)wellfound\.com$/i.test(u.hostname)) return null;
  const path = u.pathname.toLowerCase();
  for (const [re, make] of URL_PATTERNS) {
    const m = re.exec(path);
    if (!m) continue;
    const page = Number(u.searchParams.get("page") ?? 1);
    return {
      search: make(m),
      page: Number.isInteger(page) && page >= 1 ? page : 1,
    };
  }
  return null;
}

type Ref = { __ref: string };
type Entity = Record<string, unknown>;

export interface RawJob {
  id: string;
  slug?: string | null;
  title?: string | null;
  primaryRoleTitle?: string | null;
  description?: string | null;
  jobType?: string | null;
  liveStartAt?: number | null;
  locationNames?: string[] | null;
  remote?: boolean | null;
  remoteConfig?: { kind?: string | null; wfhFlexible?: boolean | null } | null;
  acceptedRemoteLocationNames?: string[] | null;
  compensation?: string | null;
  yearsExperienceMin?: number | null;
  yearsExperienceMax?: number | null;
}

export interface RawBadge {
  name?: string | null;
  label?: string | null;
  data?: string | null;
}

export interface RawStartup {
  id: string;
  name?: string | null;
  slug?: string | null;
  highConcept?: string | null;
  companySize?: string | null;
  logoUrl?: string | null;
  badges?: RawBadge[];
}

export interface ListingPage {
  /** The search Wellfound actually answered (from the Apollo query key). */
  role: string | null;
  location: string | null;
  remote: boolean;
  page: number;
  pageCount: number | null;
  totalJobCount: number | null;
  totalStartupCount: number | null;
  jobs: { job: RawJob; startup: RawStartup }[];
}

/** Extract the Next.js `__NEXT_DATA__` JSON from a page, or null. */
export function extractNextData(html: string): Entity | null {
  const $ = cheerio.load(html);
  const text = $("script#__NEXT_DATA__").first().text();
  if (!text) return null;
  try {
    return JSON.parse(text) as Entity;
  } catch {
    return null;
  }
}

const isRef = (v: unknown): v is Ref =>
  typeof v === "object" && v !== null && "__ref" in v;

const QUERY_KEY = "seoLandingPageJobSearchResults(";

/**
 * Parse a listing page. Jobs come from the Apollo cache embedded in
 * `__NEXT_DATA__`: the search result lists startups, and each startup links
 * its matching job listings. Returns null if the page has no job search data.
 */
export function parseListingPage(html: string): ListingPage | null {
  const next = extractNextData(html);
  const props = (next?.props as Entity | undefined)?.pageProps as
    Entity | undefined;
  const cache = (props?.apolloState as Entity | undefined)?.data as
    Record<string, Entity> | undefined;
  if (!cache) return null;
  const talent = (cache.ROOT_QUERY?.talent ?? {}) as Entity;
  const key = Object.keys(talent).find((k) => k.startsWith(QUERY_KEY));
  if (!key) return null;
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(key.slice(QUERY_KEY.length, -1)) as typeof args;
  } catch {
    // Unknown key format; the results are still usable.
  }
  const result = talent[key] as Entity;
  const deref = (v: unknown): Entity | undefined =>
    isRef(v) ? cache[v.__ref] : (v as Entity | undefined);

  const jobs: ListingPage["jobs"] = [];
  for (const s of (result.startups as unknown[] | undefined) ?? []) {
    const startup = deref(s);
    if (!startup) continue;
    const badges = ((startup.badges as unknown[] | undefined) ?? [])
      .map(deref)
      .filter((b): b is Entity => !!b) as RawBadge[];
    const company = { ...startup, badges } as unknown as RawStartup;
    for (const j of (startup.highlightedJobListings as unknown[] | undefined) ??
      []) {
      const job = deref(j) as RawJob | undefined;
      if (job?.id) jobs.push({ job, startup: company });
    }
  }
  const num = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  return {
    role: typeof args.role === "string" ? args.role : null,
    location: typeof args.location === "string" ? args.location : null,
    remote: args.remote === true,
    page: num(args.page) ?? 1,
    pageCount: num(result.pageCount),
    totalJobCount: num(result.totalJobCount),
    totalStartupCount: num(result.totalStartupCount),
    jobs,
  };
}

/** Cloudflare / DataDome / captcha interstitials. */
export function isBlockPage(html: string): boolean {
  const head = html.slice(0, 30_000);
  return /<title>\s*(Just a moment|Attention Required|Access denied)|cf-chl-|challenge-platform|captcha-delivery\.com|geo\.captcha|px-captcha/i.test(
    head,
  );
}

export interface Compensation {
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  equityMin: number | null;
  equityMax: number | null;
  /** true/false when Wellfound says so, null when not stated. */
  hasEquity: boolean | null;
}

// Longest first, so "A$" wins over "$".
const SYMBOLS: [string, string][] = [
  ["CA$", "CAD"],
  ["C$", "CAD"],
  ["A$", "AUD"],
  ["AU$", "AUD"],
  ["S$", "SGD"],
  ["R$", "BRL"],
  ["NZ$", "NZD"],
  ["HK$", "HKD"],
  ["$", "USD"],
  ["€", "EUR"],
  ["£", "GBP"],
  ["₹", "INR"],
  ["¥", "JPY"],
  ["₩", "KRW"],
  ["₦", "NGN"],
  ["₱", "PHP"],
  ["₪", "ILS"],
];

const UNITS: Record<string, number> = {
  "": 1,
  k: 1e3,
  m: 1e6,
  l: 1e5, // lakh
  cr: 1e7, // crore
};

const AMOUNT =
  /(CA\$|AU\$|NZ\$|HK\$|[CASR]\$|\$|€|£|₹|¥|₩|₦|₱|₪)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|m|l|cr)?\b/gi;

/**
 * Parse Wellfound's compensation string, e.g. "$160k – $200k • 0.5% – 1.0%",
 * "$130k – $140k CAD", "₹5L – ₹8L • No equity", "Up to $150k", "0.0% – 0.3%".
 */
export function parseCompensation(
  raw: string | null | undefined,
): Compensation {
  const out: Compensation = {
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    equityMin: null,
    equityMax: null,
    hasEquity: null,
  };
  const s = (raw ?? "").trim();
  if (!s) return out;
  const parts = s.split("•").map((p) => p.trim());
  for (const part of parts) {
    if (/no equity/i.test(part)) {
      out.hasEquity = false;
      continue;
    }
    if (part.includes("%")) {
      const pct = [...part.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((m) =>
        Number(m[1]),
      );
      if (pct.length) {
        out.equityMin =
          /up to/i.test(part) && pct.length === 1 ? null : pct[0]!;
        out.equityMax = pct[pct.length - 1]!;
        out.hasEquity = true;
      }
      continue;
    }
    let symbol: string | undefined;
    const values: number[] = [];
    for (const m of part.matchAll(AMOUNT)) {
      if (!m[1] && !m[3] && values.length === 0 && !/\d{3}/.test(m[2]!))
        continue; // a stray small number without symbol or unit
      symbol ??= m[1];
      const n = Number(m[2]!.replace(/,/g, ""));
      values.push(n * (UNITS[(m[3] ?? "").toLowerCase()] ?? 1));
    }
    if (!values.length) continue;
    const code = /\b([A-Z]{3})\b/.exec(part)?.[1];
    out.salaryCurrency =
      code ?? SYMBOLS.find(([sym]) => sym === symbol)?.[1] ?? null;
    if (/up to/i.test(part) && values.length === 1) {
      out.salaryMax = values[0]!;
    } else {
      out.salaryMin = values[0]!;
      out.salaryMax = values[values.length - 1]!;
    }
  }
  return out;
}

/** "SIZE_51_200" -> "51-200", "SIZE_10001_PLUS" -> "10001+". */
export function companySize(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw
    .replace(/^SIZE_/, "")
    .replace(/_PLUS$/, "+")
    .replace(/_/g, "-");
  return s || null;
}

/** ONSITE / REMOTE / ONSITE_OR_REMOTE -> "onsite" / "remote" / "onsiteOrRemote". */
export function workplace(job: RawJob): string | null {
  const kind = job.remoteConfig?.kind;
  if (kind)
    return kind
      .toLowerCase()
      .replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  if (job.remote === true) return "remote";
  if (job.remote === false) return "onsite";
  return null;
}

export const jobUrl = (job: RawJob) =>
  `${BASE_URL}/jobs/${job.id}${job.slug ? `-${job.slug}` : ""}`;

export const companyUrl = (slug: string) => `${BASE_URL}/company/${slug}`;

export function badge(s: RawStartup, name: string): RawBadge | undefined {
  return s.badges?.find((b) => b.name === name);
}
