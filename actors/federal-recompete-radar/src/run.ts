import type { DateWindow, NormalizedInput } from "./input.js";
import {
  toContractRecord,
  dateOnly,
  type ContractRecord,
} from "./transform.js";
import {
  buildFilters,
  buildSearchBody,
  HttpError,
  initialCursor,
  nextCursor,
  PAGE_SIZE,
  SEARCH_FIELDS,
  type AwardDetail,
  type SearchResponse,
  type SearchRow,
  type UsaSpendingClient,
} from "./usaspending.js";

export interface SeenStore {
  has(id: string): boolean;
  add(id: string): void;
}

export interface RunDeps {
  client: Pick<UsaSpendingClient, "searchContracts" | "getAward">;
  /** Push + charge one item. Return `false` to stop (e.g. budget exhausted). */
  emit: (item: ContractRecord) => Promise<boolean>;
  seen?: SeenStore;
  log?: (msg: string) => void;
  /** Hard page cap as a safety net against runaway scans. */
  maxPages?: number;
}

export interface RunStats {
  emitted: number;
  scanned: number;
  skippedSeen: number;
  skippedFilter: number;
  pages: number;
  mode: "search_after" | "paged";
  stopReason: "maxResults" | "windowEnd" | "exhausted" | "budget" | "pageLimit";
}

/**
 * Stream contract rows whose current end date is within the window, in
 * ascending end-date order. Uses the API's search_after cursor; if the API
 * rejects the seeded cursor, falls back to classic page-based pagination
 * (descending, capped by the API's 50k result window).
 */
async function* streamRows(
  input: NormalizedInput,
  window: DateWindow,
  deps: RunDeps,
  stats: RunStats,
): AsyncGenerator<SearchRow> {
  const log = deps.log ?? (() => {});
  const maxPages = deps.maxPages ?? 500;

  let cursor: ReturnType<typeof nextCursor> = initialCursor(window);
  let first = true;
  while (cursor) {
    if (stats.pages >= maxPages) {
      stats.stopReason = "pageLimit";
      return;
    }
    let res: SearchResponse;
    try {
      res = await deps.client.searchContracts(buildSearchBody(input, cursor));
    } catch (e) {
      if (first && e instanceof HttpError && e.status >= 400) {
        log(
          `search_after seed rejected (${e.status}); falling back to paged mode.`,
        );
        yield* streamRowsPaged(input, window, deps, stats);
        return;
      }
      throw e;
    }
    first = false;
    stats.pages += 1;
    for (const row of res.results) {
      const end = dateOnly(row["End Date"]);
      if (end && end > window.end) {
        stats.stopReason = "windowEnd";
        return;
      }
      if (!end || end < window.start) continue;
      yield row;
    }
    cursor = nextCursor(res.page_metadata);
  }
  stats.stopReason = "exhausted";
}

async function* streamRowsPaged(
  input: NormalizedInput,
  window: DateWindow,
  deps: RunDeps,
  stats: RunStats,
): AsyncGenerator<SearchRow> {
  stats.mode = "paged";
  const maxPages = Math.min(deps.maxPages ?? 500, 50_000 / PAGE_SIZE);
  for (let page = 1; ; page += 1) {
    if (stats.pages >= maxPages) {
      stats.stopReason = "pageLimit";
      return;
    }
    const res = await deps.client.searchContracts({
      filters: buildFilters(input),
      fields: SEARCH_FIELDS,
      sort: "End Date",
      order: "desc",
      limit: PAGE_SIZE,
      page,
      subawards: false,
    });
    stats.pages += 1;
    for (const row of res.results) {
      const end = dateOnly(row["End Date"]);
      if (!end || end > window.end) continue;
      if (end < window.start) {
        stats.stopReason = "windowEnd";
        return;
      }
      yield row;
    }
    if (!res.page_metadata.hasNext) {
      stats.stopReason = "exhausted";
      return;
    }
  }
}

export async function runRadar(
  input: NormalizedInput,
  window: DateWindow,
  deps: RunDeps,
): Promise<RunStats> {
  const log = deps.log ?? (() => {});
  const stats: RunStats = {
    emitted: 0,
    scanned: 0,
    skippedSeen: 0,
    skippedFilter: 0,
    pages: 0,
    mode: "search_after",
    stopReason: "exhausted",
  };

  for await (const row of streamRows(input, window, deps, stats)) {
    stats.scanned += 1;
    const id = row.generated_internal_id;
    if (input.onlyNew && deps.seen?.has(id)) {
      stats.skippedSeen += 1;
      continue;
    }

    let detail: AwardDetail | null = null;
    if (input.includeDetails) {
      try {
        detail = await deps.client.getAward(id);
      } catch (e) {
        log(`Could not load details for ${id}: ${(e as Error).message}`);
      }
    }

    const record = toContractRecord(row, detail, window.today);
    if (
      input.minPotentialValue !== undefined &&
      (record.potentialValue ?? record.obligatedAmount ?? 0) <
        input.minPotentialValue
    ) {
      stats.skippedFilter += 1;
      continue;
    }

    const more = await deps.emit(record);
    deps.seen?.add(id);
    stats.emitted += 1;
    if (!more) {
      stats.stopReason = "budget";
      break;
    }
    if (stats.emitted >= input.maxResults) {
      stats.stopReason = "maxResults";
      break;
    }
  }
  return stats;
}
