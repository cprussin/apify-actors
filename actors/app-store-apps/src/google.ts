import { EMPTY_APP, googleAppUrl, isoDate, type App } from "./app.js";
import type { Chart } from "./categories.js";
import type { HttpClient } from "./http.js";

/** Google Play charts return at most 200 apps. */
export const GOOGLE_CHART_MAX = 200;

const PLAY = "https://play.google.com";
const CHART_RPC = "vyAe2";

const COLLECTION: Record<Chart, string> = {
  topFree: "topselling_free",
  topPaid: "topselling_paid",
  topGrossing: "topgrossing",
};

type Json = unknown;
export const at = (v: Json, ...path: number[]): Json => {
  let cur = v;
  for (const i of path) {
    if (!Array.isArray(cur)) return undefined;
    cur = cur[i];
  }
  return cur;
};
const str = (v: Json): string | null => (typeof v === "string" && v ? v : null);
const num = (v: Json): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const abs = (path: Json): string | null => {
  const p = str(path);
  return p ? new URL(p, PLAY).toString() : null;
};

const decodeEntities = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");

/** Play descriptions are HTML fragments; convert to plain text. */
export function htmlToText(v: Json): string | null {
  const s = str(v);
  if (!s) return null;
  return decodeEntities(
    s
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>\s*/gi, "\n\n")
      .replace(/<[^>]+>/g, ""),
  ).trim();
}

export const detailsUrl = googleAppUrl;

