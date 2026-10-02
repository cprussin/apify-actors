import type { PoliteFetcher, Route, RouteResponse } from "./fetcher.js";
import type { HttpClient } from "./http.js";
import { localeCookie, type NormalizedInput } from "./input.js";
import { localeFor, parseReviewPage, reviewsUrl } from "./reviews.js";
import { parseSearchPage } from "./search.js";
import type { RunDeps } from "./run.js";

export const newSessionId = (random: () => number = Math.random): string =>
  `ae${Math.floor(random() * 1e9).toString(36)}`;

/**
 * Plain HTTP route. `session` is passed to the proxy URL factory so reset()
 * gets a new IP from Apify Proxy.
 */
export class HttpRoute implements Route {
  session = newSessionId();

  constructor(
    readonly name: string,
    private readonly http: HttpClient,
  ) {}

  get requests(): number {
    return this.http.requests;
  }

  async get(
    url: string,
    headers: Record<string, string>,
  ): Promise<RouteResponse> {
    return this.http.request({ url, headers }, [403, 429]);
  }

  reset(): void {
    this.session = newSessionId();
  }
}

export function browserHeaders(
  input: Pick<NormalizedInput, "shipTo" | "currency" | "language">,
  kind: "html" | "json",
): Record<string, string> {
  const locale = localeFor(input.language);
  return {
    accept:
      kind === "html"
        ? "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
        : "application/json, text/plain, */*",
    "accept-language": `${locale.replace("_", "-")},${input.language};q=0.9,en;q=0.8`,
    cookie: localeCookie(input, locale),
    ...(kind === "json" ? { referer: "https://www.aliexpress.com/" } : {}),
  };
}

/** Wires search/review requests through the polite fetcher and parsers. */
export function aliexpressDeps(
  fetcher: PoliteFetcher,
  input: NormalizedInput,
): Pick<RunDeps, "fetchSearch" | "fetchReviews"> {
  const html = browserHeaders(input, "html");
  const json = browserHeaders(input, "json");
  return {
    fetchSearch: (url) => fetcher.fetch(url, html, parseSearchPage),
    fetchReviews: (productId, page) =>
      fetcher.fetch(
        reviewsUrl(productId, page, {
          translateTo: input.translateReviews ? input.language : undefined,
        }),
        json,
        (text) => parseReviewPage(text, productId),
      ),
  };
}
