import { BlockedError, isChallenge, ParseError } from "./challenge.js";

export const SEARCH_PAGE_SIZE = 60;
/** AliExpress never serves more than 60 result pages per search. */
export const MAX_SEARCH_PAGES = 60;

export type SearchSort = "default" | "orders" | "priceAsc" | "priceDesc";

const SORT_PARAM: Record<SearchSort, string | null> = {
  default: null,
  orders: "total_tranpro_desc",
  priceAsc: "price_asc",
  priceDesc: "price_desc",
};

export interface Product {
  type: "product";
  productId: string;
  title: string;
  url: string;
  imageUrl: string | null;
  images: string[];
  price: number | null;
  originalPrice: number | null;
  discountPercent: number | null;
  currency: string | null;
  formattedPrice: string | null;
  soldCount: number | null;
  soldText: string | null;
  rating: number | null;
  storeName: string | null;
  isAd: boolean;
  isChoice: boolean | null;
  shipping: string | null;
  delivery: string | null;
  sellingPoints: string[];
  categoryIds: string[];
  listedAt: string | null;
  searchKeyword: string | null;
  searchUrl: string;
  searchPage: number;
  position: number;
  shipTo: string | null;
  scrapedAt: string;
}

export interface SearchPage {
  products: Omit<
    Product,
    "searchKeyword" | "searchUrl" | "searchPage" | "position" | "scrapedAt"
  >[];
  totalResults: number | null;
  /** AliExpress says there are no further pages. */
  finished: boolean;
  currency: string | null;
  shipTo: string | null;
}

