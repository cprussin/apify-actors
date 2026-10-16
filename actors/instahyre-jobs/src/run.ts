import {
  detailUrl,
  JOB_FUNCTIONS_URL,
  jobIdOf,
  matchesLocations,
  MAX_OFFSET,
  num,
  PAGE_SIZE,
  parseJobFunctions,
  parseJobResponse,
  parseSearchResponse,
  resolveJobFunctions,
  searchUrl,
  splitLocations,
  str,
  type RawJob,
  type SearchFilters,
} from "./instahyre.js";
import type { Page } from "./http.js";
import { InputError, type NormalizedInput } from "./input.js";
import { hash, type MonitorState } from "./state.js";

export type ChangeType = "new" | "updated" | "removed";

export interface JobResult {
  jobId: string;
  title: string | null;
  keywords: string[];
  locations: string[];
  jobUrl: string | null;
  employerId: string | null;
  employerName: string | null;
  employerTagline: string | null;
  employerFoundedYear: number | null;
  employerHeadcount: number | null;
  employerLogoUrl: string | null;
  /** monitorMode only: change since the previous run; otherwise null. */
  changeType: ChangeType | null;
  scrapedAt: string;
}

export interface RunDeps {
  /** GET a URL (throws on HTTP errors/blocks). */
  get: (url: string) => Promise<Page>;
  /** Push one item and charge for it. Return `false` to stop (budget). */
  emit: (item: JobResult) => Promise<boolean>;
  log?: (msg: string) => void;
  now?: () => Date;
  /** monitorMode state: classify jobs as new/updated/unchanged/removed. */
  state?: MonitorState;
}

export interface RunStats {
  pages: number;
  /** Jobs in the API results (before the location filter). */
  totalJobs: number | null;
  emitted: number;
  duplicates: number;
  /** Jobs outside the requested locations. */
  filteredOut: number;
  /** monitorMode: jobs unchanged since the previous run (not output). */
  unchanged: number;
  /** monitorMode: jobs output as removed. */
  removed: number;
  /** All results were read (needed to detect removed jobs). */
  complete: boolean;
  stopReason: "done" | "maxItems" | "budget" | "error" | "resultWindow";
  error?: string;
}

/** At most this many removed jobs are looked up for their latest data. */
export const MAX_REMOVED_LOOKUPS = 300;

const errMsg = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).slice(0, 300);

export function toResult(
  job: RawJob,
  jobId: string,
  scrapedAt: string,
  changeType: ChangeType | null = null,
): JobResult {
  const e = job.employer ?? {};
  const keywords = Array.isArray(job.keywords)
    ? [...new Set(job.keywords.map(str).filter((k) => k !== null))]
    : [];
  return {
    jobId,
    title: str(job.title) ?? str(job.candidate_title),
    keywords,
    locations: splitLocations(job.locations),
    jobUrl: str(job.public_url),
    employerId: num(e.id) !== null ? String(e.id) : null,
    employerName: str(e.company_name),
    employerTagline: str(e.company_tagline),
    employerFoundedYear: num(e.company_founded) || null,
    employerHeadcount: num(e.employee_count),
    employerLogoUrl: str(e.profile_image_src),
    changeType,
    scrapedAt,
  };
}

/** What counts as an "update" in monitorMode: the job's own listed data. */
export const fingerprint = (r: JobResult) =>
  hash({
    title: r.title,
    keywords: [...r.keywords].sort(),
    locations: [...r.locations].sort(),
    employerId: r.employerId,
  });

/** Job function names/slugs/IDs -> IDs (one lookup unless all are IDs). */
export async function jobFunctionIds(
  wanted: string[],
  get: RunDeps["get"],
): Promise<number[]> {
  if (!wanted.length) return [];
  if (wanted.every((w) => /^\d+$/.test(w))) return wanted.map(Number);
  const all = parseJobFunctions((await get(JOB_FUNCTIONS_URL)).body);
  if (!all) throw new Error("Unexpected job function list response.");
  const { ids, unknown } = resolveJobFunctions(wanted, all);
  if (unknown.length)
    throw new InputError(
      `Unknown job function(s): ${unknown.join(", ")}. Use names as on instahyre.com, e.g. "Backend Development", "Data Science / Machine Learning".`,
    );
  return ids;
}

