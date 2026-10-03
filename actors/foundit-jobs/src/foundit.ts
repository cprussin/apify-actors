/** Foundit (foundit.in, formerly Monster India) job search API. */

export const BASE_URL = "https://www.foundit.in";
export const API_URL = `${BASE_URL}/home/api/searchResultsPage`;
/** Largest page size the API honors (bigger limits return 20). */
export const PAGE_SIZE = 20;

export type SortBy = "date" | "relevance";

export interface Search {
  /** Keywords; "" lists every job (in the location). */
  query: string;
  /** Location filter as typed on foundit.in, e.g. "Bangalore"; null = all. */
  location: string | null;
}

interface Named {
  text?: string | null;
}

interface RawLocation {
  city?: string | null;
  state?: string | null;
  country?: string | null;
}

interface RawSalary {
  currency?: string | null;
  absoluteValue?: number | null;
}

/** One job in the API response (only the fields we read). */
export interface RawJob {
  jobId?: number | string | null;
  id?: string | null;
  title?: string | null;
  companyName?: string | null;
  companyId?: number | string | null;
  company?: { companyId?: number; name?: string; logo?: string } | null;
  companyLogoUrl?: string | null;
  hideCompanyName?: number | null;
  locations?: RawLocation[] | null;
  minimumExperience?: { years?: number | null } | null;
  maximumExperience?: { years?: number | null } | null;
  minimumSalary?: RawSalary | null;
  maximumSalary?: RawSalary | null;
  currencyCode?: string | null;
  hideSalary?: number | null;
  jobSalaryConfidential?: boolean | null;
  postedAt?: number | null;
  updatedAt?: number | null;
  closedAt?: number | null;
  industries?: string[] | null;
  functions?: string[] | null;
  roles?: string[] | null;
  jobTypes?: string[] | null;
  employmentTypes?: string[] | null;
  itSkills?: Named[] | null;
  skills?: Named[] | null;
  description?: string | null;
  jdUrl?: string | null;
  applyUrl?: string | null;
  redirectUrl?: string | null;
  totalApplicants?: number | null;
  isUrgentlyHiring?: boolean | null;
}

export interface SearchResponse {
  data?: RawJob[] | null;
  meta?: {
    paging?: { total?: number | null; limit?: number | null } | null;
  } | null;
}

/** API URL for one page of a search. `start` is a 0-based offset. */
export function searchUrl(
  s: Search,
  start = 0,
  sortBy: SortBy = "date",
): string {
  const p = new URLSearchParams({ query: s.query });
  if (s.location) p.set("locations", s.location);
  p.set("sort", sortBy === "date" ? "2" : "1");
  p.set("limit", String(PAGE_SIZE));
  p.set("start", String(start));
  return `${API_URL}?${p}`;
}

/** Parses an API response body; null if it is not search JSON (block page etc). */
export function parseSearchResponse(body: string): {
  jobs: RawJob[];
  total: number | null;
} | null {
  let json: SearchResponse;
  try {
    json = JSON.parse(body) as SearchResponse;
  } catch {
    return null;
  }
  if (!json || typeof json !== "object" || !Array.isArray(json.data))
    return null;
  const total = json.meta?.paging?.total;
  return {
    jobs: json.data,
    total: typeof total === "number" ? total : null,
  };
}

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

const str = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim() : null;

const uniq = (xs: (string | null)[]) => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    if (!x || seen.has(x.toLowerCase())) continue;
    seen.add(x.toLowerCase());
    out.push(x);
  }
  return out;
};

export const strs = (v: unknown): string[] =>
  Array.isArray(v) ? uniq(v.map(str)) : [];

/**
 * Job locations as listed: the city of each entry, or its country when it
 * has none (e.g. ["Pune", "India"] or ["Singapore", "Orchard Road"]).
 */
export function jobLocations(locs: RawLocation[] | null | undefined): {
  locations: string[];
  country: string | null;
  remote: boolean;
} {
  const list = Array.isArray(locs) ? locs : [];
  const locations = uniq(list.map((l) => str(l?.city) ?? str(l?.country)));
  const countries = uniq(list.map((l) => str(l?.country)));
  return {
    locations,
    country: countries.find((c) => c.toLowerCase() !== "remote") ?? null,
    remote: [...locations, ...countries].some((l) => /^remote$/i.test(l)),
  };
}

/**
 * Yearly salary range; nulls when hidden, confidential or not given.
 * Recruiters enter 0 or token amounts (e.g. INR 1,000 a year) for "not
 * disclosed", so yearly amounts below 5,000 INR (100 in other currencies)
 * count as missing.
 */
export function jobSalary(job: RawJob): {
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
} {
  const none = { salaryMin: null, salaryMax: null, salaryCurrency: null };
  if (job.hideSalary || job.jobSalaryConfidential) return none;
  const currency =
    str(job.minimumSalary?.currency) ??
    str(job.maximumSalary?.currency) ??
    str(job.currencyCode);
  const floor = !currency || currency.toUpperCase() === "INR" ? 5000 : 100;
  const amount = (s: RawSalary | null | undefined) =>
    typeof s?.absoluteValue === "number" && s.absoluteValue >= floor
      ? s.absoluteValue
      : null;
  const salaryMin = amount(job.minimumSalary);
  const salaryMax = amount(job.maximumSalary);
  if (salaryMin === null && salaryMax === null) return none;
  return { salaryMin, salaryMax, salaryCurrency: currency };
}

/** IT skills first, then other skills, deduplicated (case-insensitive). */
export function jobSkills(job: RawJob): string[] {
  const names = (v: Named[] | null | undefined) =>
    (Array.isArray(v) ? v : []).map((s) => str(s?.text));
  return uniq([...names(job.itSkills), ...names(job.skills)]);
}

const years = (v: { years?: number | null } | null | undefined) =>
  typeof v?.years === "number" && Number.isFinite(v.years) ? v.years : null;

export function jobExperience(job: RawJob): {
  experienceMin: number | null;
  experienceMax: number | null;
} {
  return {
    experienceMin: years(job.minimumExperience),
    experienceMax: years(job.maximumExperience),
  };
}

export const isoTime = (ms: unknown) =>
  typeof ms === "number" && ms > 0 ? new Date(ms).toISOString() : null;

/** Job ID as a string, or null when missing. */
export function jobIdOf(job: RawJob): string | null {
  const id = job.jobId ?? job.id;
  if (typeof id === "number" && Number.isFinite(id)) return String(id);
  return str(id);
}

/** Absolute foundit.in job page URL. */
export function jobUrl(job: RawJob): string | null {
  const path = str(job.jdUrl);
  return path ? new URL(path, BASE_URL).href : null;
}
