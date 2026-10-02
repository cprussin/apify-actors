import type { Dataset, Property, Query, Resolution } from "./trends.js";

/** Raw actor input, as defined in .actor/input_schema.json. */
export interface RawInput {
  mode?: string;
  searchTerms?: (string | null)[];
  geo?: string;
  timeframe?: string;
  startDate?: string;
  endDate?: string;
  category?: number | string;
  property?: string;
  datasets?: string[];
  regionResolution?: string;
  includeLowVolumeRegions?: boolean;
  language?: string;
  trendingHours?: number | string;
  maxTrendingSearches?: number | string;
  onlyNew?: boolean;
  proxyConfiguration?: Record<string, unknown>;
}

export type Mode = "explore" | "trendingNow";

export interface ExploreInput {
  mode: "explore";
  terms: string[];
  query: Query;
  datasets: Dataset[];
  resolution: Resolution | null;
  includeLowVolumeRegions: boolean;
}

export interface TrendingInput {
  mode: "trendingNow";
  geo: string;
  hours: number;
  hl: string;
  maxResults: number;
  /** Skip trending searches returned by earlier runs (monitoring). */
  onlyNew: boolean;
}

export type NormalizedInput = ExploreInput | TrendingInput;

export const TIMEFRAMES = [
  "now 1-H",
  "now 4-H",
  "now 1-d",
  "now 7-d",
  "today 1-m",
  "today 3-m",
  "today 12-m",
  "today 5-y",
  "all",
] as const;
export const DATASETS: readonly Dataset[] = [
  "interestOverTime",
  "interestByRegion",
  "relatedQueries",
  "relatedTopics",
];
export const PROPERTIES: Record<string, Property> = {
  web: "",
  "": "",
  news: "news",
  images: "images",
  youtube: "youtube",
  froogle: "froogle",
  shopping: "froogle",
};
export const RESOLUTIONS = ["COUNTRY", "REGION", "DMA", "CITY"] as const;
export const TRENDING_HOURS = [4, 24, 48, 168];
export const MAX_TERMS = 200;

export const DEFAULT_INPUT = {
  mode: "explore",
  searchTerms: ["coffee", "tea"],
  geo: "US",
  timeframe: "today 12-m",
  datasets: ["interestOverTime", "interestByRegion", "relatedQueries"],
} satisfies RawInput;

export class InputError extends Error {}

const DATE = /^\d{4}-\d{2}-\d{2}(T\d{2})?$/;

/** Accept a preset, "today N-m", "now N-d", or "YYYY-MM-DD YYYY-MM-DD". */
export function parseTimeframe(
  timeframe: string | undefined,
  start?: string,
  end?: string,
  now: Date = new Date(),
): string {
  const s = (start ?? "").trim();
  const e = (end ?? "").trim();
  if (s || e || timeframe === "custom") {
    if (!DATE.test(s))
      throw new InputError(
        `startDate "${s}" must be YYYY-MM-DD (or YYYY-MM-DDTHH for hourly data).`,
      );
    const endStr = e || now.toISOString().slice(0, s.length === 13 ? 13 : 10);
    if (!DATE.test(endStr))
      throw new InputError(`endDate "${e}" must be YYYY-MM-DD.`);
    if ((s.length === 13) !== (endStr.length === 13))
      throw new InputError("startDate and endDate must use the same format.");
    if (endStr < s) throw new InputError("endDate must be after startDate.");
    if (s < "2004-01-01")
      throw new InputError("Google Trends data starts on 2004-01-01.");
    return `${s} ${endStr}`;
  }
  const t = (timeframe || DEFAULT_INPUT.timeframe).trim();
  if ((TIMEFRAMES as readonly string[]).includes(t)) return t;
  if (/^(today \d+-[my]|now \d+-[dH])$/.test(t)) return t;
  if (/^\d{4}-\d{2}-\d{2}(T\d{2})? \d{4}-\d{2}-\d{2}(T\d{2})?$/.test(t))
    return t;
  throw new InputError(
    `timeframe "${t}" must be one of ${TIMEFRAMES.join(", ")} or "YYYY-MM-DD YYYY-MM-DD".`,
  );
}

export function normalizeGeo(v: unknown): string {
  let g = String(v ?? "")
    .trim()
    .toUpperCase();
  if (["WORLDWIDE", "WORLD", "GLOBAL", "ALL"].includes(g)) g = "";
  if (g === "UK") g = "GB";
  if (g.startsWith("UK-")) g = `GB-${g.slice(3)}`;
  if (g && !/^[A-Z]{2}(-[A-Z0-9]{1,3}(-\d{3})?)?$/.test(g))
    throw new InputError(
      `geo "${String(v)}" must be empty (worldwide), a country code (US), a region (US-CA) or a metro (US-CA-807).`,
    );
  return g;
}

