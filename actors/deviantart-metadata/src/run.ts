import {
  GALLERY_PAGE_SIZE,
  RSS_PAGE_SIZE,
  SEARCH_PAGE_SIZE,
  type DeviantArtClient,
} from "./deviantart.js";
import type { NormalizedInput } from "./input.js";
import { fromRss, splitTags, type Item } from "./item.js";

/** Charge events (see .actor/pay_per_event.json). */
export const EVENT_DEVIATION = "deviation";
export const EVENT_PROFILE = "profile";
export type ChargeEvent = typeof EVENT_DEVIATION | typeof EVENT_PROFILE;

/** Extra pages scanned beyond maxItems/pageSize (to make up filtered items). */
const SLACK_PAGES = 3;
/** With sinceDate, search (relevance-ranked) scans at most this many pages. */
const MAX_SEARCH_PAGES_SINCE = 20;

export interface RunDeps {
  client: Pick<
    DeviantArtClient,
    | "searchPage"
    | "galleryPage"
    | "profile"
    | "deviation"
    | "deviationViaOembed"
    | "authorWatchers"
    | "oembed"
    | "rss"
  >;
  /** Push + charge one item. Return `false` to stop (budget exhausted). */
  emit: (item: Item, event: ChargeEvent) => Promise<boolean>;
  log?: (msg: string) => void;
}

export interface RunStats {
  emitted: number;
  deviations: number;
  profiles: number;
  /** Items from the oEmbed/RSS fallbacks (partial metadata). */
  fallbackItems: number;
  skippedMature: number;
  skippedOld: number;
  notFound: number;
  failed: number;
  errors: string[];
  stopReason: "done" | "budget";
}

class BudgetReached extends Error {}

