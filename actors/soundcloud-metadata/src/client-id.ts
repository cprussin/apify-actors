import type { HttpClient } from "./http.js";

export const HOMEPAGE = "https://soundcloud.com/";

export class ClientIdError extends Error {}

/** JS bundle URLs referenced by the homepage, in document order. */
export function extractBundleUrls(html: string): string[] {
  const urls = [
    ...html.matchAll(
      /https:\/\/a-v2\.sndcdn\.com\/assets\/[0-9a-zA-Z_.-]+\.js/g,
    ),
  ].map((m) => m[0]);
  return [...new Set(urls)];
}

/** The 32-char client_id embedded in a SoundCloud JS bundle, or null. */
export function extractClientId(js: string): string | null {
  const m = /client_id\s*[=:]\s*["']?([0-9a-zA-Z]{32})/.exec(js);
  return m ? m[1]! : null;
}

/**
 * Fetches and caches SoundCloud's anonymous `client_id`, which the public
 * api-v2 endpoints require. The id is parsed from the JS bundles the homepage
 * references (the id usually lives in one of the last bundles, so they are
 * tried newest-first). SoundCloud rotates it, so `refresh()` re-extracts it
 * (callers do this on a 401).
 */
export class ClientIdProvider {
  private cached?: string;
  private inflight?: Promise<string>;

  constructor(
    private readonly http: HttpClient,
    /** Seed a known id (tests, env override); still refreshable on 401. */
    seed?: string,
  ) {
    this.cached = seed;
  }

  /** The current client_id, extracting it on first use. */
  async get(): Promise<string> {
    if (this.cached) return this.cached;
    return this.extract();
  }

  /** Force a fresh extraction (e.g. after a 401) and return the new id. */
  async refresh(stale?: string): Promise<string> {
    // Don't thrash: if another caller already refreshed, reuse that.
    if (this.cached && this.cached !== stale) return this.cached;
    this.cached = undefined;
    return this.extract();
  }

  private extract(): Promise<string> {
    this.inflight ??= this.doExtract().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private async doExtract(): Promise<string> {
    const home = await this.http.request({
      url: HOMEPAGE,
      headers: { accept: "text/html" },
    });
    const bundles = extractBundleUrls(home.text);
    if (!bundles.length)
      throw new ClientIdError(
        "No SoundCloud JS bundles found on the homepage; the page layout may have changed.",
      );
    // The client_id is typically in a later bundle; try newest-first.
    for (const url of bundles.reverse()) {
      let js: string;
      try {
        js = (await this.http.request({ url })).text;
      } catch {
        continue;
      }
      const id = extractClientId(js);
      if (id) {
        this.cached = id;
        return id;
      }
    }
    throw new ClientIdError(
      "Could not extract a client_id from SoundCloud's JS bundles.",
    );
  }
}
