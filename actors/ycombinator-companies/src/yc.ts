import * as cheerio from "cheerio";

export const YC = "https://www.ycombinator.com";
/** Public company directory page; embeds the Algolia app id + search key. */
export const DIRECTORY_URL = `${YC}/companies`;

/** Role pages under /jobs/role/<slug>, with the job category each one shows. */
export const JOB_ROLES: Record<string, { name: string; category: string }> = {
  "software-engineer": { name: "Software Engineer", category: "eng" },
  designer: { name: "Design & UI/UX", category: "design" },
  "product-manager": { name: "Product Manager", category: "product" },
  "recruiting-hr": { name: "Recruiting & HR", category: "recruiting" },
  "sales-manager": { name: "Sales", category: "sales" },
  marketing: { name: "Marketing", category: "marketing" },
  support: { name: "Support & Success", category: "support" },
  operations: { name: "Operations", category: "operations" },
  science: { name: "Science", category: "science" },
  finance: { name: "Finance", category: "finance" },
  legal: { name: "Legal", category: "legal" },
};

export const REMOTE = "remote";

export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function isBlockPage(html: string): boolean {
  const head = html.slice(0, 30_000);
  return /<title>\s*(Just a moment|Attention Required|Access denied)|cf-chl-|challenge-platform|captcha-delivery\.com/i.test(
    head,
  );
}

// ---------------------------------------------------------------- Algolia

export interface AlgoliaOpts {
  app: string;
  key: string;
}

/**
 * Algolia app id and search-only key from the /companies page
 * (`window.AlgoliaOpts = {"app":"...","key":"..."}`).
 */
export function extractAlgoliaOpts(html: string): AlgoliaOpts | null {
  const m = /AlgoliaOpts\s*=\s*(\{[^}]*\})/.exec(html);
  if (m) {
    try {
      const o = JSON.parse(m[1]!) as Record<string, unknown>;
      if (typeof o.app === "string" && typeof o.key === "string" && o.key)
        return { app: o.app, key: o.key };
    } catch {
      // fall through
    }
  }
  const app = /"app(?:Id|_id)?"\s*:\s*"([A-Z0-9]{8,12})"/.exec(html)?.[1];
  const key = /"(?:api_?)?key"\s*:\s*"([A-Za-z0-9+/=]{32,})"/.exec(html)?.[1];
  return app && key ? { app, key } : null;
}

/** One company record from the YCCompany_production index. */
export interface RawCompany {
  objectID?: string;
  id?: number;
  name?: string;
  slug?: string;
  former_names?: string[];
  small_logo_thumb_url?: string;
  website?: string;
  all_locations?: string;
  long_description?: string;
  one_liner?: string;
  team_size?: number | null;
  industry?: string;
  subindustry?: string;
  launched_at?: number | null;
  tags?: string[];
  top_company?: boolean;
  isHiring?: boolean;
  nonprofit?: boolean;
  batch?: string;
  status?: string;
  industries?: string[];
  regions?: string[];
  stage?: string;
}

export const COMPANY_ATTRIBUTES = [
  "id",
  "name",
  "slug",
  "former_names",
  "small_logo_thumb_url",
  "website",
  "all_locations",
  "long_description",
  "one_liner",
  "team_size",
  "industry",
  "subindustry",
  "launched_at",
  "tags",
  "top_company",
  "isHiring",
  "nonprofit",
  "batch",
  "status",
  "industries",
  "regions",
  "stage",
];

const SEASONS: Record<string, string> = {
  w: "Winter",
  x: "Spring",
  s: "Summer",
  f: "Fall",
};
const SEASON_ORDER = ["Winter", "Spring", "Summer", "Fall"];

/** "S25", "s2025", "summer 2025", "Summer-2025" -> "Summer 2025". */
export function normalizeBatch(v: string): string {
  const s = v.trim();
  const short = /^([wxsf])\s*'?(\d{2}|\d{4})$/i.exec(s);
  if (short) {
    const y = short[2]!.length === 2 ? `20${short[2]}` : short[2]!;
    return `${SEASONS[short[1]!.toLowerCase()]} ${y}`;
  }
  const long = /^(winter|spring|summer|fall)[\s-]*'?(\d{2}|\d{4})$/i.exec(s);
  if (long) {
    const y = long[2]!.length === 2 ? `20${long[2]}` : long[2]!;
    const season = long[1]!.toLowerCase();
    return `${season[0]!.toUpperCase()}${season.slice(1)} ${y}`;
  }
  return s;
}

/** "Summer 2025" -> "S25", "Spring 2026" -> "X26". */
export function batchCode(batch: string | null | undefined): string | null {
  const m = /^(Winter|Spring|Summer|Fall) (\d{4})$/.exec(batch ?? "");
  if (!m) return null;
  const letter = { Winter: "W", Spring: "X", Summer: "S", Fall: "F" }[
    m[1] as "Winter"
  ];
  return `${letter}${m[2]!.slice(2)}`;
}

/** Sort key, newest batch first; unknown batches last. */
export function batchRank(batch: string): number {
  const m = /^(Winter|Spring|Summer|Fall) (\d{4})$/.exec(batch);
  if (!m) return Number.MAX_SAFE_INTEGER;
  return -(Number(m[2]) * 10 + SEASON_ORDER.indexOf(m[1]!));
}

export const companyUrl = (slug: string) =>
  `${YC}/companies/${encodeURIComponent(slug)}`;

// ---------------------------------------------------------------- Jobs pages

