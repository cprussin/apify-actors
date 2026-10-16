import { gotScraping } from "got-scraping";
import type { FetchLike } from "./http.js";

/**
 * fetch()-like transport on got-scraping (browser-like TLS and generated
 * headers). With `nextProxyUrl`, each request goes through the URL it
 * returns (undefined = direct).
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
      body: init?.body,
      proxyUrl,
      signal: init?.signal,
      throwHttpErrors: false,
      followRedirect: true,
      retry: { limit: 0 },
      headerGeneratorOptions: {
        browsers: [{ name: "chrome", minVersion: 120 }],
        devices: ["desktop"],
        operatingSystems: ["windows", "macos"],
      },
    });
    const body = String(res.body);
    return {
      ok: res.statusCode >= 200 && res.statusCode < 300,
      status: res.statusCode,
      url: res.url,
      headers: {
        get: (name: string) => {
          const v = res.headers[name.toLowerCase()];
          return Array.isArray(v) ? v.join(", ") : (v ?? null);
        },
      },
      text: async () => body,
    };
  };
}
