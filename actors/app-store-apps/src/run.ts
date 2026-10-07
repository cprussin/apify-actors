import { makeRow, type App, type Row, type RowContext } from "./app.js";
import { APPLE_CHART_MAX, type AppleClient } from "./apple.js";
import { CATEGORIES } from "./categories.js";
import { GOOGLE_CHART_MAX, type GoogleClient } from "./google.js";
import type { NormalizedInput } from "./input.js";
import type { Ranked, RankTracker } from "./ranks.js";

export const APP_EVENT = "app";
export const RANK_EVENT = "rank-row";
export type ChargeEvent = typeof APP_EVENT | typeof RANK_EVENT;

export interface RunDeps {
  apple: Pick<AppleClient, "search" | "lookup" | "chart">;
  google: Pick<GoogleClient, "details" | "chart">;
  /**
   * Push one item, charging `event` (null = free error item). Return
   * `false` to stop, e.g. when the max charge per run is reached.
   */
  emit: (row: Row, event: ChargeEvent | null) => Promise<boolean>;
  /** Rank changes only: compares with and records the previous run's ranks. */
  tracker?: RankTracker;
  /** Called after each fully emitted ranked list, e.g. to persist state. */
  afterGroup?: () => Promise<void>;
  log?: (msg: string) => void;
  now?: () => Date;
}

export interface RunStats {
  charged: number;
  errors: number;
  /** Rank changes only: unchanged rows not output. */
  unchanged: number;
  stopReason: "done" | "budget";
  /** Queries (keywords, charts, apps) that failed. */
  failed: string[];
  queries: number;
}

class BudgetReached extends Error {}

