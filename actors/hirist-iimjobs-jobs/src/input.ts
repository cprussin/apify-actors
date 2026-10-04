import { locationId, SITES, type Search, type Site } from "./gladiator.js";

/** Raw actor input, as defined in .actor/input_schema.json. */
export interface RawInput {
  site?: string;
  queries?: (string | null)[] | string;
  locations?: (string | null)[] | string;
  minExperience?: number | string | null;
  maxExperience?: number | string | null;
  maxItems?: number | string;
  includeDescription?: boolean;
  onlyNew?: boolean;
  proxyConfiguration?: Record<string, unknown>;
}

export interface NormalizedInput {
  sites: Site[];
  /** One search per site x query, in site order. */
  searches: Search[];
  /** Total jobs to output across all searches (split between sites). */
  maxItems: number;
  includeDescription: boolean;
  /** Skip jobs returned by earlier runs with the same searches (monitoring). */
  onlyNew: boolean;
}

export const MAX_ITEMS = 10_000;
export const MAX_QUERIES = 100;
const MAX_LENGTH = 200;
const MAX_YEARS = 50;

export const DEFAULT_INPUT = {
  site: "both",
  queries: ["product manager"],
  locations: ["Bangalore"],
  maxItems: 20,
  includeDescription: false,
} satisfies RawInput;

export class InputError extends Error {}

const toInt = (v: unknown, name: string, def: number): number => {
  if (v === undefined || v === null || v === "") return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new InputError(`${name} must be a number.`);
  return Math.floor(n);
};

const toYears = (v: unknown, name: string): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = toInt(v, name, 0);
  if (n < 0 || n > MAX_YEARS)
    throw new InputError(`${name} must be between 0 and ${MAX_YEARS}.`);
  return n;
};

const list = (v: unknown, name: string): string[] => {
  const out = (
    Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\n,]/) : []
  )
    .map((x) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim() : ""))
    .filter(Boolean);
  for (const x of out)
    if (x.length > MAX_LENGTH)
      throw new InputError(`${name}: "${x.slice(0, 40)}..." is too long.`);
  return out;
};

/** Case-insensitive dedupe, keeping the first spelling. */
const dedupe = (xs: string[]) => {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = x.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

export function normalizeInput(
  raw: RawInput | null | undefined,
): NormalizedInput {
  const given = raw ?? {};
  // Fall back to the default query/location only when no query was given.
  const r: RawInput =
    list(given.queries, "queries").length > 0
      ? { ...DEFAULT_INPUT, locations: [], ...given }
      : { ...DEFAULT_INPUT, ...given, queries: DEFAULT_INPUT.queries };

  const site = String(r.site ?? "both").toLowerCase();
  if (site !== "both" && !SITES.includes(site as Site))
    throw new InputError('site must be "hirist", "iimjobs" or "both".');
  const sites: Site[] = site === "both" ? SITES : [site as Site];

  const queries = dedupe(list(r.queries, "queries"));
  if (queries.length > MAX_QUERIES)
    throw new InputError(
      `At most ${MAX_QUERIES} queries per run; got ${queries.length}.`,
    );

  const locationIds: number[] = [];
  for (const name of list(r.locations, "locations")) {
    const id = locationId(name);
    if (id === null)
      throw new InputError(
        `Unknown location "${name}". Use a city or state as listed on hirist.tech / iimjobs.com, e.g. Bangalore, Mumbai, Delhi NCR, Gurgaon, Pune, Hyderabad, Chennai, Remote.`,
      );
    if (!locationIds.includes(id)) locationIds.push(id);
  }

  const minExperience = toYears(r.minExperience, "minExperience");
  const maxExperience = toYears(r.maxExperience, "maxExperience");
  if (
    minExperience !== null &&
    maxExperience !== null &&
    minExperience > maxExperience
  )
    throw new InputError("minExperience must not exceed maxExperience.");

  const searches: Search[] = [];
  for (const s of sites)
    for (const query of queries)
      searches.push({
        site: s,
        query,
        locationIds,
        minExperience,
        maxExperience,
      });

  const maxItems = toInt(r.maxItems, "maxItems", DEFAULT_INPUT.maxItems);
  if (maxItems < 1 || maxItems > MAX_ITEMS)
    throw new InputError(`maxItems must be between 1 and ${MAX_ITEMS}.`);

  return {
    sites,
    searches,
    maxItems,
    includeDescription: r.includeDescription === true,
    onlyNew: r.onlyNew === true,
  };
}