export interface RawJob {
  id?: number;
  title?: string;
  url?: string;
  applyUrl?: string;
  location?: string;
  type?: string;
  role?: string;
  roleSpecificType?: string | null;
  prettyRole?: string;
  salaryRange?: string;
  equityRange?: string;
  minExperience?: string;
  visa?: string | null;
  skills?: (string | { name?: string })[];
  companyUrl?: string;
  companyLogoUrl?: string;
  companyName?: string;
  companyBatchName?: string;
  companyOneLiner?: string;
  createdAt?: string;
  lastActive?: string;
}

/** Inertia page props embedded in `data-page` (null if absent). */
export function parsePage(
  html: string,
): { component: string; props: Record<string, unknown> } | null {
  const $ = cheerio.load(html);
  const raw = $("[data-page]").first().attr("data-page");
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as {
      component?: string;
      props?: Record<string, unknown>;
    };
    if (!d.props) return null;
    return { component: d.component ?? "", props: d.props };
  } catch {
    return null;
  }
}

export interface JobsPage {
  kind: "listing" | "company";
  jobs: RawJob[];
  /** Listing pages: the job category shown (e.g. "eng"). */
  category: string | null;
  /** Listing pages: the location slug shown, or null for all locations. */
  location: string | null;
  /** Company pages: the company's slug. */
  companySlug: string | null;
}

export function parseJobsPage(html: string): JobsPage | null {
  const page = parsePage(html);
  if (!page) return null;
  const p = page.props;
  const jobs = Array.isArray(p.jobPostings) ? (p.jobPostings as RawJob[]) : [];
  if (page.component === "WaasShowJobsPage") {
    const c = p.company as { slug?: string } | undefined;
    return {
      kind: "company",
      jobs,
      category: null,
      location: null,
      companySlug: c?.slug ?? null,
    };
  }
  if (page.component !== "WaasJobListingsPage") return null;
  const loc = p.location as { slug?: string; is_local?: boolean } | undefined;
  return {
    kind: "listing",
    jobs,
    category: typeof p.jobCategory === "string" ? p.jobCategory || null : null,
    location: loc && !loc.is_local && loc.slug ? loc.slug : null,
    companySlug: null,
  };
}

export interface JobSearch {
  role: string | null;
  location: string | null;
}

export function jobsListingUrl(s: JobSearch): string {
  if (s.role)
    return `${YC}/jobs/role/${s.role}${s.location ? `/${s.location}` : ""}`;
  if (s.location) return `${YC}/jobs/location/${s.location}`;
  throw new Error("A job search needs a role or a location.");
}

export const companyJobsUrl = (slug: string) =>
  `${YC}/companies/${encodeURIComponent(slug)}/jobs`;

export const absolute = (path: string | null | undefined): string | null =>
  path ? new URL(path, YC).toString() : null;

// ---------------------------------------------------------------- Salary etc.

export interface Compensation {
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  /** "monthly", "hourly", ... when stated ("$2K - $5K / monthly"). */
  salaryPeriod: string | null;
  equityMin: number | null;
  equityMax: number | null;
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

const UNITS: Record<string, number> = { "": 1, k: 1e3, m: 1e6 };

const AMOUNT =
  /(CA\$|AU\$|NZ\$|HK\$|[CASR]\$|\$|€|£|₹|¥|₩|₦|₱|₪)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|m)?\b/gi;

type Salary = Pick<
  Compensation,
  "salaryMin" | "salaryMax" | "salaryCurrency" | "salaryPeriod"
>;

/** "$200K - $250K", "₹3M - ₹8M INR", "£70K - £120K GBP", "$2K - $5K / monthly". */
export function parseSalary(raw: string | null | undefined): Salary {
  const out: Salary = {
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
  };
  const s = (raw ?? "").trim();
  if (!s) return out;
  let symbol: string | undefined;
  const values: number[] = [];
  for (const m of s.matchAll(AMOUNT)) {
    symbol ??= m[1];
    const n = Number(m[2]!.replace(/,/g, ""));
    values.push(n * (UNITS[(m[3] ?? "").toLowerCase()] ?? 1));
  }
  if (!values.length) return out;
  const code = /\b([A-Z]{3})\b/.exec(s)?.[1];
  out.salaryCurrency =
    code ?? SYMBOLS.find(([sym]) => sym === symbol)?.[1] ?? null;
  out.salaryMin = values[0]!;
  out.salaryMax = values[values.length - 1]!;
  out.salaryPeriod = /\/\s*([a-z]+)\s*$/i.exec(s)?.[1]?.toLowerCase() ?? null;
  return out;
}

/** "0.50% - 1.00%", "1.00%" -> percentages. */
export function parseEquity(
  raw: string | null | undefined,
): Pick<Compensation, "equityMin" | "equityMax"> {
  const pct = [...(raw ?? "").matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((m) =>
    Number(m[1]),
  );
  if (!pct.length) return { equityMin: null, equityMax: null };
  return { equityMin: pct[0]!, equityMax: pct[pct.length - 1]! };
}

/** "6+ years" -> 6, "Any (new grads ok)" -> 0, otherwise null. */
export function parseExperience(raw: string | null | undefined): number | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (/^any\b|new grad/i.test(s)) return 0;
  const m = /(\d+)\s*\+?\s*years?/i.exec(s);
  return m ? Number(m[1]) : null;
}

/** "San Francisco, CA, US / Remote (US)" -> ["San Francisco, CA, US", "Remote (US)"]. */
export function splitLocations(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(" / ")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const isRemote = (raw: string | null | undefined): boolean =>
  /\bremote\b/i.test(raw ?? "");
