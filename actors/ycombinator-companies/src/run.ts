import {
  INDEX,
  INDEX_BY_LAUNCH,
  MAX_HITS_PER_PAGE,
  PAGINATION_LIMIT,
  type AlgoliaSearch,
  type SearchParams,
} from "./algolia.js";
import type { Page } from "./http.js";
import type { CompanyFilters, NormalizedInput } from "./input.js";
import type { Seen } from "./state.js";
import {
  absolute,
  batchCode,
  batchRank,
  companyJobsUrl,
  companyUrl,
  isBlockPage,
  isRemote,
  JOB_ROLES,
  jobsListingUrl,
  parseEquity,
  parseExperience,
  parseJobsPage,
  parseSalary,
  slugify,
  splitLocations,
  type RawCompany,
  type RawJob,
} from "./yc.js";

export interface CompanyResult {
  companyId: string;
  name: string | null;
  slug: string | null;
  formerNames: string[];
  oneLiner: string | null;
  longDescription: string | null;
  batch: string | null;
  batchCode: string | null;
  status: string | null;
  stage: string | null;
  industry: string | null;
  subindustry: string | null;
  industries: string[];
  regions: string[];
  locations: string | null;
  tags: string[];
  teamSize: number | null;
  website: string | null;
  ycUrl: string | null;
  jobsUrl: string | null;
  launchedAt: string | null;
  isHiring: boolean;
  topCompany: boolean;
  nonprofit: boolean;
  logoUrl: string | null;
  scrapedAt: string;
}

export interface JobResult {
  jobId: string;
  title: string | null;
  jobUrl: string | null;
  applyUrl: string | null;
  companyName: string | null;
  companySlug: string | null;
  companyUrl: string | null;
  companyBatch: string | null;
  companyOneLiner: string | null;
  companyLogoUrl: string | null;
  location: string | null;
  locations: string[];
  remote: boolean;
  jobType: string | null;
  role: string | null;
  roleCategory: string | null;
  roleSubtype: string | null;
  salaryRange: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
  equityRange: string | null;
  equityMin: number | null;
  equityMax: number | null;
  experience: string | null;
  minExperienceYears: number | null;
  visa: string | null;
  skills: string[];
  postedAgo: string | null;
  lastActive: string | null;
  sourceUrl: string;
  scrapedAt: string;
}

export type Item = CompanyResult | JobResult;

export interface RunDeps {
  /** GET a YC page (throws on HTTP errors/blocks). */
  get: (url: string) => Promise<Page>;
  /** Algolia client for the company index (created on first use). */
  algolia: () => Promise<AlgoliaSearch>;
  /** Push one item and charge for it. Return `false` to stop (budget). */
  emit: (item: Item) => Promise<boolean>;
  log?: (msg: string) => void;
  now?: () => Date;
  /** onlyNew mode: skip previously returned items (by ID), record new ones. */
  seen?: Seen;
}

export interface SourceStats {
  source: string;
  items: number;
  status: "done" | "failed" | "empty" | "stopped";
  error?: string;
}

export interface RunStats {
  /** Companies mode: companies matching the filters. */
  totalMatches: number | null;
  emitted: number;
  duplicates: number;
  /** onlyNew: items already returned by an earlier run (not charged). */
  skippedSeen: number;
  /** Jobs mode: one entry per jobs page. */
  sources: SourceStats[];
  stopReason: "done" | "maxItems" | "budget";
}

/** A filter value that matches nothing in the YC directory. */
export class FilterError extends Error {}

const errMsg = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).slice(0, 300);

const str = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim() : null;
const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const strs = (v: unknown) =>
  Array.isArray(v) ? v.map(str).filter((x): x is string => !!x) : [];

