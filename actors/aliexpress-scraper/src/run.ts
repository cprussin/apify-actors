import { BlockedError } from "./challenge.js";
import type { NormalizedInput, SearchQuery } from "./input.js";
import type { Review, ReviewPage } from "./reviews.js";
import {
  pageUrl,
  SEARCH_PAGE_SIZE,
  type Product,
  type SearchPage,
} from "./search.js";
import type { Seen } from "./state.js";

export interface RunDeps {
  fetchSearch: (url: string) => Promise<SearchPage>;
  fetchReviews: (productId: string, page: number) => Promise<ReviewPage>;
  /** Push + charge one item. Return `false` to stop (budget exhausted). */
  emit: (item: Product | Review) => Promise<boolean>;
  log?: (msg: string) => void;
  now?: () => Date;
  /** onlyNew mode: skip previously returned products/reviews, record new ones. */
  seen?: Seen;
}

export interface SearchStats {
  query: string;
  pages: number;
  products: number;
  totalResults: number | null;
  status:
    "ok" | "lastPage" | "maxPages" | "noResults" | "failed" | "notStarted";
  error?: string;
}

export interface ReviewStats {
  productId: string;
  reviews: number;
  totalReviews: number | null;
  status:
    "ok" | "maxReviews" | "exhausted" | "noReviews" | "failed" | "notStarted";
  error?: string;
}

export interface RunStats {
  products: number;
  reviews: number;
  /** onlyNew: products/reviews already returned by an earlier run (not charged). */
  skippedSeen: number;
  stopReason: "done" | "budget" | "blocked";
  searches: SearchStats[];
  reviewTargets: ReviewStats[];
}

class BudgetStop extends Error {}

/** onlyNew: stop a product's reviews after this many pages with nothing new. */
export const ONLY_NEW_STALE_PAGES = 2;