const toInt = (v: unknown, name: string, def: number): number => {
  if (v === undefined || v === null || v === "") return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new InputError(`${name} must be a number.`);
  return Math.floor(n);
};

export function normalizeInput(
  raw: RawInput | null | undefined,
  now: Date = new Date(),
): NormalizedInput {
  const r: RawInput = { ...DEFAULT_INPUT, ...(raw ?? {}) };
  const hl = String(r.language || "en-US").trim();
  if (!/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(hl))
    throw new InputError(`language "${hl}" must be a code like en-US or de.`);

  const mode = String(r.mode || "explore") as Mode;
  if (mode === "trendingNow") {
    const geo = normalizeGeo(r.geo || "US");
    if (!/^[A-Z]{2}$/.test(geo))
      throw new InputError(
        "Trending now needs a country code in geo, e.g. US, GB or DE.",
      );
    const hours = toInt(r.trendingHours, "trendingHours", 24);
    if (!TRENDING_HOURS.includes(hours))
      throw new InputError(
        `trendingHours must be one of ${TRENDING_HOURS.join(", ")}.`,
      );
    const maxResults = toInt(r.maxTrendingSearches, "maxTrendingSearches", 50);
    if (maxResults < 1)
      throw new InputError("maxTrendingSearches must be >= 1.");
    return { mode, geo, hours, hl, maxResults, onlyNew: r.onlyNew === true };
  }
  if (mode !== "explore")
    throw new InputError('mode must be "explore" or "trendingNow".');

  const seen = new Set<string>();
  const terms: string[] = [];
  for (const t of Array.isArray(r.searchTerms) ? r.searchTerms : []) {
    const s = typeof t === "string" ? t.trim().replace(/\s+/g, " ") : "";
    if (!s || seen.has(s.toLowerCase())) continue;
    if (s.includes(","))
      throw new InputError(
        `Search term "${s}" contains a comma. Add each term as a separate entry.`,
      );
    seen.add(s.toLowerCase());
    terms.push(s);
  }
  if (!terms.length)
    throw new InputError(
      'Add at least one search term to searchTerms, e.g. ["coffee", "tea"].',
    );
  if (terms.length > MAX_TERMS)
    throw new InputError(`At most ${MAX_TERMS} search terms per run.`);

  const geo = normalizeGeo(r.geo);
  const time = parseTimeframe(r.timeframe, r.startDate, r.endDate, now);
  const category = toInt(r.category, "category", 0);
  if (category < 0) throw new InputError("category must be >= 0.");
  const propKey = String(r.property ?? "web")
    .trim()
    .toLowerCase();
  const property = PROPERTIES[propKey];
  if (property === undefined)
    throw new InputError(
      "property must be web, news, images, youtube or froogle (Google Shopping).",
    );

  const datasets = [
    ...new Set(Array.isArray(r.datasets) ? r.datasets : []),
  ] as Dataset[];
  if (!datasets.length)
    throw new InputError(`Pick at least one of ${DATASETS.join(", ")}.`);
  for (const d of datasets)
    if (!DATASETS.includes(d))
      throw new InputError(
        `Unknown dataset "${d}"; use ${DATASETS.join(", ")}.`,
      );

  let resolution: Resolution | null = null;
  const res = String(r.regionResolution || "auto").toUpperCase();
  if (res !== "AUTO") {
    if (!(RESOLUTIONS as readonly string[]).includes(res))
      throw new InputError(
        `regionResolution must be auto, ${RESOLUTIONS.join(", ")}.`,
      );
    resolution = res as Resolution;
    if (resolution === "COUNTRY" && geo)
      throw new InputError(
        "regionResolution COUNTRY only works with geo empty (worldwide).",
      );
    if (resolution !== "COUNTRY" && !geo && resolution !== "CITY")
      throw new InputError(
        `regionResolution ${resolution} needs a country in geo.`,
      );
    if (resolution === "DMA" && !geo.startsWith("US"))
      throw new InputError(
        "regionResolution DMA (metro areas) is only available for the US.",
      );
  }

  return {
    mode,
    terms,
    query: { geo, time, category, property, hl, tz: 0 },
    datasets: DATASETS.filter((d) => datasets.includes(d)),
    resolution,
    includeLowVolumeRegions: r.includeLowVolumeRegions === true,
  };
}
