import {
  BASE_URL,
  detailLocations,
  experience,
  htmlToText,
  isoDate,
  jobPageUrl,
  ldSalary,
  listingDataUrl,
  listingPageUrl,
  listingSalary,
  num,
  parseDetail,
  parseListing,
  parseSitemap,
  shortIdOf,
  SITEMAP_URL,
  snippet,
  str,
  strs,
  workMode,
  type RawDetail,
  type RawJob,
  type WorkMode,
} from "./cutshort.js";
import type { Expect, Page } from "./http.js";
import type { NormalizedInput, Search } from "./input.js";
import { fingerprint, type ChangeType, type Monitor } from "./monitor.js";

export interface JobResult {
  jobId: string;
  internalId: string | null;
  headline: string | null;
  companyName: string | null;
  hiringForClient: boolean | null;
  recruiterName: string | null;
  companyLogoUrl: string | null;
  companyUrl: string | null;
  companyWebsite: string | null;
  companyType: string | null;
  companySize: string | null;
  companyStage: string | null;
  companyFounded: number | null;
  locations: string[];
  workMode: WorkMode | null;
  remote: boolean | null;
  experienceMin: number | null;
  experienceMax: number | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryText: string | null;
  skills: string[];
  roleTypes: string[];
  postedAt: string | null;
  url: string | null;
  descriptionSnippet: string | null;
  // With includeDetails (always in sitemap mode):
  description?: string | null;
  validThrough?: string | null;
  employmentTypes?: string[];
  category?: string | null;
  tags?: string[];
  postalCode?: string | null;
  jobValid?: boolean | null;
  // Monitor mode:
  changeType?: ChangeType;
  searchSlug: string | null;
  scrapedAt: string;
}

/** Billing events of one dataset item. */
export type ChargeEvent = "job" | "job-detail";

export interface RunDeps {
  /** GET a URL (throws on HTTP errors/blocks; returns 2xx/400/404/410). */
  get: (url: string, expect: Expect) => Promise<Page>;
  /** Push one item and charge its events. Return `false` to stop (budget). */
  emit: (item: JobResult, events: ChargeEvent[]) => Promise<boolean>;
  log?: (msg: string) => void;
  now?: () => Date;
  /** monitorMode: change tracking state. */
  monitor?: Monitor;
}

export interface SearchStats {
  search: string;
  slug: string | null;
  pages: number;
  jobs: number;
  liveJobs: number | null;
  status: "done" | "failed" | "empty" | "notFound" | "stopped" | "pageLimit";
  error?: string;
}

export interface RunStats {
  mode: NormalizedInput["mode"];
  pages: number;
  emitted: number;
  details: number;
  detailErrors: number;
  duplicates: number;
  /** Monitor: listed jobs unchanged since the last run (not output or charged). */
  unchanged: number;
  new: number;
  updated: number;
  removed: number;
  /** Monitor: why removed jobs were not checked, if they were not. */
  removedSkipped?: string;
  /** Sitemap mode: job pages that no longer exist. */
  gone: number;
  searches: SearchStats[];
  stopReason: "done" | "maxItems" | "budget";
}

const errMsg = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).slice(0, 300);

const company = (job: RawJob) => {
  const cd = job.companyDetails ?? {};
  const forClient = job.hiringForClient === true;
  const alias = str(job.companyId?.alias) ?? str(cd.alias);
  return {
    companyName:
      str(cd.name) ??
      str(job.jobFactSummary?.companyName) ??
      str(job.companyId?.name),
    hiringForClient:
      typeof job.hiringForClient === "boolean" ? forClient : null,
    recruiterName: forClient ? str(job.companyId?.name) : null,
    companyLogoUrl: forClient
      ? null
      : (str(cd.logo) ?? str(job.companyId?.logo)),
    companyUrl: alias ? `${BASE_URL}/company/${alias}` : null,
    companyWebsite: forClient ? null : str(cd.links?.website),
    companyType: str(cd.type),
    companySize: str(cd.size),
    companyStage: str(cd.stage),
    companyFounded: num(cd.founded),
  };
};