export async function runApps(
  input: NormalizedInput,
  deps: RunDeps,
): Promise<RunStats> {
  const log = deps.log ?? (() => {});
  const scrapedAt = (deps.now?.() ?? new Date()).toISOString();
  const stats: RunStats = {
    charged: 0,
    errors: 0,
    unchanged: 0,
    stopReason: "done",
    failed: [],
    queries: 0,
  };
  const { country } = input;

  const emit = async (row: Row, event: ChargeEvent | null) => {
    const more = await deps.emit(row, event);
    if (event) stats.charged += 1;
    if (!more) throw new BudgetReached();
  };

  const fail = async (
    label: string,
    ctx: Omit<RowContext, "type" | "country" | "scrapedAt" | "error">,
    app: { [K in keyof App]?: App[K] | null } | null,
    e: unknown,
  ) => {
    const msg = e instanceof Error ? e.message : String(e);
    stats.errors += 1;
    stats.failed.push(label);
    log(`${label}: ${msg.slice(0, 300)}`);
    await emit(
      makeRow(
        { ...ctx, type: "error", country, scrapedAt, error: msg.slice(0, 500) },
        app,
      ),
      null,
    );
  };

  /**
   * Emit the top `maxResults` of one ranked list (optionally only tracked
   * apps), diffed against the previous run when tracking rank changes.
   * `all` may go deeper than `maxResults`; the extra depth is only used to
   * tell small slides past the cut-off from real drops.
   */
  const emitRanked = async (
    group: string,
    ctx: Omit<RowContext, "country" | "scrapedAt">,
    all: App[],
    tracked?: string[],
  ) => {
    const want = new Set(tracked ?? []);
    const ranked: Ranked[] = all.map((a, i) => ({
      appId: a.appId,
      rank: i + 1,
      name: a.name,
      store: a.store,
      bundleId: a.bundleId,
    }));
    const visible = (e: Ranked) =>
      e.rank <= input.maxResults &&
      (!tracked || want.has(e.appId) || want.has(`bundle:${e.bundleId}`));
    let rows = ranked
      .filter(visible)
      .map((e) =>
        makeRow({ ...ctx, country, scrapedAt, rank: e.rank }, all[e.rank - 1]!),
      );
    const found = new Set(
      rows.flatMap((r) => [r.appId, `bundle:${r.bundleId}`]),
    );
    const missing = (tracked ?? []).filter((t) => !found.has(t));

    const extra: Row[] = [];
    let baseline = true;
    if (deps.tracker) {
      const cmp = deps.tracker.compare(
        group,
        ranked,
        visible,
        input.minRankChange,
      );
      baseline = cmp.baseline;
      for (const r of rows) Object.assign(r, cmp.changes.get(r.appId!));
      for (const d of cmp.dropped) {
        const row = makeRow(
          { ...ctx, country, scrapedAt, rank: d.rank },
          {
            store: d.store,
            appId: d.appId,
            name: d.name,
            bundleId: d.bundleId,
          },
        );
        row.previousRank = d.previousRank;
        row.rankChange = d.rank === null ? null : d.previousRank - d.rank;
        row.changeType = "dropped";
        extra.push(row);
      }
      if (!baseline) {
        const before = rows.length;
        rows = rows.filter((r) => r.changeType !== "same");
        stats.unchanged += before - rows.length;
      }
    }
    // Tracked apps outside the top N (only on the baseline when tracking;
    // later, leaving the top N shows up as "dropped").
    if (!deps.tracker || baseline) {
      for (const t of missing) {
        const bundle = t.startsWith("bundle:");
        const row = makeRow(
          { ...ctx, country, scrapedAt },
          {
            store: "apple",
            appId: bundle ? null : t,
            bundleId: bundle ? t.slice(7) : null,
          },
        );
        row.changeType = "notRanked";
        extra.push(row);
      }
    }
    for (const r of [...rows, ...extra]) await emit(r, RANK_EVENT);
    deps.tracker?.commit(group, ranked, scrapedAt);
    await deps.afterGroup?.();
  };

  try {
    if (input.mode === "keywordRanks") {
      for (const keyword of input.keywords) {
        stats.queries += 1;
        const ctx = {
          type: "keywordRank" as const,
          keyword,
          language: null,
        };
        let apps: App[];
        try {
          apps = await deps.apple.search(keyword, country);
        } catch (e) {
          await fail(`keyword "${keyword}"`, ctx, { store: "apple" }, e);
          continue;
        }
        await emitRanked(
          `keyword:apple:${country}:${keyword.toLowerCase()}`,
          ctx,
          apps,
          input.trackedApps.length ? input.trackedApps : undefined,
        );
      }
    } else if (input.mode === "topCharts") {
      const cat = CATEGORIES[input.category];
      for (const store of input.stores) {
        for (const chart of input.charts) {
          stats.queries += 1;
          const label = `${store} ${chart} (${input.category})`;
          const ctx = {
            type: "chartRank" as const,
            chart,
            chartCategory: input.category,
            language: store === "google" ? input.language : null,
          };
          // Rank tracking fetches the full chart to spot small slides.
          const depth = deps.tracker ? Infinity : input.maxResults;
          let apps: App[];
          try {
            apps =
              store === "apple"
                ? await deps.apple.chart(
                    chart,
                    cat.apple,
                    country,
                    Math.min(depth, APPLE_CHART_MAX),
                  )
                : await deps.google.chart(
                    chart,
                    cat.google,
                    input.language,
                    country,
                    Math.min(depth, GOOGLE_CHART_MAX),
                  );
            if (!apps.length)
              throw new Error(
                "The store returned an empty chart (not every category has every chart, e.g. Google Play has no paid Finance chart).",
              );
          } catch (e) {
            await fail(label, ctx, { store }, e);
            continue;
          }
          await emitRanked(
            `chart:${store}:${country}:${chart}:${input.category}`,
            ctx,
            apps,
          );
        }
      }
    } else {
      const appleIds = input.apps
        .filter((a) => a.store === "apple")
        .map((a) => a.id);
      let apple = new Map<string, App>();
      let appleError: unknown;
      if (appleIds.length) {
        try {
          apple = await deps.apple.lookup(appleIds, country);
        } catch (e) {
          appleError = e;
        }
      }
      for (const ref of input.apps) {
        stats.queries += 1;
        const label = `${ref.store}:${ref.id}`;
        const lang = ref.store === "google" ? input.language : null;
        const ctx = { type: "app" as const, language: lang };
        const refApp = ref.id.startsWith("bundle:")
          ? { store: ref.store, bundleId: ref.id.slice(7) }
          : { store: ref.store, appId: ref.id };
        let app: App | null | undefined;
        try {
          if (ref.store === "apple") {
            if (appleError) throw appleError;
            app = apple.get(ref.id);
          } else {
            app = await deps.google.details(ref.id, input.language, country);
          }
          if (!app)
            throw new Error(
              `App not found in the ${country.toUpperCase()} ${ref.store === "apple" ? "App Store" : "Google Play store"}.`,
            );
        } catch (e) {
          await fail(label, ctx, refApp, e);
          continue;
        }
        await emit(makeRow({ ...ctx, country, scrapedAt }, app), APP_EVENT);
      }
    }
  } catch (e) {
    if (!(e instanceof BudgetReached)) throw e;
    stats.stopReason = "budget";
    return stats;
  }

  if (stats.queries && stats.failed.length === stats.queries) {
    throw new Error(
      `All ${stats.queries} queries failed; see the dataset errors.`,
    );
  }
  return stats;
}
