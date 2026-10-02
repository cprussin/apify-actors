import type { Page } from "./http.js";
import type { NormalizedInput, SearchPlan } from "./input.js";
import type { Seen } from "./state.js";
import {
  badge,
  companySize,
  companyUrl,
  isBlockPage,
  jobUrl,
  listingUrl,
  parseCompensation,
  parseListingPage,
  REMOTE,
  workplace,
  type RawJob,
  type RawStartup,
  type Search,
} from "./wellfound.js";

export interface JobResult {
  jobId: string;
  title: string | null;
  role: string | null;
  jobUrl: string;
  jobType: string | null;
  postedAt: string | null;
  locations: string[];
  remote: boolean;
  workplace: string | null;
  remoteLocations: string[];
  compensation: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  equityMin: number | null;
  equityMax: number | null;
  hasEquity: boolean | null;
  yearsExperienceMin: number | null;
  yearsExperienceMax: number | null;
  description?: string | null;
  companyId: string;
  companyName: string | null;
  companySlug: string | null;
  companyUrl: string | null;
  companyLogoUrl: string | null;
  companySize: string | null;
  companyStage: string | null;
  companyOneLiner: string | null;
  companyBadges: string[];
  searchRole: string | null;
  searchLocation: string | null;
  searchUrl: string;
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
  stopReason: "done" | "maxJobs" | "budget";
}

const errMsg = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).slice(0, 300);

export const describeSearch = (s: Search) =>
  [s.role, s.location].filter(Boolean).join(" @ ");

const str = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim() : null;
const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const strs = (v: unknown) =>
  Array.isArray(v) ? v.map(str).filter((x): x is string => !!x) : [];

export function toResult(
  job: RawJob,
  startup: RawStartup,
  search: Search,
  url: string,
  scrapedAt: string,
  includeDescription = true,
): JobResult {
  const comp = parseCompensation(job.compensation);
  const slug = str(startup.slug);
  const stage = badge(startup, "COMPANY_STAGE_BADGE");
  const live = num(job.liveStartAt);
  const result: JobResult = {
    jobId: String(job.id),
    title: str(job.title),
    role: str(job.primaryRoleTitle),
    jobUrl: jobUrl(job),
    jobType: str(job.jobType),
    postedAt: live ? new Date(live * 1000).toISOString() : null,
    locations: strs(job.locationNames),
    remote: job.remote === true,
    workplace: workplace(job),
    remoteLocations: strs(job.acceptedRemoteLocationNames),
    compensation: str(job.compensation),
    ...comp,
    yearsExperienceMin: num(job.yearsExperienceMin),
    yearsExperienceMax: num(job.yearsExperienceMax),
    companyId: String(startup.id),
    companyName: str(startup.name),
    companySlug: slug,
    companyUrl: slug ? companyUrl(slug) : null,
    companyLogoUrl: str(startup.logoUrl),
    companySize: companySize(startup.companySize),
    companyStage: str(stage?.label),
    companyOneLiner: str(startup.highConcept),
    companyBadges: (startup.badges ?? [])
      .filter((b) => b.name !== "COMPANY_STAGE_BADGE")
      .map((b) => str(b.label))
      .filter((x): x is string => !!x),
    searchRole: search.role,
    searchLocation: search.location,
    searchUrl: url,
    scrapedAt,
  };
  if (includeDescription) result.description = str(job.description);
  return result;
}

/** Did Wellfound answer the search we asked for (unknown slugs redirect)? */
function matches(s: Search, page: ReturnType<typeof parseListingPage>) {
  if (!page) return false;
  if ((page.role ?? null) !== s.role) return false;
  if (s.location === REMOTE) return page.remote;
  return (page.location ?? null) === s.location;
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

  const runSearch = async (s: SearchPlan, st: SearchStats) => {
    const last = s.startPage + input.maxPages - 1;
    for (let p = s.startPage; p <= last; p++) {
      const url = listingUrl(s, p);
      const res = await deps.get(url);
      stats.pages += 1;
      st.pages += 1;
      const page = parseListingPage(res.html);
      if (!page) {
        if (isBlockPage(res.html)) throw new Error("Blocked by Wellfound.");
        throw new Error(`Unexpected page (no job data) at ${res.url}`);
      }
      if (!matches(s, page))
        throw new Error(
          `Wellfound has no listing page for ${describeSearch(s)} (redirected to ${res.url}). Check the role/location slug.`,
        );
      st.totalJobs ??= page.totalJobCount;
      const scrapedAt = now().toISOString();
      for (const { job, startup } of page.jobs) {
        if (seen.has(job.id)) {
          stats.duplicates += 1;
          continue;
        }
        seen.add(job.id);
        const jobId = String(job.id);
        if (deps.seen?.has(jobId)) {
          deps.seen.add(jobId);
          stats.skippedSeen += 1;
          continue;
        }
        const item = toResult(
          job,
          startup,
          s,
          url,
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
        if (stats.emitted >= input.maxJobs) {
          stats.stopReason = "maxJobs";
          return;
        }
      }
      if (!page.jobs.length) return;
      if (page.pageCount !== null && p >= page.pageCount) return;
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
      stats.skippedSeen === skippedBefore
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
