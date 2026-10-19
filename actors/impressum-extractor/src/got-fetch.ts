import { gotScraping } from "got-scraping";
import { decodeBody } from "./charset.js";
import type { FetchLike } from "./http.js";

/**
 * fetch()-like transport on got-scraping (browser-like TLS and generated
 * headers), decoding bodies by their charset. With `nextProxyUrl`, each
 * request goes through the URL it returns (used only by the local smoke test
 * in sandboxes that require an HTTPS proxy; the actor itself never proxies).
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
      return Array.isArray(v) ? v.join(", ") : (v ?? null);
    };
    const body = decodeBody(res.body as Buffer, header("content-type"));
    return {
      ok: res.statusCode >= 200 && res.statusCode < 300,
      status: res.statusCode,
      url: res.url,
      headers: { get: header },
      text: async () => body,
    };
  };
}