export async function runJobs(
  input: NormalizedInput,
  deps: RunDeps,
): Promise<RunStats> {
  const log = deps.log ?? (() => {});
  const now = deps.now ?? (() => new Date());
  const state = deps.state;
  const baseline = state?.isBaseline ?? false;
  const stats: RunStats = {
    pages: 0,
    totalJobs: null,
    emitted: 0,
    duplicates: 0,
    filteredOut: 0,
    unchanged: 0,
    removed: 0,
    complete: false,
    stopReason: "done",
  };

  const filters: SearchFilters = {
    skills: input.skills,
    locations: input.locations,
    years: input.years,
    jobFunctionIds: await jobFunctionIds(input.jobFunctions, deps.get),
    companySize: input.companySize,
    jobType: input.jobType,
  };

  /** Emits one item; false = stop (maxItems or budget). */
  const emit = async (item: JobResult): Promise<boolean> => {
    const more = await deps.emit(item);
    stats.emitted += 1;
    if (!more) {
      stats.stopReason = "budget";
      return false;
    }
    if (stats.emitted >= input.maxItems) {
      stats.stopReason = "maxItems";
      return false;
    }
    return true;
  };

  const seen = new Set<string>();
  const scan = async (): Promise<void> => {
    for (let offset = 0; ; offset += PAGE_SIZE) {
      if (offset > MAX_OFFSET) {
        stats.stopReason = "resultWindow";
        log(
          `Instahyre returns at most ${MAX_OFFSET + PAGE_SIZE} results per search; narrow the filters to get the rest.`,
        );
        return;
      }
      const url = searchUrl(filters, offset);
      const res = await deps.get(url);
      stats.pages += 1;
      const page = parseSearchResponse(res.body);
      if (!page) throw new Error(`Unexpected response (no job data) at ${url}`);
      stats.totalJobs ??= page.total;
      const scrapedAt = now().toISOString();
      for (const job of page.jobs) {
        const jobId = jobIdOf(job);
        if (!jobId) continue;
        if (seen.has(jobId)) {
          stats.duplicates += 1;
          continue;
        }
        seen.add(jobId);
        const item = toResult(job, jobId, scrapedAt);
        if (!matchesLocations(item.locations, input.locations)) {
          stats.filteredOut += 1;
          continue;
        }
        if (state) {
          const fp = fingerprint(item);
          const change = state.classify(jobId, fp);
          if (change === "unchanged") {
            state.record(jobId, fp);
            stats.unchanged += 1;
            continue;
          }
          item.changeType = change;
          const more = await emit(item);
          state.record(jobId, fp);
          if (!more) return;
        } else if (!(await emit(item))) return;
      }
      if (!page.jobs.length) break;
      if (page.total !== null && offset + PAGE_SIZE >= page.total) break;
    }
    stats.complete = true;
  };

  try {
    await scan();
  } catch (e) {
    if (e instanceof InputError) throw e;
    stats.stopReason = "error";
    stats.error = errMsg(e);
    log(`Search stopped: ${stats.error}`);
    if (!stats.emitted && !stats.unchanged) throw e;
  }

  // Removed jobs: only knowable after reading every result.
  if (state && !baseline && stats.stopReason === "done") {
    const missing = state.missing();
    if (missing.length) log(`${missing.length} job(s) removed since last run.`);
    let lookups = 0;
    for (const jobId of missing) {
      let item = toResult({}, jobId, now().toISOString());
      if (lookups < MAX_REMOVED_LOOKUPS) {
        lookups += 1;
        try {
          const job = parseJobResponse((await deps.get(detailUrl(jobId))).body);
          if (job) item = toResult(job, jobId, now().toISOString());
        } catch (e) {
          log(`Removed job ${jobId}: no details (${errMsg(e)})`);
        }
      }
      item.changeType = "removed";
      const more = await emit(item);
      state.remove(jobId);
      stats.removed += 1;
      if (!more) break;
    }
  } else if (state && !baseline && stats.stopReason !== "done") {
    log(
      "Removed jobs not checked: the run stopped before reading every result (raise maxItems or narrow the filters).",
    );
  }
  return stats;
}
