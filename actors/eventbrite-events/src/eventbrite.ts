import * as cheerio from "cheerio";

export const BASE_URL = "https://www.eventbrite.com";

/** Category slugs Eventbrite uses in /d/ search URLs. */
export const CATEGORIES = [
  "music",
  "nightlife",
  "business",
  "food-and-drink",
  "community",
  "arts",
  "film-and-media",
  "sports-and-fitness",
  "health",
  "science-and-tech",
  "travel-and-outdoor",
  "charity-and-causes",
  "spirituality",
  "family-and-education",
  "holiday",
  "seasonal",
  "government",
  "fashion",
  "home-and-lifestyle",
  "auto-boat-and-air",
  "hobbies",
  "school-activities",
  "dating",
  "other",
] as const;

/** Date filter slugs Eventbrite uses in /d/ search URLs. */
export const DATE_FILTERS = [
  "today",
  "tomorrow",
  "this-weekend",
  "this-week",
  "next-week",
  "this-month",
  "next-month",
] as const;

/** Lowercase, dash-separated slug: "Wine Tasting" -> "wine-tasting". */
export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Location slug as in Eventbrite URLs: "ny--new-york", "united-kingdom--london",
 * "online". Keeps the "--" between region and city.
 */
export function locationSlug(s: string): string {
  return s.split(/--|\//).map(slugify).filter(Boolean).join("--");
}

export interface SearchFilters {
  /** Location slug, e.g. "ny--new-york" or "online". */
  location: string;
  category: string | null;
  date: string | null;
  keyword: string | null;
}

/**
 * Search page path, e.g. /d/ny--new-york/all-events/,
 * /d/ny--new-york/music--events--this-weekend/, /d/ca--san-francisco/jazz/ or
 * /d/ca--san-francisco/food-and-drink--events/wine/.
 */
export function searchPath(f: SearchFilters): string {
  const kw = f.keyword ? slugify(f.keyword) : "";
  let seg: string | null;
  if (f.category && f.date) seg = `${f.category}--events--${f.date}`;
  else if (f.category) seg = `${f.category}--events`;
  else if (f.date) seg = `events--${f.date}`;
  else seg = kw ? null : "all-events";
  return `/d/${f.location}/${[seg, kw].filter(Boolean).join("/")}/`;
}

/** Page N of a search (page 1 has no parameter). */
export function pageUrl(searchUrl: string, page: number): string {
  return page > 1 ? `${searchUrl}?page=${page}` : searchUrl;
}

export type StartUrl =
  | { kind: "search"; url: string; page: number }
  | { kind: "event"; url: string; id: string };

const EVENT_PATH = /^\/e\/(?:[^/]*-)?(\d{6,})\/?$/;

/** Event id from an /e/<slug>-tickets-<id> URL, or null. */
export function eventIdFromUrl(url: string): string | null {
  try {
    return EVENT_PATH.exec(new URL(url).pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Parse a start URL: an Eventbrite search page (/d/...) or an event page
 * (/e/...). Query parameters other than `page` are dropped.
 */
export function parseStartUrl(raw: string): StartUrl | null {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (!/(^|\.)eventbrite\.[a-z.]+$/i.test(u.hostname)) return null;
  const host = u.hostname.toLowerCase();
  const origin = `https://${host.startsWith("www.") ? host : `www.${host}`}`;
  const path = u.pathname.replace(/\/+$/, "");
  const ev = EVENT_PATH.exec(path);
  if (ev) return { kind: "event", url: `${origin}${path}`, id: ev[1]! };
  if (/^\/d\/[^/]+(\/[^/]+){1,2}$/i.test(path)) {
    const page = Number(u.searchParams.get("page") ?? 1);
    return {
      kind: "search",
      url: `${origin}${path.toLowerCase()}/`,
      page: Number.isInteger(page) && page >= 1 ? page : 1,
    };
  }
  return null;
}

type Entity = Record<string, unknown>;

/**
 * Extract the object literal assigned to `window.<name>` in an inline
 * script. The assignment is followed by more statements, so this scans for
 * the matching closing brace instead of parsing to the end of the script.
 */
export function extractWindowJson(html: string, name: string): Entity | null {
  const at = html.indexOf(`window.${name}`);
  if (at < 0) return null;
  const start = html.indexOf("{", at);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1)) as Entity;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export interface RawTag {
  prefix?: string | null;
  tag?: string | null;
  display_name?: string | null;
}

export interface RawVenue {
  name?: string | null;
  address?: {
    address_1?: string | null;
    city?: string | null;
    region?: string | null;
    postal_code?: string | null;
    country?: string | null;
    latitude?: string | null;
    longitude?: string | null;
    localized_address_display?: string | null;
  } | null;
}

/** One event in a search page's `search_data.events.results`. */
export interface RawEvent {
  id: string;
  eid?: string | null;
  name?: string | null;
  url?: string | null;
  summary?: string | null;
  start_date?: string | null;
  start_time?: string | null;
  end_date?: string | null;
  end_time?: string | null;
  timezone?: string | null;
  is_online_event?: boolean | null;
  is_cancelled?: boolean | null;
  primary_venue?: RawVenue | null;
  primary_organizer_id?: string | null;
  tags?: RawTag[] | null;
  image?: { url?: string | null; original?: { url?: string | null } } | null;
  series_id?: string | null;
  published?: string | null;
  tickets_by?: string | null;
  language?: string | null;
}

export interface SearchPage {
  page: number;
  pageCount: number | null;
  totalEvents: number | null;
  events: RawEvent[];
  /** The search Eventbrite ran (dates, places, tags, q). */
  query: Entity | null;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

/**
 * Parse a /d/ search page from the `window.__SERVER_DATA__` state the page
 * renders from. Returns null if the page has no search results data.
 */
export function parseSearchPage(html: string): SearchPage | null {
  const sd = extractWindowJson(html, "__SERVER_DATA__");
  const data = sd?.search_data as Entity | undefined;
  const events = data?.events as Entity | undefined;
  if (!events || !Array.isArray(events.results)) return null;
  const pag = (events.pagination ?? {}) as Entity;
  return {
    page: num(pag.page_number) ?? num(sd?.page_number) ?? 1,
    pageCount: num(pag.page_count) ?? num(sd?.page_count),
    totalEvents: num(pag.object_count),
    events: (events.results as RawEvent[]).filter((e) => e && e.id),
    query: (data?.event_search as Entity | undefined) ?? null,
  };
}

export interface EventDetails {
  id: string | null;
  name: string | null;
  url: string | null;
  summary: string | null;
  description: string | null;
  status: string | null;
  startLocal: string | null;
  endLocal: string | null;
  timezone: string | null;
  startUtc: string | null;
  endUtc: string | null;
  isOnline: boolean | null;
  venueName: string | null;
  venueAddress: string | null;
  venueCity: string | null;
  venueRegion: string | null;
  venueCountry: string | null;
  latitude: number | null;
  longitude: number | null;
  organizerId: string | null;
  organizerName: string | null;
  organizerUrl: string | null;
  isFree: boolean | null;
  priceMin: number | null;
  priceMax: number | null;
  currency: string | null;
  availability: string | null;
  salesStatus: string | null;
  category: string | null;
  subcategory: string | null;
  format: string | null;
  imageUrl: string | null;
  seriesId: string | null;
}

/** The JSON-LD object describing the event (SocialEvent, MusicEvent, ...). */
export function findJsonLdEvent(html: string): Entity | null {
  const $ = cheerio.load(html);
  let found: Entity | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (found) return;
    let j: unknown;
    try {
      j = JSON.parse($(el).text());
    } catch {
      return;
    }
    for (const o of Array.isArray(j) ? j : [j]) {
      const t = (o as Entity | null)?.["@type"];
      if (typeof t === "string" && /Event$/.test(t)) {
        found = o as Entity;
        return;
      }
    }
  });
  return found;
}

/** Event page context from `__NEXT_DATA__` (props.pageProps.context). */
export function extractEventContext(html: string): Entity | null {
  const $ = cheerio.load(html);
  const text = $("script#__NEXT_DATA__").first().text();
  if (!text) return null;
  try {
    const next = JSON.parse(text) as Entity;
    const props = (next.props as Entity | undefined)?.pageProps as
      Entity | undefined;
    const ctx = props?.context as Entity | undefined;
    return ctx?.basicInfo ? ctx : null;
  } catch {
    return null;
  }
}

/** Plain text from Eventbrite's description HTML, keeping paragraphs. */
export function htmlToText(html: string): string {
  const $ = cheerio.load(`<div id="x">${html}</div>`);
  const root = $("#x");
  root.find("br").replaceWith("\n");
  root.find("li").prepend("- ");
  root.find("p,div,li,h1,h2,h3,h4,h5,h6,tr,blockquote").append("\n");
  return root
    .text()
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const isoUtc = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

/**
 * Parse an event page (/e/...): the `__NEXT_DATA__` context, with JSON-LD
 * as a fallback for each field. Returns null if neither is present.
 */
export function parseEventPage(html: string): EventDetails | null {
  const ctx = extractEventContext(html);
  const ld = findJsonLdEvent(html);
  if (!ctx && !ld) return null;
  const info = (ctx?.basicInfo ?? {}) as Entity;
  const start = (info.startDate ?? {}) as Entity;
  const end = (info.endDate ?? {}) as Entity;
  const venue = (info.venue ?? null) as Entity | null;
  const vAddr = (venue?.address ?? {}) as Entity;
  const org = (info.organizer ?? null) as Entity | null;
  const tax = (ctx?.taxonomies ?? {}) as Entity;
  const seo = (ctx?.seo ?? {}) as Entity;
  const sales = (ctx?.salesStatus ?? {}) as Entity;

  const ldLoc = (ld?.location ?? {}) as Entity;
  const ldAddr = (ldLoc.address ?? {}) as Entity;
  const ldOrg = (ld?.organizer ?? {}) as Entity;
  const offers = [
    ...((seo.offersSchema as Entity[] | undefined) ?? []),
    ...(Array.isArray(ld?.offers) ? (ld.offers as Entity[]) : []),
  ];
  const offer = offers[0] ?? {};
  const lows = offers.map((o) => num(o.lowPrice ?? o.price));
  const highs = offers.map((o) => num(o.highPrice ?? o.price));
  const priceMin = lows.find((x) => x !== null) ?? null;
  const priceMax = highs.find((x) => x !== null) ?? null;

  const modules = ((ctx?.structuredContent as Entity | undefined)?.modules ??
    []) as Entity[];
  const description =
    modules
      .filter((m) => m.type === "text" && typeof m.text === "string")
      .map((m) => htmlToText(m.text as string))
      .filter(Boolean)
      .join("\n\n") || null;

  const lines = (vAddr.localizedMultiLineAddressDisplay as unknown[]) ?? [];
  const venueAddress =
    lines.map(str).filter(Boolean).join(", ") ||
    str(ldAddr.streetAddress) ||
    null;
  const isOnline =
    typeof info.isOnline === "boolean"
      ? info.isOnline
      : ld
        ? ldLoc["@type"] === "VirtualLocation" ||
          /OnlineEventAttendanceMode/.test(String(ld.eventAttendanceMode))
        : null;
  const images = ((ctx?.gallery as Entity | undefined)?.images ??
    []) as Entity[];
  const isFree =
    typeof info.isFree === "boolean"
      ? info.isFree
      : priceMax !== null
        ? priceMax === 0
        : null;

  return {
    id: str(info.id),
    name: str(info.name) ?? str(ld?.name),
    url: str(info.url) ?? str(ld?.url),
    summary: str(info.summary) ?? str(ld?.description),
    description,
    status: str(info.status),
    startLocal: str(start.local),
    endLocal: str(end.local),
    timezone: str(start.timezone),
    startUtc: isoUtc(start.utc) ?? isoUtc(ld?.startDate),
    endUtc: isoUtc(end.utc) ?? isoUtc(ld?.endDate),
    isOnline,
    venueName: str(venue?.name) ?? (isOnline ? null : str(ldLoc.name)),
    venueAddress: isOnline && !venue ? null : venueAddress,
    venueCity: str(vAddr.city) ?? str(ldAddr.addressLocality),
    venueRegion: str(vAddr.region) ?? str(ldAddr.addressRegion),
    venueCountry: str(vAddr.country) ?? str(ldAddr.addressCountry),
    latitude: num(vAddr.latitude),
    longitude: num(vAddr.longitude),
    organizerId: str(org?.id),
    organizerName: str(org?.name) ?? str(ldOrg.name),
    organizerUrl: str(org?.url) ?? str(ldOrg.url),
    isFree,
    priceMin,
    priceMax,
    currency:
      str(offer.priceCurrency) ??
      (priceMax !== null ? str(info.currency) : null),
    availability: str(offer.availability),
    salesStatus: str(sales.salesStatus),
    category: str(tax.category),
    subcategory: str(tax.subcategory),
    format: str(tax.format),
    imageUrl: str(images[0]?.url) ?? str(ld?.image),
    seriesId: str(info.seriesId),
  };
}

/** Offset of `timeZone` from UTC at `utcMs`, in ms. */
function tzOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - utcMs;
}

/** "2026-10-02T20:00:00" in "America/New_York" -> "2026-10-03T00:00:00.000Z". */
export function localToUtc(
  local: string | null,
  timeZone: string | null,
): string | null {
  if (!local || !timeZone || !/T\d\d:\d\d/.test(local)) return null;
  const guess = Date.parse(`${local}Z`);
  if (Number.isNaN(guess)) return null;
  try {
    const off = tzOffsetMs(guess, timeZone);
    let utc = guess - off;
    const off2 = tzOffsetMs(utc, timeZone);
    if (off2 !== off) utc = guess - off2;
    return new Date(utc).toISOString();
  } catch {
    return null; // unknown time zone
  }
}

/** "2026-10-02" + "20:00" -> "2026-10-02T20:00:00". */
export function localDateTime(
  date: string | null | undefined,
  time: string | null | undefined,
): string | null {
  if (!date) return null;
  if (!time) return date;
  return `${date}T${time.length === 5 ? `${time}:00` : time}`;
}

/** Display names of tags with a prefix, deduplicated, in order. */
export function tagNames(tags: RawTag[] | null | undefined, prefix: string) {
  const out: string[] = [];
  for (const t of tags ?? []) {
    const name = str(t.display_name);
    if (t.prefix === prefix && name && !out.includes(name)) out.push(name);
  }
  return out;
}

/** AWS WAF challenge / "Whoops" bot pages. */
export function isBlockPage(html: string): boolean {
  const head = html.slice(0, 20_000);
  return /<title>\s*(Human Verification|Whoops!|Just a moment|Access denied)|awsWafCookieDomainList|gokuProps|<!-- WAF -->/i.test(
    head,
  );
}