export function toCompany(c: RawCompany, scrapedAt: string): CompanyResult {
  const slug = str(c.slug);
  const launched = num(c.launched_at);
  const ycUrl = slug ? companyUrl(slug) : null;
  const subindustry = str(c.subindustry);
  return {
    companyId: String(c.objectID ?? c.id ?? ""),
    name: str(c.name),
    slug,
    formerNames: strs(c.former_names),
    oneLiner: str(c.one_liner),
    longDescription: str(c.long_description?.replace(/\r\n?/g, "\n")),
    batch: str(c.batch),
    batchCode: batchCode(c.batch),
    status: str(c.status),
    stage: str(c.stage),
    industry: str(c.industry),
    subindustry:
      subindustry && subindustry.includes("->")
        ? str(subindustry.split("->").pop())
        : null,
    industries: strs(c.industries),
    regions: strs(c.regions),
    locations: str(c.all_locations),
    tags: strs(c.tags),
    teamSize: num(c.team_size),
    website: str(c.website),
    ycUrl,
    jobsUrl: ycUrl && c.isHiring === true ? `${ycUrl}/jobs` : null,
    launchedAt: launched ? new Date(launched * 1000).toISOString() : null,
    isHiring: c.isHiring === true,
    topCompany: c.top_company === true,
    nonprofit: c.nonprofit === true,
    logoUrl: str(c.small_logo_thumb_url),
    scrapedAt,
  };
}

