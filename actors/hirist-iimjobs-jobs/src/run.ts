import {
  detailUrl,
  htmlToText,
  isoTime,
  jobCompany,
  jobExperience,
  jobIdOf,
  jobLocations,
  jobSalary,
  jobUrl,
  names,
  PAGE_SIZE,
  parseDetailResponse,
  parseSearchResponse,
  searchUrl,
  snippet,
  str,
  type RawJob,
  type Search,
  type Site,
} from "./gladiator.js";
import type { Page } from "./http.js";
import type { NormalizedInput } from "./input.js";
import type { Seen } from "./state.js";

export interface JobResult {
  jobId: string;
  site: Site;
  title: string | null;
  designation: string | null;
  company: string | null;
  companyLogoUrl: string | null;
  locations: string[];
  remote: boolean;
  experienceMin: number | null;
  experienceMax: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  skills: string[];
  postedAt: string | null;
  applicants: number | null;
  recruiterName: string | null;
  jobUrl: string | null;
  applyUrl: string | null;
  descriptionSnippet: string | null;
  description?: string | null;
  searchQuery: string;
  scrapedAt: string;
}

export interface RunDeps {
  /** GET a URL on a site's API (throws on HTTP errors/blocks). */
  get: (url: string, site: Site) => Promise<Page>;
  /** Push one item and charge for it. Return `false` to stop (budget). */
  emit: (item: JobResult) => Promise<boolean>;
  log?: (msg: string) => void;
  now?: () => Date;
  /** onlyNew mode: skip previously returned jobs (by site + jobId), record new ones. */
  seen?: Seen;
}

export interface SearchStats {
  search: string;
  pages: number;
  jobs: number;
  totalJobs: number | null;
  status: "done" | "failed" | "empty" | "stopped";
  error?: string;
}

export interface RunStats {
  pages: number;
  emitted: number;
  duplicates: number;
  /** onlyNew: jobs already returned by an earlier run (not charged). */
  skippedSeen: number;
  /** includeDescription: detail requests that failed (job kept without it). */
  descriptionErrors: number;
  searches: SearchStats[];
  stopReason: "done" | "maxItems" | "budget";
}

/** Safety cap on pages per search. */
export const MAX_PAGES = 200;

const errMsg = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).slice(0, 300);

export const describeSearch = (s: Search) =>
  `${s.site}: "${s.query}"` +
  (s.locationIds.length ? ` in locations ${s.locationIds.join(",")}` : "") +
  (s.minExperience !== null || s.maxExperience !== null
    ? `, ${s.minExperience ?? 0}-${s.maxExperience ?? "any"} yrs`
    : "");

/** Key for dedupe and onlyNew state: job IDs are per site. */
export const jobKey = (site: Site, jobId: string) => `${site}:${jobId}`;

export function toResult(
  job: RawJob,
  jobId: string,
  search: Search,
  scrapedAt: string,
  description?: string | null,
): JobResult {
  const company = jobCompany(job);
  const result: JobResult = {
    jobId,
    site: search.site,
    title: str(job.title),
    designation: str(job.jobdesignation),
    company,
    companyLogoUrl: company ? str(job.companyData?.logo) : null,
    ...jobLocations(job),
    ...jobExperience(job),
    ...jobSalary(job),
    skills: names(job.tags),
    postedAt: isoTime(job.createdTimeMs) ?? isoTime(job.createdTime),
    applicants: typeof job.applyCount === "number" ? job.applyCount : null,
    recruiterName: job.confidential ? null : str(job.recruiter?.recruiterName),
    jobUrl: jobUrl(job, search.site),
    applyUrl: str(job.applyUrl),
    descriptionSnippet: snippet(description ?? null),
    searchQuery: search.query,
    scrapedAt,
  };
  if (description !== undefined) result.description = description;
  return result;
}

