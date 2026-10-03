import { JOB_ROLES, normalizeBatch, REMOTE, slugify, YC } from "./yc.js";

export type Mode = "companies" | "jobs";
export type SortBy = "relevance" | "launchDate";

/** Raw actor input, as defined in .actor/input_schema.json. */
export interface RawInput {
  mode?: Mode | string;
  query?: string;
  batches?: (string | null)[] | string;
  industries?: (string | null)[] | string;
  regions?: (string | null)[] | string;
  statuses?: (string | null)[] | string;
  tags?: (string | null)[] | string;
  hiringOnly?: boolean;
  topCompaniesOnly?: boolean;
  minTeamSize?: number | string | null;
  maxTeamSize?: number | string | null;
  sortBy?: SortBy | string;
  jobRoles?: (string | null)[] | string;
  jobLocation?: string | null;
  companySlugs?: (string | null)[] | string;
  jobsFromFilteredCompanies?: boolean;
  maxItems?: number | string;
  onlyNew?: boolean;
  proxyConfiguration?: Record<string, unknown>;
}

/** Company directory filters (Algolia facets). */
export interface CompanyFilters {
  query: string;
  batches: string[];
  industries: string[];
  regions: string[];
  statuses: string[];
  tags: string[];
  hiringOnly: boolean;
  topCompaniesOnly: boolean;
  minTeamSize: number | null;
  maxTeamSize: number | null;
}

export interface NormalizedInput {
  mode: Mode;
  filters: CompanyFilters;
  sortBy: SortBy;
  /** Jobs mode: role slugs (/jobs/role/<slug>). */
  jobRoles: string[];
  /** Jobs mode: location slug for the role pages, or null for all. */
  jobLocation: string | null;
  /** Jobs mode: companies whose /companies/<slug>/jobs page to read. */
  companySlugs: string[];
  /** Jobs mode: also read jobs of hiring companies matching `filters`. */
  jobsFromFilteredCompanies: boolean;
  maxItems: number;
  onlyNew: boolean;
}

export const MAX_ITEMS = 10_000;
export const MAX_COMPANY_SLUGS = 500;
export const STATUSES = ["Active", "Acquired", "Inactive", "Public"];

export const DEFAULT_INPUT = {
  mode: "companies",
  maxItems: 20,
} satisfies RawInput;

export class InputError extends Error {}

const toInt = (v: unknown, name: string, def: number): number => {
  if (v === undefined || v === null || v === "") return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new InputError(`${name} must be a number.`);
  return Math.floor(n);
};

const optInt = (v: unknown, name: string): number | null =>
  v === undefined || v === null || v === "" ? null : toInt(v, name, 0);

const list = (v: unknown): string[] => [
  ...new Set(
    (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\n,]/) : [])
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter(Boolean),
  ),
];