export function toJob(
  j: RawJob,
  sourceUrl: string,
  scrapedAt: string,
): JobResult {
  const companyPath = str(j.companyUrl);
  const location = str(j.location);
  return {
    jobId: String(j.id),
    title: str(j.title),
    jobUrl: absolute(str(j.url)),
    applyUrl: str(j.applyUrl),
    companyName: str(j.companyName),
    companySlug: companyPath
      ? (/\/companies\/([^/?#]+)/.exec(companyPath)?.[1] ?? null)
      : null,
    companyUrl: absolute(companyPath),
    companyBatch: str(j.companyBatchName),
    companyOneLiner: str(j.companyOneLiner),
    companyLogoUrl: str(j.companyLogoUrl),
    location,
    locations: splitLocations(location),
    remote: isRemote(location),
    jobType: str(j.type),
    role: str(j.prettyRole),
    roleCategory: str(j.role),
    roleSubtype: str(j.roleSpecificType),
    salaryRange: str(j.salaryRange),
    ...parseSalary(j.salaryRange),
    equityRange: str(j.equityRange),
    ...parseEquity(j.equityRange),
    experience: str(j.minExperience),
    minExperienceYears: parseExperience(j.minExperience),
    visa: str(j.visa),
    skills: (j.skills ?? [])
      .map((s) => (typeof s === "string" ? s : s?.name))
      .map(str)
      .filter((x): x is string => !!x),
    postedAgo: str(j.createdAt),
    lastActive: str(j.lastActive),
    sourceUrl,
    scrapedAt,
  };
}

// ---------------------------------------------------------------- Filters

const FACETS = {
  batches: "batch",
  industries: "industries",
  regions: "regions",
  tags: "tags",
} as const;

const norm = (s: string) => slugify(s);

/**
 * Map user filter values to the exact facet values in the index
 * (case-insensitive). Throws FilterError for values that match nothing.
 */
export function resolveFacetValues(
  filters: CompanyFilters,
  facets: Record<string, Record<string, number>>,
): CompanyFilters {
  const out = { ...filters };
  for (const [field, facet] of Object.entries(FACETS) as [
    keyof typeof FACETS,
    string,
  ][]) {
    const known = Object.keys(facets[facet] ?? {});
    out[field] = filters[field].map((v) => {
      const hit = known.find((k) => norm(k) === norm(v));
      if (hit) return hit;
      const close = known
        .filter((k) => norm(k).includes(norm(v)) || norm(v).includes(norm(k)))
        .slice(0, 8);
      throw new FilterError(
        `Unknown ${facet} "${v}".` +
          (close.length
            ? ` Did you mean: ${close.join(", ")}?`
            : ` Examples: ${known.slice(0, 12).join(", ")}.`),
      );
    });
  }
  return out;
}

export function buildSearch(f: CompanyFilters): SearchParams {
  const facetFilters: string[][] = [];
  const any = (facet: string, values: string[]) => {
    if (values.length) facetFilters.push(values.map((v) => `${facet}:${v}`));
  };
  any("batch", f.batches);
  any("industries", f.industries);
  any("regions", f.regions);
  any("status", f.statuses);
  any("tags", f.tags);
  if (f.hiringOnly) facetFilters.push(["isHiring:true"]);
  if (f.topCompaniesOnly) facetFilters.push(["top_company:true"]);
  const numericFilters: string[] = [];
  if (f.minTeamSize !== null)
    numericFilters.push(`team_size>=${f.minTeamSize}`);
  if (f.maxTeamSize !== null)
    numericFilters.push(`team_size<=${f.maxTeamSize}`);
  return { query: f.query, facetFilters, numericFilters };
}

const needsFacetLookup = (f: CompanyFilters) =>
  f.batches.length + f.industries.length + f.regions.length + f.tags.length > 0;

/**
 * All companies matching the filters, in index order. Algolia stops at 1,000
 * hits per query, so beyond that the search continues batch by batch
 * (newest first), skipping companies already returned.
 */
async function* companies(
  algolia: AlgoliaSearch,
  filters: CompanyFilters,
  index: string,
  hitsPerPage: number,
  onTotal: (n: number) => void,
  log: (m: string) => void,
): AsyncGenerator<RawCompany> {
  let resolved = filters;
  if (needsFacetLookup(filters)) {
    const all = await algolia.search({
      hitsPerPage: 0,
      facets: Object.values(FACETS),
      attributesToRetrieve: [],
    });
    resolved = resolveFacetValues(filters, all.facets ?? {});
  }
  const base = buildSearch(resolved);
  const returned = new Set<string>();

  async function* pages(extra?: string) {
    const facetFilters = extra
      ? [...(base.facetFilters ?? []), [extra]]
      : base.facetFilters;
    for (let page = 0; ; page++) {
      const res = await algolia.search(
        { ...base, facetFilters, hitsPerPage, page },
        index,
      );
      if (!extra && page === 0) onTotal(res.nbHits);
      for (const h of res.hits) {
        const id = String(h.objectID ?? h.id);
        if (returned.has(id)) continue;
        returned.add(id);
        yield h;
      }
      // nbPages is capped at the pagination limit, so compare with nbHits.
      const reached = (page + 1) * hitsPerPage;
      if (!res.hits.length || reached >= res.nbHits) return false;
      if (reached >= PAGINATION_LIMIT) return true;
    }
  }

  const truncated = yield* pages();
  if (!truncated) return;
  const counts = await algolia.search(
    { ...base, hitsPerPage: 0, facets: ["batch"], attributesToRetrieve: [] },
    index,
  );
  const batches = Object.entries(counts.facets?.batch ?? {}).sort(
    ([a], [b]) => batchRank(a) - batchRank(b) || a.localeCompare(b),
  );
  log(
    `More than ${PAGINATION_LIMIT} matches: continuing batch by batch (${batches.length} batches).`,
  );
  for (const [batch, n] of batches) {
    if (n > PAGINATION_LIMIT)
      log(
        `Batch ${batch} has ${n} matches; only ${PAGINATION_LIMIT} reachable.`,
      );
    yield* pages(`batch:${batch}`);
  }
}

// ---------------------------------------------------------------- Run

export async function run(
  input: NormalizedInput,
  deps: RunDeps,
): Promise<RunStats> {
  const log = deps.log ?? (() => {});
  const now = deps.now ?? (() => new Date());
  const stats: RunStats = {
    totalMatches: null,
    emitted: 0,
    duplicates: 0,
    skippedSeen: 0,
    sources: [],
    stopReason: "done",
  };

  /** Emit unless seen before; returns false to stop. */
  const offer = async (id: string, item: () => Item): Promise<boolean> => {
    if (deps.seen?.has(id)) {
      deps.seen.add(id);
      stats.skippedSeen += 1;
      return true;
    }
    const more = await deps.emit(item());
    deps.seen?.add(id);
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

  const index =
    input.sortBy === "launchDate" && !input.filters.query
      ? INDEX_BY_LAUNCH
      : INDEX;

  if (input.mode === "companies") {
    const algolia = await deps.algolia();
    const hitsPerPage = Math.min(
      MAX_HITS_PER_PAGE,
      Math.max(input.maxItems, 20),
    );
    for await (const c of companies(
      algolia,
      input.filters,
      index,
      hitsPerPage,
      (n) => (stats.totalMatches = n),
      log,
    )) {
      const scrapedAt = now().toISOString();
      const id = String(c.objectID ?? c.id);
      if (!(await offer(id, () => toCompany(c, scrapedAt)))) break;
    }
    return stats;
  }

  // Jobs mode.
  const jobIds = new Set<string>();
  const readJobsPage = async (
    url: string,
    check?: (p: NonNullable<ReturnType<typeof parseJobsPage>>) => void,
  ) => {
    const st: SourceStats = { source: url, items: 0, status: "done" };
    stats.sources.push(st);
    const skippedBefore = stats.skippedSeen;
    try {
      const res = await deps.get(url);
      const page = parseJobsPage(res.html);
      if (!page) {
        if (isBlockPage(res.html))
          throw new Error("Blocked by ycombinator.com.");
        throw new Error(`Unexpected page (no job data) at ${res.url}`);
      }
      check?.(page);
      const scrapedAt = now().toISOString();
      for (const j of page.jobs) {
        const id = String(j.id);
        if (jobIds.has(id)) {
          stats.duplicates += 1;
          continue;
        }
        jobIds.add(id);
        const before = stats.emitted;
        const more = await offer(id, () => toJob(j, url, scrapedAt));
        st.items += stats.emitted - before;
        if (!more) return false;
      }
    } catch (e) {
      st.status = st.items ? "stopped" : "failed";
      st.error = errMsg(e);
      log(`${url}: ${st.error}`);
      return true;
    }
    if (!st.items && stats.skippedSeen === skippedBefore) st.status = "empty";
    return true;
  };

  const loc = input.jobLocation;
  const listings = input.jobRoles.length
    ? input.jobRoles.map((role) => ({ role, location: loc }))
    : loc
      ? [{ role: null, location: loc }]
      : [];
  let more = true;
  for (const s of listings) {
    more = await readJobsPage(jobsListingUrl(s), (p) => {
      if (p.kind !== "listing") throw new Error("Not a jobs listing page.");
      const want = s.role ? JOB_ROLES[s.role]?.category : null;
      if (want && p.category !== want)
        throw new Error(`YC has no jobs page for role "${s.role}".`);
      if (s.location && p.location !== s.location)
        throw new Error(
          `YC has no jobs page for location "${s.location}" (it showed all locations). Try e.g. remote, san-francisco, new-york, london, india.`,
        );
    });
    if (!more) break;
  }
  for (const slug of more ? input.companySlugs : []) {
    more = await readJobsPage(companyJobsUrl(slug));
    if (!more) break;
  }
  if (more && input.jobsFromFilteredCompanies) {
    const algolia = await deps.algolia();
    const filters = { ...input.filters, hiringOnly: true };
    let n = 0;
    for await (const c of companies(
      algolia,
      filters,
      index,
      100,
      (t) => (stats.totalMatches = t),
      log,
    )) {
      const slug = str(c.slug);
      if (!slug || input.companySlugs.includes(slug)) continue;
      n += 1;
      if (!(await readJobsPage(companyJobsUrl(slug)))) break;
    }
    if (!n) log("No hiring companies match the company filters.");
  }

  const failed = stats.sources.filter((s) => s.status === "failed");
  if (failed.length > 0 && stats.emitted === 0 && stats.skippedSeen === 0)
    throw new Error(
      `All job pages failed: ${[...new Set(failed.map((f) => f.error))].join("; ")}`,
    );
  return stats;
}