export async function runJobs(
  input: NormalizedInput,
  deps: RunDeps,
): Promise<RunStats> {
  const log = deps.log ?? (() => {});
  const now = deps.now ?? (() => new Date());
  const stats: RunStats = {
    pages: 0,
    emitted: 0,
    duplicates: 0,
    skippedSeen: 0,
    descriptionErrors: 0,
    searches: [],
    stopReason: "done",
  };
  const seen = new Set<string>();
  // maxItems is split between the sites; a site that runs out of jobs
  // leaves its share to the next one.
  let siteCap = input.maxItems;

  const describe = async (s: Search, jobId: string) => {
    try {
      const res = await deps.get(detailUrl(s.site, jobId), s.site);
      const detail = parseDetailResponse(res.body);
      if (!detail) throw new Error("no job data");
      return htmlToText(detail.introText);
    } catch (e) {
      stats.descriptionErrors += 1;
      log(`${s.site} job ${jobId}: no description (${errMsg(e)})`);
      return null;
    }
  };

  const runSearch = async (s: Search, st: SearchStats) => {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const url = searchUrl(s, page);
      const res = await deps.get(url, s.site);
      stats.pages += 1;
      st.pages += 1;
      const parsed = parseSearchResponse(res.body);
      if (!parsed)
        throw new Error(`Unexpected response (no job data) at ${url}`);
      st.totalJobs ??= parsed.total;
      for (const job of parsed.jobs) {
        const jobId = jobIdOf(job);
        if (!jobId) continue;
        const key = jobKey(s.site, jobId);
        if (seen.has(key)) {
          stats.duplicates += 1;
          continue;
        }
        seen.add(key);
        if (deps.seen?.has(key)) {
          deps.seen.add(key);
          stats.skippedSeen += 1;
          continue;
        }
        const description = input.includeDescription
          ? await describe(s, jobId)
          : undefined;
        const item = toResult(job, jobId, s, now().toISOString(), description);
        const more = await deps.emit(item);
        deps.seen?.add(key);
        stats.emitted += 1;
        st.jobs += 1;
        if (!more) {
          stats.stopReason = "budget";
          return;
        }
        if (stats.emitted >= siteCap) return;
      }
      if (!parsed.jobs.length || !parsed.hasMore) return;
      if (parsed.total !== null && (page + 1) * PAGE_SIZE >= parsed.total)
        return;
    }
  };

  for (const [i, site] of input.sites.entries()) {
    const left = input.maxItems - stats.emitted;
    siteCap = stats.emitted + Math.ceil(left / (input.sites.length - i));
    for (const s of input.searches.filter((x) => x.site === site)) {
      if (stats.emitted >= siteCap) break;
      const st: SearchStats = {
        search: describeSearch(s),
        pages: 0,
        jobs: 0,
        totalJobs: null,
        status: "done",
      };
      stats.searches.push(st);
      const skippedBefore = stats.skippedSeen;
      const dupesBefore = stats.duplicates;
      try {
        await runSearch(s, st);
      } catch (e) {
        const error = errMsg(e);
        // Jobs from earlier pages are kept; only a search with none fails.
        st.status =
          st.jobs || stats.skippedSeen > skippedBefore ? "stopped" : "failed";
        st.error = error;
        log(`${st.search}: ${error}`);
        continue;
      }
      if (
        !st.jobs &&
        stats.stopReason === "done" &&
        stats.skippedSeen === skippedBefore &&
        stats.duplicates === dupesBefore
      ) {
        st.status = "empty";
        log(`${st.search}: no jobs found.`);
      }
      if (stats.stopReason === "budget") break;
    }
    if (stats.stopReason === "budget") break;
  }
  if (stats.stopReason === "done" && stats.emitted >= input.maxItems)
    stats.stopReason = "maxItems";
  // Partial results are fine, but never report success when every search failed.
  const failed = stats.searches.filter((s) => s.status === "failed");
  if (failed.length > 0 && stats.emitted === 0 && stats.skippedSeen === 0) {
    throw new Error(
      `All searches failed: ${[...new Set(failed.map((f) => f.error))].join("; ")}`,
    );
  }
  return stats;
}
