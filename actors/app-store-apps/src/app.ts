export type Store = "apple" | "google";

/** App metadata in the unified schema shared by both stores. */
export interface App {
  store: Store;
  /** Apple numeric track ID or Google Play package name. */
  appId: string;
  /** Apple bundle ID or Google Play package name. */
  bundleId: string | null;
  name: string | null;
  developer: string | null;
  developerId: string | null;
  developerUrl: string | null;
  url: string;
  iconUrl: string | null;
  /** Short description (Google Play) or null. */
  summary: string | null;
  description: string | null;
  /** Primary category / genre name. */
  category: string | null;
  /** Apple genre ID or Google Play category ID. */
  categoryId: string | null;
  genres: string[] | null;
  price: number | null;
  currency: string | null;
  free: boolean | null;
  /** Google Play in-app purchase price range, e.g. "$0.99 - $49.99 per item". */
  inAppPurchases: string | null;
  containsAds: boolean | null;
  rating: number | null;
  ratingCount: number | null;
  /** Google Play: ratings with a written review. */
  reviewCount: number | null;
  /** Google Play: number of ratings per star, 1 to 5. */
  ratingHistogram: number[] | null;
  /** Google Play install bucket, e.g. "1,000,000+". */
  installs: string | null;
  minInstalls: number | null;
  version: string | null;
  /** ISO 8601. */
  releaseDate: string | null;
  /** ISO 8601. */
  updatedDate: string | null;
  releaseNotes: string | null;
  contentRating: string | null;
  sizeBytes: number | null;
  minOsVersion: string | null;
  languages: string[] | null;
  screenshots: string[] | null;
  website: string | null;
  developerEmail: string | null;
  privacyPolicyUrl: string | null;
}

export type RowType = "app" | "keywordRank" | "chartRank" | "error";
export type ChangeType =
  "baseline" | "new" | "up" | "down" | "same" | "dropped" | "notRanked";

/** One dataset item. App fields are null on error rows and dropped ranks. */
export interface Row extends Omit<App, "store" | "appId" | "url"> {
  type: RowType;
  store: Store | null;
  keyword: string | null;
  chart: string | null;
  chartCategory: string | null;
  rank: number | null;
  previousRank: number | null;
  /** previousRank - rank: positive = moved up. */
  rankChange: number | null;
  changeType: ChangeType | null;
  appId: string | null;
  url: string | null;
  country: string;
  /** Google Play display language; null for the App Store. */
  language: string | null;
  scrapedAt: string;
  error: string | null;
}

export const EMPTY_APP: Omit<App, "store" | "appId" | "url"> = {
  bundleId: null,
  name: null,
  developer: null,
  developerId: null,
  developerUrl: null,
  iconUrl: null,
  summary: null,
  description: null,
  category: null,
  categoryId: null,
  genres: null,
  price: null,
  currency: null,
  free: null,
  inAppPurchases: null,
  containsAds: null,
  rating: null,
  ratingCount: null,
  reviewCount: null,
  ratingHistogram: null,
  installs: null,
  minInstalls: null,
  version: null,
  releaseDate: null,
  updatedDate: null,
  releaseNotes: null,
  contentRating: null,
  sizeBytes: null,
  minOsVersion: null,
  languages: null,
  screenshots: null,
  website: null,
  developerEmail: null,
  privacyPolicyUrl: null,
};

/** Field order of every dataset item (matches dataset_schema.json). */
export const ROW_FIELDS = [
  "type",
  "store",
  "keyword",
  "chart",
  "chartCategory",
  "rank",
  "previousRank",
  "rankChange",
  "changeType",
  "appId",
  "bundleId",
  "name",
  "developer",
  "developerId",
  "developerUrl",
  "url",
  "iconUrl",
  "summary",
  "description",
  "category",
  "categoryId",
  "genres",
  "price",
  "currency",
  "free",
  "inAppPurchases",
  "containsAds",
  "rating",
  "ratingCount",
  "reviewCount",
  "ratingHistogram",
  "installs",
  "minInstalls",
  "version",
  "releaseDate",
  "updatedDate",
  "releaseNotes",
  "contentRating",
  "sizeBytes",
  "minOsVersion",
  "languages",
  "screenshots",
  "website",
  "developerEmail",
  "privacyPolicyUrl",
  "country",
  "language",
  "scrapedAt",
  "error",
] as const satisfies readonly (keyof Row)[];

export interface RowContext {
  type: RowType;
  country: string;
  language: string | null;
  scrapedAt: string;
  keyword?: string | null;
  chart?: string | null;
  chartCategory?: string | null;
  rank?: number | null;
  error?: string | null;
}

/** Build a dataset item with every field present, in schema order. */
export function makeRow(
  ctx: RowContext,
  app: { [K in keyof App]?: App[K] | null } | null,
): Row {
  const merged: Record<string, unknown> = {
    ...EMPTY_APP,
    store: null,
    appId: null,
    url: null,
    ...(app ?? {}),
    type: ctx.type,
    keyword: ctx.keyword ?? null,
    chart: ctx.chart ?? null,
    chartCategory: ctx.chartCategory ?? null,
    rank: ctx.rank ?? null,
    previousRank: null,
    rankChange: null,
    changeType: null,
    country: ctx.country,
    language: ctx.language,
    scrapedAt: ctx.scrapedAt,
    error: ctx.error ?? null,
  };
  const out: Record<string, unknown> = {};
  for (const k of ROW_FIELDS) out[k] = merged[k] ?? null;
  return out as unknown as Row;
}

export const appleAppUrl = (id: string, country: string) =>
  `https://apps.apple.com/${country}/app/id${id}`;

export const googleAppUrl = (id: string, language: string, country: string) =>
  `https://play.google.com/store/apps/details?id=${encodeURIComponent(id)}&hl=${language}&gl=${country}`;

/** ISO 8601 from a date string or epoch seconds; null if unparseable. */
export function isoDate(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v))
    return new Date(v * 1000).toISOString();
  if (typeof v !== "string" || !v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}
