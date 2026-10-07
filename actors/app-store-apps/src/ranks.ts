import { createHash } from "node:crypto";
import type { ChangeType, Store } from "./app.js";

/**
 * "Rank changes only" state, persisted between runs in a named key-value
 * store under a key derived from the input. Per ranked list (one keyword or
 * one chart) it keeps the previous run's rank of every app fetched, which
 * can go deeper than the rows output (e.g. all 200 search results for a
 * top-30 query), so an app sliding from #30 to #31 is a 1-place move rather
 * than a drop.
 */
export interface RankEntry {
  rank: number;
  name: string | null;
  store: Store;
  bundleId?: string | null;
}

export interface RankGroup {
  /** ISO timestamp of the run that recorded these ranks. */
  at: string;
  ranks: Record<string, RankEntry>;
}

export interface RankState {
  version: 1;
  groups: Record<string, RankGroup>;
}

/** Stable JSON (sorted object keys) for hashing. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v)
      .sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map(
        (k) =>
          `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/** Key-value store record key for the given query parameters. */
export function stateKey(params: unknown): string {
  const h = createHash("sha256").update(stable(params)).digest("hex");
  return `RANKS-${h.slice(0, 16)}`;
}

/** Tolerant parse: anything unexpected becomes an empty state. */
export function parseRankState(raw: unknown): RankState {
  const out: RankState = { version: 1, groups: {} };
  const groups = (raw as RankState | null)?.groups;
  if (!groups || typeof groups !== "object") return out;
  for (const [k, g] of Object.entries(groups)) {
    if (!g || typeof g !== "object" || typeof g.at !== "string") continue;
    const ranks: Record<string, RankEntry> = {};
    for (const [id, e] of Object.entries(g.ranks ?? {})) {
      if (
        e &&
        typeof e.rank === "number" &&
        (e.store === "apple" || e.store === "google")
      )
        ranks[id] = {
          rank: e.rank,
          name: typeof e.name === "string" ? e.name : null,
          store: e.store,
          bundleId: typeof e.bundleId === "string" ? e.bundleId : null,
        };
    }
    out.groups[k] = { at: g.at, ranks };
  }
  return out;
}

export interface Ranked extends RankEntry {
  appId: string;
}

export interface Change {
  previousRank: number | null;
  rankChange: number | null;
  changeType: ChangeType;
}

export interface Comparison {
  /** True on the first run for this list (no previous ranks). */
  baseline: boolean;
  /** Per visible current app ID. "same" = not worth reporting. */
  changes: Map<string, Change>;
  /** Apps visible last run but not now; `rank` = current rank, if fetched. */
  dropped: (Omit<Ranked, "rank"> & {
    rank: number | null;
    previousRank: number;
  })[];
}

/**
 * Change for an app now at `rank`. `wasVisible` = it was in last run's
 * output list. Moves smaller than `minChange` count as "same".
 */
export function changeOf(
  previous: number | null,
  rank: number,
  wasVisible = previous !== null,
  minChange = 1,
): Change {
  if (previous === null)
    return { previousRank: null, rankChange: null, changeType: "new" };
  const delta = previous - rank;
  const changeType: ChangeType =
    Math.abs(delta) < minChange
      ? "same"
      : !wasVisible
        ? "new"
        : delta > 0
          ? "up"
          : "down";
  return { previousRank: previous, rankChange: delta, changeType };
}

export class RankTracker {
  private readonly state: RankState;

  constructor(raw?: unknown) {
    this.state = parseRankState(raw);
  }

  /**
   * Compare this run's full ranked list with the previous run's.
   * `visible` says whether an entry belongs in the output (rank depth,
   * tracked apps); the same predicate is applied to the previous run.
   */
  compare(
    group: string,
    current: Ranked[],
    visible: (e: Ranked) => boolean,
    minChange = 1,
  ): Comparison {
    const prev = this.state.groups[group];
    const changes = new Map<string, Change>();
    const shown = current.filter(visible);
    if (!prev) {
      for (const c of shown)
        changes.set(c.appId, {
          previousRank: null,
          rankChange: null,
          changeType: "baseline",
        });
      return { baseline: true, changes, dropped: [] };
    }
    const wasShown = (id: string) => {
      const p = prev.ranks[id];
      return !!p && visible({ ...p, appId: id });
    };
    for (const c of shown) {
      const p = prev.ranks[c.appId]?.rank ?? null;
      changes.set(c.appId, changeOf(p, c.rank, wasShown(c.appId), minChange));
    }
    const byId = new Map(current.map((c) => [c.appId, c]));
    const nowShown = new Set(shown.map((c) => c.appId));
    const dropped: Comparison["dropped"] = [];
    for (const [appId, p] of Object.entries(prev.ranks)) {
      if (nowShown.has(appId) || !wasShown(appId)) continue;
      const now = byId.get(appId);
      // Slid just past the cut-off: jitter, not a drop.
      if (now && now.rank - p.rank < minChange) continue;
      dropped.push({
        ...p,
        ...(now ?? {}),
        appId,
        rank: now?.rank ?? null,
        previousRank: p.rank,
      });
    }
    dropped.sort((a, b) => a.previousRank - b.previousRank);
    return { baseline: false, changes, dropped };
  }

  /** Record this run's ranks (call once the list is fully emitted). */
  commit(group: string, current: Ranked[], at: string): void {
    this.state.groups[group] = {
      at,
      ranks: Object.fromEntries(
        current.map((c) => [
          c.appId,
          {
            rank: c.rank,
            name: c.name,
            store: c.store,
            bundleId: c.bundleId ?? null,
          },
        ]),
      ),
    };
  }

  toJSON(): RankState {
    return this.state;
  }
}
