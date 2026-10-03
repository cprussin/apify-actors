import {
  eventIdFromUrl,
  isBlockPage,
  localDateTime,
  localToUtc,
  pageUrl,
  parseEventPage,
  parseSearchPage,
  tagNames,
  type EventDetails,
  type RawEvent,
} from "./eventbrite.js";
import type { Page } from "./http.js";
import type { NormalizedInput, SearchPlan } from "./input.js";
import type { Seen } from "./state.js";

export interface EventResult {
  eventId: string;
  name: string | null;
  url: string | null;
  startDate: string | null;
  endDate: string | null;
  timezone: string | null;
  startUtc: string | null;
  endUtc: string | null;
  isOnline: boolean | null;
  venueName: string | null;
  venueAddress: string | null;
  venueCity: string | null;
  venueRegion: string | null;
  venuePostalCode: string | null;
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
  salesStatus: string | null;
  category: string | null;
  subcategory: string | null;
  format: string | null;
  tags: string[];
  imageUrl: string | null;
  summary: string | null;
  description?: string | null;
  isCancelled: boolean | null;
  seriesId: string | null;
  publishedAt: string | null;
  searchUrl: string | null;
  scrapedAt: string;
}

export interface RunDeps {
  /** GET a URL (throws on HTTP errors/blocks). */
  get: (url: string) => Promise<Page>;
  /** Push one item and charge for it. Return `false` to stop (budget). */
  emit: (item: EventResult) => Promise<boolean>;
  log?: (msg: string) => void;
  now?: () => Date;
  /** Parallel event page requests. Default 3. */
  detailConcurrency?: number;
  /** onlyNew mode: skip previously returned events (by eventId), record new ones. */
  seen?: Seen;
}

export interface SearchStats {
  search: string;
  pages: number;
  events: number;
  totalEvents: number | null;
  status: "done" | "failed" | "empty" | "stopped";
  error?: string;
}

export interface RunStats {
  pages: number;
  detailPages: number;
  detailErrors: number;
  emitted: number;
  duplicates: number;
  /** onlyNew: events already returned by an earlier run (not charged). */
  skippedSeen: number;
  searches: SearchStats[];
  stopReason: "done" | "maxEvents" | "budget";
}

/** Eventbrite lists at most 50 pages per search. */
export const MAX_PAGES = 50;

const errMsg = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).slice(0, 300);

const num = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

/** Merge a search result and/or its event page into one dataset item. */
export function toResult(
  ev: RawEvent | null,
  d: EventDetails | null,
  opts: {
    searchUrl: string | null;
    scrapedAt: string;
    includeDetails: boolean;
  },
): EventResult {
  const v = ev?.primary_venue ?? null;
  const a = v?.address ?? null;
  const tz = str(ev?.timezone) ?? d?.timezone ?? null;
  const start = localDateTime(str(ev?.start_date), str(ev?.start_time));
  const end = localDateTime(str(ev?.end_date), str(ev?.end_time));
  const isOnline =
    typeof ev?.is_online_event === "boolean"
      ? ev.is_online_event
      : (d?.isOnline ?? null);
  const result: EventResult = {
    eventId: String(ev?.id ?? d?.id ?? eventIdFromUrl(d?.url ?? "") ?? ""),
    name: str(ev?.name) ?? d?.name ?? null,
    url: str(ev?.url) ?? d?.url ?? null,
    startDate: d?.startLocal ?? start,
    endDate: d?.endLocal ?? end,
    timezone: tz,
    startUtc: d?.startUtc ?? localToUtc(start, tz),
    endUtc: d?.endUtc ?? localToUtc(end, tz),
    isOnline,
    venueName: str(v?.name) ?? d?.venueName ?? null,
    venueAddress: str(a?.localized_address_display) ?? d?.venueAddress ?? null,
    venueCity: str(a?.city) ?? d?.venueCity ?? null,
    venueRegion: str(a?.region) ?? d?.venueRegion ?? null,
    venuePostalCode: str(a?.postal_code),
    venueCountry: str(a?.country) ?? d?.venueCountry ?? null,
    latitude: num(a?.latitude) ?? d?.latitude ?? null,
    longitude: num(a?.longitude) ?? d?.longitude ?? null,
    organizerId: str(ev?.primary_organizer_id) ?? d?.organizerId ?? null,
    organizerName: d?.organizerName ?? null,
    organizerUrl: d?.organizerUrl ?? null,
    isFree: d?.isFree ?? null,
    priceMin: d?.priceMin ?? null,
    priceMax: d?.priceMax ?? null,
    currency: d?.currency ?? null,
    salesStatus: d?.salesStatus ?? null,
    category:
      tagNames(ev?.tags, "EventbriteCategory")[0] ?? d?.category ?? null,
    subcategory:
      tagNames(ev?.tags, "EventbriteSubCategory")[0] ?? d?.subcategory ?? null,
    format: tagNames(ev?.tags, "EventbriteFormat")[0] ?? d?.format ?? null,
    tags: tagNames(ev?.tags, "OrganizerTag"),
    imageUrl:
      str(ev?.image?.original?.url) ??
      str(ev?.image?.url) ??
      d?.imageUrl ??
      null,
    summary: str(ev?.summary) ?? d?.summary ?? null,
    isCancelled:
      ev?.is_cancelled === true || d?.status === "canceled"
        ? true
        : ev?.is_cancelled === false || d?.status
          ? false
          : null,
    seriesId: str(ev?.series_id) ?? d?.seriesId ?? null,
    publishedAt: str(ev?.published),
    searchUrl: opts.searchUrl,
    scrapedAt: opts.scrapedAt,
  };
  if (opts.includeDetails) result.description = d?.description ?? null;
  return result;
}

