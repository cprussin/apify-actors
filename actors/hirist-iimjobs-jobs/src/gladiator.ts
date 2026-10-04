/**
 * Hirist (hirist.tech, tech jobs) and iimjobs (iimjobs.com, management jobs)
 * run on one platform with the same public JSON API ("gladiator").
 */

export type Site = "hirist" | "iimjobs";
export const SITES: Site[] = ["hirist", "iimjobs"];

export const API_HOSTS: Record<Site, string> = {
  hirist: "https://gladiator.hirist.tech",
  iimjobs: "https://gladiator.iimjobs.com",
};

/**
 * Minimum gap between requests per site: iimjobs.com robots.txt asks for
 * `Crawl-delay: 10`; Hirist sets none, so ~1 request per second.
 */
export const MIN_INTERVAL_MS: Record<Site, number> = {
  hirist: 1000,
  iimjobs: 10_000,
};

/** Jobs per search page (the API honors up to 100). */
export const PAGE_SIZE = 50;

export interface Search {
  site: Site;
  /** Keywords (required by the API). */
  query: string;
  /** Location IDs (OR); empty = all locations. */
  locationIds: number[];
  /** Experience filter in years: jobs whose range overlaps it. */
  minExperience: number | null;
  maxExperience: number | null;
}

/**
 * Location IDs shared by both sites (from the `locations` of API results).
 * Keys are lower case; several spellings map to one ID.
 */
export const LOCATIONS: Record<string, number> = {
  "delhi ncr": 1,
  ncr: 1,
  mumbai: 2,
  bombay: 2,
  bangalore: 3,
  bengaluru: 3,
  hyderabad: 4,
  kolkata: 5,
  calcutta: 5,
  chennai: 6,
  madras: 6,
  pune: 7,
  gujarat: 8,
  maharashtra: 9,
  mp: 10,
  "madhya pradesh": 10,
  jaipur: 11,
  guwahati: 12,
  goa: 13,
  chandigarh: 14,
  punjab: 15,
  haryana: 16,
  kerala: 17,
  odisha: 18,
  jharkhand: 20,
  up: 21,
  "uttar pradesh": 21,
  us: 22,
  usa: 22,
  "united states": 22,
  singapore: 24,
  "middle east": 25,
  africa: 26,
  malaysia: 27,
  karnataka: 31,
  "tamil nadu": 32,
  rajasthan: 33,
  "andhra pradesh": 34,
  telangana: 35,
  delhi: 36,
  "new delhi": 36,
  gurgaon: 37,
  gurugram: 37,
  "gurgaon/gurugram": 37,
  noida: 38,
  "greater noida": 39,
  faridabad: 40,
  ghaziabad: 41,
  sonipat: 49,
  udaipur: 51,
  ahmedabad: 53,
  surat: 54,
  gandhinagar: 55,
  vadodara: 56,
  baroda: 56,
  "vadodara/baroda": 56,
  haridwar: 57,
  dehradun: 58,
  uttarakhand: 59,
  lucknow: 60,
  bhubaneshwar: 65,
  bhubaneswar: 65,
  nagpur: 66,
  nasik: 67,
  nashik: 67,
  "navi mumbai": 68,
  thane: 69,
  cochin: 70,
  kochi: 70,
  "cochin/kochi": 70,
  mysore: 73,
  mysuru: 73,
  raipur: 74,
  trivandrum: 75,
  thiruvananthapuram: 75,
  "trivandrum/thiruvananthapuram": 75,
  vishakhapatnam: 78,
  visakhapatnam: 78,
  vizag: 78,
  "vishakhapatnam/vizag": 78,
  aurangabad: 79,
  madurai: 83,
  coimbatore: 84,
  metros: 87,
  "anywhere in india": 88,
  "multiple locations": 88,
  "anywhere in india/multiple locations": 88,
  overseas: 89,
  international: 89,
  "overseas/international": 89,
  dubai: 91,
  kuwait: 93,
  nigeria: 94,
  "saudi arabia": 101,
  indonesia: 103,
  bhopal: 121,
  assam: 123,
  "west bengal": 129,
  indore: 130,
  mohali: 131,
  remote: 132,
  "work from home": 132,
  wfh: 132,
  mangalore: 134,
  mangaluru: 134,
  manesar: 138,
  panchkula: 142,
  vapi: 145,
  kozhikode: 146,
  calicut: 146,
  jamnagar: 147,
  salem: 149,
  australia: 165,
  canada: 167,
  germany: 168,
};

/** Location ID for a city/state name or a numeric ID; null if unknown. */
export function locationId(name: string): number | null {
  const s = name.trim().toLowerCase().replace(/\s+/g, " ");
  if (/^\d+$/.test(s)) return Number(s);
  return LOCATIONS[s] ?? null;
}

