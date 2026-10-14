import type { NormalizedInput } from "./input.js";
import { toItem, type Item } from "./item.js";
import type { SoundCloudClient } from "./soundcloud.js";
import type { Target } from "./target.js";

/** Charge event (see .actor/pay_per_event.json). */
export const EVENT_ITEM = "item";

export interface RunDeps {
  client: Pick<SoundCloudClient, "resolve" | "search">;
  /** Push + charge one item. Return `false` to stop (e.g. budget exhausted). */
  emit: (item: Item) => Promise<boolean>;
  log?: (msg: string) => void;
  /** Parallel resolve requests. */
  concurrency?: number;
}

export interface RunStats {
  /** URL targets that resolved to an object. */
  resolved: number;
  /** Search results returned. */
  searchResults: number;
  emitted: number;
  /** URL targets that returned nothing (404) or an unsupported kind. */
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
  const concurrency = Math.max(1, deps.concurrency ?? 5);
  const stats: RunStats = {
    resolved: 0,
    searchResults: 0,
    emitted: 0,
    notFound: 0,
    failed: 0,
    errors: [],
    stopReason: "done",
  };

  const emit = async (item: Item): Promise<void> => {
    const more = await deps.emit(item);
    stats.emitted += 1;
    if (!more) throw new BudgetReached();
  };

  try {
    // 1. Resolve URL targets (in parallel, emit as they complete, in order).
    for (let i = 0; i < input.targets.length; i += concurrency) {
      const chunk = input.targets.slice(i, i + concurrency);
      const results = await Promise.all(
        chunk.map(async (t: Target): Promise<Item | null> => {
          try {
            const obj = await deps.client.resolve(t.url);
            if (!obj) {
              stats.notFound += 1;
              log(`${t.input}: not found (404), skipped.`);
              return null;
            }
            const item = toItem(obj, t.input);
            if (!item) {
              stats.notFound += 1;
              log(`${t.input}: unsupported object kind, skipped.`);
              return null;
            }
            stats.resolved += 1;
            return item;
          } catch (e) {
            stats.failed += 1;
            const msg = `${t.input}: ${(e as Error).message.slice(0, 200)}`;
            stats.errors.push(msg);
            log(`Failed to resolve ${msg}`);
            return null;
          }
        }),
      );
      for (const item of results) if (item) await emit(item);
    }

    // 2. Keyword search.
    if (input.search) {
      let raws: Awaited<ReturnType<typeof deps.client.search>>;
      try {
        raws = await deps.client.search(
          input.searchType,
          input.search,
          input.maxItems,
        );
      } catch (e) {
        stats.failed += 1;
        const msg = `search "${input.search}": ${(e as Error).message.slice(0, 200)}`;
        stats.errors.push(msg);
        log(msg);
        raws = [];
      }
      for (const raw of raws) {
        const item = toItem(raw, `search:${input.search}`);
        if (!item) continue;
        stats.searchResults += 1;
        await emit(item);
      }
    }
  } catch (e) {
    if (!(e instanceof BudgetReached)) throw e;
    stats.stopReason = "budget";
  }

  if (stats.emitted === 0 && stats.failed > 0 && stats.notFound === 0)
    throw new Error(`Nothing scraped. ${stats.errors.join("; ")}`);
  return stats;
}
