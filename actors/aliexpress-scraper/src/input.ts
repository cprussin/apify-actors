import {
  canonicalProductId,
  keywordUrl,
  MAX_SEARCH_PAGES,
  type SearchSort,
} from "./search.js";

/** Raw actor input, as defined in .actor/input_schema.json. */
export interface RawInput {
  keywords?: string[];
  searchUrls?: (string | { url?: string })[];
  maxPagesPerKeyword?: number;
  sort?: string;
  productIds?: (string | { url?: string })[];
  includeReviews?: boolean;
  maxReviewsPerProduct?: number;
  reviewsForTopProducts?: number;
  translateReviews?: boolean;
  shipTo?: string;
  currency?: string;
  language?: string;
  onlyNew?: boolean;
  proxyConfiguration?: Record<string, unknown>;
}

export interface SearchQuery {
  /** Keyword, or null for a pasted search URL. */
  keyword: string | null;
  url: string;
}

export interface NormalizedInput {
  searches: SearchQuery[];
  maxPages: number;
  sort: SearchSort;
  productIds: string[];
  includeReviews: boolean;
  maxReviewsPerProduct: number;
  /** Reviews for the first N products of each search; 0 = all. */
  reviewsForTopProducts: number;
  translateReviews: boolean;
  shipTo: string;
  currency: string;
  language: string;
  /** Skip products/reviews returned by earlier runs with the same input (monitoring). */
  onlyNew: boolean;
}

export const DEFAULT_INPUT = {
  maxPagesPerKeyword: 1,
  sort: "default",
  includeReviews: true,
  maxReviewsPerProduct: 10,
  reviewsForTopProducts: 3,
  shipTo: "US",
  currency: "USD",
  language: "en",
} satisfies RawInput;

export const SORTS: readonly SearchSort[] = [
  "default",
  "orders",
  "priceAsc",
  "priceDesc",
];
export const MAX_REVIEWS_PER_PRODUCT = 10_000;

export class InputError extends Error {}

const toInt = (v: unknown, name: string): number | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new InputError(`${name} must be a number.`);
  return Math.floor(n);
};

const entries = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [])
    .map((x) =>
      typeof x === "string" ? x : (x as { url?: unknown } | null)?.url,
    )
    .filter((x): x is string => typeof x === "string" && !!x.trim())
    .map((x) => x.trim());

/** Item URL or numeric ID → canonical product ID. */
export function parseProductId(s: string): string {
  const t = s.trim();
  const m =
    /\/item\/(?:[^/]*\/)?(\d{8,20})\.html/i.exec(t) ??
    /[?&](?:productId|itemId)=(\d{8,20})/i.exec(t) ??
    /^(\d{8,20})$/.exec(t);
  if (!m)
    throw new InputError(
      `"${s}" is not an AliExpress product ID or item URL (e.g. 1005007502032342 or https://www.aliexpress.com/item/1005007502032342.html).`,
    );
  return canonicalProductId(m[1]!);
}

/** Checks a pasted AliExpress search/category URL. */
export function parseSearchUrl(s: string): string {
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new InputError(`"${s}" is not a valid URL.`);
  }
  if (!/(^|\.)aliexpress\.(com|us)$/i.test(u.hostname))
    throw new InputError(`"${s}" is not an aliexpress.com URL.`);
  if (/\/item\//.test(u.pathname))
    throw new InputError(
      `"${s}" is a product page. Put product URLs in productIds (for reviews) instead of searchUrls.`,
    );
  // Country subdomains (de., es., aliexpress.us) would redirect and override
  // the ship-to/currency settings, so always use www.aliexpress.com.
  u.protocol = "https:";
  u.hostname = "www.aliexpress.com";
  const text = u.searchParams.get("SearchText");
  if (/^\/wholesale\/?$/i.test(u.pathname) && text) {
    const k = new URL(keywordUrl(text));
    u.searchParams.delete("SearchText");
    u.pathname = k.pathname;
  }
  return u.toString();
}

export function normalizeInput(
  raw: RawInput | null | undefined,
): NormalizedInput {
  const r: RawInput = { ...DEFAULT_INPUT, ...(raw ?? {}) };

  const searches = new Map<string, SearchQuery>();
  for (const k of entries(r.keywords)) {
    const url = keywordUrl(k);
    if (url.endsWith("wholesale-.html")) continue;
    searches.set(url, { keyword: k, url });
  }
  for (const s of entries(r.searchUrls)) {
    const url = parseSearchUrl(s);
    searches.set(url, { keyword: null, url });
  }
  const productIds = [...new Set(entries(r.productIds).map(parseProductId))];
  if (!searches.size && !productIds.length)
    throw new InputError(
      'Add at least one keyword (e.g. "wireless earbuds"), search URL or product ID.',
    );

  const maxPages = toInt(r.maxPagesPerKeyword, "maxPagesPerKeyword") ?? 1;
  if (maxPages < 1) throw new InputError("maxPagesPerKeyword must be >= 1.");

  const sort = String(r.sort || DEFAULT_INPUT.sort) as SearchSort;
  if (!SORTS.includes(sort))
    throw new InputError(`sort must be one of ${SORTS.join(", ")}.`);

  const maxReviews =
    toInt(r.maxReviewsPerProduct, "maxReviewsPerProduct") ??
    DEFAULT_INPUT.maxReviewsPerProduct;
  if (maxReviews < 1)
    throw new InputError("maxReviewsPerProduct must be >= 1.");
  const topN =
    toInt(r.reviewsForTopProducts, "reviewsForTopProducts") ??
    DEFAULT_INPUT.reviewsForTopProducts;
  if (topN < 0) throw new InputError("reviewsForTopProducts must be >= 0.");

  let shipTo = String(r.shipTo || DEFAULT_INPUT.shipTo)
    .trim()
    .toUpperCase();
  if (shipTo === "UK") shipTo = "GB";
  if (!/^[A-Z]{2}$/.test(shipTo))
    throw new InputError(`shipTo "${shipTo}" must be a 2-letter country code.`);
  const currency = String(r.currency || DEFAULT_INPUT.currency)
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency))
    throw new InputError(
      `currency "${currency}" must be a 3-letter code like USD.`,
    );
  const language = String(r.language || DEFAULT_INPUT.language)
    .trim()
    .toLowerCase()
    .slice(0, 2);
  if (!/^[a-z]{2}$/.test(language))
    throw new InputError(
      `language "${String(r.language)}" must be a code like en.`,
    );

  return {
    searches: [...searches.values()],
    maxPages: Math.min(maxPages, MAX_SEARCH_PAGES),
    sort,
    productIds,
    includeReviews: r.includeReviews !== false,
    maxReviewsPerProduct: Math.min(maxReviews, MAX_REVIEWS_PER_PRODUCT),
    reviewsForTopProducts: topN,
    translateReviews: r.translateReviews === true,
    shipTo,
    currency,
    language,
    onlyNew: r.onlyNew === true,
  };
}

/** Cookie that sets ship-to country, currency and site language. */
export function localeCookie(
  i: Pick<NormalizedInput, "shipTo" | "currency" | "language">,
  locale: string,
): string {
  return `aep_usuc_f=site=glo&c_tp=${i.currency}&region=${i.shipTo}&b_locale=${locale}`;
}
