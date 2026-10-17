/**
 * Luma (luma.com, formerly lu.ma) public JSON API: URL builders and parsers.
 * Endpoints are the ones luma.com's own pages call for logged-out visitors
 * (api.lu.ma robots.txt disallows only /insights/).
 */

export const API_BASE = "https://api.lu.ma";
export const SITE_BASE = "https://luma.com";
/** Luma's page size cap for discover and calendar listings. */
export const PAGE_SIZE = 50;

export const CATEGORIES = [
  "tech",
  "ai",
  "food",
  "arts",
  "climate",
  "fitness",
  "wellness",
  "crypto",
  "books",
  "games",
  "running",
  "family",
] as const;
export type Category = (typeof CATEGORIES)[number];

export type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json =>
  !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const bool = (v: unknown): boolean | null =>
  typeof v === "boolean" ? v : null;

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/** "40.71,-74.0" (or with a space) -> coordinates; null if not a pair. */
export function parseCoordinates(s: string): Coordinates | null {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(s);
  if (!m) return null;
  const latitude = Number(m[1]);
  const longitude = Number(m[2]);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

/**
 * Luma page slug from a slug or a luma.com / lu.ma URL:
 * "nyc", "https://lu.ma/nyc", "luma.com/genai-sf?k=c" -> "nyc", "genai-sf".
 * Returns null for anything else (other hosts, nested paths, bad chars).
 */
export function parseSlug(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  const isUrl = /^(https?:\/\/)?(www\.)?(lu\.ma|luma\.com)(\/|$)/i.test(s);
  if (isUrl) {
    s = s.replace(/^(https?:\/\/)?(www\.)?(lu\.ma|luma\.com)\/?/i, "");
    s = s.replace(/[?#].*$/, "").replace(/\/+$/, "");
    // luma.com/event/evt-xxx and luma.com/calendar/cal-xxx style links.
    const m = /^(?:event|calendar)\/((?:evt|cal)-[A-Za-z0-9]+)$/.exec(s);
    if (m) s = m[1]!;
  } else if (/[/:.]/.test(s)) return null;
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(s)) return null;
  return s;
}

export function resolveUrl(slug: string): string {
  return `${API_BASE}/url?url=${encodeURIComponent(slug)}`;
}

export function discoverUrl(opts: {
  coordinates: Coordinates;
  categoryId?: string | null;
  query?: string | null;
  cursor?: string | null;
}): string {
  const p = new URLSearchParams();
  p.set("latitude", String(opts.coordinates.latitude));
  p.set("longitude", String(opts.coordinates.longitude));
  if (opts.categoryId) p.set("discover_category_api_id", opts.categoryId);
  if (opts.query) p.set("query", opts.query);
  p.set("pagination_limit", String(PAGE_SIZE));
  if (opts.cursor) p.set("pagination_cursor", opts.cursor);
  return `${API_BASE}/discover/get-paginated-events?${p}`;
}

export function calendarItemsUrl(opts: {
  calendarId: string;
  period: "future" | "past";
  cursor?: string | null;
}): string {
  const p = new URLSearchParams();
  p.set("calendar_api_id", opts.calendarId);
  p.set("period", opts.period);
  p.set("pagination_limit", String(PAGE_SIZE));
  if (opts.cursor) p.set("pagination_cursor", opts.cursor);
  return `${API_BASE}/calendar/get-items?${p}`;
}

export function eventUrl(eventId: string): string {
  return `${API_BASE}/event/get?event_api_id=${encodeURIComponent(eventId)}`;
}

/** One listing entry: the event plus its calendar, hosts and ticket summary. */
export interface Entry {
  api_id?: string;
  event: Json;
  calendar?: Json;
  hosts?: Json[];
  guest_count?: number;
  ticket_info?: Json | null;
  waitlist_active?: boolean;
}

export interface EntriesPage {
  entries: Entry[];
  hasMore: boolean;
  nextCursor: string | null;
}

/** Discover / calendar listing page; null when the JSON isn't one. */
export function parseEntriesPage(body: string): EntriesPage | null {
  let d: unknown;
  try {
    d = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isObj(d) || !Array.isArray(d.entries)) return null;
  const entries = d.entries.filter(
    (e): e is Entry => isObj(e) && isObj(e.event) && !!str(e.event.api_id),
  );
  return {
    entries,
    hasMore: d.has_more === true,
    nextCursor: str(d.next_cursor),
  };
}

export type Resolved =
  | ({
      kind: "place";
      slug: string;
      name: string | null;
      timezone: string | null;
    } & Coordinates)
  | { kind: "category"; slug: string; id: string; name: string | null }
  | { kind: "calendar"; slug: string; id: string; name: string | null }
  | { kind: "event"; slug: string; detail: Json }
  | { kind: "other"; slug: string; type: string };

/** Body of `/url?url=<slug>`; null when it isn't a resolver response. */
export function parseResolved(slug: string, body: string): Resolved | null {
  let d: unknown;
  try {
    d = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isObj(d) || !isObj(d.data) || typeof d.kind !== "string") return null;
  const data = d.data;
  switch (d.kind) {
    case "discover-place": {
      const p = isObj(data.place) ? data.place : null;
      const c = p && isObj(p.coordinate) ? p.coordinate : null;
      const latitude = num(c?.latitude);
      const longitude = num(c?.longitude);
      if (latitude === null || longitude === null) return null;
      return {
        kind: "place",
        slug: str(p?.slug) ?? slug,
        name: str(p?.name),
        timezone: str(p?.timezone),
        latitude,
        longitude,
      };
    }
    case "category": {
      const c = isObj(data.category) ? data.category : null;
      const id = str(c?.api_id);
      if (!id) return null;
      return {
        kind: "category",
        slug: str(c?.slug) ?? slug,
        id,
        name: str(c?.name),
      };
    }
    case "calendar": {
      const c = isObj(data.calendar) ? data.calendar : null;
      const id = str(c?.api_id);
      if (!id) return null;
      return {
        kind: "calendar",
        slug: str(c?.slug) ?? slug,
        id,
        name: str(c?.name),
      };
    }
    case "event":
      if (!isObj(data.event) || !str(data.event.api_id)) return null;
      return { kind: "event", slug, detail: data };
    default:
      return { kind: "other", slug, type: d.kind };
  }
}

/** Event detail (`/event/get`); null when the JSON isn't one. */
export function parseEventDetail(body: string): Json | null {
  let d: unknown;
  try {
    d = JSON.parse(body);
  } catch {
    return null;
  }
  return isObj(d) && isObj(d.event) && str(d.event.api_id) ? d : null;
}

/** Plain text from Luma's ProseMirror `description_mirror` document. */
export function mirrorToText(doc: unknown): string | null {
  const blocks: string[] = [];
  const inline = (n: unknown): string => {
    if (!isObj(n)) return "";
    if (n.type === "text") return typeof n.text === "string" ? n.text : "";
    if (n.type === "hard_break") return "\n";
    return Array.isArray(n.content) ? n.content.map(inline).join("") : "";
  };
  const walk = (n: unknown, prefix = ""): void => {
    if (!isObj(n)) return;
    const kids = Array.isArray(n.content) ? n.content : [];
    switch (n.type) {
      case "doc":
      case "blockquote":
        kids.forEach((k) => walk(k, prefix));
        return;
      case "bullet_list":
      case "ordered_list":
        kids.forEach((k, i) =>
          walk(k, n.type === "ordered_list" ? `${i + 1}. ` : "- "),
        );
        return;
      case "list_item": {
        // First paragraph gets the bullet; nested blocks follow as-is.
        kids.forEach((k, i) => walk(k, i === 0 ? prefix : ""));
        return;
      }
      case "horizontal_rule":
        blocks.push("---");
        return;
      default: {
        const t = inline(n).trim();
        if (t) blocks.push(prefix + t);
      }
    }
  };
  walk(doc);
  const text = blocks.join("\n\n").trim();
  return text || null;
}

/** "2026-10-17T22:00:00.000Z" in "America/New_York" -> "2026-10-17T18:00:00". */
export function toLocal(iso: string | null, tz: string | null): string | null {
  if (!iso || !tz) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
        .formatToParts(d)
        .map((p) => [p.type, p.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  } catch {
    return null;
  }
}

const cents = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : n / 100;
};

export interface TicketType {
  name: string | null;
  price: number | null;
  currency: string | null;
  type: string | null;
}

export interface EventResult {
  eventId: string;
  name: string | null;
  url: string | null;
  startUtc: string | null;
  endUtc: string | null;
  timezone: string | null;
  startLocal: string | null;
  endLocal: string | null;
  locationType: string | null;
  isOnline: boolean | null;
  venueName: string | null;
  venueAddress: string | null;
  venueCity: string | null;
  venueRegion: string | null;
  venueCountry: string | null;
  venueCountryCode: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Exact address shown only to registered guests (city and approximate coordinates only). */
  addressHidden: boolean;
  isFree: boolean | null;
  priceMin: number | null;
  priceMax: number | null;
  currency: string | null;
  isSoldOut: boolean | null;
  spotsRemaining: number | null;
  requiresApproval: boolean | null;
  waitlistActive: boolean | null;
  guestCount: number | null;
  hostNames: string[];
  calendarId: string | null;
  calendarName: string | null;
  calendarUrl: string | null;
  imageUrl: string | null;
  recurrenceId: string | null;
  categories?: string[];
  ticketTypes?: TicketType[];
  description?: string | null;
  source: string | null;
  scrapedAt: string;
}

/** Merge a listing entry and/or an event detail into one dataset item. */
export function toResult(
  entry: Entry | null,
  detail: Json | null,
  opts: { source: string | null; scrapedAt: string; includeDetails: boolean },
): EventResult {
  const ev = (entry?.event ?? detail?.event ?? {}) as Json;
  const pick = <T>(k: string, f: (v: unknown) => T | null): T | null =>
    f((entry as Json | null)?.[k]) ?? f(detail?.[k]);
  const geo = isObj(ev.geo_address_info) ? ev.geo_address_info : null;
  const coord = isObj(ev.coordinate) ? ev.coordinate : null;
  const hidden =
    ev.geo_address_visibility === "guests-only" || geo?.mode === "obfuscated";
  const locationType = str(ev.location_type);
  const ticket = (
    isObj(entry?.ticket_info)
      ? entry.ticket_info
      : isObj(detail?.ticket_info)
        ? detail.ticket_info
        : null
  ) as Json | null;
  const price = isObj(ticket?.price) ? ticket.price : null;
  const maxPrice = isObj(ticket?.max_price) ? ticket.max_price : null;
  const isFree = bool(ticket?.is_free);
  const cal = (
    isObj(entry?.calendar)
      ? entry.calendar
      : isObj(detail?.calendar)
        ? detail.calendar
        : null
  ) as Json | null;
  const hosts = (
    Array.isArray(entry?.hosts)
      ? entry.hosts
      : Array.isArray(detail?.hosts)
        ? detail.hosts
        : []
  ) as unknown[];
  const tz = str(ev.timezone);
  const start = str(ev.start_at);
  const end = str(ev.end_at);
  const slug = str(ev.url);
  const calSlug = str(cal?.slug);
  const calId = str(cal?.api_id);
  const priceMin = price
    ? (cents(price.min_cents) ?? cents(price.cents))
    : isFree
      ? 0
      : null;
  const priceMax = maxPrice
    ? cents(maxPrice.cents)
    : price
      ? cents(price.cents)
      : isFree
        ? 0
        : null;

  const result: EventResult = {
    eventId: str(ev.api_id) ?? "",
    name: str(ev.name),
    url: slug ? `${SITE_BASE}/${slug}` : null,
    startUtc: start,
    endUtc: end,
    timezone: tz,
    startLocal: toLocal(start, tz),
    endLocal: toLocal(end, tz),
    locationType,
    isOnline: locationType ? locationType !== "offline" : null,
    venueName: hidden ? null : str(geo?.address),
    venueAddress: hidden ? null : str(geo?.full_address),
    venueCity: str(geo?.city),
    venueRegion: str(geo?.region),
    venueCountry: str(geo?.country),
    venueCountryCode: str(geo?.country_code),
    latitude: num(coord?.latitude),
    longitude: num(coord?.longitude),
    addressHidden: hidden,
    isFree,
    priceMin,
    priceMax,
    currency:
      (str(price?.currency) ?? str(maxPrice?.currency))?.toUpperCase() ?? null,
    isSoldOut: bool(ticket?.is_sold_out),
    spotsRemaining: num(ticket?.spots_remaining),
    requiresApproval: bool(ticket?.require_approval),
    waitlistActive: pick("waitlist_active", bool),
    guestCount: pick("guest_count", num),
    hostNames: hosts
      .map((h) => (isObj(h) ? str(h.name) : null))
      .filter((n): n is string => !!n),
    calendarId: calId,
    calendarName: cal?.is_personal === true ? null : str(cal?.name),
    calendarUrl:
      cal?.is_personal === true
        ? null
        : calSlug
          ? `${SITE_BASE}/${calSlug}`
          : calId
            ? `${SITE_BASE}/calendar/${calId}`
            : null,
    imageUrl: str(ev.cover_url),
    recurrenceId: str(ev.recurrence_id),
    source: opts.source,
    scrapedAt: opts.scrapedAt,
  };
  if (opts.includeDetails) {
    const cats = Array.isArray(detail?.categories) ? detail.categories : [];
    result.categories = cats
      .map((c) => (isObj(c) ? str(c.name) : null))
      .filter((n): n is string => !!n);
    const types = Array.isArray(detail?.ticket_types)
      ? detail.ticket_types
      : [];
    result.ticketTypes = types
      .filter((t): t is Json => isObj(t) && t.is_hidden !== true)
      .map((t) => ({
        name: str(t.name),
        price: t.type === "free" ? 0 : cents(t.cents),
        currency: str(t.currency)?.toUpperCase() ?? null,
        type: str(t.type),
      }));
    result.description = detail
      ? mirrorToText(detail.description_mirror)
      : null;
  }
  return result;
}
