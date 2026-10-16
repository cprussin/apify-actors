import type { HttpClient } from "./http.js";
import { BASE, fromOembed, profileUrl, type Item } from "./item.js";
import {
  parseDeviationPage,
  parseGalleryPage,
  parseProfilePage,
  parseRss,
  parseSearchPage,
  parseWatchers,
  type ListPage,
  type RssPage,
} from "./parse.js";
import type { RawOembed } from "./raw.js";

export const BACKEND = "https://backend.deviantart.com";

/** Deviations per page (fixed by DeviantArt). */
export const SEARCH_PAGE_SIZE = 24;
export const GALLERY_PAGE_SIZE = 10;
export const RSS_PAGE_SIZE = 60;

export class DeviantArtError extends Error {}

const HTML = { accept: "text/html,application/xhtml+xml" };

/**
 * DeviantArt's public, logged-out pages (robots.txt-allowed paths only) plus
 * the backend oEmbed and RSS endpoints as fallbacks. Never calls the internal
 * `_puppy` API, `/users/*?` or any `cursor=` URL, and never fetches images.
 */
export class DeviantArtClient {
  private readonly watchers = new Map<string, Promise<number | null>>();

  constructor(private readonly http: HttpClient) {}

  private async html(url: string): Promise<string | null> {
    const res = await this.http.get(url, [404, 410], HTML);
    return res.status === 200 ? res.text : null;
  }

  /** One search results page (1-based), or null if it had no parseable state. */
  async searchPage(query: string, page: number): Promise<ListPage | null> {
    const url =
      `${BASE}/search?q=${encodeURIComponent(query)}` +
      (page > 1 ? `&page=${page}` : "");
    const html = await this.html(url);
    return html === null ? null : parseSearchPage(html, `search:${query}`);
  }

  /**
   * One gallery page (newest first). `undefined` when the user does not
   * exist (404); null when the page had no parseable state.
   */
  async galleryPage(
    username: string,
    page: number,
  ): Promise<ListPage | null | undefined> {
    const url =
      `${profileUrl(username)}/gallery` + (page > 1 ? `?page=${page}` : "");
    const html = await this.html(url);
    if (html === null) return undefined;
    return parseGalleryPage(html, username);
  }

  /** A profile item; `undefined` for 404, null when unparseable. */
  async profile(username: string): Promise<Item | null | undefined> {
    const html = await this.html(profileUrl(username));
    if (html === null) return undefined;
    const watchers = parseWatchers(html);
    this.watchers.set(username.toLowerCase(), Promise.resolve(watchers));
    return parseProfilePage(html, username);
  }

  /** A deviation from its page; `undefined` for 404, null when unparseable. */
  async deviation(
    url: string,
    id: number | null,
    source: string,
  ): Promise<Item | null | undefined> {
    const html = await this.html(url);
    if (html === null) return undefined;
    return parseDeviationPage(html, id, source);
  }

  /** Author watcher count from their profile page, fetched once per author. */
  authorWatchers(username: string): Promise<number | null> {
    const key = username.toLowerCase();
    let p = this.watchers.get(key);
    if (!p) {
      p = this.html(profileUrl(username))
        .then((html) => (html ? parseWatchers(html) : null))
        .catch(() => null);
      this.watchers.set(key, p);
    }
    return p;
  }

  /** oEmbed record for a deviation URL, or null if not found. */
  async oembed(url: string): Promise<RawOembed | null> {
    const res = await this.http.get(
      `${BACKEND}/oembed?url=${encodeURIComponent(url)}`,
      [404],
      { accept: "application/json" },
    );
    if (res.status === 404) return null;
    try {
      return JSON.parse(res.text) as RawOembed;
    } catch {
      throw new DeviantArtError(`oEmbed did not return JSON for ${url}.`);
    }
  }

  /** A deviation from oEmbed (fallback, partial), or null if not found. */
  async deviationViaOembed(url: string, source: string): Promise<Item | null> {
    const o = await this.oembed(url);
    return o ? fromOembed(url, o, source) : null;
  }

  /** One RSS page for a query such as `dragon` or `by:wlop`. */
  async rss(query: string, offset: number): Promise<RssPage> {
    const url =
      `${BACKEND}/rss.xml?type=deviation&q=${encodeURIComponent(query)}` +
      (offset > 0 ? `&offset=${offset}` : "");
    const res = await this.http.get(url, [], {
      accept: "application/rss+xml,application/xml",
    });
    return parseRss(res.text);
  }
}