export async function runScraper(
  input: NormalizedInput,
  deps: RunDeps,
): Promise<RunStats> {
  const log = deps.log ?? (() => {});
  const now = deps.now ?? (() => new Date());
  const stats: RunStats = {
    products: 0,
    reviews: 0,
    skippedSeen: 0,
    stopReason: "done",
    searches: input.searches.map((q) => ({
      query: q.keyword ?? q.url,
      pages: 0,
      products: 0,
      totalResults: null,
      status: "notStarted",
    })),
    reviewTargets: [],
  };
  const seenProducts = new Set<string>();
  const seenReviews = new Set<string>();
  const titles = new Map<string, string>();
  const reviewIds: string[] = [...input.productIds];

  const seen = deps.seen;
  /** onlyNew: true (and refreshes state) if `key` was returned by an earlier run. */
  const wasSeen = (key: string): boolean => {
    if (!seen?.has(key)) return false;
    seen.add(key);
    stats.skippedSeen += 1;
    return true;
  };

  const emit = async (item: Product | Review, key: string) => {
    const more = await deps.emit(item);
    seen?.add(key);
    if (item.type === "product") stats.products += 1;
    else stats.reviews += 1;
    if (!more) throw new BudgetStop();
  };

  const searchOne = async (q: SearchQuery, st: SearchStats) => {
    st.status = "ok";
    let picked = 0;
    for (let page = 1; page <= input.maxPages; page++) {
      const url = pageUrl(q.url, page, input.sort);
      const res = await deps.fetchSearch(url);
      st.pages = page;
      st.totalResults ??= res.totalResults;
      let position = (page - 1) * SEARCH_PAGE_SIZE;
      for (const p of res.products) {
        position += 1;
        if (seenProducts.has(p.productId)) continue;
        seenProducts.add(p.productId);
        titles.set(p.productId, p.title);
        const pickForReviews =
          input.includeReviews &&
          (input.reviewsForTopProducts === 0 ||
            picked < input.reviewsForTopProducts);
        if (pickForReviews && !reviewIds.includes(p.productId)) {
          reviewIds.push(p.productId);
          picked += 1;
        }
        if (wasSeen(`p:${p.productId}`)) continue;
        st.products += 1;
        await emit(
          {
            ...p,
            searchKeyword: q.keyword,
            searchUrl: url,
            searchPage: page,
            position,
            scrapedAt: now().toISOString(),
          },
          `p:${p.productId}`,
        );
      }
      if (!res.products.length) {
        st.status = page === 1 ? "noResults" : "lastPage";
        return;
      }
      const lastPage =
        res.totalResults !== null
          ? Math.ceil(res.totalResults / SEARCH_PAGE_SIZE)
          : Infinity;
      if (res.finished || page >= lastPage) {
        st.status = "lastPage";
        return;
      }
    }
    st.status = "maxPages";
  };

  const reviewsOne = async (productId: string, st: ReviewStats) => {
    st.status = "ok";
    let stalePages = 0;
    for (let page = 1; ; page++) {
      const res = await deps.fetchReviews(productId, page);
      st.totalReviews ??= res.totalReviews;
      // Past the last page AliExpress serves page 1 again.
      if (page > 1 && res.page !== page) {
        st.status = "exhausted";
        return;
      }
      let fresh = 0;
      for (const r of res.reviews) {
        const key = `${productId}:${r.reviewId}`;
        if (seenReviews.has(key)) continue;
        seenReviews.add(key);
        if (wasSeen(`r:${key}`)) continue;
        fresh += 1;
        st.reviews += 1;
        await emit(
          {
            ...r,
            productTitle: titles.get(productId) ?? null,
            scrapedAt: now().toISOString(),
          },
          `r:${key}`,
        );
        if (st.reviews >= input.maxReviewsPerProduct) {
          st.status = "maxReviews";
          return;
        }
      }
      if (!res.reviews.length || page >= res.totalPages) {
        st.status = st.reviews ? "exhausted" : "noReviews";
        return;
      }
      // onlyNew: stop paging once pages hold only already-returned reviews.
      stalePages = fresh ? 0 : stalePages + 1;
      if (seen && stalePages >= ONLY_NEW_STALE_PAGES) {
        st.status = "exhausted";
        return;
      }
    }
  };

  const guard = async (
    fn: () => Promise<void>,
    st: { status: string; error?: string },
    label: string,
  ) => {
    try {
      await fn();
    } catch (e) {
      if (e instanceof BudgetStop) throw e;
      st.status = "failed";
      st.error = (e as Error).message.slice(0, 300);
      log(`${label}: ${st.error}`);
      if (e instanceof BlockedError) throw e;
    }
  };

  try {
    for (const [i, q] of input.searches.entries()) {
      const st = stats.searches[i]!;
      await guard(() => searchOne(q, st), st, `Search "${st.query}"`);
    }
    for (const id of reviewIds) {
      const st: ReviewStats = {
        productId: id,
        reviews: 0,
        totalReviews: null,
        status: "notStarted",
      };
      stats.reviewTargets.push(st);
      await guard(() => reviewsOne(id, st), st, `Reviews for ${id}`);
    }
  } catch (e) {
    if (e instanceof BudgetStop) stats.stopReason = "budget";
    else if (e instanceof BlockedError) stats.stopReason = "blocked";
    else throw e;
  }

  if (stats.products + stats.reviews + stats.skippedSeen === 0) {
    const errors = [...stats.searches, ...stats.reviewTargets]
      .filter((s) => s.error)
      .map((s) => ("query" in s ? s.query : s.productId) + ": " + s.error);
    throw new Error(
      stats.stopReason === "blocked"
        ? `AliExpress blocked every request, so no results were scraped. ${errors.join("; ")}`
        : errors.length
          ? `No results: ${errors.join("; ")}`
          : "No results: the searches returned no products and the products have no reviews.",
    );
  }
  return stats;
}
