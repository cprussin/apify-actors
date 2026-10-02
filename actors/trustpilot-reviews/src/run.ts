import {
  MAX_PAGES_PER_FILTER,
  MAX_PER_FILTER,
  PAGE_SIZE,
  type NormalizedInput,
} from "./input.js";
import {
  parseReviewPage,
  reviewPageUrl,
  type TpBusinessUnit,
  type TpReview,
} from "./page.js";
import type { PageResponse } from "./client.js";
import { laterOf, type Monitor } from "./state.js";
import { toCompanyInfo, toRecord, type ReviewRecord } from "./record.js";

export interface PageClient {
  get(url: string): Promise<PageResponse>;
}

export interface RunDeps {
  client: PageClient;
  /** Push + charge one item. Return `false` to stop (e.g. budget exhausted). */
  emit: (item: ReviewRecord) => Promise<boolean>;
  log?: (msg: string) => void;
  /** onlyNew mode: skips previously emitted reviews and records new ones. */
  monitor?: Monitor;
  /** Called after each company, e.g. to persist monitor state. */
  afterCompany?: () => Promise<void>;
}

export interface CompanyStats {
  status: "ok" | "notFound" | "failed";
  companyName?: string;
  pages: number;
  emitted: number;
  skippedDuplicate: number;
  /** onlyNew: reviews already returned by an earlier run. */
  skippedSeen: number;
  error?: string;
}

export interface RunStats {
  emitted: number;
  stopReason: "done" | "budget";
  companies: Record<string, CompanyStats>;
}

class NotFound extends Error {}

interface Item {
  review: TpReview;
  bu: TpBusinessUnit;
  ratings?: Record<string, number>;
}

/**
 * Reviews for one filter (star subset), page by page, in Trustpilot's order.
 * Stops at the last page, the logged-out page limit, `limit` reviews, or
 * (recency sort) the first review older than `since`.
 */
async function* streamFilter(
  company: string,
  stars: number[],
  input: NormalizedInput,
  since: string | undefined,
  limit: number,
  deps: RunDeps,
  st: CompanyStats,
): AsyncGenerator<Item> {
  const maxPages = Math.min(MAX_PAGES_PER_FILTER, Math.ceil(limit / PAGE_SIZE));
  let yielded = 0;
  for (let page = 1; page <= maxPages; page++) {
    const url = reviewPageUrl(company, {
      page,
      stars,
      language: input.language,
      sort: input.sort,
    });
    const res = await deps.client.get(url);
    st.pages += 1;
    const parsed = parseReviewPage(res.body);
    if (parsed.kind === "notFound") {
      if (page === 1) throw new NotFound(company);
      return;
    }
    if (parsed.kind === "loginWall") return;
    if (parsed.kind === "unknown") {
      throw new Error(`Unexpected page structure at ${url} (${parsed.detail})`);
    }
    const ratings = parsed.filters.reviewStatistics?.ratings;
    // Newest-first order is approximate (edited reviews), so finish the page
    // that crosses sinceDate before stopping.
    let reachedSince = false;
    for (const review of parsed.reviews) {
      if (!review?.id || review.isPending) continue;
      if (since && (review.dates?.publishedDate ?? "") < since) {
        reachedSince = true;
        continue;
      }
      yield { review, bu: parsed.businessUnit, ratings };
      if (++yielded >= limit) return;
    }
    const p = parsed.filters.pagination;
    if (reachedSince || !parsed.reviews.length) return;
    if (p && p.currentPage >= p.totalPages) return;
  }
}

/**
 * Merge several filter streams. Recency: newest first across streams.
 * Relevance: round-robin.
 */
async function* merge(
  streams: AsyncGenerator<Item>[],
  byDate: boolean,
): AsyncGenerator<Item> {
  const heads: { it: AsyncGenerator<Item>; cur: Item }[] = [];
  for (const it of streams) {
    const n = await it.next();
    if (!n.done) heads.push({ it, cur: n.value });
  }
  let rr = 0;
  while (heads.length) {
    let i = rr % heads.length;
    if (byDate) {
      i = 0;
      for (let j = 1; j < heads.length; j++) {
        const a = heads[j]!.cur.review.dates?.publishedDate ?? "";
        const b = heads[i]!.cur.review.dates?.publishedDate ?? "";
        if (a > b) i = j;
      }
    }
    const h = heads[i]!;
    yield h.cur;
    const n = await h.it.next();
    if (n.done) heads.splice(i, 1);
    else {
      h.cur = n.value;
      rr = i + 1;
    }
  }
}

