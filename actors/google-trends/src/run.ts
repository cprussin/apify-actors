import type { GoogleTrends } from "./google-trends.js";
import type { ExploreInput, NormalizedInput, TrendingInput } from "./input.js";
import type { Seen } from "./state.js";
import {
  anchorFactors,
  findWidget,
  parseRegions,
  parseRelatedQueries,
  parseRelatedTopics,
  parseTimeline,
  planBatches,
  uiExploreUrl,
  type Dataset,
  type RegionRow,
  type RelatedQueryRow,
  type RelatedTopicRow,
  type TimelinePoint,
  type Widget,
} from "./trends.js";

export interface TimelineRow {
  date: string;
  formattedTime: string;
  value: number;
  /** On one 0-100 scale across all batches (equals `value` with <= 5 terms). */
  normalizedValue: number | null;
  hasData: boolean;
  isPartial: boolean;
}

export interface TrendResult {
  dataset: Dataset;
  term: string;
  geo: string;
  timeframe: string;
  category: number;
  property: string;
  resolution: string | null;
  comparedWith: string[];
  anchorTerm: string | null;
  hasData: boolean;
  rowCount: number;
  rows: TimelineRow[] | RegionRow[] | RelatedQueryRow[] | RelatedTopicRow[];
  exploreUrl: string;
}

export interface TrendingResult {
  dataset: "trendingNow";
  term: string;
  geo: string;
  timeframe: string;
  searchVolume: number | null;
  increasePercent: number | null;
  startedAt: string | null;
  endedAt: string | null;
  isActive: boolean;
  categories: string[];
  relatedQueries: string[];
  newsArticleCount: number;
  exploreUrl: string;
}

export type ResultItem = TrendResult | TrendingResult;

export interface RunDeps {
  trends: GoogleTrends;
  /** Push one item, charging for it if `charge`. Return `false` to stop (budget). */
  emit: (item: ResultItem, charge: boolean) => Promise<boolean>;
  log?: (msg: string) => void;
  /** onlyNew (trending now): skip searches returned before, record new ones. */
  seen?: Seen;
}

/** onlyNew identity of a trending search. */
export const trendingKey = (term: string): string => term.trim().toLowerCase();

export interface RunStats {
  emitted: number;
  charged: number;
  empty: number;
  /** onlyNew: trending searches already returned by an earlier run (not charged). */
  skippedSeen: number;
  failed: { term: string; dataset: string; error: string }[];
  stopReason: "done" | "budget";
}

class BudgetReached extends Error {}

const round2 = (n: number) => Math.round(n * 100) / 100;
const errMsg = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).slice(0, 300);

export async function runTrends(
  input: NormalizedInput,
  deps: RunDeps,
): Promise<RunStats> {
  const stats: RunStats = {
    emitted: 0,
    charged: 0,
    empty: 0,
    skippedSeen: 0,
    failed: [],
    stopReason: "done",
  };
  const emit = async (item: ResultItem) => {
    const charge = item.dataset === "trendingNow" || item.hasData;
    const more = await deps.emit(item, charge);
    if (item.dataset === "trendingNow") deps.seen?.add(trendingKey(item.term));
    stats.emitted += 1;
    if (charge) stats.charged += 1;
    else stats.empty += 1;
    if (!more) throw new BudgetReached();
  };
  try {
    if (input.mode === "trendingNow")
      await runTrending(input, deps, emit, stats);
    else await runExplore(input, deps, emit, stats);
  } catch (e) {
    if (!(e instanceof BudgetReached)) throw e;
    stats.stopReason = "budget";
  }
  return stats;
}

async function runTrending(
  input: TrendingInput,
  deps: RunDeps,
  emit: (i: ResultItem) => Promise<void>,
  stats: RunStats,
) {
  const list = await deps.trends.trending(input.geo, input.hours, input.hl);
  if (!list.length) deps.log?.("Google returned no trending searches.");
  const seen = deps.seen;
  const fresh = list.filter((t) => {
    if (!seen?.has(trendingKey(t.term))) return true;
    seen.add(trendingKey(t.term));
    stats.skippedSeen += 1;
    return false;
  });
  for (const t of fresh.slice(0, input.maxResults)) {
    const q = new URLSearchParams({
      q: t.term,
      date: input.hours <= 24 ? "now 1-d" : "now 7-d",
      geo: input.geo,
      hl: input.hl,
    });
    await emit({
      dataset: "trendingNow",
      term: t.term,
      geo: t.geo || input.geo,
      timeframe: `past ${input.hours} hours`,
      searchVolume: t.searchVolume,
      increasePercent: t.increasePercent,
      startedAt: t.startedAt,
      endedAt: t.endedAt,
      isActive: t.isActive,
      categories: t.categories,
      relatedQueries: t.relatedQueries,
      newsArticleCount: t.newsArticleCount,
      exploreUrl: `https://trends.google.com/trends/explore?${q.toString()}`,
    });
  }
}

