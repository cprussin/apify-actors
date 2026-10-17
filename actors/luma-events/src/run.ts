import { HttpError, type Page } from "./http.js";
import { targetKey, type NormalizedInput, type Target } from "./input.js";
import {
  calendarItemsUrl,
  discoverUrl,
  eventUrl,
  parseEntriesPage,
  parseEventDetail,
  parseResolved,
  resolveUrl,
  toResult,
  type Coordinates,
  type Entry,
  type EventResult,
  type Json,
  type Resolved,
} from "./luma.js";
import type { Seen } from "./state.js";

export type ChargeEvent = "event" | "event-detail";

export interface RunDeps {
  /** GET a URL (throws HttpError on HTTP errors/blocks). */
  get: (url: string) => Promise<Page>;
  /**
   * Push one item and charge `events` for it. Return `false` to stop
   * (budget reached).
   */
  emit: (item: EventResult, events: ChargeEvent[]) => Promise<boolean>;
  log?: (msg: string) => void;
  now?: () => Date;
  /** Parallel event detail requests. Default 3. */
  detailConcurrency?: number;
  /** onlyNew mode: skip previously returned events (by eventId), record new ones. */
  seen?: Seen;
}

export interface TargetStats {
  target: string;
  /** What the target resolved to: city, coordinates, calendar or event. */
  kind: string | null;
  pages: number;
  events: number;
  status: "done" | "failed" | "empty" | "stopped" | "notFound";
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
  targets: TargetStats[];
  stopReason: "done" | "maxEvents" | "budget";
}

/** Safety cap on listing pages per target (50 events each). */
export const MAX_PAGES = 200;

const errMsg = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).slice(0, 300);

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

