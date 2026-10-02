import type { HttpClient } from "./http.js";
import type { AppInfo, ReviewSource, SourceQuery } from "./source.js";
import { appleAppUrl, type RawReview } from "./review.js";

/** Reviews per userReviewsRow request (the endpoint accepts up to ~500). */
export const APPLE_PAGE_SIZE = 200;
/** The RSS feed (used only for app versions) stops after 10 pages of 50. */
export const APPLE_RSS_MAX_PAGES = 10;

/** Review sort codes: 0 = most recent, 1 = most helpful. */
const SORT = { newest: 0, mostRelevant: 1 } as const;

export const ITUNES_UA = "iTunes/12.12 (Macintosh; OS X 13.0)";

interface UserReview {
  userReviewId?: string | number;
  body?: string;
  date?: string;
  name?: string;
  rating?: number;
  title?: string;
  voteCount?: number;
  voteSum?: number;
  developerResponse?: { body?: string; modified?: string };
}

export const lookupUrl = (id: string, country: string, language: string) => {
  const key = id.startsWith("bundle:") ? "bundleId" : "id";
  const value = id.replace(/^bundle:/, "");
  return `https://itunes.apple.com/lookup?${key}=${encodeURIComponent(value)}&country=${country}&lang=${language}&entity=software`;
};

export const reviewsUrl = (
  id: string,
  country: string,
  sort: SourceQuery["sort"],
  start: number,
  end: number,
) =>
  `https://itunes.apple.com/WebObjects/MZStore.woa/wa/userReviewsRow?id=${id}&displayable-kind=11&startIndex=${start}&endIndex=${end}&sort=${SORT[sort]}&cc=${country}`;

export const rssUrl = (id: string, country: string, page: number) =>
  `https://itunes.apple.com/${country}/rss/customerreviews/page=${page}/id=${id}/sortby=mostrecent/json`;

export function parseLookup(text: string): AppInfo | null {
  const body = JSON.parse(text) as {
    results?: { trackId?: number; trackName?: string; kind?: string }[];
  };
  const app = body.results?.find((r) => r.trackId);
  if (!app) return null;
  return { id: String(app.trackId), name: app.trackName ?? null };
}

export function parseUserReviews(
  text: string,
  appId: string,
  country: string,
): { reviews: RawReview[]; rawCount: number } {
  if (!text.trimStart().startsWith("{"))
    throw new Error(
      `App Store returned a non-JSON reviews response: ${text.slice(0, 100)}`,
    );
  const body = JSON.parse(text) as { userReviewList?: UserReview[] };
  const list = body.userReviewList ?? [];
  const out: RawReview[] = [];
  for (const r of list) {
    if (r.userReviewId === undefined || !r.date) continue;
    const rating = Number(r.rating);
    if (!Number.isFinite(rating)) continue;
    out.push({
      reviewId: String(r.userReviewId),
      rating,
      title: r.title?.trim() || null,
      text: r.body ?? "",
      author: r.name ?? null,
      date: new Date(r.date).toISOString(),
      appVersion: null,
      developerReply: r.developerResponse?.body ?? null,
      developerReplyDate: r.developerResponse?.modified
        ? new Date(r.developerResponse.modified).toISOString()
        : null,
      helpfulCount: typeof r.voteSum === "number" ? r.voteSum : null,
      url: `${appleAppUrl(appId, country)}?see-all=reviews`,
    });
  }
  return { reviews: out, rawCount: list.length };
}

type Label = { label?: string };
interface RssEntry {
  id?: Label;
  updated?: Label;
  "im:version"?: Label;
}

/** Map reviewId -> app version from one RSS page, plus the oldest date seen. */
export function parseRssVersions(text: string): {
  versions: Map<string, string>;
  oldest: string | null;
  count: number;
} {
  const body = JSON.parse(text) as { feed?: { entry?: RssEntry | RssEntry[] } };
  let entries = body.feed?.entry ?? [];
  if (!Array.isArray(entries)) entries = [entries];
  const versions = new Map<string, string>();
  let oldest: string | null = null;
  for (const e of entries) {
    const id = e.id?.label;
    const v = e["im:version"]?.label;
    if (id && v) versions.set(id, v);
    const d = e.updated?.label;
    if (d) {
      const iso = new Date(d).toISOString();
      if (!oldest || iso < oldest) oldest = iso;
    }
  }
  return { versions, oldest, count: entries.length };
}

export class AppleSource implements ReviewSource {
  constructor(private readonly http: HttpClient) {}

  async resolve(id: string, q: SourceQuery): Promise<AppInfo | null> {
    const res = await this.http.request({
      url: lookupUrl(id, q.country, q.language),
    });
    return parseLookup(res.text);
  }

  async *reviews(app: AppInfo, q: SourceQuery): AsyncGenerator<RawReview> {
    const versions = new RssVersions(this.http, app.id, q.country);
    for (let start = 0; ; start += APPLE_PAGE_SIZE) {
      const res = await this.http.request(
        {
          url: reviewsUrl(
            app.id,
            q.country,
            q.sort,
            start,
            start + APPLE_PAGE_SIZE,
          ),
          // Without an iTunes user agent this endpoint serves an HTML page.
          headers: { "user-agent": ITUNES_UA, accept: "application/json" },
        },
        [404],
      );
      // 404 = no (more) reviews for this app in this storefront.
      if (res.status === 404) return;
      const { reviews, rawCount } = parseUserReviews(
        res.text,
        app.id,
        q.country,
      );
      for (const r of reviews) {
        // Lazy: only reviews the caller actually consumes cost RSS requests.
        r.appVersion = await versions.get(r);
        yield r;
      }
      if (rawCount < APPLE_PAGE_SIZE) return;
    }
  }
}

/**
 * The userReviewsRow endpoint has no app version, but the RSS feed does for
 * the ~500 most recent reviews. Fetch RSS pages lazily, only as far back as
 * the reviews we actually emit. Best effort: failures leave versions null.
 */
export class RssVersions {
  private readonly map = new Map<string, string>();
  private page = 0;
  private oldest: string | null = null;
  private done = false;

  constructor(
    private readonly http: HttpClient,
    private readonly appId: string,
    private readonly country: string,
  ) {}

  async get(r: Pick<RawReview, "reviewId" | "date">): Promise<string | null> {
    while (
      !this.map.has(r.reviewId) &&
      !this.done &&
      (this.oldest === null || r.date >= this.oldest)
    ) {
      await this.next();
    }
    return this.map.get(r.reviewId) ?? null;
  }

  private async next(): Promise<void> {
    if (this.page >= APPLE_RSS_MAX_PAGES) {
      this.done = true;
      return;
    }
    this.page += 1;
    try {
      const res = await this.http.request(
        { url: rssUrl(this.appId, this.country, this.page) },
        [400, 404],
      );
      if (res.status !== 200) {
        this.done = true;
        return;
      }
      const { versions, oldest, count } = parseRssVersions(res.text);
      for (const [k, v] of versions) this.map.set(k, v);
      if (oldest) this.oldest = oldest;
      if (count === 0) this.done = true;
    } catch {
      this.done = true;
    }
  }
}