/** "phone case" → https://www.aliexpress.com/w/wholesale-phone-case.html */
export function keywordUrl(keyword: string): string {
  const slug = keyword
    .trim()
    .replace(/[\s/\\?#%&+]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `https://www.aliexpress.com/w/wholesale-${encodeURIComponent(slug).replace(/%2D/gi, "-")}.html`;
}

/** Sets page (and sort, unless the URL already has one). */
export function pageUrl(base: string, page: number, sort: SearchSort): string {
  const u = new URL(base);
  u.searchParams.set("page", String(page));
  const s = SORT_PARAM[sort];
  if (s && !u.searchParams.has("SortType")) u.searchParams.set("SortType", s);
  return u.toString();
}

/**
 * AliExpress search cards sometimes carry a "redirected" ID (e.g. 3256…) that
 * is the canonical item ID (e.g. 1005…) plus 2^51. Returns the canonical one.
 */
export function canonicalProductId(id: string): string {
  if (!/^\d{16,17}$/.test(id)) return id;
  const n = BigInt(id);
  const offset = 2n ** 51n;
  return n >= offset ? String(n - offset) : id;
}

export const productUrl = (id: string): string =>
  `https://www.aliexpress.com/item/${id}.html`;

/** "50,000+ sold" / "100K+ sold" / "10.000+ vendido(s)" / "1,2 mil" → number. */
export function parseSoldCount(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /(\d[\d.,\s]*)\s*([kKmM]|mil)?/.exec(s);
  if (!m) return null;
  let num = m[1]!.replace(/\s/g, "");
  const mult = m[2]
    ? /^k$/i.test(m[2]) || m[2] === "mil"
      ? 1000
      : 1_000_000
    : 1;
  if (mult > 1) {
    // "1.2K" / "1,2K": the separator is a decimal point.
    num = num.replace(",", ".");
    const n = Number(num);
    return Number.isFinite(n) ? Math.round(n * mult) : null;
  }
  // Without a suffix, "." and "," are thousands separators.
  const n = Number(num.replace(/[.,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Extracts the JSON assigned to window._dida_config_._init_data_. */
export function extractInitData(html: string): unknown {
  const end = html.indexOf("/*!-->init-data-end--*/");
  const start = html.indexOf("_init_data_=");
  if (start < 0 || end < 0 || end < start) return null;
  let s = html.slice(start + "_init_data_=".length, end).trim();
  // `{ data: {...} }`: a JS object literal around JSON.
  const m = /^\{\s*data\s*:\s*/.exec(s);
  if (m) s = s.slice(m[0].length).replace(/\}\s*;?\s*$/, "");
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const absUrl = (u: string | null): string | null =>
  u ? (u.startsWith("//") ? `https:${u}` : u) : null;

/** Parses one search results page. Throws BlockedError on bot checks. */
export function parseSearchPage(html: string): SearchPage {
  const init = obj(extractInitData(html));
  const fields = obj(obj(obj(obj(init.data).root).fields));
  if (!Object.keys(fields).length) {
    if (isChallenge(html) || html.length < 50_000)
      throw new BlockedError("AliExpress returned a bot-check page.");
    throw new ParseError("Search page has no embedded result data.");
  }
  const pageInfo = obj(fields.pageInfo);
  const utLog = obj(obj(pageInfo.trace).utLogMap);
  const pageCurrency = str(utLog.currency);
  const shipTo = str(utLog.ship_to_country);
  const content = obj(obj(fields.mods).itemList).content;
  const items = Array.isArray(content) ? content : [];

  const products: SearchPage["products"] = [];
  for (const raw of items) {
    const p = parseCard(obj(raw), pageCurrency);
    if (p) products.push({ ...p, shipTo });
  }
  return {
    products,
    totalResults: num(pageInfo.totalResults),
    finished: pageInfo.finished === true,
    currency: pageCurrency,
    shipTo,
  };
}

function parseCard(
  it: Obj,
  pageCurrency: string | null,
): Omit<SearchPage["products"][number], "shipTo"> | null {
  const trace = obj(it.trace);
  const ut = obj(trace.utLogMap);
  const rawId =
    str(ut.x_object_id) ?? str(it.productId) ?? str(it.redirectedId);
  const title = str(obj(it.title).displayTitle);
  if (!rawId || !title) return null;
  const productId = canonicalProductId(rawId);

  const prices = obj(it.prices);
  const sale = obj(prices.salePrice);
  const orig = obj(prices.originalPrice);
  const currency =
    str(sale.currencyCode) ?? str(orig.currencyCode) ?? pageCurrency;
  const fromCents = (v: unknown) => {
    const n = num(v);
    return n === null ? null : n / 100;
  };
  let price = num(sale.minPrice) ?? fromCents(ut.salePriceAmount);
  let originalPrice =
    num(orig.minPrice) ??
    fromCents(ut.originPriceAmount) ??
    fromCents(ut.sellerOfferPriceAmount);
  if (price === null && originalPrice !== null) price = originalPrice;
  if (originalPrice !== null && price !== null && originalPrice <= price)
    originalPrice = null;
  const discountPercent =
    num(sale.discount) ??
    (price !== null && originalPrice
      ? Math.round((1 - price / originalPrice) * 100)
      : null);

  const soldText = str(obj(it.trade).tradeDesc);
  const soldCount = num(ut.real_trade_count) ?? parseSoldCount(soldText);
  const rating =
    num(obj(it.evaluation).starRating) ?? num(ut.star_rating) ?? null;

  const sellingPoints: string[] = [];
  for (const sp of Array.isArray(it.sellingPoints) ? it.sellingPoints : []) {
    const t = str(obj(obj(sp).tagContent).tagText);
    if (t && !sellingPoints.includes(t)) sellingPoints.push(t);
  }
  const shipping =
    sellingPoints.find(
      (t) =>
        /shipping|delivery|envío|frete|livraison/i.test(t) &&
        !/^delivery:/i.test(t),
    ) ?? null;
  const delivery =
    sellingPoints.find((t) =>
      /^(delivery|entrega|livraison|lieferung)\b/i.test(t),
    ) ?? null;

  let storeName = str(obj(it.store).storeName);
  if (!storeName) {
    try {
      storeName = str(
        obj(JSON.parse(String(obj(trace.custom).p4pExtendParam ?? "{}")))
          .store_name,
      );
    } catch {
      storeName = null;
    }
  }

  const images: string[] = [];
  for (const img of Array.isArray(it.images) ? it.images : []) {
    const u = absUrl(str(obj(img).imgUrl));
    if (u && !images.includes(u)) images.push(u);
  }
  const imageUrl = absUrl(str(obj(it.image).imgUrl)) ?? images[0] ?? null;
  if (imageUrl && !images.includes(imageUrl)) images.unshift(imageUrl);

  const categoryIds = (str(ut.categoryId) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const lunch = str(it.lunchTime);
  const listedAt =
    lunch && /^\d{4}-\d{2}-\d{2}/.test(lunch) ? lunch.slice(0, 10) : null;

  return {
    type: "product",
    productId,
    title,
    url: productUrl(productId),
    imageUrl,
    images,
    price,
    originalPrice,
    discountPercent:
      discountPercent && discountPercent > 0 ? discountPercent : null,
    currency,
    formattedPrice: str(sale.formattedPrice) ?? str(ut.formatted_price),
    soldCount,
    soldText,
    rating: rating && rating > 0 ? rating : null,
    storeName,
    isAd: it.productType === "ad",
    isChoice:
      ut.isChoice === "true" ? true : ut.isChoice === "false" ? false : null,
    shipping,
    delivery,
    sellingPoints,
    categoryIds,
    listedAt,
  };
}
