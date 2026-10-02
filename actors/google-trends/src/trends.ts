/** Pure request builders and response parsers for Google Trends' internal API. */
import { BASE } from "./http.js";

export type Property = "" | "news" | "images" | "youtube" | "froogle";
export type Dataset =
  "interestOverTime" | "interestByRegion" | "relatedQueries" | "relatedTopics";
export type Resolution = "COUNTRY" | "REGION" | "DMA" | "CITY";

export interface Query {
  geo: string;
  time: string;
  category: number;
  property: Property;
  hl: string;
  tz: number;
}

export interface Widget {
  id: string;
  token: string;
  request: Record<string, unknown>;
}

export class TrendsParseError extends Error {}

/** Parse a Trends JSON body, stripping the `)]}'` anti-XSSI prefix. */
export function parseJson<T = unknown>(text: string): T {
  let s = text.trimStart();
  if (s.startsWith(")]}'")) s = s.slice(4).replace(/^,?\s*/, "");
  try {
    return JSON.parse(s) as T;
  } catch {
    throw new TrendsParseError(
      `Unexpected response from Google Trends: ${s.slice(0, 120)}`,
    );
  }
}

export function exploreUrl(terms: string[], q: Query): string {
  const req = {
    comparisonItem: terms.map((keyword) => ({
      keyword,
      geo: q.geo,
      time: q.time,
    })),
    category: q.category,
    property: q.property,
  };
  return `${BASE}/trends/api/explore?hl=${encodeURIComponent(q.hl)}&tz=${q.tz}&req=${encodeURIComponent(JSON.stringify(req))}`;
}

export function parseExplore(text: string): Widget[] {
  const data = parseJson<{ widgets?: Widget[] }>(text);
  if (!Array.isArray(data.widgets))
    throw new TrendsParseError("Explore response has no widgets.");
  return data.widgets.filter((w) => w.token && w.request);
}

export const WIDGET_ENDPOINT = {
  TIMESERIES: "multiline",
  GEO_MAP: "comparedgeo",
  RELATED_QUERIES: "relatedsearches",
  RELATED_TOPICS: "relatedsearches",
} as const;

export function widgetUrl(
  endpoint: string,
  request: Record<string, unknown>,
  token: string,
  q: Pick<Query, "hl" | "tz">,
): string {
  return `${BASE}/trends/api/widgetdata/${endpoint}?hl=${encodeURIComponent(q.hl)}&tz=${q.tz}&req=${encodeURIComponent(JSON.stringify(request))}&token=${encodeURIComponent(token)}`;
}

/**
 * The widget for term `index` of an explore request with `count` terms.
 * Single-term explores use bare ids (GEO_MAP); multi-term ones suffix the
 * term index (GEO_MAP_1). Multi-term explores have no RELATED_TOPICS.
 */
export function findWidget(
  widgets: Widget[],
  kind: keyof typeof WIDGET_ENDPOINT,
  index: number,
  count: number,
): Widget | undefined {
  const id = kind === "TIMESERIES" || count === 1 ? kind : `${kind}_${index}`;
  return widgets.find((w) => w.id === id);
}

export interface TimelinePoint {
  date: string;
  formattedTime: string;
  values: number[];
  hasData: boolean[];
  isPartial: boolean;
}

export function parseTimeline(text: string): TimelinePoint[] {
  const data = parseJson<{
    default?: {
      timelineData?: {
        time: string;
        formattedTime?: string;
        value?: number[];
        hasData?: boolean[];
        isPartial?: boolean;
      }[];
    };
  }>(text);
  return (data.default?.timelineData ?? []).map((p) => ({
    date: new Date(Number(p.time) * 1000).toISOString(),
    formattedTime: (p.formattedTime ?? "").replace(/\s/g, " "),
    values: p.value ?? [],
    hasData: p.hasData ?? [],
    isPartial: p.isPartial === true,
  }));
}

export interface RegionRow {
  geoCode: string | null;
  geoName: string;
  value: number;
  hasData: boolean;
  coordinates: { lat: number; lng: number } | null;
}

