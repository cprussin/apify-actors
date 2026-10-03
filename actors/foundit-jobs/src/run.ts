import {
  htmlToText,
  isoTime,
  jobExperience,
  jobIdOf,
  jobLocations,
  jobSalary,
  jobSkills,
  jobUrl,
  PAGE_SIZE,
  parseSearchResponse,
  searchUrl,
  snippet,
  strs,
  type RawJob,
  type Search,
} from "./foundit.js";
import type { Page } from "./http.js";
import type { NormalizedInput } from "./input.js";
import type { Seen } from "./state.js";

export interface JobResult {
  jobId: string;
  title: string | null;
  companyName: string | null;
  companyId: string | null;
  companyLogoUrl: string | null;
  locations: string[];
  country: string | null;
  remote: boolean;
  experienceMin: number | null;
  experienceMax: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  skills: string[];
  employmentTypes: string[];
  jobTypes: string[];
  industries: string[];
  functions: string[];
  postedAt: string | null;
  updatedAt: string | null;
  closesAt: string | null;
  applicants: number | null;
  urgentlyHiring: boolean;
  jobUrl: string | null;
  applyUrl: string | null;
  descriptionSnippet: string | null;
  description?: string | null;
  searchQuery: string | null;
  searchLocation: string | null;
  scrapedAt: string;
}

export interface RunDeps {
  /** GET a URL (throws on HTTP errors/blocks). */
  get: (url: string) => Promise<Page>;
  /** Push one item and charge for it. Return `false` to stop (budget). */
  emit: (item: JobResult) => Promise<boolean>;
  log?: (msg: string) => void;
  now?: () => Date;
  /** onlyNew mode: skip previously returned jobs (by jobId), record new ones. */
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
  searches: SearchStats[];
  stopReason: "done" | "maxItems" | "budget";
}

/** The API stops returning results past this offset. */
export const MAX_START = 10_000;

const errMsg = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).slice(0, 300);

export const describeSearch = (s: Search) =>
  `${s.query ? `"${s.query}"` : "all jobs"}${s.location ? ` in ${s.location}` : ""}`;

const str = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim() : null;
const idStr = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? String(v) : str(v);

export function toResult(
  job: RawJob,
  jobId: string,
  search: Search,
  scrapedAt: string,
  includeDescription = false,
): JobResult {
  const text = htmlToText(job.description);
  const hidden = !!job.hideCompanyName;
  const result: JobResult = {
    jobId,
    title: str(job.title),
    companyName: hidden
      ? null
      : (str(job.companyName) ?? str(job.company?.name)),
    companyId: hidden
      ? null
      : (idStr(job.companyId) ?? idStr(job.company?.companyId)),
    companyLogoUrl: hidden
      ? null
      : (str(job.company?.logo) ?? str(job.companyLogoUrl)),
    ...jobLocations(job.locations),
    ...jobExperience(job),
    ...jobSalary(job),
    skills: jobSkills(job),
    employmentTypes: strs(job.employmentTypes),
    jobTypes: strs(job.jobTypes),
    industries: strs(job.industries),
    functions: strs(job.functions),
    postedAt: isoTime(job.postedAt),
    updatedAt: isoTime(job.updatedAt),
    closesAt: isoTime(job.closedAt),
    applicants:
      typeof job.totalApplicants === "number" ? job.totalApplicants : null,
    urgentlyHiring: job.isUrgentlyHiring === true,
    jobUrl: jobUrl(job),
    applyUrl: str(job.applyUrl) ?? str(job.redirectUrl),
    descriptionSnippet: snippet(text),
    searchQuery: search.query || null,
    searchLocation: search.location,
    scrapedAt,
  };
  if (includeDescription) result.description = text;
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
    searches: [],
    stopReason: "done",
  };
  const seen = new Set<string>();

  const runSearch = async (s: Search, st: SearchStats) => {
    for (let start = 0; start < MAX_START; start += PAGE_SIZE) {
      const url = searchUrl(s, start, input.sortBy);
      const res = await deps.get(url);
      stats.pages += 1;
      st.pages += 1;
      const page = parseSearchResponse(res.body);
      if (!page) throw new Error(`Unexpected response (no job data) at ${url}`);
      st.totalJobs ??= page.total;
      const scrapedAt = now().toISOString();
      for (const job of page.jobs) {
        const jobId = jobIdOf(job);
        if (!jobId) continue;
        if (seen.has(jobId)) {
          stats.duplicates += 1;
          continue;
        }
        seen.add(jobId);
        if (deps.seen?.has(jobId)) {
          deps.seen.add(jobId);
          stats.skippedSeen += 1;
          continue;
        }
        const item = toResult(
          job,
          jobId,
          s,
          scrapedAt,
          input.includeDescription,
        );
        const more = await deps.emit(item);
        deps.seen?.add(jobId);
        stats.emitted += 1;
        st.jobs += 1;
        if (!more) {
          stats.stopReason = "budget";
          return;
        }
        if (stats.emitted >= input.maxItems) {
          stats.stopReason = "maxItems";
          return;
        }
      }
      if (!page.jobs.length) return;
      if (page.total !== null && start + PAGE_SIZE >= page.total) return;
    }
  };

  for (const s of input.searches) {
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
    if (stats.stopReason !== "done") break;
  }
  // Partial results are fine, but never report success when every search failed.
  const failed = stats.searches.filter((s) => s.status === "failed");
  if (failed.length > 0 && stats.emitted === 0 && stats.skippedSeen === 0) {
    throw new Error(
      `All searches failed: ${[...new Set(failed.map((f) => f.error))].join("; ")}`,
    );
  }
  return stats;
}