/** Map with at most `limit` calls in flight; results keep input order. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return out;
}

export const describeSearch = (s: SearchPlan) =>
  s.url.replace(/^https:\/\/www\./, "");

export async function runEvents(
  input: NormalizedInput,
  deps: RunDeps,
): Promise<RunStats> {
  const log = deps.log ?? (() => {});
  const now = deps.now ?? (() => new Date());
  const concurrency = deps.detailConcurrency ?? 3;
  const stats: RunStats = {
    pages: 0,
    detailPages: 0,
    detailErrors: 0,
    emitted: 0,
    duplicates: 0,
    skippedSeen: 0,
    searches: [],
    stopReason: "done",
  };
  const seen = new Set<string>();
  /** onlyNew: true (and refreshes state) if the event was returned before. */
  const wasSeen = (id: string): boolean => {
    if (!deps.seen?.has(id)) return false;
    deps.seen.add(id);
    stats.skippedSeen += 1;
    return true;
  };

  const fetchDetails = async (url: string): Promise<EventDetails> => {
    stats.detailPages += 1;
    const res = await deps.get(url);
    const d = parseEventPage(res.html);
    if (!d) {
      if (isBlockPage(res.html)) throw new Error("Blocked by Eventbrite.");
      throw new Error(`Not an event page: ${res.url}`);
    }
    return d;
  };

  /** Emit items; returns false once maxEvents or the budget is reached. */
  const emitAll = async (items: EventResult[], st?: SearchStats) => {
    for (const item of items) {
      const more = await deps.emit(item);
      deps.seen?.add(item.eventId);
      stats.emitted += 1;
      if (st) st.events += 1;
      if (!more) {
        stats.stopReason = "budget";
        return false;
      }
      if (stats.emitted >= input.maxEvents) {
        stats.stopReason = "maxEvents";
        return false;
      }
    }
    return true;
  };

  // 1. Event pages given as start URLs.
  const direct = input.eventUrls.filter((u) => {
    const id = eventIdFromUrl(u);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return !wasSeen(id);
  });
  for (let i = 0; i < direct.length;) {
    const room = input.maxEvents - stats.emitted;
    const batch = direct.slice(i, i + Math.min(concurrency * 4, room));
    i += batch.length;
    const results = await mapLimit(batch, concurrency, async (url) => {
      try {
        return toResult(null, await fetchDetails(url), {
          searchUrl: null,
          scrapedAt: now().toISOString(),
          includeDetails: input.includeDetails,
        });
      } catch (e) {
        stats.detailErrors += 1;
        log(`${url}: ${errMsg(e)}`);
        return null;
      }
    });
    const ok = results.filter((r): r is EventResult => !!r);
    if (!(await emitAll(ok))) return stats;
  }
  if (
    direct.length &&
    stats.emitted === 0 &&
    stats.skippedSeen === 0 &&
    !input.searches.length
  )
    throw new Error("All event pages failed.");

  // 2. Searches.
  const runSearch = async (s: SearchPlan, st: SearchStats) => {
    const last = Math.min(MAX_PAGES, s.startPage + MAX_PAGES - 1);
    for (let p = s.startPage; p <= last; p++) {
      const url = pageUrl(s.url, p);
      const res = await deps.get(url);
      stats.pages += 1;
      st.pages += 1;
      const page = parseSearchPage(res.html);
      if (!page) {
        if (isBlockPage(res.html)) throw new Error("Blocked by Eventbrite.");
        throw new Error(
          `Not an Eventbrite search page (no event data) at ${res.url}. Check the location slug or URL.`,
        );
      }
      st.totalEvents ??= page.totalEvents;
      const fresh = page.events.filter((e) => {
        if (seen.has(e.id)) {
          stats.duplicates += 1;
          return false;
        }
        seen.add(e.id);
        return !wasSeen(e.id);
      });
      const todo = fresh.slice(0, input.maxEvents - stats.emitted);
      const scrapedAt = now().toISOString();
      const items = await mapLimit(todo, concurrency, async (ev) => {
        let d: EventDetails | null = null;
        if (input.includeDetails && ev.url) {
          try {
            d = await fetchDetails(ev.url);
          } catch (e) {
            stats.detailErrors += 1;
            log(`Event ${ev.id}: ${errMsg(e)} (keeping search data only)`);
          }
        }
        return toResult(ev, d, {
          searchUrl: url,
          scrapedAt,
          includeDetails: input.includeDetails,
        });
      });
      if (!(await emitAll(items, st))) return;
      if (!page.events.length) return;
      if (page.pageCount !== null && p >= page.pageCount) return;
    }
  };

  for (const s of input.searches) {
    const st: SearchStats = {
      search: describeSearch(s),
      pages: 0,
      events: 0,
      totalEvents: null,
      status: "done",
    };
    stats.searches.push(st);
    const skippedBefore = stats.skippedSeen;
    try {
      await runSearch(s, st);
    } catch (e) {
      const error = errMsg(e);
      // Events from earlier pages are kept; only a search with none fails.
      st.status =
        st.events || stats.skippedSeen > skippedBefore ? "stopped" : "failed";
      st.error = error;
      log(`${st.search}: ${error}`);
      continue;
    }
    if (
      !st.events &&
      stats.stopReason === "done" &&
      stats.skippedSeen === skippedBefore
    ) {
      st.status = "empty";
      log(`${st.search}: no events found.`);
    }
    if (stats.stopReason !== "done") break;
  }
  // Partial results are fine, but never report success when everything failed.
  const failed = stats.searches.filter((s) => s.status === "failed");
  if (failed.length > 0 && stats.emitted === 0 && stats.skippedSeen === 0) {
    throw new Error(
      `All searches failed: ${[...new Set(failed.map((f) => f.error))].join("; ")}`,
    );
  }
  return stats;
}
