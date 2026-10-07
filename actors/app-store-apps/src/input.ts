import type { Store } from "./app.js";
import { AppRefError, appKey, parseAppRef, type AppRef } from "./appref.js";
import { CATEGORIES, CHARTS, type Category, type Chart } from "./categories.js";

export const MODES = ["keywordRanks", "topCharts", "appDetails"] as const;
export type Mode = (typeof MODES)[number];

/** Raw actor input, as defined in .actor/input_schema.json. */
export interface RawInput {
  mode?: string;
  keywords?: string[];
  trackedApps?: (string | { url?: string })[];
  charts?: string[];
  stores?: string[];
  category?: string;
  apps?: (string | { url?: string })[];
  country?: string;
  language?: string;
  maxResults?: number | string;
  rankChangesOnly?: boolean;
  minRankChange?: number | string;
}

export interface NormalizedInput {
  mode: Mode;
  keywords: string[];
  /** keywordRanks: only output these App Store apps (by ID or bundle:ID). */
  trackedApps: string[];
  charts: Chart[];
  stores: Store[];
  category: Category;
  apps: AppRef[];
  country: string;
  language: string;
  /** Rank depth per keyword / chart. */
  maxResults: number;
  rankChangesOnly: boolean;
  /** Rank changes only: ignore moves smaller than this many places. */
  minRankChange: number;
}

export const DEFAULT_INPUT = {
  mode: "keywordRanks",
  country: "us",
  language: "en",
  maxResults: 50,
  charts: ["topFree"],
  stores: ["apple", "google"],
  category: "all",
} satisfies RawInput;

export const MAX_RESULTS = 200;

export class InputError extends Error {}

function refs(list: RawInput["apps"]): AppRef[] {
  const out = new Map<string, AppRef>();
  for (const item of list ?? []) {
    const s = typeof item === "string" ? item : item?.url;
    if (typeof s !== "string" || !s.trim()) continue;
    try {
      const ref = parseAppRef(s);
      out.set(appKey(ref), ref);
    } catch (e) {
      if (e instanceof AppRefError) throw new InputError(e.message);
      throw e;
    }
  }
  return [...out.values()];
}

export function normalizeInput(
  raw: RawInput | null | undefined,
): NormalizedInput {
  const r: RawInput = { ...DEFAULT_INPUT, ...(raw ?? {}) };

  const mode = String(r.mode || DEFAULT_INPUT.mode) as Mode;
  if (!MODES.includes(mode))
    throw new InputError(`mode must be one of ${MODES.join(", ")}.`);

  let country = String(r.country || DEFAULT_INPUT.country)
    .trim()
    .toLowerCase();
  if (country === "uk") country = "gb";
  if (!/^[a-z]{2}$/.test(country))
    throw new InputError(`country "${country}" must be a 2-letter code.`);
  const language = String(r.language || DEFAULT_INPUT.language)
    .trim()
    .toLowerCase();
  if (!/^[a-z]{2,3}(-[a-z]{2,4})?$/.test(language))
    throw new InputError(
      `language "${language}" must be a code like en or pt-br.`,
    );

  const max = Math.floor(Number(r.maxResults ?? DEFAULT_INPUT.maxResults));
  if (!Number.isFinite(max) || max < 1)
    throw new InputError("maxResults must be a number >= 1.");

  const minRankChange = Math.floor(Number(r.minRankChange ?? 1));
  if (!Number.isFinite(minRankChange) || minRankChange < 1)
    throw new InputError("minRankChange must be a number >= 1.");

  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const k of r.keywords ?? []) {
    const kw = String(k ?? "")
      .trim()
      .replace(/\s+/g, " ");
    if (kw && !seen.has(kw.toLowerCase())) {
      seen.add(kw.toLowerCase());
      keywords.push(kw);
    }
  }

  const trackedApps = refs(r.trackedApps).map((ref) => {
    if (ref.store !== "apple")
      throw new InputError(
        `trackedApps: "${ref.id}" is a Google Play app. Keyword ranks are App Store only.`,
      );
    return ref.id;
  });

  const charts = [
    ...new Set(r.charts?.length ? r.charts : DEFAULT_INPUT.charts),
  ];
  for (const c of charts)
    if (!CHARTS.includes(c as Chart))
      throw new InputError(`charts must be among ${CHARTS.join(", ")}.`);
  const stores = [
    ...new Set(r.stores?.length ? r.stores : DEFAULT_INPUT.stores),
  ];
  for (const s of stores)
    if (s !== "apple" && s !== "google")
      throw new InputError(`stores must be among apple, google.`);
  const category = String(r.category || "all") as Category;
  if (!(category in CATEGORIES))
    throw new InputError(
      `category must be one of ${Object.keys(CATEGORIES).join(", ")}.`,
    );

  const apps = refs(r.apps);

  if (mode === "keywordRanks" && !keywords.length)
    throw new InputError(
      'Add at least one keyword to keywords, e.g. "photo editor".',
    );
  if (mode === "appDetails" && !apps.length)
    throw new InputError(
      "Add at least one app URL or ID to apps, e.g. https://apps.apple.com/us/app/id324684580 or com.spotify.music.",
    );

  return {
    mode,
    keywords,
    trackedApps,
    charts: charts as Chart[],
    stores: stores as Store[],
    category,
    apps,
    country,
    language,
    maxResults: Math.min(max, MAX_RESULTS),
    rankChangesOnly: r.rankChangesOnly === true && mode !== "appDetails",
    minRankChange,
  };
}
