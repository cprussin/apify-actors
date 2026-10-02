/**
 * Request builders and response parsers for the Transparency Center's
 * internal RPC API (adstransparency.google.com/anji/_/rpc/...). Requests and
 * responses are protobuf-as-JSON objects keyed by field number.
 */

export type Format = "text" | "image" | "video";
export const FORMAT_IDS: Record<Format, number> = {
  text: 1,
  image: 2,
  video: 3,
};
const FORMAT_NAMES: Record<number, Format> = {
  1: "text",
  2: "image",
  3: "video",
};

export type Platform = "SEARCH" | "YOUTUBE" | "MAPS" | "PLAY" | "SHOPPING";
export const PLATFORM_IDS: Record<Platform, number> = {
  PLAY: 1,
  MAPS: 2,
  SEARCH: 3,
  SHOPPING: 4,
  YOUTUBE: 5,
};

export interface SearchFilter {
  advertiserIds?: string[];
  domain?: string;
  /** Google geo target ID, e.g. 2840 (US). Omit for anywhere. */
  regionId?: number;
  format?: Format;
  platform?: Platform;
  /** YYYYMMDD; both or neither. */
  startDate?: number;
  endDate?: number;
}

export function searchCreativesRequest(
  f: SearchFilter,
  count: number,
  pageToken?: string,
): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (f.format) filter["4"] = FORMAT_IDS[f.format];
  if (f.startDate && f.endDate) {
    filter["6"] = f.startDate;
    filter["7"] = f.endDate;
  }
  if (f.regionId) filter["8"] = [f.regionId];
  if (f.domain) filter["12"] = { "1": f.domain, "2": true };
  if (f.advertiserIds?.length) filter["13"] = { "1": f.advertiserIds };
  if (f.platform) filter["14"] = [PLATFORM_IDS[f.platform]];
  return {
    "2": count,
    "3": filter,
    ...(pageToken ? { "4": pageToken } : {}),
    "7": { "1": 1 },
  };
}

/** One ad from a SearchCreatives page. */
export interface RawAd {
  advertiserId: string;
  creativeId: string;
  advertiserName: string | null;
  format: Format | null;
  firstShown: string | null;
  lastShown: string | null;
  totalDaysShown: number | null;
  targetDomain: string | null;
  /** content.js preview (text ads, most image/video ads). */
  previewUrl: string | null;
  /** Direct image (archived image/text ads). */
  imageUrl: string | null;
  width: number | null;
  height: number | null;
}

export interface SearchPage {
  ads: RawAd[];
  nextPageToken: string | null;
  /** Google's rounded estimate of matching ads, e.g. [7000, 8000]. */
  totalEstimate: [number, number] | null;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
const str = (v: unknown): string | null =>
  typeof v === "string" && v ? v : null;
const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/** {"1": "<epoch seconds>", "2": nanos} -> ISO timestamp. */
export function parseTimestamp(v: unknown): string | null {
  const s = num(obj(v)["1"]);
  return s === null ? null : new Date(s * 1000).toISOString();
}

const decodeEntities = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/** Content of an ad variation: preview script URL or inline <img>. */
export function parseContent(v: unknown): {
  previewUrl: string | null;
  imageUrl: string | null;
  width: number | null;
  height: number | null;
} {
  const c = obj(v);
  const previewUrl = str(obj(c["1"])["4"]);
  const html = str(obj(c["3"])["2"]) ?? "";
  const src = /<img[^>]*\ssrc="([^"]+)"/i.exec(html)?.[1];
  const attr = (name: string) =>
    num(new RegExp(`\\s${name}="(\\d+)"`, "i").exec(html)?.[1]);
  return {
    previewUrl,
    imageUrl: src ? decodeEntities(src) : null,
    width: html ? attr("width") : null,
    height: html ? attr("height") : null,
  };
}

export function parseSearchCreatives(res: Obj): SearchPage {
  const list = Array.isArray(res["1"]) ? res["1"] : [];
  const ads: RawAd[] = [];
  for (const item of list) {
    const a = obj(item);
    const advertiserId = str(a["1"]);
    const creativeId = str(a["2"]);
    if (!advertiserId || !creativeId) continue;
    ads.push({
      advertiserId,
      creativeId,
      advertiserName: str(a["12"]),
      format: FORMAT_NAMES[num(a["4"]) ?? 0] ?? null,
      firstShown: parseTimestamp(a["6"]),
      lastShown: parseTimestamp(a["7"]),
      totalDaysShown: num(a["13"]),
      targetDomain: str(a["14"]),
      ...parseContent(a["3"]),
    });
  }
  const lo = num(res["4"]);
  const hi = num(res["5"]);
  return {
    ads,
    nextPageToken: str(res["2"]),
    totalEstimate: lo !== null ? [lo, hi ?? lo] : null,
  };
}

export const suggestionsRequest = (query: string, count: number) => ({
  "1": query,
  "2": count,
  "3": count,
});

export interface AdvertiserSuggestion {
  advertiserId: string;
  advertiserName: string;
  /** ISO country the advertiser is based in. */
  country: string | null;
  /** Google's rounded ad count range, e.g. [9000, 10000]. */
  adCountMin: number | null;
  adCountMax: number | null;
}

export interface Suggestions {
  advertisers: AdvertiserSuggestion[];
  domains: string[];
}

export function parseSuggestions(res: Obj): Suggestions {
  const out: Suggestions = { advertisers: [], domains: [] };
  for (const item of Array.isArray(res["1"]) ? res["1"] : []) {
    const adv = obj(obj(item)["1"]);
    const id = str(adv["2"]);
    if (id) {
      const range = obj(obj(adv["4"])["2"]);
      out.advertisers.push({
        advertiserId: id,
        advertiserName: str(adv["1"]) ?? "",
        country: str(adv["3"]),
        adCountMin: num(range["1"]),
        adCountMax: num(range["2"]),
      });
    }
    const domain = str(obj(obj(item)["2"])["1"]);
    if (domain) out.domains.push(domain);
  }
  return out;
}

/**
 * Picks the advertiser a name most likely refers to: exact (case-insensitive)
 * name matches first, then names starting with the query, then any; ties go
 * to the advertiser with the most ads.
 */
export function bestAdvertiser(
  query: string,
  list: AdvertiserSuggestion[],
): AdvertiserSuggestion | null {
  const q = norm(query);
  const rank = (a: AdvertiserSuggestion) => {
    const n = norm(a.advertiserName);
    return n === q ? 0 : n.startsWith(q) ? 1 : 2;
  };
  return (
    [...list].sort(
      (a, b) => rank(a) - rank(b) || (b.adCountMax ?? 0) - (a.adCountMax ?? 0),
    )[0] ?? null
  );
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[,.]/g, "")
    .replace(/\s+(inc|llc|ltd|gmbh|corp|corporation|co|plc|sa|srl|bv|oy)$/, "")
    .trim();