class NotFound extends Error {}

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
    targets: [],
    stopReason: "done",
  };
  const seen = new Set<string>();

  const resolve = async (slug: string): Promise<Resolved> => {
    let res: Page;
    try {
      res = await deps.get(resolveUrl(slug));
    } catch (e) {
      if (e instanceof HttpError && e.status === 404)
        throw new NotFound(`No Luma page "${slug}".`);
      throw e;
    }
    const r = parseResolved(slug, res.body);
    if (!r) throw new Error(`Unexpected response resolving "${slug}".`);
    return r;
  };

  let categoryId: string | null = null;
  if (input.category) {
    const r = await resolve(input.category);
    if (r.kind !== "category")
      throw new Error(`Luma category "${input.category}" not found.`);
    categoryId = r.id;
  }

  const fetchDetail = async (id: string): Promise<Json> => {
    stats.detailPages += 1;
    const res = await deps.get(eventUrl(id));
    const d = parseEventDetail(res.body);
    if (!d) throw new Error(`Unexpected event response for ${id}.`);
    return d;
  };

  /** Dedupe and onlyNew filter; returns entries still to emit. */
  const fresh = (entries: Entry[]): Entry[] =>
    entries.filter((e) => {
      const id = String(e.event.api_id);
      if (seen.has(id)) {
        stats.duplicates += 1;
        return false;
      }
      seen.add(id);
      if (deps.seen?.has(id)) {
        deps.seen.add(id);
        stats.skippedSeen += 1;
        return false;
      }
      return true;
    });

  /** Build, emit and charge items; returns false once done (max or budget). */
  const emitEntries = async (
    entries: Entry[],
    source: string,
    st: TargetStats,
    known?: Map<string, Json>,
  ): Promise<boolean> => {
    const todo = entries.slice(0, input.maxEvents - stats.emitted);
    const scrapedAt = now().toISOString();
    const items = await mapLimit(todo, concurrency, async (entry) => {
      const id = String(entry.event.api_id);
      let detail: Json | null = known?.get(id) ?? null;
      if (input.includeDetails && !detail) {
        try {
          detail = await fetchDetail(id);
        } catch (e) {
          stats.detailErrors += 1;
          log(`Event ${id}: ${errMsg(e)} (keeping listing data only)`);
        }
      }
      const item = toResult(entry, detail, {
        source,
        scrapedAt,
        includeDetails: input.includeDetails,
      });
      const events: ChargeEvent[] = ["event"];
      if (input.includeDetails && detail) events.push("event-detail");
      return { item, events };
    });
    for (const { item, events } of items) {
      const more = await deps.emit(item, events);
      deps.seen?.add(item.eventId);
      stats.emitted += 1;
      st.events += 1;
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

  /** Follow a cursor-paged listing until it ends or we're done. */
  const paginate = async (
    pageUrl: (cursor: string | null) => string,
    source: string,
    st: TargetStats,
  ) => {
    let cursor: string | null = null;
    for (let p = 0; p < MAX_PAGES; p++) {
      const res = await deps.get(pageUrl(cursor));
      stats.pages += 1;
      st.pages += 1;
      const page = parseEntriesPage(res.body);
      if (!page) throw new Error(`Unexpected listing response at ${res.url}.`);
      if (!(await emitEntries(fresh(page.entries), source, st))) return;
      if (!page.hasMore || !page.nextCursor || page.nextCursor === cursor)
        return;
      cursor = page.nextCursor;
    }
  };

  const discover = (
    coordinates: Coordinates,
    source: string,
    st: TargetStats,
  ) =>
    paginate(
      (cursor) =>
        discoverUrl({
          coordinates,
          categoryId,
          query: input.keyword,
          cursor,
        }),
      source,
      st,
    );

  const runTarget = async (t: Target, st: TargetStats) => {
    if (t.type === "coords") {
      st.kind = "coordinates";
      return discover(t.coordinates, st.target, st);
    }
    const r = await resolve(t.slug);
    switch (r.kind) {
      case "place":
        st.kind = "city";
        return discover(r, `city:${r.slug}`, st);
      case "calendar":
        if (t.type === "city")
          throw new NotFound(
            `"${t.slug}" is a Luma calendar, not a city. Put calendars in startUrls.`,
          );
        st.kind = "calendar";
        return paginate(
          (cursor) =>
            calendarItemsUrl({
              calendarId: r.id,
              period: input.calendarPeriod,
              cursor,
            }),
          `calendar:${r.slug}`,
          st,
        );
      case "event": {
        if (t.type === "city")
          throw new NotFound(`"${t.slug}" is a Luma event, not a city.`);
        st.kind = "event";
        const entry = r.detail as unknown as Entry;
        const id = String(entry.event.api_id);
        await emitEntries(
          fresh([entry]),
          `event:${r.slug}`,
          st,
          new Map([[id, r.detail]]),
        );
        return;
      }
      case "category":
        throw new NotFound(
          `"${t.slug}" is a Luma category. Set category: "${r.slug}" and add cities instead.`,
        );
      default:
        throw new NotFound(
          `"${t.slug}" is a Luma ${r.type} page, not supported.`,
        );
    }
  };

  for (const t of input.targets) {
    const st: TargetStats = {
      target: targetKey(t),
      kind: null,
      pages: 0,
      events: 0,
      status: "done",
    };
    stats.targets.push(st);
    const skippedBefore = stats.skippedSeen;
    try {
      await runTarget(t, st);
    } catch (e) {
      const error = errMsg(e);
      st.status =
        e instanceof NotFound
          ? "notFound"
          : st.events || stats.skippedSeen > skippedBefore
            ? "stopped"
            : "failed";
      st.error = error;
      log(`${st.target}: ${error}`);
      continue;
    }
    if (
      !st.events &&
      stats.stopReason === "done" &&
      stats.skippedSeen === skippedBefore
    ) {
      st.status = "empty";
      log(`${st.target}: no events found.`);
    }
    if (stats.stopReason !== "done") break;
  }
  // Partial results are fine, but never report success when everything failed.
  const bad = stats.targets.filter(
    (s) => s.status === "failed" || s.status === "notFound",
  );
  if (
    bad.length === stats.targets.length &&
    stats.emitted === 0 &&
    stats.skippedSeen === 0
  ) {
    throw new Error(
      `All targets failed: ${[...new Set(bad.map((f) => f.error))].join("; ")}`,
    );
  }
  return stats;
}