export function parseRegions(text: string): RegionRow[] {
  const data = parseJson<{
    default?: {
      geoMapData?: {
        geoCode?: string;
        geoName: string;
        value?: number[];
        hasData?: boolean[];
        coordinates?: { lat: number; lng: number };
      }[];
    };
  }>(text);
  return (data.default?.geoMapData ?? []).map((g) => ({
    geoCode: g.geoCode ?? null,
    geoName: g.geoName,
    value: g.value?.[0] ?? 0,
    hasData: g.hasData?.[0] ?? false,
    coordinates: g.coordinates ?? null,
  }));
}

export interface RelatedQueryRow {
  ranking: "top" | "rising";
  rank: number;
  query: string;
  value: number;
  formattedValue: string;
  isBreakout: boolean;
  link: string | null;
}

export interface RelatedTopicRow {
  ranking: "top" | "rising";
  rank: number;
  topicId: string;
  title: string;
  topicType: string;
  value: number;
  formattedValue: string;
  isBreakout: boolean;
  link: string | null;
}

interface RankedKeyword {
  query?: string;
  topic?: { mid: string; title: string; type: string };
  value?: number;
  formattedValue?: string;
  link?: string;
}

function rankedLists(text: string): [RankedKeyword[], RankedKeyword[]] {
  const data = parseJson<{
    default?: { rankedList?: { rankedKeyword?: RankedKeyword[] }[] };
  }>(text);
  const lists = data.default?.rankedList ?? [];
  return [lists[0]?.rankedKeyword ?? [], lists[1]?.rankedKeyword ?? []];
}

const common = (k: RankedKeyword, ranking: "top" | "rising", i: number) => {
  const formattedValue = k.formattedValue ?? String(k.value ?? "");
  return {
    ranking,
    rank: i + 1,
    value: k.value ?? 0,
    formattedValue,
    isBreakout: ranking === "rising" && /breakout/i.test(formattedValue),
    link: k.link ? `${BASE}${k.link}` : null,
  };
};

export function parseRelatedQueries(text: string): RelatedQueryRow[] {
  const [top, rising] = rankedLists(text);
  const rows = (list: RankedKeyword[], r: "top" | "rising") =>
    list
      .filter((k) => typeof k.query === "string")
      .map((k, i) => {
        const c = common(k, r, i);
        return {
          ranking: c.ranking,
          rank: c.rank,
          query: k.query!,
          value: c.value,
          formattedValue: c.formattedValue,
          isBreakout: c.isBreakout,
          link: c.link,
        };
      });
  return [...rows(top, "top"), ...rows(rising, "rising")];
}

export function parseRelatedTopics(text: string): RelatedTopicRow[] {
  const [top, rising] = rankedLists(text);
  const rows = (list: RankedKeyword[], r: "top" | "rising") =>
    list
      .filter((k) => k.topic)
      .map((k, i) => {
        const c = common(k, r, i);
        return {
          ranking: c.ranking,
          rank: c.rank,
          topicId: k.topic!.mid,
          title: k.topic!.title,
          topicType: k.topic!.type,
          value: c.value,
          formattedValue: c.formattedValue,
          isBreakout: c.isBreakout,
          link: c.link,
        };
      });
  return [...rows(top, "top"), ...rows(rising, "rising")];
}

/** Link to the same comparison in the Google Trends UI. */
export function uiExploreUrl(terms: string[], q: Query): string {
  const p = new URLSearchParams({ q: terms.join(","), date: q.time });
  if (q.geo) p.set("geo", q.geo);
  if (q.category) p.set("cat", String(q.category));
  if (q.property) p.set("gprop", q.property);
  p.set("hl", q.hl);
  return `${BASE}/trends/explore?${p.toString()}`;
}

/**
 * Split terms into requests of at most `size` (Google compares up to 5).
 * With more terms, every batch repeats the first term as an anchor so batches
 * can be put on one scale.
 */
export function planBatches(terms: string[], size = 5): string[][] {
  if (terms.length <= size) return [terms];
  const [anchor, ...rest] = terms as [string, ...string[]];
  const out: string[][] = [];
  for (let i = 0; i < rest.length; i += size - 1)
    out.push([anchor, ...rest.slice(i, i + size - 1)]);
  return out;
}