/** API URL for one page of a search. `page` is 0-based. */
export function searchUrl(s: Search, page = 0): string {
  const p = new URLSearchParams({
    query: s.query,
    size: String(PAGE_SIZE),
    page: String(page),
  });
  if (s.locationIds.length) p.set("loc", s.locationIds.join(","));
  if (s.minExperience !== null) p.set("minexp", String(s.minExperience));
  if (s.maxExperience !== null) p.set("maxexp", String(s.maxExperience));
  return `${API_HOSTS[s.site]}/job/search?${p}`;
}

/** API URL of one job's details (full description). */
export const detailUrl = (site: Site, jobId: string) =>
  `${API_HOSTS[site]}/job/detail?jobcode=${encodeURIComponent(jobId)}`;

interface Named {
  id?: number | null;
  name?: string | null;
}

/** One job in a search response (only the fields we read). */
export interface RawJob {
  id?: number | string | null;
  title?: string | null;
  jobdesignation?: string | null;
  min?: number | null;
  max?: number | null;
  minSal?: number | null;
  maxSal?: number | null;
  hideSal?: number | null;
  confidential?: number | null;
  jobDetailUrl?: string | null;
  applyUrl?: string | null;
  applyCount?: number | null;
  createdTimeMs?: number | null;
  createdTime?: number | null;
  workFromHome?: number | null;
  tags?: Named[] | null;
  locations?: Named[] | null;
  companyData?: {
    companyId?: number | null;
    companyName?: string | null;
    logo?: string | null;
  } | null;
  recruiter?: {
    recruiterName?: string | null;
    designation?: string | null;
  } | null;
}

/** One job in a detail response. */
export interface RawDetail extends RawJob {
  introText?: string | null;
}

export interface SearchResponse {
  data?: RawJob[] | null;
  totalJobs?: number | null;
  hasMore?: boolean | null;
}

/** Parses a search response body; null if it is not search JSON. */
export function parseSearchResponse(body: string): {
  jobs: RawJob[];
  total: number | null;
  hasMore: boolean;
} | null {
  let json: SearchResponse;
  try {
    json = JSON.parse(body) as SearchResponse;
  } catch {
    return null;
  }
  if (!json || typeof json !== "object" || !Array.isArray(json.data))
    return null;
  return {
    jobs: json.data,
    total: typeof json.totalJobs === "number" ? json.totalJobs : null,
    hasMore: json.hasMore === true,
  };
}

/** Parses a detail response body; null if it has no job. */
export function parseDetailResponse(body: string): RawDetail | null {
  try {
    const json = JSON.parse(body) as { data?: RawDetail | null };
    return json?.data && typeof json.data === "object" ? json.data : null;
  } catch {
    return null;
  }
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

export const str = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ") : null;

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

/** Names of a list of {id, name} entries, deduplicated. */
export const names = (v: Named[] | null | undefined): string[] =>
  uniq((Array.isArray(v) ? v : []).map((x) => str(x?.name)));

/** Location names; "remote" when listed as Remote or work from home. */
export function jobLocations(job: RawJob): {
  locations: string[];
  remote: boolean;
} {
  const locations = names(job.locations);
  return {
    locations,
    remote:
      job.workFromHome === 1 || locations.some((l) => /^remote$/i.test(l)),
  };
}

/**
 * Yearly salary range in INR. The API gives lakhs per annum (LPA: 20 =
 * ₹20,00,000); nulls when hidden or not given.
 */
export function jobSalary(job: RawJob): {
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
} {
  const none = { salaryMin: null, salaryMax: null, salaryCurrency: null };
  if (job.hideSal) return none;
  const inr = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) && v > 0
      ? Math.round(v * 100_000)
      : null;
  const salaryMin = inr(job.minSal);
  const salaryMax = inr(job.maxSal);
  if (salaryMin === null && salaryMax === null) return none;
  return { salaryMin, salaryMax, salaryCurrency: "INR" };
}

const years = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;

export function jobExperience(job: RawJob): {
  experienceMin: number | null;
  experienceMax: number | null;
} {
  return { experienceMin: years(job.min), experienceMax: years(job.max) };
}

/** Company name; null for confidential jobs ("Verified Company"). */
export function jobCompany(job: RawJob): string | null {
  if (job.confidential) return null;
  return str(job.companyData?.companyName);
}

export const isoTime = (ms: unknown) =>
  typeof ms === "number" && ms > 0 ? new Date(ms).toISOString() : null;

/** Job ID as a string, or null when missing. */
export function jobIdOf(job: RawJob): string | null {
  const id = job.id;
  if (typeof id === "number" && Number.isFinite(id)) return String(id);
  return str(id);
}

const SITE_URLS: Record<Site, string> = {
  hirist: "https://www.hirist.tech",
  iimjobs: "https://www.iimjobs.com",
};

/** Absolute job page URL. */
export function jobUrl(job: RawJob, site: Site): string | null {
  const url = str(job.jobDetailUrl);
  return url ? new URL(url, SITE_URLS[site]).href : null;
}
