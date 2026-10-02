import { ApiSource, postToLaunch, TokenError, type RawPost } from "./api.js";
import { entryToLaunch, type FeedEntry, type FeedSource } from "./feed.js";
import type { NormalizedInput } from "./input.js";
import {
  addDays,
  orderLaunch,
  ptDate,
  ptMidnight,
  refKey,
  windows,
  type Launch,
  type SourceName,
} from "./launch.js";
import type { Seen } from "./state.js";
import type { WebsiteResolver } from "./website.js";

export interface RunDeps {
  /** Token-free source; used when there is no API token. */
  feed: FeedSource;
  /** Official API; used when the input has a token. */
  api?: ApiSource;
  websites?: WebsiteResolver;
  /** Charge + save one launch. Return `false` to stop (budget exhausted). */
  emit: (item: Launch) => Promise<boolean>;
  log?: (msg: string) => void;
  now?: () => Date;
  /** onlyNew mode: skip previously returned launches (by id), record new ones. */
  seen?: Seen;
}

/** onlyNew, newest-first API streams: stop after this many known launches in a row. */
export const ONLY_NEW_SEEN_STREAK = 3;

export interface GroupStats {
  status: "ok" | "notFound" | "failed" | "notStarted";
  scanned: number;
  emitted: number;
  error?: string;
}

export interface RunStats {
  source: SourceName;
  emitted: number;
  skippedFilter: number;
  skippedDuplicate: number;
  /** onlyNew: launches already returned by an earlier run (not charged). */
  skippedSeen: number;
  stopReason: "done" | "maxItems" | "budget";
  groups: Record<string, GroupStats>;
}

class Stop extends Error {}

export function matchesKeywords(l: Launch, keywords: string[]): boolean {
  if (!keywords.length) return true;
  const hay = [l.name, l.tagline, l.description, ...l.topics]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return keywords.some((k) => hay.includes(k));
}

export async function runLaunches(
  input: NormalizedInput,
  deps: RunDeps,
): Promise<RunStats> {
  const log = deps.log ?? (() => {});
  const now = deps.now?.() ?? new Date();
  const scrapedAt = now.toISOString();
  const useApi = Boolean(input.apiToken && deps.api);
  const stats: RunStats = {
    source: useApi ? "api" : "feed",
    emitted: 0,
    skippedFilter: 0,
    skippedDuplicate: 0,
    skippedSeen: 0,
    stopReason: "done",
    groups: {},
  };
  const seen = new Set<string>();

  const group = (label: string): GroupStats =>
    (stats.groups[label] ??= { status: "notStarted", scanned: 0, emitted: 0 });

  /** Filters, dedupes and emits one launch. */
  const offer = async (
    l: Launch,
    g: GroupStats,
    prepare?: (l: Launch) => Promise<void>,
  ): Promise<Offered> => {
    if (!matchesKeywords(l, input.keywords)) {
      stats.skippedFilter += 1;
      return "skipped";
    }
    if (seen.has(l.id)) {
      stats.skippedDuplicate += 1;
      return "skipped";
    }
    seen.add(l.id);
    if (deps.seen?.has(l.id)) {
      deps.seen.add(l.id);
      stats.skippedSeen += 1;
      return "known";
    }
    if (prepare) await prepare(l);
    if (input.resolveWebsites && deps.websites && !l.website)
      l.website = await deps.websites.resolve(l.websiteRedirectUrl);
    const more = await deps.emit(orderLaunch(l));
    deps.seen?.add(l.id);
    g.emitted += 1;
    stats.emitted += 1;
    if (!more) {
      stats.stopReason = "budget";
      throw new Stop();
    }
    if (stats.emitted >= input.maxItems) {
      stats.stopReason = "maxItems";
      throw new Stop();
    }
    return "emitted";
  };

  try {
    if (useApi)
      await runApi(input, deps.api!, scrapedAt, now, group, offer, log);
    else await runFeed(input, deps.feed, scrapedAt, group, offer, log);
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
  }

  const all = Object.values(stats.groups);
  if (all.length && all.every((s) => s.status === "failed"))
    throw new Error(
      `Nothing could be scraped: ${Object.entries(stats.groups)
        .map(([k, s]) => `${k}: ${s.error}`)
        .join("; ")}`,
    );
  return stats;
}

