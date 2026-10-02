import type { TrendsClient } from "./http.js";
import {
  exploreUrl,
  parseExplore,
  parseTrending,
  trendingRequest,
  widgetUrl,
  WIDGET_ENDPOINT,
  type Query,
  type TrendingSearch,
  type Widget,
} from "./trends.js";

/** Google Trends endpoints on top of a TrendsClient. */
export class GoogleTrends {
  constructor(private readonly http: TrendsClient) {}

  async explore(terms: string[], q: Query): Promise<Widget[]> {
    return parseExplore(await this.http.request(exploreUrl(terms, q)));
  }

  /** Raw widget data; `request` may override fields not covered by the token (e.g. resolution). */
  async widget(
    w: Widget,
    q: Query,
    request: Record<string, unknown> = w.request,
  ): Promise<string> {
    const kind = w.id.replace(/_\d+$/, "") as keyof typeof WIDGET_ENDPOINT;
    const endpoint = WIDGET_ENDPOINT[kind];
    if (!endpoint) throw new Error(`Unsupported widget ${w.id}`);
    return this.http.request(widgetUrl(endpoint, request, w.token, q));
  }

  async trending(
    geo: string,
    hours: number,
    hl: string,
  ): Promise<TrendingSearch[]> {
    const { url, body } = trendingRequest(geo, hours, hl);
    return parseTrending(
      await this.http.request(url, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body,
      }),
    );
  }
}
