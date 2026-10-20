import { gotScraping } from "got-scraping";
import type { FetchLike } from "./http.js";

/**
 * fetch()-like transport on got-scraping (browser-like TLS and generated
 * headers). Set-Cookie headers are joined with newlines. With `nextProxyUrl`,
 * each request goes through the URL it returns (used only by the local smoke
 * test in sandboxes that require an HTTPS proxy; the actor never proxies).
 */
export function gotFetch(
  nextProxyUrl?: () => Promise<string | undefined>,
): FetchLike {
  return async (url, init) => {
    const proxyUrl = nextProxyUrl ? await nextProxyUrl() : undefined;
    const res = await gotScraping({
      url,
      method: (init?.method ?? "GET") as "GET",
      headers: init?.headers,
      proxyUrl,
      signal: init?.signal,
      responseType: "buffer",
      throwHttpErrors: false,
      followRedirect: true,
      maxRedirects: 8,
      retry: { limit: 0 },
      headerGeneratorOptions: {
        browsers: [{ name: "chrome", minVersion: 120 }],
        devices: ["desktop"],
        operatingSystems: ["windows", "macos"],
      },
    });
    const header = (name: string) => {
      const v = res.headers[name.toLowerCase()];
      return Array.isArray(v) ? v.join("\n") : (v ?? null);
    };
    const body = (res.body as Buffer).toString("utf8");
    return {
      ok: res.statusCode >= 200 && res.statusCode < 300,
      status: res.statusCode,
      url: res.url,
      headers: { get: header },
      text: async () => body,
    };
  };
}
