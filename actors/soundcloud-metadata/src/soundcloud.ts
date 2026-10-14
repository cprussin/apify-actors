import type { ClientIdProvider } from "./client-id.js";
import { HttpClient, HttpError } from "./http.js";
import type { RawObject } from "./item.js";

export const API_BASE = "https://api-v2.soundcloud.com";

/** How many results one search request asks for (SoundCloud caps it ~200). */
export const SEARCH_PAGE_SIZE = 200;

export type SearchType = "tracks" | "users" | "playlists";

export class SoundCloudError extends Error {}

interface SearchResponse {
  collection?: unknown[];
  total_results?: number;
  next_href?: string | null;
}

/** Builds an api-v2 URL with the client_id query param set. */
function withClientId(url: string, clientId: string): string {
  const u = new URL(url, API_BASE);
  u.searchParams.set("client_id", clientId);
  return u.toString();
}

/**
 * Public SoundCloud api-v2 client. Injects the anonymous `client_id` on every
 * request and, on a 401 (SoundCloud rotated it), re-extracts a fresh id and
 * retries once.
 */
export class SoundCloudClient {
  constructor(
    private readonly http: HttpClient,
    private readonly clientId: ClientIdProvider,
  ) {}

  /** GET an api-v2 path, parsed as JSON. `accept` statuses are returned, not thrown. */
  private async getJson<T>(
    path: string,
    accept: number[] = [],
  ): Promise<{ status: number; data: T | null }> {
    let id = await this.clientId.get();
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.http.request(
        {
          url: withClientId(path, id),
          headers: { accept: "application/json" },
        },
        [401, ...accept],
      );
      if (res.status === 401) {
        // client_id rotated or revoked: refresh once, then retry.
        if (attempt === 0) {
          id = await this.clientId.refresh(id);
          continue;
        }
        throw new SoundCloudError(
          "SoundCloud rejected the client_id twice (HTTP 401) after refreshing it.",
        );
      }
      if (accept.includes(res.status))
        return { status: res.status, data: null };
      try {
        return { status: res.status, data: JSON.parse(res.text) as T };
      } catch {
        throw new SoundCloudError(
          `SoundCloud did not return JSON for ${path.slice(0, 120)}.`,
        );
      }
    }
    // Unreachable: the loop either returns or throws.
    throw new SoundCloudError("Request failed.");
  }

  /** Resolve a SoundCloud URL to its object, or `null` if not found (404). */
  async resolve(url: string): Promise<RawObject | null> {
    const path = `/resolve?url=${encodeURIComponent(url)}`;
    const { status, data } = await this.getJson<RawObject>(path, [404]);
    if (status === 404) return null;
    return data;
  }

  /**
   * Keyword search of one type, newest page first, up to `max` items.
   * Pages via offset until `max` or the results run out.
   */
  async search(
    type: SearchType,
    query: string,
    max: number,
  ): Promise<RawObject[]> {
    const out: RawObject[] = [];
    let offset = 0;
    while (out.length < max) {
      const limit = Math.min(SEARCH_PAGE_SIZE, max - out.length);
      const path =
        `/search/${type}?q=${encodeURIComponent(query)}` +
        `&limit=${limit}&offset=${offset}`;
      const { data } = await this.getJson<SearchResponse>(path);
      const page = (data?.collection ?? []).filter(
        (x): x is RawObject => !!x && typeof x === "object",
      );
      if (!page.length) break;
      out.push(...page);
      offset += page.length;
      if (!data?.next_href) break;
    }
    return out.slice(0, max);
  }
}

export { HttpError };