async function runExplore(
  input: ExploreInput,
  deps: RunDeps,
  emit: (i: ResultItem) => Promise<void>,
  stats: RunStats,
) {
  const log = deps.log ?? (() => {});
  const q = input.query;
  const batches = planBatches(input.terms);
  const anchor = batches.length > 1 ? batches[0]![0]! : null;
  const fail = (term: string, dataset: string, e: unknown) => {
    const error = errMsg(e);
    stats.failed.push({ term, dataset, error });
    log(`${term} / ${dataset}: ${error}`);
  };

  const base = (
    dataset: Dataset,
    term: string,
    batch: string[],
    rows: TrendResult["rows"],
    extra: Partial<TrendResult> = {},
  ): TrendResult => ({
    dataset,
    term,
    geo: q.geo,
    timeframe: q.time,
    category: q.category,
    property: q.property || "web",
    resolution: null,
    comparedWith: batch.filter((t) => t !== term),
    anchorTerm: anchor,
    ...extra,
    hasData: rows.length > 0,
    rowCount: rows.length,
    rows,
    exploreUrl: uiExploreUrl(batch, q),
  });

  // One explore call per batch gives the widget tokens.
  const explores: (Widget[] | Error)[] = [];
  for (const batch of batches) {
    try {
      explores.push(await deps.trends.explore(batch, q));
    } catch (e) {
      explores.push(e instanceof Error ? e : new Error(String(e)));
    }
  }
  /** Terms of batch `i`, skipping the repeated anchor after batch 0. */
  const own = (i: number) =>
    batches[i]!.map((term, j) => ({ term, j })).filter(
      ({ j }) => i === 0 || j > 0,
    );
  const each = async (
    dataset: Dataset,
    fn: (
      widgets: Widget[],
      batch: string[],
      term: string,
      j: number,
    ) => Promise<void>,
    needsExplore = true,
  ) => {
    for (let i = 0; i < batches.length; i++) {
      const ex = explores[i]!;
      for (const { term, j } of own(i)) {
        if (ex instanceof Error && needsExplore) {
          fail(term, dataset, ex);
          continue;
        }
        try {
          await fn(ex instanceof Error ? [] : ex, batches[i]!, term, j);
        } catch (e) {
          if (e instanceof BudgetReached) throw e;
          fail(term, dataset, e);
        }
      }
    }
  };

  if (input.datasets.includes("interestOverTime")) {
    const series: (TimelinePoint[] | Error)[] = [];
    for (let i = 0; i < batches.length; i++) {
      const ex = explores[i]!;
      if (ex instanceof Error) {
        series.push(ex);
        continue;
      }
      try {
        const w = findWidget(ex, "TIMESERIES", 0, batches[i]!.length);
        if (!w)
          throw new Error("Google returned no interest-over-time widget.");
        series.push(parseTimeline(await deps.trends.widget(w, q)));
      } catch (e) {
        series.push(e instanceof Error ? e : new Error(String(e)));
      }
    }
    const factors =
      batches.length > 1
        ? anchorFactors(
            series.map((s) =>
              s instanceof Error ? [] : s.map((p) => p.values[0] ?? 0),
            ),
          )
        : [1];
    if (factors.some((f) => f === null))
      log(
        `Anchor term "${anchor}" has no interest in some batches; normalizedValue is null there. Use a more popular first term.`,
      );
    let max = 0;
    series.forEach((s, i) => {
      const f = factors[i];
      if (s instanceof Error || f == null) return;
      for (const p of s) for (const v of p.values) max = Math.max(max, v * f);
    });
    const scale = batches.length > 1 && max > 0 ? 100 / max : 1;

    await each("interestOverTime", async (_w, batch, term, j) => {
      const i = batches.indexOf(batch);
      const s = series[i]!;
      if (s instanceof Error) throw s;
      const f = factors[i];
      const rows: TimelineRow[] = s.map((p) => {
        const value = p.values[j] ?? 0;
        return {
          date: p.date,
          formattedTime: p.formattedTime,
          value,
          normalizedValue: f == null ? null : round2(value * f * scale),
          hasData: p.hasData[j] ?? false,
          isPartial: p.isPartial,
        };
      });
      await emit(base("interestOverTime", term, batch, rows));
    });
  }

  if (input.datasets.includes("interestByRegion")) {
    await each("interestByRegion", async (widgets, batch, term, j) => {
      const w = findWidget(widgets, "GEO_MAP", j, batch.length);
      if (!w) throw new Error("Google returned no interest-by-region widget.");
      const request = { ...w.request };
      if (input.resolution) request.resolution = input.resolution;
      request.includeLowSearchVolumeGeos = input.includeLowVolumeRegions;
      let rows = parseRegions(await deps.trends.widget(w, q, request));
      if (!input.includeLowVolumeRegions) rows = rows.filter((r) => r.hasData);
      await emit(
        base("interestByRegion", term, batch, rows, {
          resolution: String(request.resolution ?? "") || null,
        }),
      );
    });
  }

  if (input.datasets.includes("relatedQueries")) {
    await each("relatedQueries", async (widgets, batch, term, j) => {
      const w = findWidget(widgets, "RELATED_QUERIES", j, batch.length);
      // Google omits the widget when a term has too little data.
      const rows = w ? parseRelatedQueries(await deps.trends.widget(w, q)) : [];
      await emit(base("relatedQueries", term, batch, rows));
    });
  }

  if (input.datasets.includes("relatedTopics")) {
    // Multi-term explores have no related-topics widget: explore each term alone.
    await each(
      "relatedTopics",
      async (widgets, batch, term) => {
        const single =
          batch.length === 1 && widgets.length
            ? widgets
            : await deps.trends.explore([term], q);
        const w = findWidget(single, "RELATED_TOPICS", 0, 1);
        const rows = w
          ? parseRelatedTopics(await deps.trends.widget(w, q))
          : [];
        await emit(base("relatedTopics", term, batch, rows));
      },
      false,
    );
  }

  // Partial results are fine, but never report success without any data.
  if (stats.failed.length > 0 && stats.charged === 0) {
    throw new Error(
      `All requests failed: ${[...new Set(stats.failed.map((f) => f.error))].join("; ")}`,
    );
  }
}
