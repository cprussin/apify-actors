import type { Search, SortBy } from "./foundit.js";

/** Raw actor input, as defined in .actor/input_schema.json. */
export interface RawInput {
  queries?: (string | null)[] | string;
  locations?: (string | null)[] | string;
  maxItems?: number | string;
  sortBy?: string;
  includeDescription?: boolean;
  onlyNew?: boolean;
  proxyConfiguration?: Record<string, unknown>;
}

export interface NormalizedInput {
  searches: Search[];
  /** Total jobs to output across all searches. */
  maxItems: number;
  sortBy: SortBy;
  includeDescription: boolean;
  /** Skip jobs returned by earlier runs with the same searches (monitoring). */
  onlyNew: boolean;
}

export const MAX_ITEMS = 10_000;
export const MAX_SEARCHES = 200;
const MAX_LENGTH = 200;

export const DEFAULT_INPUT = {
  queries: ["python developer"],
  locations: ["Bangalore"],
  maxItems: 20,
  sortBy: "date",
  includeDescription: false,
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
  const hasOwnSearch =
    list(given.queries, "queries").length > 0 ||
    list(given.locations, "locations").length > 0;
  // Fall back to the default query/location only when nothing was given.
  const r: RawInput = hasOwnSearch
    ? { ...DEFAULT_INPUT, queries: [], locations: [], ...given }
    : { ...DEFAULT_INPUT, ...given };

  const queries = dedupe(list(r.queries, "queries"));
  const locations = dedupe(list(r.locations, "locations"));

  const searches: Search[] = [];
  for (const query of queries.length ? queries : [""]) {
    if (!locations.length) searches.push({ query, location: null });
    for (const location of locations) searches.push({ query, location });
  }
  if (searches.length > MAX_SEARCHES)
    throw new InputError(
      `At most ${MAX_SEARCHES} searches (queries x locations) per run; got ${searches.length}.`,
    );

  const maxItems = toInt(r.maxItems, "maxItems", DEFAULT_INPUT.maxItems);
  if (maxItems < 1 || maxItems > MAX_ITEMS)
    throw new InputError(`maxItems must be between 1 and ${MAX_ITEMS}.`);

  const sort = String(r.sortBy ?? "date").toLowerCase();
  if (sort !== "date" && sort !== "relevance")
    throw new InputError('sortBy must be "date" or "relevance".');

  return {
    searches,
    maxItems,
    sortBy: sort,
    includeDescription: r.includeDescription === true,
    onlyNew: r.onlyNew === true,
  };
}
