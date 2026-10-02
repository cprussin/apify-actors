import type { HttpClient } from "./http.js";
import { googleAppUrl, type RawReview } from "./review.js";
import type { AppInfo, ReviewSource, SourceQuery } from "./source.js";

/** Reviews per batchexecute request (same as google-play-scraper). */
export const GOOGLE_PAGE_SIZE = 150;
/** Safety net against a pagination token that never ends. */
export const GOOGLE_MAX_PAGES = 1000;

/** Play Store review sort codes: 1 = most relevant, 2 = newest, 3 = rating. */
const SORT = { newest: 2, mostRelevant: 1 } as const;

const RPC_ID = "UsvDTd";

export const batchUrl = (language: string, country: string) =>
  `https://play.google.com/_/PlayStoreUi/data/batchexecute?rpcids=${RPC_ID}&source-path=%2Fstore%2Fapps%2Fdetails&hl=${language}&gl=${country}&authuser&soc-app=121&soc-platform=1&soc-device=1`;

export function batchBody(
  appId: string,
  sort: SourceQuery["sort"],
  num: number,
  token: string | null,
): string {
  const inner = JSON.stringify([
    null,
    null,
    [2, SORT[sort], [num, null, token], null, []],
    [appId, 7],
  ]);
  const req = JSON.stringify([[[RPC_ID, inner, null, "generic"]]]);
  return `f.req=${encodeURIComponent(req)}`;
}

type Json = unknown;
const at = (v: Json, ...path: number[]): Json => {
  let cur = v;
  for (const i of path) {
    if (!Array.isArray(cur)) return undefined;
    cur = cur[i];
  }
  return cur;
};
const str = (v: Json): string | null => (typeof v === "string" ? v : null);
const epoch = (v: Json): string | null =>
  typeof v === "number" ? new Date(v * 1000).toISOString() : null;

export interface GooglePage {
  reviews: RawReview[];
  nextToken: string | null;
}

/** Parse a batchexecute response (")]}'" prefix + JSON envelope). */
export function parseBatchResponse(
  text: string,
  appId: string,
  language: string,
  country: string,
): GooglePage {
  const start = text.indexOf("[");
  if (start < 0) throw new Error("Unexpected Google Play response.");
  const envelope = JSON.parse(text.slice(start)) as Json[];
  const entry = envelope.find(
    (e) => Array.isArray(e) && e[0] === "wrb.fr" && e[1] === RPC_ID,
  );
  const payload = str(at(entry, 2));
  if (!payload) throw new Error("Google Play response has no review payload.");
  const data = JSON.parse(payload) as Json;
  const list = at(data, 0);
  const reviews: RawReview[] = [];
  if (Array.isArray(list)) {
    for (const r of list) {
      const id = str(at(r, 0));
      const date = epoch(at(r, 5, 0));
      const rating = at(r, 2);
      if (!id || !date || typeof rating !== "number") continue;
      const thumbs = at(r, 6);
      reviews.push({
        reviewId: id,
        rating,
        title: null,
        text: str(at(r, 4)) ?? "",
        author: str(at(r, 1, 0)),
        date,
        appVersion: str(at(r, 10)),
        developerReply: str(at(r, 7, 1)),
        developerReplyDate: epoch(at(r, 7, 2, 0)),
        helpfulCount: typeof thumbs === "number" ? thumbs : null,
        url: `${googleAppUrl(appId, language, country)}&reviewId=${encodeURIComponent(id)}`,
      });
    }
  }
  const nextToken = str(at(data, 1, 1));
  return { reviews, nextToken: Array.isArray(list) ? nextToken : null };
}

/** App name from the details page (og:title minus the store suffix). */
export function parseDetailsName(html: string): string | null {
  const m =
    /<meta property="og:title" content="([^"]*)"/.exec(html) ??
    /<title[^>]*>([^<]*)<\/title>/.exec(html);
  if (!m) return null;
  const name = decodeEntities(m[1]!)
    .replace(
      /\s+-\s+(Apps on Google Play|Apps bei Google Play|Google Play)$/i,
      "",
    )
    .replace(/\s+[-–]\s+[^-–]*Google Play[^-–]*$/i, "")
    .trim();
  return name || null;
}

const decodeEntities = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));

export class GoogleSource implements ReviewSource {
  constructor(private readonly http: HttpClient) {}

  async resolve(id: string, q: SourceQuery): Promise<AppInfo | null> {
    const res = await this.http.request(
      { url: googleAppUrl(id, q.language, q.country) },
      [404],
    );
    if (res.status === 404) return null;
    return { id, name: parseDetailsName(res.text) };
  }

  async *reviews(app: AppInfo, q: SourceQuery): AsyncGenerator<RawReview> {
    let token: string | null = null;
    for (let page = 0; page < GOOGLE_MAX_PAGES; page++) {
      const res = await this.http.request({
        url: batchUrl(q.language, q.country),
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: batchBody(app.id, q.sort, GOOGLE_PAGE_SIZE, token),
      });
      const parsed = parseBatchResponse(
        res.text,
        app.id,
        q.language,
        q.country,
      );
      yield* parsed.reviews;
      if (!parsed.nextToken || parsed.reviews.length === 0) return;
      token = parsed.nextToken;
    }
  }
}
