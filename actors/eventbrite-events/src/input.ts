import {
  BASE_URL,
  CATEGORIES,
  DATE_FILTERS,
  locationSlug,
  parseStartUrl,
  searchPath,
  slugify,
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
  /** Input problems that were worked around (skipped entries, clamped limits). */
  warnings: string[];
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

/** Store titles (input schema enumTitles) and common names -> slugs. */
const ALIASES: Record<string, string> = {
  "business-and-professional": "business",
  "community-and-culture": "community",
  "performing-and-visual-arts": "arts",
  "film-media-and-entertainment": "film-and-media",
  "health-and-wellness": "health",
  "science-and-technology": "science-and-tech",
  technology: "science-and-tech",
  tech: "science-and-tech",
  "religion-and-spirituality": "spirituality",
  "government-and-politics": "government",
  "fashion-and-beauty": "fashion",
  "hobbies-and-special-interest": "hobbies",
  weekend: "this-weekend",
  "any-upcoming-date": "any",
  "any-category": "any",
};

function pick<T extends string>(
  v: unknown,
  allowed: readonly T[],
  name: string,
): T | null {
  if (v === undefined || v === null || v === "") return null;
  const slug = slugify(String(v));
  const s = ALIASES[slug] ?? slug;
  if (!s || s === "any") return null;
  if (!(allowed as readonly string[]).includes(s))
    throw new InputError(
      `${name} "${String(v)}" is not supported. Use one of: ${allowed.join(", ")}.`,
    );
  return s as T;
}

const EXAMPLE_URLS =
  "URLs like https://www.eventbrite.com/d/ny--new-york/music--events/ or https://www.eventbrite.com/e/some-event-tickets-123456789";

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
  const warnings: string[] = [];
  let keyword = typeof r.keyword === "string" ? r.keyword.trim() : "";
  if (keyword && !slugify(keyword)) {
    warnings.push(`Ignored keyword "${keyword}": no letters or digits.`);
    keyword = "";
  }

  const searches: SearchPlan[] = [];
  const eventUrls: string[] = [];
  const seen = new Set<string>();
  const add = (s: SearchPlan) => {
    if (seen.has(s.url)) return;
    seen.add(s.url);
    searches.push(s);
  };

  const addUrl = (parsed: NonNullable<ReturnType<typeof parseStartUrl>>) => {
    if (parsed.kind === "event") {
      if (!eventUrls.includes(parsed.url)) eventUrls.push(parsed.url);
    } else add({ url: parsed.url, startPage: parsed.page, location: null });
  };

  // Unusable entries are skipped with a warning so the rest still runs.
  for (const u of startUrls) {
    const parsed = parseStartUrl(u);
    if (parsed) addUrl(parsed);
    else
      warnings.push(
        /eventbrite\.[a-z.]+\/o\//i.test(u)
          ? `Skipped start URL "${u}": organizer pages aren't supported yet. Use ${EXAMPLE_URLS}.`
          : `Skipped start URL "${u}": not an Eventbrite search or event page. Use ${EXAMPLE_URLS}.`,
      );
  }

  for (const l of list(r.locations)) {
    const fromUrl = /eventbrite\./i.test(l) ? parseStartUrl(l) : null;
    if (fromUrl) {
      // A URL in locations: use it like a start URL (filters don't apply).
      warnings.push(
        `Location "${l}" is a URL; used it as a start URL (category, date and keyword filters don't apply to it).`,
      );
      addUrl(fromUrl);
      continue;
    }
    const location = locationSlug(l);
    if (!location) {
      warnings.push(`Skipped location "${l}": not a valid location slug.`);
      continue;
    }
    add({
      url: `${BASE_URL}${searchPath({ location, category, date, keyword: keyword || null })}`,
      startPage: 1,
      location,
    });
  }

  if (!searches.length && !eventUrls.length)
    throw new InputError(
      [
        ...warnings,
        'Add at least one location or start URL, e.g. locations: ["ny--new-york"].',
      ].join(" "),
    );
  if (searches.length > MAX_SEARCHES) {
    warnings.push(
      `At most ${MAX_SEARCHES} searches (locations + start URLs) per run; got ${searches.length}, using the first ${MAX_SEARCHES}.`,
    );
    searches.length = MAX_SEARCHES;
  }
  if (eventUrls.length > MAX_EVENT_URLS) {
    warnings.push(
      `At most ${MAX_EVENT_URLS} event URLs per run; got ${eventUrls.length}, using the first ${MAX_EVENT_URLS}.`,
    );
    eventUrls.length = MAX_EVENT_URLS;
  }

  let maxEvents = toInt(r.maxEvents, "maxEvents", DEFAULT_INPUT.maxEvents);
  if (maxEvents < 1 || maxEvents > MAX_EVENTS) {
    const clamped = Math.min(MAX_EVENTS, Math.max(1, maxEvents));
    warnings.push(
      `maxEvents ${maxEvents} is out of range (1-${MAX_EVENTS}); using ${clamped}.`,
    );
    maxEvents = clamped;
  }

  return {
    searches,
    eventUrls,
    maxEvents,
    includeDetails: r.includeDetails !== false,
    onlyNew: r.onlyNew === true,
    warnings,
  };
}