export async function runScrape(
  input: NormalizedInput,
  deps: RunDeps,
): Promise<RunStats> {
  const log = deps.log ?? (() => {});
  const { client } = deps;
  const stats: RunStats = {
    emitted: 0,
    deviations: 0,
    profiles: 0,
    fallbackItems: 0,
    skippedMature: 0,
    skippedOld: 0,
    notFound: 0,
    failed: 0,
    errors: [],
    stopReason: "done",
  };

  const fail = (what: string, e: unknown) => {
    stats.failed += 1;
    const msg = `${what}: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`;
    stats.errors.push(msg);
    log(msg);
  };

  const isOld = (item: Item): boolean =>
    input.since !== null &&
    item.publishedAt !== null &&
    Date.parse(item.publishedAt) < input.since;

  /** Filters, enriches and emits one deviation. Returns true if emitted. */
  const offer = async (item: Item): Promise<boolean> => {
    if (!input.includeMature && item.isMature) {
      stats.skippedMature += 1;
      return false;
    }
    if (isOld(item)) {
      stats.skippedOld += 1;
      return false;
    }
    if (input.includeTags && item.tags === null && item.url) {
      try {
        const o = await client.oembed(item.url);
        if (o) item.tags = splitTags(o.tags);
      } catch (e) {
        log(
          `Tags for ${item.url} unavailable: ${(e as Error).message.slice(0, 120)}`,
        );
      }
    }
    return emit(item, EVENT_DEVIATION);
  };

  const emit = async (item: Item, event: ChargeEvent): Promise<boolean> => {
    const more = await deps.emit(item, event);
    stats.emitted += 1;
    if (event === EVENT_PROFILE) stats.profiles += 1;
    else stats.deviations += 1;
    if (item.dataSource !== "page") stats.fallbackItems += 1;
    if (!more) throw new BudgetReached();
    return true;
  };

  /** RSS fallback: up to `max` deviations for `query`, newest first for by:user. */
  const viaRss = async (
    query: string,
    source: string,
    max: number,
    newestFirst: boolean,
  ): Promise<void> => {
    log(`Falling back to RSS for "${query}".`);
    let count = 0;
    const maxPages = Math.ceil(max / RSS_PAGE_SIZE) + SLACK_PAGES;
    for (let page = 0, offset = 0; page < maxPages && count < max; page++) {
      let p;
      try {
        p = await client.rss(query, offset);
      } catch (e) {
        fail(`RSS "${query}"`, e);
        return;
      }
      let older = false;
      for (const r of p.items) {
        const item = fromRss(r, source);
        if (newestFirst && isOld(item)) older = true;
        if (await offer(item)) count += 1;
        if (count >= max) break;
      }
      if (older || !p.next || !p.items.length) break;
      offset += p.items.length;
    }
  };

  const search = async (query: string): Promise<void> => {
    let count = 0;
    const maxPages =
      input.since !== null
        ? MAX_SEARCH_PAGES_SINCE
        : Math.ceil(input.maxItems / SEARCH_PAGE_SIZE) + SLACK_PAGES;
    for (let page = 1; page <= maxPages && count < input.maxItems; page++) {
      let p;
      try {
        p = await client.searchPage(query, page);
      } catch (e) {
        fail(`search "${query}" page ${page}`, e);
        p = null;
      }
      if (!p) {
        await viaRss(query, `search:${query}`, input.maxItems - count, false);
        return;
      }
      for (const item of p.items) {
        if (count >= input.maxItems) break;
        if (await offer(item)) count += 1;
      }
      if (!p.hasMore) break;
    }
  };

  const gallery = async (username: string): Promise<void> => {
    let count = 0;
    const maxPages =
      Math.ceil(input.maxItems / GALLERY_PAGE_SIZE) + SLACK_PAGES;
    for (let page = 1; page <= maxPages && count < input.maxItems; page++) {
      let p;
      try {
        p = await client.galleryPage(username, page);
      } catch (e) {
        fail(`gallery ${username} page ${page}`, e);
        p = null;
      }
      if (p === undefined) {
        stats.notFound += 1;
        log(`${username}: user not found (404), skipped.`);
        return;
      }
      if (p === null) {
        await viaRss(`by:${username}`, username, input.maxItems - count, true);
        return;
      }
      let older = false;
      for (const item of p.items) {
        if (count >= input.maxItems) break;
        if (isOld(item)) older = true;
        if (await offer(item)) count += 1;
      }
      // The gallery is newest first: once past sinceDate, stop paging.
      if (older || !p.hasMore) break;
      if (p.total !== null && page >= p.total) break;
    }
  };

  const profile = async (username: string): Promise<void> => {
    let item;
    try {
      item = await client.profile(username);
    } catch (e) {
      fail(`profile ${username}`, e);
      return;
    }
    if (item === undefined) {
      stats.notFound += 1;
      log(`${username}: user not found (404), skipped.`);
      return;
    }
    if (item === null) {
      fail(`profile ${username}`, "page had no profile data");
      return;
    }
    await emit(item, EVENT_PROFILE);
  };

  const deviation = async (t: NormalizedInput["deviations"][number]) => {
    let item: Item | null | undefined;
    try {
      item = await client.deviation(t.url, t.id, t.input);
    } catch (e) {
      log(`${t.url}: page failed (${(e as Error).message.slice(0, 120)}).`);
      item = null;
    }
    if (item === undefined) {
      stats.notFound += 1;
      log(`${t.input}: not found (404), skipped.`);
      return;
    }
    if (item === null) {
      try {
        item = await client.deviationViaOembed(t.url, t.input);
      } catch (e) {
        fail(t.input, e);
        return;
      }
      if (!item) {
        stats.notFound += 1;
        log(`${t.input}: not found, skipped.`);
        return;
      }
    }
    if (item.authorWatchers === null && item.author)
      item.authorWatchers = await client.authorWatchers(item.author);
    await offer(item);
  };

  try {
    switch (input.mode) {
      case "search":
        await search(input.query!);
        break;
      case "userGallery":
        for (const u of input.usernames) await gallery(u);
        break;
      case "userProfile":
        for (const u of input.usernames) await profile(u);
        break;
      case "deviationUrls":
        for (const t of input.deviations) await deviation(t);
        break;
    }
  } catch (e) {
    if (!(e instanceof BudgetReached)) throw e;
    stats.stopReason = "budget";
  }

  if (stats.emitted === 0 && stats.failed > 0 && stats.notFound === 0)
    throw new Error(`Nothing scraped. ${stats.errors.join("; ")}`);
  return stats;
}