/**
 * Cross-batch scale factor for each batch: the anchor's total interest in
 * batch 0 divided by its total in that batch. `null` when the anchor has no
 * interest in a batch (it can't be used to rescale).
 */
export function anchorFactors(anchorSeries: number[][]): (number | null)[] {
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const ref = sum(anchorSeries[0] ?? []);
  return anchorSeries.map((s, i) => {
    if (i === 0) return 1;
    const t = sum(s);
    return ref > 0 && t > 0 ? ref / t : null;
  });
}

// ---- Trending now ----

export const TRENDING_CATEGORIES: Record<number, string> = {
  1: "Autos and Vehicles",
  2: "Beauty and Fashion",
  3: "Business and Finance",
  4: "Entertainment",
  5: "Food and Drink",
  6: "Games",
  7: "Health",
  8: "Hobbies and Leisure",
  9: "Jobs and Education",
  10: "Law and Government",
  11: "Other",
  13: "Pets and Animals",
  14: "Politics",
  15: "Science",
  16: "Shopping",
  17: "Sports",
  18: "Technology",
  19: "Travel and Transportation",
  20: "Climate",
};

export const TRENDING_RPC = "i0OFE";

export function trendingRequest(
  geo: string,
  hours: number,
  hl: string,
): { url: string; body: string } {
  const args = JSON.stringify([null, null, geo, 0, hl, hours, 1]);
  const freq = JSON.stringify([[[TRENDING_RPC, args, null, "generic"]]]);
  return {
    url: `${BASE}/_/TrendsUi/data/batchexecute?rpcids=${TRENDING_RPC}&source-path=%2Ftrending&hl=${encodeURIComponent(hl)}`,
    body: `f.req=${encodeURIComponent(freq)}`,
  };
}

export interface TrendingSearch {
  term: string;
  geo: string;
  searchVolume: number | null;
  increasePercent: number | null;
  startedAt: string | null;
  endedAt: string | null;
  isActive: boolean;
  categories: string[];
  relatedQueries: string[];
  newsArticleCount: number;
}

const ts = (v: unknown): string | null =>
  Array.isArray(v) && typeof v[0] === "number"
    ? new Date(v[0] * 1000).toISOString()
    : null;
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

export function parseTrending(text: string): TrendingSearch[] {
  let s = text.trimStart();
  if (s.startsWith(")]}'")) s = s.slice(4);
  for (const line of s.split("\n")) {
    if (!line.startsWith("[[")) continue;
    let outer: unknown[][];
    try {
      outer = JSON.parse(line) as unknown[][];
    } catch {
      continue;
    }
    const entry = outer.find((e) => e[0] === "wrb.fr" && e[1] === TRENDING_RPC);
    if (!entry) continue;
    if (typeof entry[2] !== "string")
      throw new TrendsParseError("Trending response has no data.");
    const payload = JSON.parse(entry[2]) as unknown[];
    const items = (payload[1] ?? []) as unknown[][];
    return items
      .filter((it) => Array.isArray(it) && typeof it[0] === "string")
      .map((it) => {
        const endedAt = ts(it[4]);
        return {
          term: it[0] as string,
          geo: typeof it[2] === "string" ? it[2] : "",
          searchVolume: num(it[6]),
          increasePercent: num(it[8]),
          startedAt: ts(it[3]),
          endedAt,
          isActive: endedAt === null,
          categories: (Array.isArray(it[10]) ? (it[10] as number[]) : []).map(
            (c) => TRENDING_CATEGORIES[c] ?? String(c),
          ),
          relatedQueries: Array.isArray(it[9])
            ? (it[9] as unknown[]).filter(
                (q): q is string => typeof q === "string",
              )
            : [],
          newsArticleCount: Array.isArray(it[11]) ? it[11].length : 0,
        };
      });
  }
  throw new TrendsParseError(
    `Unexpected trending response: ${s.slice(0, 120)}`,
  );
}
