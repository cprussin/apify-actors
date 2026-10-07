import { appleAppUrl, EMPTY_APP, isoDate, type App } from "./app.js";
import type { Chart } from "./categories.js";
import type { HttpClient } from "./http.js";

/** The Search API returns at most 200 results per query. */
export const APPLE_SEARCH_MAX = 200;
/** Both chart feeds stop at 100 entries. */
export const APPLE_CHART_MAX = 100;
/** IDs per /lookup request. */
export const LOOKUP_BATCH = 100;

export const searchUrl = (term: string, country: string, limit: number) =>
  `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=software&country=${country}&limit=${limit}`;

/** IDs are numeric track IDs or "bundle:<bundle ID>"; one kind per call. */
export function lookupUrl(ids: string[], country: string): string {
  const bundle = ids[0]?.startsWith("bundle:");
  const values = ids.map((i) => i.replace(/^bundle:/, ""));
  return `https://itunes.apple.com/lookup?${bundle ? "bundleId" : "id"}=${values.map(encodeURIComponent).join(",")}&country=${country}&entity=software`;
}

const MARKETING_SLUG: Partial<Record<Chart, string>> = {
  topFree: "top-free",
  topPaid: "top-paid",
};
const LEGACY_SLUG: Record<Chart, string> = {
  topFree: "topfreeapplications",
  topPaid: "toppaidapplications",
  topGrossing: "topgrossingapplications",
};

/** Apple Marketing Tools RSS feed (top free / top paid, no genres). */
export const marketingChartUrl = (country: string, chart: Chart) =>
  MARKETING_SLUG[chart]
    ? `https://rss.marketingtools.apple.com/api/v2/${country}/apps/${MARKETING_SLUG[chart]}/100/apps.json`
    : null;

/** iTunes RSS feed: also top grossing and per-genre charts. */
export const legacyChartUrl = (
  country: string,
  chart: Chart,
  genre: string | null,
  limit: number,
) =>
  `https://itunes.apple.com/${country}/rss/${LEGACY_SLUG[chart]}/limit=${limit}${genre ? `/genre=${genre}` : ""}/json`;

