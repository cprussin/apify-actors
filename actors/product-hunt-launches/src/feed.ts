/**
 * Token-free source: Product Hunt's public Atom feed (the current launches,
 * optionally per topic) plus the public embed badges on api.producthunt.com,
 * which carry each launch's live upvote count and its top-5 daily rank.
 * Neither is behind the Cloudflare challenge that guards www.producthunt.com.
 */
import { HttpError, mapLimit, type HttpClient } from "./http.js";
import type { Launch, Period, Person } from "./launch.js";

export const FEED_URL = "https://www.producthunt.com/feed";
export const BADGE_BASE = "https://api.producthunt.com/widgets/embed-image/v1";

export interface FeedEntry {
  id: string;
  name: string;
  tagline: string | null;
  url: string;
  redirectUrl: string | null;
  createdAt: string | null;
  author: string | null;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code =
        e[1] === "x" || e[1] === "X"
          ? parseInt(e.slice(2), 16)
          : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const tag = (xml: string, name: string): string | null => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(
    xml,
  );
  return m ? m[1]! : null;
};

const stripUtm = (u: string): string => {
  try {
    const url = new URL(u);
    for (const k of [...url.searchParams.keys()])
      if (k.startsWith("utm_") || k === "app_id") url.searchParams.delete(k);
    return url.toString();
  } catch {
    return u;
  }
};

/** Parses the Atom feed at https://www.producthunt.com/feed. */
export function parseFeed(xml: string): FeedEntry[] {
  if (!/<feed[\s>]/.test(xml))
    throw new Error("Product Hunt feed response is not an Atom feed.");
  const out: FeedEntry[] = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1]!;
    const id = /Post\/(\d+)/.exec(tag(e, "id") ?? "")?.[1];
    // Some titles end in a dangling ":" (an empty version suffix).
    const name = decodeEntities(tag(e, "title") ?? "")
      .trim()
      .replace(/\s*:$/, "");
    const link = /<link[^>]*rel="alternate"[^>]*href="([^"]+)"/.exec(e)?.[1];
    if (!id || !name || !link) continue;
    // <content> is escaped HTML: unescape once to get the HTML, then read it.
    const html = decodeEntities(tag(e, "content") ?? "");
    const firstP = /<p>([\s\S]*?)<\/p>/.exec(html)?.[1] ?? "";
    const tagline =
      decodeEntities(firstP.replace(/<[^>]+>/g, ""))
        .replace(/\s+/g, " ")
        .trim() || null;
    const redirect = /href="(https:\/\/www\.producthunt\.com\/r\/[^"]+)"/.exec(
      html,
    )?.[1];
    const published = tag(e, "published")?.trim();
    const author = tag(tag(e, "author") ?? "", "name");
    out.push({
      id,
      name,
      tagline,
      url: stripUtm(decodeEntities(link)),
      redirectUrl: redirect ? stripUtm(decodeEntities(redirect)) : null,
      createdAt:
        published && !Number.isNaN(Date.parse(published))
          ? new Date(published).toISOString()
          : null,
      author: author ? decodeEntities(author).trim() || null : null,
    });
  }
  return out;
}

/** Upvote count from the "Featured on Product Hunt" badge SVG. */
export function parseVotesBadge(svg: string): number | null {
  // The count is the only purely numeric <tspan>.
  for (const m of svg.matchAll(/<tspan[^>]*>\s*([\d,.]+)\s*<\/tspan>/g)) {
    const n = Number(m[1]!.replace(/,/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Rank from a "#3 Product of the Day/Week/Month" badge SVG. */
export function parseRankBadge(svg: string): number | null {
  const m = /#(\d+)\s+Product of the (?:Day|Week|Month)/i.exec(svg);
  return m ? Number(m[1]) : null;
}

const hunterFromName = (name: string | null): Person | null =>
  name
    ? {
        id: null,
        name,
        username: null,
        headline: null,
        profileUrl: null,
        twitterUsername: null,
        websiteUrl: null,
        avatarUrl: null,
      }
    : null;

export function entryToLaunch(
  e: FeedEntry,
  topics: string[],
  scrapedAt: string,
): Launch {
  return {
    id: e.id,
    name: e.name,
    tagline: e.tagline,
    description: null,
    slug: null,
    url: e.url,
    website: null,
    websiteRedirectUrl: e.redirectUrl,
    topics,
    votesCount: null,
    commentsCount: null,
    reviewsCount: null,
    reviewsRating: null,
    dailyRank: null,
    weeklyRank: null,
    monthlyRank: null,
    launchDate: null,
    createdAt: e.createdAt,
    featuredAt: null,
    featured: null,
    thumbnail: null,
    media: [],
    hunter: hunterFromName(e.author),
    makers: null,
    pricingType: null,
    productLinks: [],
    source: "feed",
    scrapedAt,
  };
}

export class FeedSource {
  /** Cache-buster so badge counts are live, not up to 4 h old CDN copies. */
  private readonly bust = Date.now().toString(36);

  constructor(
    private readonly http: HttpClient,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  async entries(topic?: string): Promise<FeedEntry[]> {
    const url = topic
      ? `${FEED_URL}?category=${encodeURIComponent(topic)}`
      : FEED_URL;
    const res = await this.http.request({
      url,
      headers: { accept: "application/atom+xml,application/xml;q=0.9" },
    });
    return parseFeed(res.text);
  }

  private async badge(id: string, period?: Period): Promise<string | null> {
    const path = period
      ? `top-post-badge.svg?post_id=${encodeURIComponent(id)}&period=${period}`
      : `featured.svg?post_id=${encodeURIComponent(id)}`;
    const res = await this.http.request(
      {
        url: `${BADGE_BASE}/${path}&theme=light&_=${this.bust}`,
        maxRetries: 2,
      },
      [404],
    );
    return res.status === 404 ? null : res.text;
  }

  /**
   * Adds live votes and top-5 daily/weekly/monthly ranks from the badges.
   * Weekly and monthly badges are only requested for launches with a daily
   * rank (a launch can't win the week without placing in its day).
   */
  async enrich(launches: Launch[], concurrency = 6): Promise<void> {
    let failures = 0;
    await mapLimit(launches, concurrency, async (l) => {
      try {
        const featured = await this.badge(l.id);
        if (featured !== null) l.votesCount = parseVotesBadge(featured);
        const daily = await this.badge(l.id, "daily");
        l.dailyRank = daily ? parseRankBadge(daily) : null;
        if (l.dailyRank !== null) {
          const [w, mo] = await Promise.all([
            this.badge(l.id, "weekly"),
            this.badge(l.id, "monthly"),
          ]);
          l.weeklyRank = w ? parseRankBadge(w) : null;
          l.monthlyRank = mo ? parseRankBadge(mo) : null;
        }
      } catch (e) {
        failures += 1;
        if (failures <= 3)
          this.log(
            `Could not read votes for launch ${l.id}: ${e instanceof HttpError ? `HTTP ${e.status}` : (e as Error).message}`,
          );
      }
    });
  }
}
