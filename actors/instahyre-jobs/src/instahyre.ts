/** Instahyre (instahyre.com) public job search JSON API. */

export const BASE_URL = "https://www.instahyre.com";
export const SEARCH_URL = `${BASE_URL}/api/v1/job_search`;
export const JOB_FUNCTIONS_URL = `${BASE_URL}/api/v1/job_function`;
/** The API ignores `limit` and always returns pages of 35 jobs. */
export const PAGE_SIZE = 35;
/** Requested page size (sent as on instahyre.com; the API answers 35). */
export const LIMIT = 20;
/** offset + 35 must be <= 10,000 ("Result window is too large"). */
export const MAX_OFFSET = 10_000 - PAGE_SIZE;

export type CompanySize = "small" | "medium" | "large";
export type JobType = "full-time" | "internship";

/** API codes (company_size=2 is large, 3 is medium). */
export const COMPANY_SIZE_CODES: Record<CompanySize, string> = {
  small: "1",
  large: "2",
  medium: "3",
};
export const JOB_TYPE_CODES: Record<JobType, string> = {
  "full-time": "1",
  internship: "2",
};

/** The API-side filters of one search. */
export interface SearchFilters {
  skills: string[];
  locations: string[];
  years: number | null;
  jobFunctionIds: number[];
  companySize: CompanySize | null;
  jobType: JobType | null;
}

export interface RawEmployer {
  id?: number | null;
  company_name?: string | null;
  company_tagline?: string | null;
  company_founded?: number | null;
  employee_count?: number | null;
  profile_image_src?: string | null;
}

/** One job in an API response (only the fields we read). */
export interface RawJob {
  id?: number | null;
  title?: string | null;
  candidate_title?: string | null;
  locations?: string | null;
  keywords?: string[] | null;
  public_url?: string | null;
  employer?: RawEmployer | null;
}

interface SearchResponse {
  objects?: RawJob[] | null;
  meta?: { total_count?: number | null } | null;
}

export interface RawJobFunction {
  id?: number | null;
  name?: string | null;
  slug?: string | null;
}

/** API URL for one page of a search. `offset` is 0-based. */
export function searchUrl(f: SearchFilters, offset = 0): string {
  const p = new URLSearchParams();
  // An empty `skills=` matches nothing, so only send given values.
  for (const s of f.skills) p.append("skills", s);
  for (const l of f.locations) p.append("locations", l);
  if (f.years !== null) p.set("years", String(f.years));
  for (const id of f.jobFunctionIds) p.append("job_functions", String(id));
  if (f.jobType) p.set("job_type", JOB_TYPE_CODES[f.jobType]);
  if (f.companySize) p.set("company_size", COMPANY_SIZE_CODES[f.companySize]);
  p.set("limit", String(LIMIT));
  p.set("offset", String(offset));
  return `${SEARCH_URL}?${p}`;
}

/** API URL of one job (works for closed jobs too). */
export const detailUrl = (id: string) =>
  `${SEARCH_URL}/${encodeURIComponent(id)}`;

const parse = (body: string): unknown => {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
};

/** Parses a search page; null if it is not search JSON (block page etc). */
export function parseSearchResponse(
  body: string,
): { jobs: RawJob[]; total: number | null } | null {
  const json = parse(body) as SearchResponse | null;
  if (!json || typeof json !== "object" || !Array.isArray(json.objects))
    return null;
  const total = json.meta?.total_count;
  return {
    jobs: json.objects,
    total: typeof total === "number" ? total : null,
  };
}

/** Parses a single-job response; null if it is not a job. */
export function parseJobResponse(body: string): RawJob | null {
  const json = parse(body) as RawJob | null;
  return json && typeof json === "object" && jobIdOf(json) ? json : null;
}

/** Parses /api/v1/job_function; null if it is not that JSON. */
export function parseJobFunctions(body: string): RawJobFunction[] | null {
  const json = parse(body) as { objects?: unknown } | null;
  return json && Array.isArray(json.objects)
    ? (json.objects as RawJobFunction[])
    : null;
}

export const str = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim() : null;
export const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const idStr = (v: unknown) => (num(v) !== null ? String(v) : str(v));

export const jobIdOf = (job: RawJob): string | null => idStr(job?.id);

/** "Bangalore,Hyderabad" -> ["Bangalore", "Hyderabad"]. */
export function splitLocations(v: unknown): string[] {
  if (typeof v !== "string") return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of v.split(",")) {
    const l = part.trim();
    if (!l || seen.has(l.toLowerCase())) continue;
    seen.add(l.toLowerCase());
    out.push(l);
  }
  return out;
}

/** Spellings people type, mapped to the names Instahyre uses. */
const LOCATION_ALIASES: Record<string, string> = {
  bengaluru: "bangalore",
  gurugram: "gurgaon",
  bombay: "mumbai",
  madras: "chennai",
  calcutta: "kolkata",
  "new delhi": "delhi",
  remote: "work from home",
  wfh: "work from home",
  "delhi ncr": "delhi",
};

const canon = (l: string) => {
  const k = l.toLowerCase().replace(/\s+/g, " ").trim();
  return LOCATION_ALIASES[k] ?? k;
};

/**
 * True if the job is in any of `wanted` (case-insensitive, aliases such as
 * Bengaluru/Bangalore and Remote/Work From Home). Empty `wanted` matches all.
 */
export function matchesLocations(
  jobLocations: string[],
  wanted: string[],
): boolean {
  if (!wanted.length) return true;
  const want = new Set(wanted.map(canon));
  return jobLocations.some((l) => want.has(canon(l)));
}

/**
 * Resolves job function names, slugs or IDs to IDs. Returns the IDs and the
 * entries that matched nothing.
 */
export function resolveJobFunctions(
  wanted: string[],
  all: RawJobFunction[],
): { ids: number[]; unknown: string[] } {
  const ids: number[] = [];
  const unknown: string[] = [];
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  for (const w of wanted) {
    const n = norm(w);
    const hit = all.find(
      (f) =>
        (num(f.id) !== null && String(f.id) === w.trim()) ||
        (str(f.name) && norm(f.name!) === n) ||
        (str(f.slug) && norm(f.slug!) === n),
    );
    if (hit && num(hit.id) !== null) {
      if (!ids.includes(hit.id!)) ids.push(hit.id!);
    } else unknown.push(w);
  }
  return { ids, unknown };
}