/** Star filters to query: split by rating when one filter's 200 cap is too few. */
export function planFilters(input: NormalizedInput): number[][] {
  if (input.maxReviewsPerCompany <= MAX_PER_FILTER || input.stars.length === 1)
    return [input.stars];
  const stars = input.stars.length ? input.stars : [1, 2, 3, 4, 5];
  return [...stars].reverse().map((s) => [s]);
}

export async function runScrape(
  input: NormalizedInput,
  deps: RunDeps,
): Promise<RunStats> {
  const log = deps.log ?? (() => {});
  const stats: RunStats = { emitted: 0, stopReason: "done", companies: {} };
  const seenReviews = new Set<string>();
  const seenCompanies = new Map<string, string>();
  const filters = planFilters(input);

  for (const company of input.companies) {
    const st: CompanyStats = {
      status: "ok",
      pages: 0,
      emitted: 0,
      skippedDuplicate: 0,
      skippedSeen: 0,
    };
    stats.companies[company] = st;
    const monitor = deps.monitor;
    const since = laterOf(input.sinceDate, monitor?.since(company));
    // Whether the company was scanned down to `since` / the end.
    let complete = false;
    const perFilter =
      filters.length > 1
        ? Math.min(MAX_PER_FILTER, input.maxReviewsPerCompany)
        : input.maxReviewsPerCompany;
    const streams = filters.map((s) =>
      streamFilter(company, s, input, since, perFilter, deps, st),
    );
    const merged = merge(streams, input.sort === "recency");
    let companyInfo: ReturnType<typeof toCompanyInfo> | undefined;
    try {
      for await (const { review, bu, ratings } of merged) {
        st.companyName = bu.displayName;
        const dupOf = seenCompanies.get(bu.identifyingName);
        if (dupOf !== undefined && dupOf !== company) {
          log(
            `${company}: same Trustpilot profile as ${dupOf} (${bu.identifyingName}); skipping.`,
          );
          break;
        }
        seenCompanies.set(bu.identifyingName, company);
        if (seenReviews.has(review.id)) {
          st.skippedDuplicate += 1;
          continue;
        }
        seenReviews.add(review.id);
        if (monitor?.isSeen(company, review.id)) {
          st.skippedSeen += 1;
          continue;
        }
        if (input.includeCompanyInfo) {
          companyInfo ??= toCompanyInfo(bu, ratings);
        }
        const more = await deps.emit(toRecord(review, bu, companyInfo));
        st.emitted += 1;
        stats.emitted += 1;
        monitor?.record(
          company,
          review.id,
          review.dates?.publishedDate ?? new Date(0).toISOString(),
        );
        if (!more) {
          stats.stopReason = "budget";
          await merged.return(undefined);
          monitor?.finish(company, false);
          await deps.afterCompany?.();
          return stats;
        }
        if (st.emitted >= input.maxReviewsPerCompany) break;
      }
      complete = st.emitted < input.maxReviewsPerCompany;
    } catch (e) {
      if (e instanceof NotFound) {
        st.status = "notFound";
        log(`${company}: no Trustpilot profile found.`);
      } else {
        st.status = "failed";
        st.error = (e as Error).message.slice(0, 500);
        log(`${company}: failed: ${st.error}`);
      }
    } finally {
      await Promise.allSettled(streams.map((s) => s.return(undefined)));
    }
    if (monitor) {
      if (st.status === "ok") monitor.finish(company, complete);
      await deps.afterCompany?.();
    }
  }

  const all = Object.values(stats.companies);
  if (all.length && all.every((s) => s.status === "failed")) {
    throw new Error(
      `All companies failed: ${Object.entries(stats.companies)
        .map(([c, s]) => `${c}: ${s.error}`)
        .join("; ")}`,
    );
  }
  return stats;
}