/** All AF_initDataCallback payloads in a Play page, by key ("ds:5"). */
export function extractDataBlocks(html: string): Map<string, Json> {
  const out = new Map<string, Json>();
  const re =
    /AF_initDataCallback\(\{key: '(ds:\d+)', hash: '[^']*', data:([\s\S]*?), sideChannel: \{\}\}\);<\/script>/g;
  for (const m of html.matchAll(re)) {
    try {
      out.set(m[1]!, JSON.parse(m[2]!));
    } catch {
      // Not every block is plain JSON; skip those.
    }
  }
  return out;
}

/** Find the first [number, "x.y"] pair (min Android version) in a subtree. */
function findVersionPair(v: Json, depth = 0): string | null {
  if (!Array.isArray(v) || depth > 8) return null;
  if (
    v.length === 2 &&
    typeof v[0] === "number" &&
    typeof v[1] === "string" &&
    /^\d+(\.\d+)*/.test(v[1])
  )
    return v[1];
  for (const x of v) {
    const r = findVersionPair(x, depth + 1);
    if (r) return r;
  }
  return null;
}

/** Parse an app details page. Returns null if it has no app data. */
export function parseDetails(
  html: string,
  appId: string,
  language: string,
  country: string,
): App | null {
  const blocks = extractDataBlocks(html);
  let data: Json = undefined;
  for (const d of blocks.values()) {
    if (at(d, 1, 2, 77, 0) === appId) {
      data = d;
      break;
    }
  }
  data ??= blocks.get("ds:5");
  const a = at(data, 1, 2);
  const name = str(at(a, 0, 0));
  if (!Array.isArray(a) || !name) return null;

  const offer = at(a, 57, 0, 0, 0, 0, 1, 0);
  const micros = num(at(offer, 0));
  const devPath = str(at(a, 68, 1, 4, 2));
  const histogram = [1, 2, 3, 4, 5].map((i) => num(at(a, 51, 1, i, 1)));
  const screenshots = ((at(a, 78, 0) as Json[] | undefined) ?? [])
    .map((s) => str(at(s, 3, 2)))
    .filter((s): s is string => !!s);
  const releasedEpoch = num(at(a, 10, 1, 0));
  return {
    ...EMPTY_APP,
    store: "google",
    appId,
    bundleId: appId,
    name,
    developer: str(at(a, 68, 0)),
    developerId: devPath ? new URL(devPath, PLAY).searchParams.get("id") : null,
    developerUrl: abs(devPath),
    url: googleAppUrl(appId, language, country),
    iconUrl: str(at(a, 95, 0, 3, 2)),
    summary: htmlToText(at(a, 73, 0, 1)),
    description: htmlToText(at(a, 72, 0, 1)),
    category: str(at(a, 79, 0, 0, 0)),
    categoryId: str(at(a, 79, 0, 0, 2)),
    genres: (() => {
      const g = ((at(a, 79, 0) as Json[] | undefined) ?? [])
        .map((x) => str(at(x, 0)))
        .filter((x): x is string => !!x);
      return g.length ? g : null;
    })(),
    price: micros === null ? null : micros / 1e6,
    currency: str(at(offer, 1)),
    free: micros === null ? null : micros === 0,
    inAppPurchases: str(at(a, 19, 0)),
    containsAds: Array.isArray(at(a, 48)) && at(a, 48, 0) !== undefined,
    rating: num(at(a, 51, 0, 1)),
    ratingCount: num(at(a, 51, 2, 1)),
    reviewCount: num(at(a, 51, 3, 1)),
    ratingHistogram: histogram.every((h) => h !== null)
      ? (histogram as number[])
      : null,
    installs: str(at(a, 13, 0)),
    minInstalls: num(at(a, 13, 1)),
    version: str(at(a, 140, 0, 0, 0)),
    releaseDate: releasedEpoch
      ? isoDate(releasedEpoch)
      : isoDate(str(at(a, 10, 0))),
    updatedDate: isoDate(num(at(a, 145, 0, 1, 0))),
    releaseNotes: htmlToText(at(a, 144, 1, 1)),
    contentRating: str(at(a, 9, 0)),
    minOsVersion: findVersionPair(at(a, 140, 1)),
    screenshots: screenshots.length ? screenshots : null,
    website: str(at(a, 69, 0, 5, 2)),
    developerEmail: str(at(a, 69, 1, 0)),
    privacyPolicyUrl: str(at(a, 99, 0, 5, 2)),
  };
}

export const chartUrl = (language: string, country: string) =>
  `${PLAY}/_/PlayStoreUi/data/batchexecute?rpcids=${CHART_RPC}&source-path=%2Fstore%2Fapps&hl=${language}&gl=${country}&authuser&soc-app=121&soc-platform=1&soc-device=1`;

/**
 * Request body for a top chart (same RPC as the Play web app's charts page,
 * trimmed to the parts the server needs).
 */
export function chartBody(chart: Chart, category: string, num: number): string {
  const inner =
    `[[null,[[8,[20,${num}]],true,null,[64,1,195,71,8,72,9,10,11,139,12,16,145,148,150,151,152,27,30,31,96,32,34,163,100,165,104,169,108,110,113,55,56,57,122],` +
    `[null,null,[[[true],null,[[null,[]]],null,null,null,null,[null,2],null,null,null,null,null,null,[1],null,null,null,null,null,null,null,[1]],` +
    `[null,[[null,[]]]],[null,[[null,[]]],null,[true]],[null,[[null,[]]]],null,null,null,null,[[[null,[]]]],[[[null,[]]]]],[]],` +
    `null,null,[[[1,2],[10,8,9],[],[]]]],[2,${JSON.stringify(COLLECTION[chart])},${JSON.stringify(category)}]]]`;
  return `f.req=${encodeURIComponent(JSON.stringify([[[CHART_RPC, inner, null, "generic"]]]))}`;
}

/** Parse a chart batchexecute response into apps, in chart order. */
export function parseChart(
  text: string,
  language: string,
  country: string,
): App[] {
  const start = text.indexOf("[");
  if (start < 0) throw new Error("Unexpected Google Play response.");
  // The envelope is followed by length-prefixed trailer lines.
  const envelope = JSON.parse(text.slice(start).split("\n")[0]!) as Json[];
  const entry = envelope.find(
    (e) => Array.isArray(e) && e[0] === "wrb.fr" && e[1] === CHART_RPC,
  );
  const payload = str(at(entry, 2));
  if (!payload) throw new Error("Google Play response has no chart payload.");
  const items = at(JSON.parse(payload), 0, 1, 0, 28, 0);
  if (!Array.isArray(items)) return [];
  const out: App[] = [];
  for (const item of items) {
    const a = at(item, 0);
    const appId = str(at(a, 0, 0));
    if (!appId) continue;
    const micros = num(at(a, 8, 1, 0, 0));
    const screenshots = ((at(a, 2) as Json[] | undefined) ?? [])
      .map((s) => str(at(s, 3, 2)))
      .filter((s): s is string => !!s);
    out.push({
      ...EMPTY_APP,
      store: "google",
      appId,
      bundleId: appId,
      name: str(at(a, 3)),
      developer: str(at(a, 14)),
      url: googleAppUrl(appId, language, country),
      iconUrl: str(at(a, 1, 3, 2)),
      description: htmlToText(at(a, 13, 1)),
      category: str(at(a, 5)),
      price: micros === null ? null : micros / 1e6,
      currency: str(at(a, 8, 1, 0, 1)),
      free: micros === null ? null : micros === 0,
      inAppPurchases: str(at(a, 29, 0)),
      rating: num(at(a, 4, 1)),
      installs: str(at(a, 15)),
      contentRating: str(at(a, 24, 0)),
      screenshots: screenshots.length ? screenshots : null,
    });
  }
  return out;
}

export class GoogleClient {
  constructor(private readonly http: HttpClient) {}

  /** Full app details, or null if the app doesn't exist in this country. */
  async details(
    appId: string,
    language: string,
    country: string,
  ): Promise<App | null> {
    const res = await this.http.request(
      { url: detailsUrl(appId, language, country) },
      [404],
    );
    if (res.status === 404) return null;
    const app = parseDetails(res.text, appId, language, country);
    if (!app) throw new Error("Google Play page has no app data.");
    return app;
  }

  async chart(
    chart: Chart,
    category: string,
    language: string,
    country: string,
    limit: number,
  ): Promise<App[]> {
    limit = Math.min(limit, GOOGLE_CHART_MAX);
    const res = await this.http.request({
      url: chartUrl(language, country),
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: chartBody(chart, category, limit),
    });
    return parseChart(res.text, language, country).slice(0, limit);
  }
}
