/**
 * Cutshort (cutshort.io) jobs: listing pages by skill/role and city, job
 * pages (`__NEXT_DATA__`) and the jobs sitemap. robots.txt disallows
 * `/view/j/`, `/vj/`, `/*?job_listing`, `/*?free_text` and `/apply/`; none
 * of those are used.
 */

export const BASE_URL = "https://cutshort.io";
export const SITEMAP_URL = `${BASE_URL}/sitemap_jobs.xml`;
/** Jobs per listing page (fixed by the site). */
export const PAGE_SIZE = 50;

/** Public listing page, e.g. https://cutshort.io/jobs/python-jobs-in-pune. */
export const listingPageUrl = (slug: string) => `${BASE_URL}/jobs/${slug}`;

/**
 * JSON behind a listing page: the `/jobs/<slug>` HTML page renders only its
 * first 50 jobs server-side (its `?page=N` is ignored) and loads the rest
 * from this URL, with the same job objects as its `__NEXT_DATA__`.
 */
export const listingDataUrl = (slug: string, page: number) =>
  `${BASE_URL}/backend-api/webpage/jobs/${slug}?page=${page}`;

/** Job page URL from its slug (the part after /job/) or full URL. */
export const jobPageUrl = (slugOrUrl: string) =>
  /^https?:\/\//.test(slugOrUrl) ? slugOrUrl : `${BASE_URL}/job/${slugOrUrl}`;

/**
 * Cutshort's short job ID: the last 8 characters of the job URL (e.g.
 * `xhH8K6kb` in /job/Integration-Engineer-Bengaluru-Bangalore-OneFin-xhH8K6kb).
 */
