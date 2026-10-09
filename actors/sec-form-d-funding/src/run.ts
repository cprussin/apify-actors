import {
  MAX_OFFSET,
  PAGE_SIZE,
  toFilingRef,
  type EdgarClient,
} from "./edgar.js";
import { industryCategory, parseFormD, type FilingRecord } from "./formd.js";
import { addDays, type DateWindow, type NormalizedInput } from "./input.js";
import type { FilingRef } from "./formd.js";

export interface SeenLike {
  has(id: string): boolean;
  add(id: string): void;
}

export interface RunDeps {
  client: Pick<EdgarClient, "search" | "primaryDoc">;
  /** Push + charge one item. Return `false` to stop (e.g. budget exhausted). */
  emit: (item: FilingRecord) => Promise<boolean>;
  seen?: SeenLike;
  log?: (msg: string) => void;
  /** Filings downloaded in parallel (the client enforces the rate limit). */
  concurrency?: number;
}

export interface RunStats {
  emitted: number;
  scanned: number;
  skippedSeen: number;
  skippedFilter: number;
  failed: number;
  days: number;
  pages: number;
  stopReason: "maxResults" | "exhausted" | "budget";
}

/** Filters decidable from the record (industry, amount, form type). */
export function matches(r: FilingRecord, input: NormalizedInput): boolean {
  if (input.filingType === "new" && r.isAmendment) return false;
  if (input.filingType === "amendment" && !r.isAmendment) return false;
  const group = r.industryGroup?.toLowerCase() ?? "";
  if (input.excludeInvestmentFunds && group === "pooled investment fund")
    return false;
  if (input.industryGroups.length) {
    const cat = industryCategory(r.industryGroup)?.toLowerCase() ?? "";
    if (!input.industryGroups.some((g) => g === group || g === cat))
      return false;
  }
  if (
    input.minOfferingAmount !== undefined ||
    input.maxOfferingAmount !== undefined
  ) {
    // "Indefinite" offerings count as unbounded.
    const amount = r.offeringAmountIndefinite
      ? Infinity
      : r.totalOfferingAmount;
    if (amount === null) return false;
    if (
      input.minOfferingAmount !== undefined &&
      amount < input.minOfferingAmount
    )
      return false;
    if (
      input.maxOfferingAmount !== undefined &&
      amount > input.maxOfferingAmount
    )
      return false;
  }
  return true;
}

/** Stream filing references, newest filing date first, one day at a time. */
async function* streamRefs(
  input: NormalizedInput,
  window: DateWindow,
  deps: RunDeps,
  stats: RunStats,
): AsyncGenerator<FilingRef> {
  const log = deps.log ?? (() => {});
  const forms = input.filingType === "amendment" ? "D/A" : "D";
  for (let date = window.to; date >= window.from; date = addDays(date, -1)) {
    stats.days += 1;
    for (let from = 0; from < MAX_OFFSET; from += PAGE_SIZE) {
      const res = await deps.client.search({
        date,
        forms,
        states: input.states,
        from,
      });
      stats.pages += 1;
      const total = res.hits.total?.value ?? 0;
      if (from === 0 && total >= MAX_OFFSET)
        log(
          `${date}: ${total} filings; only the first ${MAX_OFFSET} are reachable.`,
        );
      for (const hit of res.hits.hits) {
        const ref = toFilingRef(hit);
        if (!ref) continue;
        // Cheap pre-filter from the index before downloading the filing.
        if (input.filingType === "new" && ref.formType.endsWith("/A")) continue;
        yield ref;
      }
      if (res.hits.hits.length < PAGE_SIZE || from + PAGE_SIZE >= total) break;
    }
  }
}

export async function runFeed(
  input: NormalizedInput,
  window: DateWindow,
  deps: RunDeps,
): Promise<RunStats> {
  const log = deps.log ?? (() => {});
  const concurrency = Math.max(1, deps.concurrency ?? 6);
  const stats: RunStats = {
    emitted: 0,
    scanned: 0,
    skippedSeen: 0,
    skippedFilter: 0,
    failed: 0,
    days: 0,
    pages: 0,
    stopReason: "exhausted",
  };

  const load = async (ref: FilingRef): Promise<FilingRecord | null> => {
    try {
      return parseFormD(await deps.client.primaryDoc(ref), ref);
    } catch (e) {
      stats.failed += 1;
      log(`Skipping ${ref.accessionNumber}: ${(e as Error).message}`);
      return null;
    }
  };

  /** Download a batch in parallel, emit in index order. */
  const flush = async (batch: FilingRef[]): Promise<boolean> => {
    const records = await Promise.all(batch.map(load));
    for (const r of records) {
      if (!r) continue;
      if (!matches(r, input)) {
        stats.skippedFilter += 1;
        continue;
      }
      const more = await deps.emit(r);
      deps.seen?.add(r.accessionNumber);
      stats.emitted += 1;
      if (!more) {
        stats.stopReason = "budget";
        return false;
      }
      if (stats.emitted >= input.maxResults) {
        stats.stopReason = "maxResults";
        return false;
      }
    }
    return true;
  };

  const postFilters =
    input.industryGroups.length > 0 ||
    input.excludeInvestmentFunds ||
    input.minOfferingAmount !== undefined ||
    input.maxOfferingAmount !== undefined;
  let batch: FilingRef[] = [];
  const seenNow = new Set<string>();
  for await (const ref of streamRefs(input, window, deps, stats)) {
    if (seenNow.has(ref.accessionNumber)) continue;
    seenNow.add(ref.accessionNumber);
    stats.scanned += 1;
    if (input.onlyNew && deps.seen?.has(ref.accessionNumber)) {
      stats.skippedSeen += 1;
      deps.seen.add(ref.accessionNumber); // keep it in the capped state
      continue;
    }
    batch.push(ref);
    // Without post-download filters, don't fetch more than still needed.
    const size = postFilters
      ? concurrency
      : Math.min(concurrency, input.maxResults - stats.emitted);
    if (batch.length >= size) {
      const more = await flush(batch);
      batch = [];
      if (!more) return stats;
    }
  }
  if (batch.length) await flush(batch);
  return stats;
}
