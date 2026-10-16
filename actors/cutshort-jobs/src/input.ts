import {
  citySlug,
  explicitListingSlug,
  listingSlug,
  skillSlugs,
} from "./cutshort.js";

/** Raw actor input, as defined in .actor/input_schema.json. */
export interface RawInput {
  skills?: (string | null)[] | string;
  cities?: (string | null)[] | string;
  startPage?: number | string;
  maxPages?: number | string;
  maxItems?: number | string;
  includeDetails?: boolean;
  monitorMode?: boolean;
  proxyConfiguration?: Record<string, unknown>;
}

/** One listing to page through. */
export interface Search {
  /** Human-readable, e.g. "python in bangalore". */
  label: string;
  /** Listing slugs to try in order; the first that exists is used. */
  candidates: string[];
}

export interface NormalizedInput {
  /** "listing": skill/city pages. "sitemap": every job (no skills given). */
  mode: "listing" | "sitemap";
  searches: Search[];
  /** First listing page to read (1-based). */
  startPage: number;
  /** Listing pages per search; 0 = all. */
  maxPages: number;
  /** New/updated jobs to output in total. */
  maxItems: number;
  includeDetails: boolean;
  monitorMode: boolean;
}

export const MAX_ITEMS = 10_000;
export const MAX_SEARCHES = 200;
export const MAX_PAGE = 200;
const MAX_LENGTH = 200;

export const DEFAULT_INPUT = {
  skills: ["python"],
  cities: ["bangalore"],
  maxItems: 20,
} satisfies RawInput;

export class InputError extends Error {}

const toInt = (v: unknown, name: string, def: number): number => {
  if (v === undefined || v === null || v === "") return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new InputError(`${name} must be a number.`);
  return Math.floor(n);
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

const dedupe = (xs: string[]) => [...new Set(xs)];

export function normalizeInput(
  raw: RawInput | null | undefined,
): NormalizedInput {
  const given = raw ?? {};
  const ownSearch = given.skills !== undefined || given.cities !== undefined;
  // Default skill/city only when neither is given (e.g. Apify's daily test);
  // an explicitly empty skills list means "all jobs" (sitemap).
  const r: RawInput = ownSearch ? given : { ...DEFAULT_INPUT, ...given };

  const skills = list(r.skills, "skills");
  const cities = dedupe(list(r.cities, "cities").map(citySlug));
  if (!skills.length && cities.length)
    throw new InputError(
      "cities need at least one skill or role (Cutshort lists jobs by skill, e.g. python, reactjs, product-manager).",
    );

  const searches: Search[] = [];
  const seen = new Set<string>();
  for (const skill of skills) {
    const explicit = explicitListingSlug(skill);
    const bases = skillSlugs(skill);
    if (!bases.length && !explicit)
      throw new InputError(`skills: "${skill}" is not a valid skill.`);
    // A full listing slug/URL with a city in it ignores `cities`.
    const forCities =
      explicit && /-in-|^remote-/.test(explicit) ? [null] : cities;
    for (const city of forCities.length ? forCities : [null]) {
      const candidates = dedupe([
        ...(explicit && city === null ? [explicit] : []),
        ...bases.map((b) => listingSlug(b, city)),
      ]);
      const key = candidates[0]!;
      if (seen.has(key)) continue;
      seen.add(key);
      const label =
        explicit && city === null
          ? explicit
          : `${bases[0]}${city === "remote" ? " (remote)" : city ? ` in ${city}` : ""}`;
      searches.push({ label, candidates });
    }
  }
  if (searches.length > MAX_SEARCHES)
    throw new InputError(
      `At most ${MAX_SEARCHES} searches (skills x cities) per run; got ${searches.length}.`,
    );

  const maxItems = toInt(r.maxItems, "maxItems", DEFAULT_INPUT.maxItems);
  if (maxItems < 1 || maxItems > MAX_ITEMS)
    throw new InputError(`maxItems must be between 1 and ${MAX_ITEMS}.`);
  const startPage = toInt(r.startPage, "startPage", 1);
  if (startPage < 1 || startPage > MAX_PAGE)
    throw new InputError(`startPage must be between 1 and ${MAX_PAGE}.`);
  const maxPages = toInt(r.maxPages, "maxPages", 0);
  if (maxPages < 0 || maxPages > MAX_PAGE)
    throw new InputError(`maxPages must be between 0 (all) and ${MAX_PAGE}.`);

  return {
    mode: searches.length ? "listing" : "sitemap",
    searches,
    startPage,
    maxPages,
    maxItems,
    includeDetails: r.includeDetails === true,
    monitorMode: r.monitorMode === true,
  };
}
