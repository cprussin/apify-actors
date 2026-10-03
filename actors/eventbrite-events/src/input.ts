import {
  BASE_URL,
  CATEGORIES,
  DATE_FILTERS,
  locationSlug,
  parseStartUrl,
  searchPath,
} from "./eventbrite.js";

/** Raw actor input, as defined in .actor/input_schema.json. */
export interface RawInput {
  locations?: (string | null)[] | string;
  startUrls?: (string | { url?: string } | null)[];
  category?: string | null;
  dateFilter?: string | null;
  keyword?: string | null;
  maxEvents?: number | string;
  includeDetails?: boolean;
  onlyNew?: boolean;
  proxyConfiguration?: Record<string, unknown>;
}

export interface SearchPlan {
  /** Search page URL (page 1). */
  url: string;
  /** First page to fetch (from a start URL's `?page=`). */
  startPage: number;
  /** Location slug, when built from `locations`. */
  location: string | null;
}

export interface NormalizedInput {
  searches: SearchPlan[];
  /** Event pages given directly as start URLs. */
  eventUrls: string[];
  /** Total events to output across all searches. */
  maxEvents: number;
  includeDetails: boolean;
  /** Skip events returned by earlier runs with the same input (monitoring). */
  onlyNew: boolean;
}

export const MAX_EVENTS = 10_000;
export const MAX_SEARCHES = 200;
export const MAX_EVENT_URLS = 10_000;

export const DEFAULT_INPUT = {
  locations: ["ny--new-york"],
  maxEvents: 20,
  includeDetails: true,
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

function pick<T extends string>(
  v: unknown,
  allowed: readonly T[],
  name: string,
): T | null {
  if (v === undefined || v === null || v === "" || v === "any") return null;
  const s = String(v).trim().toLowerCase().replace(/\s+/g, "-");
  if (!(allowed as readonly string[]).includes(s))
    throw new InputError(
      `${name} "${String(v)}" is not supported. Use one of: ${allowed.join(", ")}.`,
    );
  return s as T;
}

export function normalizeInput(
  raw: RawInput | null | undefined,
): NormalizedInput {
  const given = raw ?? {};
  const startUrls = list(
    (Array.isArray(given.startUrls) ? given.startUrls : []).map((u) =>
      typeof u === "string" ? u : (u?.url ?? ""),
    ),
  );
  const hasOwnSearch = list(given.locations).length > 0 || startUrls.length > 0;
  // Fall back to the default location only when nothing was given.
  const r: RawInput = hasOwnSearch
    ? { ...DEFAULT_INPUT, locations: [], ...given }
    : { ...DEFAULT_INPUT, ...given };

  const category = pick(r.category, CATEGORIES, "category");
  const date = pick(r.dateFilter, DATE_FILTERS, "dateFilter");
  const keyword = typeof r.keyword === "string" ? r.keyword.trim() : "";
  if (keyword && !/[a-z0-9]/i.test(keyword))
    throw new InputError(`keyword "${keyword}" has no letters or digits.`);

  const searches: SearchPlan[] = [];
  const eventUrls: string[] = [];
  const seen = new Set<string>();
  const add = (s: SearchPlan) => {
    if (seen.has(s.url)) return;
    seen.add(s.url);
    searches.push(s);
  };

  for (const u of startUrls) {
    const parsed = parseStartUrl(u);
    if (!parsed)
      throw new InputError(
        `Start URL "${u}" is not an Eventbrite search or event page. Use URLs like https://www.eventbrite.com/d/ny--new-york/music--events/ or https://www.eventbrite.com/e/some-event-tickets-123456789.`,
      );
    if (parsed.kind === "event") {
      if (!eventUrls.includes(parsed.url)) eventUrls.push(parsed.url);
    } else add({ url: parsed.url, startPage: parsed.page, location: null });
  }

  for (const l of list(r.locations)) {
    const fromUrl = /eventbrite\./i.test(l) ? parseStartUrl(l) : null;
    if (fromUrl)
      throw new InputError(
        `Location "${l}" is a URL. Put Eventbrite URLs in startUrls instead.`,
      );
    const location = locationSlug(l);
    if (!location)
      throw new InputError(`Location "${l}" is not a valid location slug.`);
    add({
      url: `${BASE_URL}${searchPath({ location, category, date, keyword: keyword || null })}`,
      startPage: 1,
      location,
    });
  }

  if (!searches.length && !eventUrls.length)
    throw new InputError(
      'Add at least one location or start URL, e.g. locations: ["ny--new-york"].',
    );
  if (searches.length > MAX_SEARCHES)
    throw new InputError(
      `At most ${MAX_SEARCHES} searches (locations + start URLs) per run; got ${searches.length}.`,
    );
  if (eventUrls.length > MAX_EVENT_URLS)
    throw new InputError(`At most ${MAX_EVENT_URLS} event URLs per run.`);

  const maxEvents = toInt(r.maxEvents, "maxEvents", DEFAULT_INPUT.maxEvents);
  if (maxEvents < 1 || maxEvents > MAX_EVENTS)
    throw new InputError(`maxEvents must be between 1 and ${MAX_EVENTS}.`);

  return {
    searches,
    eventUrls,
    maxEvents,
    includeDetails: r.includeDetails !== false,
    onlyNew: r.onlyNew === true,
  };
}