/** Dataset item from a listing page job. */
export function fromListing(
  job: RawJob,
  jobId: string,
  searchSlug: string | null,
  scrapedAt: string,
): JobResult {
  const text = htmlToText(job.sanitizedComment);
  const mode = workMode(job.remoteType);
  return {
    jobId,
    internalId: str(job._id),
    headline: str(job.headline),
    ...company(job),
    locations: Array.isArray(job.locations) ? strs(job.locations) : [],
    workMode: mode,
    remote: mode ? mode !== "onsite" : null,
    ...experience(job.expRange),
    ...listingSalary(job.salaryRange),
    salaryText:
      str(job.salaryRangeText) ??
      (typeof job.salaryRange === "string" ? str(job.salaryRange) : null) ??
      str(job.jobFactSummary?.salary),
    skills: strs(job.allSkills),
    roleTypes: strs(job.roleTypes),
    postedAt: isoDate(job.jobFactSummary?.postedDate),
    url: str(job.publicUrl),
    descriptionSnippet: snippet(text),
    searchSlug,
    scrapedAt,
  };
}

/** Job-page-only fields, added with includeDetails. */
export function detailFields(job: RawDetail) {
  const ld = job.jobPosting;
  const places = ld?.jobLocation;
  const first = Array.isArray(places) ? places[0] : places;
  const types = ld?.employmentType;
  return {
    description: htmlToText(job.sanitizedComment),
    validThrough: isoDate(ld?.validThrough),
    employmentTypes: strs(Array.isArray(types) ? types : [types]),
    category: str(job.matchPreferences?.tagCategory),
    tags: strs(job.matchPreferences?.tags),
    postalCode: str(first?.address?.postalCode),
    jobValid: typeof job.jobValid === "boolean" ? job.jobValid : null,
  };
}

/** Dataset item from a job page alone (sitemap mode). */
export function fromDetail(
  job: RawDetail,
  jobId: string,
  scrapedAt: string,
): JobResult {
  const base = fromListing(job, jobId, null, scrapedAt);
  const salary = ldSalary(job.jobPosting);
  return {
    ...base,
    locations: detailLocations(job),
    ...(salary.salaryMin !== null || salary.salaryMax !== null
      ? salary
      : listingSalary(job.salaryRange)),
    postedAt: base.postedAt ?? isoDate(job.jobPosting?.datePosted),
    url: base.url ?? null,
    ...detailFields(job),
  };
}

/** Content that counts as an "update" in monitor mode. */
export const contentFingerprint = (r: JobResult) =>
  fingerprint({
    h: r.headline,
    c: r.companyName,
    l: [...r.locations].sort(),
    w: r.workMode,
    e: [r.experienceMin, r.experienceMax],
    s: [r.salaryMin, r.salaryMax, r.salaryCurrency],
    k: [...r.skills].sort(),
    r: [...r.roleTypes].sort(),
    d: r.descriptionSnippet,
  });

export const describeSearch = (s: Search) => s.label;

/** Hard cap on listing pages per search (the site serves 50 jobs each). */
export const MAX_LISTING_PAGES = 200;
/** Job page failures in a row (after retries) that end the run's detail fetching. */
export const MAX_DETAIL_FAILURES = 10;