/** "known" = returned by an earlier run (onlyNew). */
type Offered = "emitted" | "skipped" | "known";

type Offer = (
  l: Launch,
  g: GroupStats,
  prepare?: (l: Launch) => Promise<void>,
) => Promise<Offered>;

async function guarded(
  label: string,
  g: GroupStats,
  log: (m: string) => void,
  fn: () => Promise<void>,
): Promise<void> {
  g.status = "ok";
  try {
    await fn();
  } catch (e) {
    if (e instanceof Stop || e instanceof TokenError) throw e;
    g.status = "failed";
    g.error = (e as Error).message.slice(0, 500);
    log(`${label}: failed after ${g.emitted} launches: ${g.error}`);
  }
}

/**
 * An unknown topic slug returns the main feed (possibly a slightly different
 * cached copy). Real topics share well under half their launches with it.
 */
export function looksLikeMainFeed(
  entries: FeedEntry[],
  main: Set<string>,
): boolean {
  if (!entries.length || !main.size) return false;
  const shared = entries.filter((e) => main.has(e.id)).length;
  return shared >= 0.8 * Math.min(entries.length, main.size);
}

async function runFeed(
  input: NormalizedInput,
  feed: FeedSource,
  scrapedAt: string,
  group: (l: string) => GroupStats,
  offer: Offer,
  log: (m: string) => void,
): Promise<void> {
  if (input.includeComments)
    log("Comments need a Product Hunt API token; skipping them.");
  if (input.dateFilter && input.mode !== "leaderboard")
    log(
      "Without an API token only Product Hunt's current launches are available; the date range is ignored.",
    );

  /** Emits entries in order, enriching them with live votes/ranks in batches. */
  const emitAll = async (
    entries: FeedEntry[],
    topics: string[],
    g: GroupStats,
    sortByVotes = false,
  ) => {
    const launches = entries.map((e) => entryToLaunch(e, topics, scrapedAt));
    g.scanned += launches.length;
    if (sortByVotes) {
      await feed.enrich(launches);
      launches.sort((a, b) => (b.votesCount ?? -1) - (a.votesCount ?? -1));
    }
    let inGroup = 0;
    // Enrich lazily, a batch at a time, so small runs make few requests.
    const BATCH = 12;
    for (
      let i = 0;
      i < launches.length && inGroup < input.maxPerGroup;
      i += BATCH
    ) {
      const batch = launches.slice(i, i + BATCH);
      if (!sortByVotes) await feed.enrich(batch);
      for (const l of batch) {
        if (inGroup >= input.maxPerGroup) break;
        if ((await offer(l, g)) === "emitted") inGroup += 1;
      }
    }
  };

  if (input.mode === "latest" || input.mode === "leaderboard") {
    const label = input.mode === "latest" ? "latest" : "current leaderboard";
    const g = group(label);
    if (input.mode === "leaderboard")
      log(
        "No API token: returning Product Hunt's current launches sorted by live upvotes. Ranks are only known for the top 5 of each day; add a token for full historical leaderboards.",
      );
    await guarded(label, g, log, async () => {
      await emitAll(await feed.entries(), [], g, input.mode === "leaderboard");
    });
    return;
  }

  if (input.mode === "topics") {
    let mainIds: Set<string> | undefined;
    for (const topic of input.topics) {
      const g = group(`topic:${topic}`);
      await guarded(`topic:${topic}`, g, log, async () => {
        const entries = await feed.entries(topic);
        // Unknown topics silently return the main feed; detect that.
        mainIds ??= new Set((await feed.entries()).map((e) => e.id));
        if (looksLikeMainFeed(entries, mainIds)) {
          g.status = "notFound";
          g.error = `Topic "${topic}" was not found on Product Hunt (check the slug in https://www.producthunt.com/topics).`;
          log(g.error);
          return;
        }
        await emitAll(entries, [topic], g);
      });
    }
  }
}