export function shortIdOf(url: string | null | undefined): string | null {
  const m = /\/job\/[^?#]*?([A-Za-z0-9_-]{8})\/?(?:[?#]|$)/.exec(url ?? "");
  return m ? m[1]! : null;
}

// ---------------------------------------------------------------- slugs

/** City names users type -> Cutshort's city slug. */
export const CITY_ALIASES: Record<string, string> = {
  bangalore: "bangalore-bengaluru",
  bengaluru: "bangalore-bengaluru",
  blr: "bangalore-bengaluru",
  "bangalore bengaluru": "bangalore-bengaluru",
  "bengaluru bangalore": "bangalore-bengaluru",
  delhi: "delhi-ncr-gurgaon-noida",
  "new delhi": "delhi-ncr-gurgaon-noida",
  ncr: "delhi-ncr-gurgaon-noida",
  "delhi ncr": "delhi-ncr-gurgaon-noida",
  gurgaon: "delhi-ncr-gurgaon-noida",
  gurugram: "delhi-ncr-gurgaon-noida",
  noida: "delhi-ncr-gurgaon-noida",
  kochi: "kochi-cochin",
  cochin: "kochi-cochin",
  bombay: "mumbai",
  madras: "chennai",
  calcutta: "kolkata",
};

const slugify = (s: string, sep: string) =>
  s
    .toLowerCase()
    .replace(/\+/g, "plus")
    .replace(/#/g, "sharp")
    .replace(/\./g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-/g, sep);

/** City slug, or "remote" for remote jobs. */
export function citySlug(city: string): string {
  const key = city
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (key === "remote" || key === "work from home" || key === "wfh")
    return "remote";
  return CITY_ALIASES[key] ?? slugify(city, "-");
}

/**
 * Skill/role base slugs to try, best first, e.g. "React.js" -> ["reactjs"],
 * "Data Science" -> ["data-science", "datascience"]. Accepts a listing slug
 * or URL too ("python-jobs", "python-jobs-in-pune", ".../jobs/python-jobs").
 */
export function skillSlugs(skill: string): string[] {
  let s = skill.trim();
  const url = /cutshort\.io\/jobs\/([^/?#]+)/i.exec(s);
  if (url) s = url[1]!;
  s = s.replace(/-jobs(-in-[a-z0-9-]+)?$/i, "");
  s = s.replace(/^remote-/i, "");
  const out = [slugify(s, "-"), slugify(s, "")].filter(Boolean);
  return [...new Set(out)];
}

/** Listing slug for a skill base slug and optional city slug. */
export function listingSlug(skillBase: string, city: string | null): string {
  if (city === "remote") return `remote-${skillBase}-jobs`;
  return city ? `${skillBase}-jobs-in-${city}` : `${skillBase}-jobs`;
}

/** The listing slug given verbatim as a URL or `...-jobs[-in-...]` slug, if any. */
export function explicitListingSlug(skill: string): string | null {
  const s = skill.trim();
  const url = /cutshort\.io\/jobs\/([^/?#]+)/i.exec(s);
  if (url) return url[1]!.toLowerCase();
  if (/^[a-z0-9-]+-jobs(-in-[a-z0-9-]+)?$/.test(s)) return s;
  return null;
}

// --------------------------------------------------------------- listing

interface RawRange {
  min?: number | null;
  max?: number | null;
  minVanity?: number | null;
  maxVanity?: number | null;
  userMinVanity?: number | null;
  userMaxVanity?: number | null;
  currency?: string | null;
  duration?: string | null;
}

interface RawCompanyDetails {
  _id?: string | null;
  name?: string | null;
  logo?: string | null;
  alias?: string | null;
  type?: string | null;
  size?: string | null;
  stage?: string | null;
  founded?: number | null;
  followersCount?: number | null;
  links?: { website?: string | null } | null;
}

/** One job of a listing page (only the fields we read). */
export interface RawJob {
  _id?: string | null;
  publicUrl?: string | null;
  headline?: string | null;
  hiringForClient?: boolean | null;
  allSkills?: (string | null)[] | null;
  salaryRange?: RawRange | string | null;
  salaryRangeText?: string | null;
  locations?: (string | null)[] | string | null;
  locationsText?: string | null;
  companyDetails?: RawCompanyDetails | null;
  companyId?: {
    _id?: string | null;
    name?: string | null;
    alias?: string | null;
    logo?: string | null;
  } | null;
  expRange?: RawRange | null;
  sanitizedComment?: string | null;
  roleTypes?: (string | null)[] | null;
  remoteType?: string | null;
  jobFactSummary?: {
    companyName?: string | null;
    postedDate?: string | null;
    experience?: string | null;
    salary?: string | null;
  } | null;
}

export type Listing =
  | { kind: "jobs"; jobs: RawJob[]; liveJobCount: number | null }
  /** Past the last page. */
  | { kind: "end" }
  /** No listing page with this slug. */
  | { kind: "unknown" };

/** Parses listing JSON; null if it is something else (block page etc). */
export function parseListing(body: string): Listing | null {
  let json: {
    success?: boolean;
    data?: { pageData?: { jobs?: RawJob[]; liveJobCount?: number } };
    error?: { errorCode?: string };
  };
  try {
    json = JSON.parse(body) as typeof json;
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") return null;
  if (json.success === false) {
    const code = json.error?.errorCode ?? "";
    if (code === "jobs_not_found") return { kind: "end" };
    if (code === "jobs_page_config_not_found") return { kind: "unknown" };
    return null;
  }
  const jobs = json.data?.pageData?.jobs;
  if (!Array.isArray(jobs)) return null;
  const live = json.data?.pageData?.liveJobCount;
  return {
    kind: jobs.length ? "jobs" : "end",
    jobs,
    liveJobCount: typeof live === "number" ? live : null,
  } as Listing;
}

// ---------------------------------------------------------------- detail

export interface JobPostingLd {
  "@type"?: string;
  datePosted?: string | null;
  validThrough?: string | null;
  employmentType?: string[] | string | null;
  baseSalary?: {
    currency?: string | null;
    value?: {
      minValue?: number | null;
      maxValue?: number | null;
      unitText?: string | null;
    } | null;
  } | null;
  jobLocation?: JobPlace | JobPlace[] | null;
  hiringOrganization?: { name?: string | null; sameAs?: string[] | null };
}

interface JobPlace {
  address?: {
    addressLocality?: string | null;
    postalCode?: string | null;
    addressCountry?: string | null;
  } | null;
}

/** Job page data: `pageData` of the jobData query, plus its JobPosting JSON-LD. */
export interface RawDetail extends RawJob {
  jobValid?: boolean | null;
  matchPreferences?: {
    tagCategory?: string | null;
    tags?: (string | null)[] | null;
  } | null;
  hiringIntentShownOn?: string | null;
  jobPosting: JobPostingLd | null;
}

/** `__NEXT_DATA__` JSON of a Next.js page, or null. */
export function nextData(html: string): unknown {
  const m =
    /<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/.exec(
      html,
    );
  if (!m) return null;
  try {
    return JSON.parse(m[1]!);
  } catch {
    return null;
  }
}

interface DehydratedQuery {
  queryKey?: unknown[];
  state?: {
    data?: {
      success?: boolean;
      data?: {
        pageData?: RawDetail;
        seoData?: { jsonlds?: JobPostingLd[] };
      };
    };
  };
}

export type Detail =
  | { kind: "job"; job: RawDetail }
  /** Job page exists no longer (404 or no job data). */
  | { kind: "gone" };

/** Parses a /job/<slug> page; null if it is not a Cutshort page at all. */
export function parseDetail(html: string, status = 200): Detail | null {
  const nd = nextData(html) as {
    props?: { pageProps?: { dehydratedState?: { queries?: unknown } } };
  } | null;
  if (!nd) return status === 404 || status === 410 ? { kind: "gone" } : null;
  const qs = nd.props?.pageProps?.dehydratedState?.queries;
  const q = (Array.isArray(qs) ? (qs as DehydratedQuery[]) : []).find(
    (x) => Array.isArray(x.queryKey) && x.queryKey[0] === "jobData",
  );
  const data = q?.state?.data?.data;
  const page = data?.pageData;
  if (!page || typeof page !== "object" || !page.headline)
    return { kind: "gone" };
  const lds = Array.isArray(data.seoData?.jsonlds) ? data.seoData.jsonlds : [];
  const jobPosting = lds.find((x) => x?.["@type"] === "JobPosting") ?? null;
  return { kind: "job", job: { ...page, jobPosting } };
}

// --------------------------------------------------------------- sitemap

export interface SitemapEntry {
  url: string;
  jobId: string;
  lastmod: string | null;
}

/** Job URLs of sitemap_jobs.xml (cutshort.io only, deduplicated). */
export function parseSitemap(xml: string): SitemapEntry[] | null {
  if (!/<urlset[\s>]/.test(xml)) return null;
  const out: SitemapEntry[] = [];
  const seen = new Set<string>();
  for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = /<loc>\s*([^<\s]+)\s*<\/loc>/.exec(m[1]!)?.[1];
    if (!loc || !loc.startsWith(`${BASE_URL}/job/`)) continue;
    const jobId = shortIdOf(loc);
    if (!jobId || seen.has(jobId)) continue;
    seen.add(jobId);
    const lastmod = /<lastmod>\s*([^<\s]+)\s*<\/lastmod>/.exec(m[1]!)?.[1];
    out.push({ url: loc, jobId, lastmod: lastmod ?? null });
  }
  return out;
}

// --------------------------------------------------------------- helpers

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** HTML job description -> plain text with line breaks. */
export function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = html
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n- ")
    .replace(/<\/\s*(p|div|ul|ol|h[1-6]|tr)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code =
          e[1] === "x" || e[1] === "X"
            ? parseInt(e.slice(2), 16)
            : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || null;
}

export const SNIPPET_LENGTH = 300;

/** First ~300 chars of the description on one line, cut at a word. */
export function snippet(
  text: string | null,
  max = SNIPPET_LENGTH,
): string | null {
  if (!text) return null;
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:-]+$/, "")} ...`;
}

export const str = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim() : null;

export const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** Case-insensitive dedupe of non-empty strings, keeping the first spelling. */
export const strs = (v: unknown): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of Array.isArray(v) ? v : []) {
    const s = str(x);
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
  }
  return out;
};

export const isoDate = (v: unknown) => {
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

export interface Salary {
  /** Yearly amounts, also for jobs shown per month (internships). */
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
}

const NO_SALARY: Salary = {
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
};

const positive = (v: unknown) => {
  const n = num(v);
  return n !== null && n > 0 ? n : null;
};

/**
 * Yearly salary range as shown on the site (the "vanity" amounts: ₹4L - ₹5L
 * is 400000-500000). 0 means not given. Internships shown per month
 * (duration MONTH) are stored yearly too (₹2000 / mo is 24000).
 */
export function listingSalary(r: RawRange | string | null | undefined): Salary {
  if (!r || typeof r !== "object") return NO_SALARY;
  const salaryMin = positive(r.minVanity) ?? positive(r.userMinVanity);
  const salaryMax = positive(r.maxVanity) ?? positive(r.userMaxVanity);
  if (salaryMin === null && salaryMax === null) return NO_SALARY;
  return { salaryMin, salaryMax, salaryCurrency: str(r.currency) };
}

/** Yearly salary from a job page's JobPosting JSON-LD (monthly x 12). */
export function ldSalary(ld: JobPostingLd | null | undefined): Salary {
  const v = ld?.baseSalary?.value;
  const k = /month/i.test(v?.unitText ?? "") ? 12 : 1;
  const salaryMin = positive(v?.minValue);
  const salaryMax = positive(v?.maxValue);
  if (salaryMin === null && salaryMax === null) return NO_SALARY;
  return {
    salaryMin: salaryMin && salaryMin * k,
    salaryMax: salaryMax && salaryMax * k,
    salaryCurrency: str(ld?.baseSalary?.currency),
  };
}

export function experience(r: RawRange | null | undefined): {
  experienceMin: number | null;
  experienceMax: number | null;
} {
  return {
    experienceMin: num(r?.minVanity) ?? num(r?.min),
    experienceMax: num(r?.maxVanity) ?? num(r?.max),
  };
}

export type WorkMode = "onsite" | "remote" | "remoteOrOnsite";

const WORK_MODES: Record<string, WorkMode> = {
  remote_not_okay: "onsite",
  remote_only: "remote",
  remote_okay: "remoteOrOnsite",
};

export const workMode = (v: unknown): WorkMode | null =>
  WORK_MODES[str(v) ?? ""] ?? null;

/**
 * Job page locations: the comma-joined text ("Remote only" = none), else
 * the JSON-LD place (which lists only the first city).
 */
export function detailLocations(job: RawDetail): string[] {
  if (Array.isArray(job.locations)) return strs(job.locations);
  const text = str(job.locations);
  if (text)
    return /^remote only$/i.test(text)
      ? []
      : // "Delhi, NCR and Gurgaon" is one city; otherwise ", " separates cities.
        strs(text.replace(/Delhi, NCR/g, "Delhi\u0000NCR").split(/,\s*/)).map(
          (s) => s.replace("\u0000", ", "),
        );
  const places = job.jobPosting?.jobLocation;
  return strs(
    (Array.isArray(places) ? places : places ? [places] : []).map(
      (p) => p?.address?.addressLocality,
    ),
  );
}