/** "Software Engineer", "software-engineer" or a /jobs/role/... URL -> slug. */
export function normalizeRole(v: string): string {
  const fromUrl = /\/jobs\/role\/([^/?#]+)/.exec(v)?.[1];
  const slug = slugify(fromUrl ?? v);
  if (JOB_ROLES[slug]) return slug;
  const byName = Object.entries(JOB_ROLES).find(
    ([, r]) => slugify(r.name) === slug || r.category === slug,
  );
  if (byName) return byName[0];
  throw new InputError(
    `Unknown job role "${v}". Use one of: ${Object.keys(JOB_ROLES).join(", ")}.`,
  );
}

/** "Acme", "acme" or https://www.ycombinator.com/companies/acme(/jobs) -> slug. */
export function normalizeCompanySlug(v: string): string {
  const fromUrl = /ycombinator\.com\/companies\/([^/?#]+)/.exec(v)?.[1];
  const slug = (fromUrl ?? v).trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(slug))
    throw new InputError(
      `"${v}" is not a YC company slug or URL (e.g. "stripe" or ${YC}/companies/stripe).`,
    );
  return slug;
}

export function normalizeInput(
  raw: RawInput | null | undefined,
): NormalizedInput {
  const r: RawInput = { ...DEFAULT_INPUT, ...(raw ?? {}) };

  const mode = (r.mode || "companies") as Mode;
  if (mode !== "companies" && mode !== "jobs")
    throw new InputError(`mode must be "companies" or "jobs".`);
  const sortBy = (r.sortBy || "relevance") as SortBy;
  if (sortBy !== "relevance" && sortBy !== "launchDate")
    throw new InputError(`sortBy must be "relevance" or "launchDate".`);

  const statuses = list(r.statuses).map((s) => {
    const m = STATUSES.find((x) => x.toLowerCase() === s.toLowerCase());
    if (!m)
      throw new InputError(
        `Unknown status "${s}". Use ${STATUSES.join(", ")}.`,
      );
    return m;
  });
  const filters: CompanyFilters = {
    query: typeof r.query === "string" ? r.query.trim() : "",
    batches: [...new Set(list(r.batches).map(normalizeBatch))],
    industries: list(r.industries),
    regions: list(r.regions),
    statuses: [...new Set(statuses)],
    tags: list(r.tags),
    hiringOnly: r.hiringOnly === true,
    topCompaniesOnly: r.topCompaniesOnly === true,
    minTeamSize: optInt(r.minTeamSize, "minTeamSize"),
    maxTeamSize: optInt(r.maxTeamSize, "maxTeamSize"),
  };
  if (
    filters.minTeamSize !== null &&
    filters.maxTeamSize !== null &&
    filters.minTeamSize > filters.maxTeamSize
  )
    throw new InputError("minTeamSize must not be greater than maxTeamSize.");

  const jobLocationRaw =
    typeof r.jobLocation === "string" ? r.jobLocation.trim() : "";
  let jobLocation: string | null = null;
  if (jobLocationRaw) {
    const fromUrl = /\/jobs\/(?:role\/[^/]+|location)\/([^/?#]+)/.exec(
      jobLocationRaw,
    )?.[1];
    jobLocation = slugify(fromUrl ?? jobLocationRaw) || null;
    if (jobLocation && ["anywhere", "worldwide"].includes(jobLocation))
      jobLocation = REMOTE;
  }

  let jobRoles: string[] = [];
  let companySlugs: string[] = [];
  const jobsFromFilteredCompanies = r.jobsFromFilteredCompanies === true;
  if (mode === "jobs") {
    jobRoles = [...new Set(list(r.jobRoles).map(normalizeRole))];
    companySlugs = [...new Set(list(r.companySlugs).map(normalizeCompanySlug))];
    if (companySlugs.length > MAX_COMPANY_SLUGS)
      throw new InputError(
        `At most ${MAX_COMPANY_SLUGS} company slugs per run; got ${companySlugs.length}.`,
      );
    // Nothing chosen: all jobs in the location, or software engineer jobs.
    if (
      !jobRoles.length &&
      !companySlugs.length &&
      !jobsFromFilteredCompanies &&
      !jobLocation
    )
      jobRoles = ["software-engineer"];
  }

  const maxItems = toInt(r.maxItems, "maxItems", DEFAULT_INPUT.maxItems);
  if (maxItems < 1 || maxItems > MAX_ITEMS)
    throw new InputError(`maxItems must be between 1 and ${MAX_ITEMS}.`);

  return {
    mode,
    filters,
    sortBy,
    jobRoles,
    jobLocation,
    companySlugs,
    jobsFromFilteredCompanies,
    maxItems,
    onlyNew: r.onlyNew === true,
  };
}

/** onlyNew state key parameters: everything that defines the result set. */
export function stateParams(input: NormalizedInput): unknown {
  const f = input.filters;
  const filters = {
    query: f.query.toLowerCase(),
    batches: [...f.batches].sort(),
    industries: f.industries.map((s) => s.toLowerCase()).sort(),
    regions: f.regions.map((s) => s.toLowerCase()).sort(),
    statuses: [...f.statuses].sort(),
    tags: f.tags.map((s) => s.toLowerCase()).sort(),
    hiringOnly: f.hiringOnly,
    topCompaniesOnly: f.topCompaniesOnly,
    minTeamSize: f.minTeamSize ?? undefined,
    maxTeamSize: f.maxTeamSize ?? undefined,
  };
  if (input.mode === "companies") return { mode: input.mode, filters };
  return {
    mode: input.mode,
    jobRoles: [...input.jobRoles].sort(),
    jobLocation: input.jobLocation ?? undefined,
    companySlugs: [...input.companySlugs].sort(),
    filters: input.jobsFromFilteredCompanies ? filters : undefined,
  };
}