async function runApi(
  input: NormalizedInput,
  api: ApiSource,
  scrapedAt: string,
  now: Date,
  group: (l: string) => GroupStats,
  offer: Offer,
  log: (m: string) => void,
): Promise<void> {
  const toLaunch = (p: RawPost) =>
    postToLaunch(p, scrapedAt, input.includeMakers);
  const prepare = input.includeComments
    ? async (l: Launch) => {
        try {
          l.comments = await api.comments(l.id, input.maxCommentsPerLaunch);
        } catch (e) {
          if (e instanceof TokenError) throw e;
          log(`Comments for ${l.name} failed: ${(e as Error).message}`);
          l.comments = [];
        }
      }
    : undefined;
  const scanLimit = Math.max(2000, input.maxPerGroup * 20);

  const stream = async (
    label: string,
    posts: AsyncGenerator<RawPost>,
    rank?: (l: Launch, position: number) => void,
    newestFirst = false,
  ) => {
    const g = group(label);
    await guarded(label, g, log, async () => {
      let inGroup = 0;
      let knownStreak = 0;
      try {
        for await (const p of posts) {
          g.scanned += 1;
          const l = toLaunch(p);
          rank?.(l, g.scanned);
          const r = await offer(l, g, prepare);
          if (r === "emitted") inGroup += 1;
          if (r !== "skipped")
            knownStreak = r === "known" ? knownStreak + 1 : 0;
          if (inGroup >= input.maxPerGroup || g.scanned >= scanLimit) break;
          if (newestFirst && knownStreak >= ONLY_NEW_SEEN_STREAK) break;
        }
      } finally {
        await posts.return(undefined);
      }
    });
  };

  const range = input.dateFilter
    ? {
        postedAfter: ptMidnight(input.startDate).toISOString(),
        postedBefore: ptMidnight(addDays(input.endDate, 1)).toISOString(),
      }
    : {};
  const featured = input.featuredOnly ? true : undefined;

  switch (input.mode) {
    case "latest":
      await stream(
        "latest",
        api.posts({ order: "NEWEST", featured }),
        undefined,
        true,
      );
      return;
    case "leaderboard": {
      const today = ptDate(now)!;
      const ws = windows(
        input.period,
        input.startDate,
        input.endDate,
      ).reverse();
      for (const w of ws) {
        const label = `${input.period} ${w.label}`;
        if (w.start > today) continue;
        await stream(
          label,
          api.posts({
            order: "RANKING",
            featured: true,
            postedAfter: ptMidnight(w.start).toISOString(),
            postedBefore: ptMidnight(w.end).toISOString(),
          }),
          (l, pos) => {
            if (w.period === "daily") l.dailyRank = pos;
            if (w.period === "weekly") l.weeklyRank = pos;
            if (w.period === "monthly") l.monthlyRank = pos;
          },
        );
      }
      return;
    }
    case "topics":
      for (const topic of input.topics)
        await stream(
          `topic:${topic}`,
          api.posts({ order: "NEWEST", topic, featured, ...range }),
          undefined,
          true,
        );
      return;
    case "posts":
      for (const ref of input.posts) {
        const label = refKey(ref);
        const g = group(label);
        await guarded(label, g, log, async () => {
          const p = await api.post(ref);
          g.scanned += 1;
          if (!p) {
            g.status = "notFound";
            g.error = "Post not found.";
            log(`${label}: not found on Product Hunt.`);
            return;
          }
          await offer(toLaunch(p), g, prepare);
        });
      }
      return;
  }
}