export async function runJobs(
  input: NormalizedInput,
  deps: RunDeps,
): Promise<RunStats> {
  const log = deps.log ?? (() => {});
  const now = deps.now ?? (() => new Date());
  const monitor = deps.monitor;
  const stats: RunStats = {
    mode: input.mode,
    pages: 0,
    emitted: 0,
    details: 0,
    detailErrors: 0,
    duplicates: 0,
    unchanged: 0,
    new: 0,
    updated: 0,
    removed: 0,
    gone: 0,
    searches: [],
    stopReason: "done",
  };
  const seen = new Set<string>();

  /** Emits one item; false = stop the run. */
  const emit = async (
    item: JobResult,
    events: ChargeEvent[],
  ): Promise<boolean> => {
    const more = await deps.emit(item, events);
    stats.emitted += 1;
    if (item.changeType) stats[item.changeType] += 1;
    if (monitor && item.changeType !== "removed")
      monitor.record(item.jobId, {
        fingerprint: item.searchSlug === null ? "" : contentFingerprint(item),
        headline: item.headline,
        companyName: item.companyName,
        url: item.url,
      });
    if (!more) {
      stats.stopReason = "budget";
      return false;
    }
    return true;
  };
  const changes = () =>
    stats.new + stats.updated + (monitor ? 0 : stats.emitted);

  let detailFailures = 0;
  /**
   * Job page data, "gone", or null if it failed (logged). Throws after
   * MAX_DETAIL_FAILURES failures in a row (blocked or broken site).
   */
  const fetchDetail = async (
    url: string,
  ): Promise<RawDetail | "gone" | null> => {
    try {
      const page = await deps.get(jobPageUrl(url), "html");
      const d = parseDetail(page.body, page.status);
      if (!d) throw new Error(`Unexpected job page (no job data) at ${url}`);
      detailFailures = 0;
      return d.kind === "job" ? d.job : "gone";
    } catch (e) {
      stats.detailErrors += 1;
      detailFailures += 1;
      log(`Job page ${url}: ${errMsg(e)}`);
      if (detailFailures >= MAX_DETAIL_FAILURES)
        throw new Error(
          `${detailFailures} job pages failed in a row; last: ${errMsg(e)}`,
          { cause: e },
        );
      return null;
    }
  };

  /** Handles one listed job; false = stop the run. */
  const handleListed = async (
    job: RawJob,
    slug: string,
    st: SearchStats,
  ): Promise<boolean> => {
    const jobId = shortIdOf(job.publicUrl) ?? str(job._id);
    if (!jobId) return true;
    if (seen.has(jobId)) {
      stats.duplicates += 1;
      return true;
    }
    seen.add(jobId);
    const item = fromListing(job, jobId, slug, now().toISOString());
    if (monitor) {
      const change = monitor.check(jobId, contentFingerprint(item));
      if (!change) {
        stats.unchanged += 1;
        return true;
      }
      item.changeType = change;
    }
    const events: ChargeEvent[] = ["job"];
    if (input.includeDetails && item.url) {
      const d = await fetchDetail(item.url);
      if (d && d !== "gone") {
        Object.assign(item, detailFields(d));
        stats.details += 1;
        events.push("job-detail");
      } else if (d === "gone") {
        item.jobValid = false;
      }
    }
    st.jobs += 1;
    if (!(await emit(item, events))) return false;
    if (changes() >= input.maxItems) {
      stats.stopReason = "maxItems";
      return false;
    }
    return true;
  };

  /** Pages through one search; returns false to stop the run. */
  const runSearch = async (s: Search, st: SearchStats): Promise<boolean> => {
    let page = input.startPage;
    // Resolve the slug: the first candidate that exists.
    let first = null;
    for (const slug of s.candidates) {
      const url = listingDataUrl(slug, page);
      const res = await deps.get(url, "json");
      stats.pages += 1;
      st.pages += 1;
      const listing = parseListing(res.body);
      if (!listing)
        throw new Error(`Unexpected response (no job data) at ${url}`);
      if (listing.kind === "unknown") continue;
      st.slug = slug;
      first = listing;
      break;
    }
    if (!first || !st.slug) {
      st.status = "notFound";
      st.pages = 0;
      log(
        `${st.search}: no Cutshort listing (tried ${s.candidates.map(listingPageUrl).join(", ")}). Open cutshort.io/jobs, find the skill and city, and use the slug from its URL.`,
      );
      return true;
    }
    const slug = st.slug;
    let listing = first;
    let listed = 0;
    for (let n = 1; ; n += 1) {
      if (listing.kind !== "jobs") break;
      st.liveJobs ??= listing.liveJobCount;
      listed += listing.jobs.length;
      for (const job of listing.jobs)
        if (!(await handleListed(job, slug, st))) {
          st.status = "stopped";
          return false;
        }
      if (input.maxPages && n >= input.maxPages) {
        st.status = "pageLimit";
        return true;
      }
      if (page - input.startPage + 1 >= MAX_LISTING_PAGES) {
        st.status = "pageLimit";
        return true;
      }
      page += 1;
      const url = listingDataUrl(slug, page);
      const res = await deps.get(url, "json");
      stats.pages += 1;
      st.pages += 1;
      const next = parseListing(res.body);
      if (!next || next.kind === "unknown")
        throw new Error(`Unexpected response (no job data) at ${url}`);
      listing = next;
    }
    if (!listed) st.status = "empty";
    return true;
  };

  /** Reports known jobs that a complete crawl no longer lists. */
  const reportRemoved = async () => {
    if (!monitor) return;
    for (const [jobId, k] of monitor.missing()) {
      const item: JobResult = {
        jobId,
        internalId: null,
        headline: k.headline,
        companyName: k.companyName,
        hiringForClient: null,
        recruiterName: null,
        companyLogoUrl: null,
        companyUrl: null,
        companyWebsite: null,
        companyType: null,
        companySize: null,
        companyStage: null,
        companyFounded: null,
        locations: [],
        workMode: null,
        remote: null,
        experienceMin: null,
        experienceMax: null,
        salaryMin: null,
        salaryMax: null,
        salaryCurrency: null,
        salaryText: null,
        skills: [],
        roleTypes: [],
        postedAt: null,
        url: k.url,
        descriptionSnippet: null,
        changeType: "removed",
        searchSlug: null,
        scrapedAt: now().toISOString(),
      };
      const more = await emit(item, ["job"]);
      monitor.delete(jobId);
      if (!more) return;
    }
  };

  if (input.mode === "sitemap") {
    const st: SearchStats = {
      search: "all jobs (sitemap)",
      slug: null,
      pages: 0,
      jobs: 0,
      liveJobs: null,
      status: "done",
    };
    stats.searches.push(st);
    const res = await deps.get(SITEMAP_URL, "xml");
    stats.pages += 1;
    st.pages += 1;
    const entries = parseSitemap(res.body);
    if (!entries || !entries.length)
      throw new Error(`Unexpected response (no job URLs) at ${SITEMAP_URL}`);
    st.liveJobs = entries.length;
    // Most recently modified first.
    entries.sort((a, b) => (b.lastmod ?? "").localeCompare(a.lastmod ?? ""));
    for (const e of entries) monitor?.touch(e.jobId);
    let stop = false;
    for (const e of entries) {
      if (monitor?.has(e.jobId)) {
        stats.unchanged += 1;
        continue;
      }
      let d;
      try {
        d = await fetchDetail(e.url);
      } catch (err) {
        if (!st.jobs) throw err;
        // Keep the jobs so far; removals can't be trusted without them all.
        log(`Stopping: ${errMsg(err)}`);
        st.status = "stopped";
        stop = true;
        break;
      }
      if (d === "gone") stats.gone += 1;
      if (!d || d === "gone") continue;
      stats.details += 1;
      const item = fromDetail(d, e.jobId, now().toISOString());
      item.url ??= e.url;
      if (monitor) item.changeType = "new";
      st.jobs += 1;
      if (!(await emit(item, ["job", "job-detail"]))) {
        stop = true;
        break;
      }
      if (changes() >= input.maxItems) {
        stats.stopReason = "maxItems";
        break;
      }
    }
    if (st.jobs === 0 && stats.detailErrors > 0 && !stats.unchanged)
      throw new Error(
        `All job pages failed (${stats.detailErrors} errors); see the log.`,
      );
    // The sitemap lists every live job, so removals are always detectable.
    if (!stop) await reportRemoved();
    return stats;
  }

  for (const s of input.searches) {
    const st: SearchStats = {
      search: describeSearch(s),
      slug: null,
      pages: 0,
      jobs: 0,
      liveJobs: null,
      status: "done",
    };
    stats.searches.push(st);
    let more: boolean;
    try {
      more = await runSearch(s, st);
    } catch (e) {
      const error = errMsg(e);
      // Jobs from earlier pages are kept; only a search with none fails.
      st.status = st.jobs ? "stopped" : "failed";
      st.error = error;
      log(`${st.search}: ${error}`);
      continue;
    }
    if (st.status === "empty") log(`${st.search}: no jobs found.`);
    if (!more) break;
  }

  // Partial results are fine, but never report success when every search failed.
  const failed = stats.searches.filter((s) => s.status === "failed");
  if (failed.length > 0 && stats.emitted === 0 && stats.unchanged === 0) {
    throw new Error(
      `All searches failed: ${[...new Set(failed.map((f) => f.error))].join("; ")}`,
    );
  }

  if (monitor) {
    const incomplete = stats.searches.find(
      (s) => !["done", "empty", "notFound"].includes(s.status),
    );
    if (stats.stopReason !== "done")
      stats.removedSkipped = `stopped early (${stats.stopReason})`;
    else if (input.startPage !== 1) stats.removedSkipped = "startPage is not 1";
    else if (incomplete)
      stats.removedSkipped = `${incomplete.search} was not read to the end (${incomplete.status})`;
    if (stats.removedSkipped)
      log(
        `Removed jobs not checked: ${stats.removedSkipped}. They are reported by the next complete run.`,
      );
    else await reportRemoved();
  }
  return stats;
}