interface Software {
  wrapperType?: string;
  kind?: string;
  trackId?: number;
  trackName?: string;
  bundleId?: string;
  artistId?: number;
  artistName?: string;
  artistViewUrl?: string;
  sellerUrl?: string;
  trackViewUrl?: string;
  artworkUrl512?: string;
  artworkUrl100?: string;
  description?: string;
  primaryGenreName?: string;
  primaryGenreId?: number;
  genres?: string[];
  price?: number;
  currency?: string;
  averageUserRating?: number;
  userRatingCount?: number;
  version?: string;
  releaseDate?: string;
  currentVersionReleaseDate?: string;
  releaseNotes?: string;
  trackContentRating?: string;
  contentAdvisoryRating?: string;
  fileSizeBytes?: string;
  minimumOsVersion?: string;
  languageCodesISO2A?: string[];
  screenshotUrls?: string[];
  ipadScreenshotUrls?: string[];
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const nonEmpty = <T>(a: T[] | undefined): T[] | null =>
  a && a.length ? a : null;
const stripUo = (u: string) => u.replace(/[?&]uo=\d+$/, "");

export function mapSoftware(r: Software, country: string): App | null {
  if (!r.trackId) return null;
  if (r.wrapperType && r.wrapperType !== "software") return null;
  const id = String(r.trackId);
  const size = Number(r.fileSizeBytes);
  return {
    ...EMPTY_APP,
    store: "apple",
    appId: id,
    bundleId: r.bundleId ?? null,
    name: r.trackName ?? null,
    developer: r.artistName ?? null,
    developerId: r.artistId ? String(r.artistId) : null,
    developerUrl: r.artistViewUrl ? stripUo(r.artistViewUrl) : null,
    url: r.trackViewUrl ? stripUo(r.trackViewUrl) : appleAppUrl(id, country),
    iconUrl: r.artworkUrl512 ?? r.artworkUrl100 ?? null,
    description: r.description ?? null,
    category: r.primaryGenreName ?? null,
    categoryId: r.primaryGenreId ? String(r.primaryGenreId) : null,
    genres: nonEmpty(r.genres),
    price: num(r.price),
    currency: r.currency ?? null,
    free: num(r.price) === null ? null : r.price === 0,
    rating: num(r.averageUserRating),
    ratingCount: num(r.userRatingCount),
    version: r.version ?? null,
    releaseDate: isoDate(r.releaseDate),
    updatedDate: isoDate(r.currentVersionReleaseDate),
    releaseNotes: r.releaseNotes ?? null,
    contentRating: r.trackContentRating ?? r.contentAdvisoryRating ?? null,
    sizeBytes: Number.isFinite(size) && size > 0 ? size : null,
    minOsVersion: r.minimumOsVersion ?? null,
    languages: nonEmpty(r.languageCodesISO2A),
    screenshots: nonEmpty(r.screenshotUrls) ?? nonEmpty(r.ipadScreenshotUrls),
    website: r.sellerUrl ?? null,
  };
}

function parseJson(text: string, what: string): unknown {
  if (!text.trimStart().startsWith("{"))
    throw new Error(`Apple returned a non-JSON ${what}: ${text.slice(0, 100)}`);
  return JSON.parse(text);
}

/** Search API or /lookup response -> apps, in response order. */
export function parseResults(text: string, country: string): App[] {
  const body = parseJson(text, "response") as { results?: Software[] };
  const out: App[] = [];
  for (const r of body.results ?? []) {
    const app = mapSoftware(r, country);
    if (app) out.push(app);
  }
  return out;
}

/** Minimal app data from a chart feed, used if /lookup misses an app. */
export type ChartEntry = Pick<
  App,
  | "store"
  | "appId"
  | "bundleId"
  | "name"
  | "developer"
  | "url"
  | "iconUrl"
  | "category"
  | "categoryId"
  | "releaseDate"
>;

export function parseMarketingChart(text: string): ChartEntry[] {
  const body = parseJson(text, "chart feed") as {
    feed?: {
      results?: {
        id?: string;
        name?: string;
        artistName?: string;
        url?: string;
        artworkUrl100?: string;
        releaseDate?: string;
        genres?: { name?: string; genreId?: string }[];
      }[];
    };
  };
  return (body.feed?.results ?? [])
    .filter((r) => r.id)
    .map((r) => ({
      store: "apple",
      appId: r.id!,
      bundleId: null,
      name: r.name ?? null,
      developer: r.artistName ?? null,
      url: r.url ?? "",
      iconUrl: r.artworkUrl100 ?? null,
      category: r.genres?.[0]?.name ?? null,
      categoryId: r.genres?.[0]?.genreId ?? null,
      releaseDate: isoDate(r.releaseDate),
    }));
}

type Label = { label?: string; attributes?: Record<string, string> };
interface LegacyEntry {
  "im:name"?: Label;
  "im:image"?: Label[];
  "im:artist"?: Label;
  "im:releaseDate"?: Label;
  id?: Label;
  category?: Label;
}

export function parseLegacyChart(text: string): ChartEntry[] {
  const body = parseJson(text, "chart feed") as {
    feed?: { entry?: LegacyEntry | LegacyEntry[] };
  };
  let entries = body.feed?.entry ?? [];
  if (!Array.isArray(entries)) entries = [entries];
  const out: ChartEntry[] = [];
  for (const e of entries) {
    const id = e.id?.attributes?.["im:id"];
    if (!id) continue;
    const images = e["im:image"] ?? [];
    out.push({
      store: "apple",
      appId: id,
      bundleId: e.id?.attributes?.["im:bundleId"] ?? null,
      name: e["im:name"]?.label ?? null,
      developer: e["im:artist"]?.label ?? null,
      url: e.id?.label ? stripUo(e.id.label) : "",
      iconUrl: images[images.length - 1]?.label ?? null,
      category: e.category?.attributes?.label ?? null,
      categoryId: e.category?.attributes?.["im:id"] ?? null,
      releaseDate: isoDate(e["im:releaseDate"]?.label),
    });
  }
  return out;
}

export class AppleClient {
  constructor(
    private readonly http: HttpClient,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  /**
   * Keyword search: all results (up to 200), in Apple's ranking order.
   * Always asks for the maximum: Apple drops ~15% of results after applying
   * `limit`, and the order of the tail shifts with it, so ranks are only
   * stable at a fixed limit.
   */
  async search(term: string, country: string): Promise<App[]> {
    const res = await this.http.request({
      url: searchUrl(term, country, APPLE_SEARCH_MAX),
    });
    return parseResults(res.text, country);
  }

  /**
   * Look up apps by numeric ID or "bundle:<bundle ID>". Returns a map keyed
   * by the requested reference; missing apps are absent.
   */
  async lookup(refs: string[], country: string): Promise<Map<string, App>> {
    const out = new Map<string, App>();
    const ids = refs.filter((r) => !r.startsWith("bundle:"));
    const bundles = refs.filter((r) => r.startsWith("bundle:"));
    for (const group of [ids, bundles]) {
      for (let i = 0; i < group.length; i += LOOKUP_BATCH) {
        const batch = group.slice(i, i + LOOKUP_BATCH);
        const res = await this.http.request({
          url: lookupUrl(batch, country),
        });
        for (const app of parseResults(res.text, country)) {
          out.set(app.appId, app);
          if (app.bundleId) out.set(`bundle:${app.bundleId}`, app);
        }
      }
    }
    return new Map(refs.filter((r) => out.has(r)).map((r) => [r, out.get(r)!]));
  }

  /** Top chart with full app metadata, in chart order. */
  async chart(
    chart: Chart,
    genre: string | null,
    country: string,
    limit: number,
  ): Promise<App[]> {
    limit = Math.min(limit, APPLE_CHART_MAX);
    let entries: ChartEntry[] | null = null;
    const marketing = genre ? null : marketingChartUrl(country, chart);
    if (marketing) {
      try {
        const res = await this.http.request({ url: marketing });
        entries = parseMarketingChart(res.text);
      } catch (e) {
        this.log(
          `Apple Marketing Tools feed failed (${(e as Error).message.slice(0, 120)}); using the iTunes RSS feed.`,
        );
      }
    }
    if (!entries) {
      const res = await this.http.request({
        url: legacyChartUrl(country, chart, genre, limit),
      });
      entries = parseLegacyChart(res.text);
    }
    entries = entries.slice(0, limit);
    const full = await this.lookup(
      entries.map((e) => e.appId),
      country,
    );
    return entries.map(
      (e) =>
        full.get(e.appId) ?? {
          ...EMPTY_APP,
          ...e,
          url: e.url || appleAppUrl(e.appId, country),
        },
    );
  }
}
