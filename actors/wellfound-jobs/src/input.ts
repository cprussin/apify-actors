import { parseListingUrl, REMOTE, slugify, type Search } from "./wellfound.js";

/** Raw actor input, as defined in .actor/input_schema.json. */
export interface RawInput {
  roles?: (string | null)[] | string;
  locations?: (string | null)[] | string;
  startUrls?: (string | { url?: string } | null)[];
  maxJobs?: number | string;
  maxPages?: number | string;
  includeDescription?: boolean;
  onlyNew?: boolean;
  proxyConfiguration?: Record<string, unknown>;
}

export interface SearchPlan extends Search {
  /** First page to fetch (from a start URL's `?page=`). */
  startPage: number;
}

export interface NormalizedInput {
  searches: SearchPlan[];
  /** Total jobs to output across all searches. */
  maxJobs: number;
  /** Max pages per search. */
  maxPages: number;
  includeDescription: boolean;
  /** Skip jobs returned by earlier runs with the same searches (monitoring). */
  onlyNew: boolean;
}

export const MAX_JOBS = 10_000;
export const MAX_PAGES = 100;
export const MAX_SEARCHES = 200;

export const DEFAULT_INPUT = {
  roles: ["software-engineer"],
  locations: ["san-francisco"],
  maxJobs: 20,
  maxPages: 5,
  includeDescription: true,
} satisfies RawInput;

export class InputError extends Error {}

const toInt = (v: unknown, name: string, def: number): number => {
  if (v === undefined || v === null || v === "") return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new InputError(`${name} must be a number.`);
  return Math.floor(n);
};

const list = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\n,]/) : [])
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean);

const REMOTE_ALIASES = new Set(["remote", "anywhere", "worldwide", "r"]);

/** "Software Engineer", "software-engineer" or a /role/... URL -> slug. */
export function normalizeRole(v: string): string {
  const fromUrl = parseListingUrl(v);
  if (fromUrl?.search.role) return fromUrl.search.role;
  const slug = slugify(v);
  if (!slug) throw new InputError(`Role "${v}" is not a valid role.`);
  return slug;
}

/** "San Francisco", "new-york", "Remote" -> slug ("remote" for remote). */
export function normalizeLocation(v: string): string {
  const slug = slugify(v);
  if (!slug) throw new InputError(`Location "${v}" is not a valid location.`);
  return REMOTE_ALIASES.has(slug) ? REMOTE : slug;
}

const key = (s: Search) => `${s.role ?? ""}|${s.location ?? ""}`;

export function normalizeInput(
  raw: RawInput | null | undefined,
): NormalizedInput {
  const given = raw ?? {};
  const startUrls = list(
    (Array.isArray(given.startUrls) ? given.startUrls : []).map((u) =>
      typeof u === "string" ? u : (u?.url ?? ""),
    ),
  );
  const hasOwnSearch =
    list(given.roles).length > 0 ||
    list(given.locations).length > 0 ||
    startUrls.length > 0;
  // Fall back to the default role/location only when nothing was given.
  const r: RawInput = hasOwnSearch
    ? { ...DEFAULT_INPUT, roles: [], locations: [], ...given }
    : { ...DEFAULT_INPUT, ...given };

  const roles = [...new Set(list(r.roles).map(normalizeRole))];
  const locations = [...new Set(list(r.locations).map(normalizeLocation))];

  const searches: SearchPlan[] = [];
  const seen = new Set<string>();
  const add = (s: SearchPlan) => {
    if (seen.has(key(s))) return;
    seen.add(key(s));
    searches.push(s);
  };

  for (const u of startUrls) {
    const parsed = parseListingUrl(u);
    if (!parsed)
      throw new InputError(
        `Start URL "${u}" is not a Wellfound job listing page. Use URLs like https://wellfound.com/role/l/software-engineer/san-francisco, /role/r/data-analyst (remote), /role/product-manager or /location/new-york.`,
      );
    add({ ...parsed.search, startPage: parsed.page });
  }

  if (roles.length) {
    for (const role of roles) {
      if (!locations.length) add({ role, location: null, startPage: 1 });
      for (const location of locations) add({ role, location, startPage: 1 });
    }
  } else {
    for (const location of locations) {
      if (location === REMOTE)
        throw new InputError(
          'Remote search needs a role, e.g. roles: ["software-engineer"], locations: ["remote"].',
        );
      add({ role: null, location, startPage: 1 });
    }
  }

  if (!searches.length)
    throw new InputError(
      'Add at least one role, location or start URL, e.g. roles: ["software-engineer"], locations: ["san-francisco"].',
    );
  if (searches.length > MAX_SEARCHES)
    throw new InputError(
      `At most ${MAX_SEARCHES} searches (role x location + start URLs) per run; got ${searches.length}.`,
    );

  const maxJobs = toInt(r.maxJobs, "maxJobs", DEFAULT_INPUT.maxJobs);
  if (maxJobs < 1 || maxJobs > MAX_JOBS)
    throw new InputError(`maxJobs must be between 1 and ${MAX_JOBS}.`);
  const maxPages = toInt(r.maxPages, "maxPages", DEFAULT_INPUT.maxPages);
  if (maxPages < 1 || maxPages > MAX_PAGES)
    throw new InputError(`maxPages must be between 1 and ${MAX_PAGES}.`);

  return {
    searches,
    maxJobs,
    maxPages,
    includeDescription: r.includeDescription !== false,
    onlyNew: r.onlyNew === true,
  };
}
