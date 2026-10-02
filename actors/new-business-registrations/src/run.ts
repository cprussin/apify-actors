import { ADAPTERS } from "./adapters/index.js";
import {
  buildWhere,
  orderBy,
  type QueryClient,
  type StateAdapter,
} from "./adapters/types.js";
import type { DateWindow } from "./dates.js";
import type { NormalizedInput } from "./input.js";
import type { BusinessRecord } from "./record.js";

export interface SeenStore {
  has(id: string): boolean;
  add(id: string): void;
}

export interface RunDeps {
  client: QueryClient;
  /** Push + charge one item. Return `false` to stop (e.g. budget exhausted). */
  emit: (item: BusinessRecord) => Promise<boolean>;
  seen?: SeenStore;
  log?: (msg: string) => void;
  /** Rows per Socrata request. */
  pageSize?: number;
  /** Safety net against runaway scans. */
  maxPagesPerState?: number;
  /** Override the adapter registry (tests). */
  adapters?: Record<string, StateAdapter>;
}

export interface StateStats {
  pages: number;
  rows: number;
  emitted: number;
  skippedSeen: number;
  skippedFilter: number;
  status: "ok" | "exhausted" | "pageLimit" | "skipped" | "failed";
  error?: string;
}

export interface RunStats {
  emitted: number;
  stopReason: "maxResults" | "exhausted" | "budget";
  states: Record<string, StateStats>;
}

export const seenKey = (r: Pick<BusinessRecord, "state" | "entityId">) =>
  `${r.state}:${r.entityId}`;

export const DEFAULT_PAGE_SIZE = 1000;

/** Newest-first records for one state, after dedupe and client-side filters. */
async function* streamState(
  adapter: StateAdapter,
  input: NormalizedInput,
  window: DateWindow,
  deps: RunDeps,
  st: StateStats,
): AsyncGenerator<BusinessRecord> {
  const where = buildWhere(adapter, window, input);
  if (where === null) {
    st.status = "skipped";
    st.error = "County filter not supported: dataset has no county field.";
    return;
  }
  const pageSize = deps.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxPages = deps.maxPagesPerState ?? 200;
  const categories = new Set(input.entityTypes);
  const emittedIds = new Set<string>();

  for (let offset = 0; ; offset += pageSize) {
    if (st.pages >= maxPages) {
      st.status = "pageLimit";
      return;
    }
    const rows = await deps.client.query(adapter.domain, adapter.datasetId, {
      where,
      order: orderBy(adapter),
      limit: pageSize,
      offset,
    });
    st.pages += 1;
    st.rows += rows.length;

    const page: BusinessRecord[] = [];
    for (const row of rows) {
      const rec = adapter.toRecord(row);
      if (!rec || emittedIds.has(rec.entityId)) continue;
      emittedIds.add(rec.entityId);
      if (categories.size && !categories.has(rec.entityCategory)) {
        st.skippedFilter += 1;
        continue;
      }
      if (input.onlyNew && deps.seen?.has(seenKey(rec))) {
        st.skippedSeen += 1;
        continue;
      }
      page.push(rec);
    }
    if (page.length && adapter.enrich) {
      try {
        await adapter.enrich(page, deps.client);
      } catch (e) {
        deps.log?.(
          `${adapter.code}: enrichment failed, continuing without it: ${(e as Error).message}`,
        );
      }
    }
    yield* page;
    if (rows.length < pageSize) {
      st.status = "exhausted";
      return;
    }
  }
}

/**
 * Stream all selected states round-robin (one record from each in turn), so
 * a small maxResults still covers every state. A failing state is logged and
 * dropped; the run fails only if every state fails.
 */
export async function runFeed(
  input: NormalizedInput,
  window: DateWindow,
  deps: RunDeps,
): Promise<RunStats> {
  const log = deps.log ?? (() => {});
  const registry: Record<string, StateAdapter> = deps.adapters ?? ADAPTERS;
  const stats: RunStats = { emitted: 0, stopReason: "exhausted", states: {} };

  const active = input.states.map((code) => {
    const adapter = registry[code];
    if (!adapter) throw new Error(`No adapter for state ${code}`);
    const st: StateStats = {
      pages: 0,
      rows: 0,
      emitted: 0,
      skippedSeen: 0,
      skippedFilter: 0,
      status: "ok",
    };
    stats.states[code] = st;
    return { code, st, it: streamState(adapter, input, window, deps, st) };
  });

  const closeAll = async () => {
    await Promise.allSettled(active.map((a) => a.it.return(undefined)));
  };

  while (active.length) {
    for (let i = 0; i < active.length;) {
      const a = active[i]!;
      let next: IteratorResult<BusinessRecord>;
      try {
        next = await a.it.next();
      } catch (e) {
        a.st.status = "failed";
        a.st.error = (e as Error).message.slice(0, 500);
        log(`${a.code}: failed, skipping state: ${a.st.error}`);
        active.splice(i, 1);
        continue;
      }
      if (next.done) {
        if (a.st.status === "skipped") log(`${a.code}: ${a.st.error}`);
        active.splice(i, 1);
        continue;
      }
      const record = next.value;
      const more = await deps.emit(record);
      deps.seen?.add(seenKey(record));
      stats.emitted += 1;
      a.st.emitted += 1;
      if (!more) {
        stats.stopReason = "budget";
        await closeAll();
        return stats;
      }
      if (stats.emitted >= input.maxResults) {
        stats.stopReason = "maxResults";
        await closeAll();
        return stats;
      }
      i += 1;
    }
  }

  const all = Object.values(stats.states);
  if (all.length && all.every((s) => s.status === "failed")) {
    throw new Error(
      `All states failed: ${Object.entries(stats.states)
        .map(([c, s]) => `${c}: ${s.error}`)
        .join("; ")}`,
    );
  }
  return stats;
}
