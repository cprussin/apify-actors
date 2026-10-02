import {
  addDays,
  parsePostRef,
  parseTopic,
  PostRefError,
  ptDate,
  refKey,
  type Period,
  type PostRef,
} from "./launch.js";

export type Mode = "latest" | "leaderboard" | "topics" | "posts";
export const MODES: readonly Mode[] = [
  "latest",
  "leaderboard",
  "topics",
  "posts",
];
export const PERIODS: readonly Period[] = ["daily", "weekly", "monthly"];

/** Raw actor input, as defined in .actor/input_schema.json. */
export interface RawInput {
  mode?: string;
  period?: string;
  startDate?: string;
  endDate?: string;
  topics?: string[];
  postUrls?: (string | { url?: string })[];
  searchKeywords?: string;
  maxItems?: number | string;
  maxPerGroup?: number | string;
  featuredOnly?: boolean;
  includeMakers?: boolean;
  includeComments?: boolean;
  maxCommentsPerLaunch?: number | string;
  resolveWebsites?: boolean;
  apiToken?: string;
  onlyNew?: boolean;
  proxyConfiguration?: Record<string, unknown>;
}

export interface NormalizedInput {
  mode: Mode;
  period: Period;
  /** Pacific-Time dates, inclusive. */
  startDate: string;
  endDate: string;
  /** True when the user set startDate or endDate (filters topic feeds too). */
  dateFilter: boolean;
  topics: string[];
  posts: PostRef[];
  keywords: string[];
  maxItems: number;
  /** Cap per leaderboard period or per topic. */
  maxPerGroup: number;
  featuredOnly: boolean;
  includeMakers: boolean;
  includeComments: boolean;
  maxCommentsPerLaunch: number;
  resolveWebsites: boolean;
  apiToken?: string;
  /** Skip launches returned by earlier runs with the same input (monitoring). */
  onlyNew: boolean;
}

export const DEFAULT_INPUT = {
  mode: "latest",
  period: "daily",
  maxItems: 20,
} satisfies RawInput;

export const MAX_ITEMS = 10_000;
export const MAX_COMMENTS = 500;
/** Longest leaderboard date range, to keep runs bounded. */
export const MAX_RANGE_DAYS = 366;

export class InputError extends Error {}

const toInt = (v: unknown, name: string): number | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new InputError(`${name} must be a number.`);
  return Math.floor(n);
};

/**
 * "2026-09-28", "today", "yesterday" or relative "7 days" (ago), as a
 * Pacific-Time date.
 */
export function parseDate(
  v: unknown,
  name: string,
  now: Date,
): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const s = String(v).trim().toLowerCase();
  const today = ptDate(now)!;
  if (s === "today") return today;
  if (s === "yesterday") return addDays(today, -1);
  const rel = /^(\d+)\s*(day|week|month)s?(\s+ago)?$/.exec(s);
  if (rel) {
    const n = Number(rel[1]);
    const days = rel[2] === "day" ? n : rel[2] === "week" ? 7 * n : 30 * n;
    return addDays(today, -days);
  }
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) {
    const iso = `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
    if (!Number.isNaN(Date.parse(`${iso}T00:00:00Z`))) return iso;
  }
  throw new InputError(
    `${name} "${String(v)}" must be YYYY-MM-DD, "today", "yesterday" or relative like "7 days".`,
  );
}

export function normalizeInput(
  raw: RawInput | null | undefined,
  now: Date = new Date(),
): NormalizedInput {
  const r: RawInput = { ...DEFAULT_INPUT, ...(raw ?? {}) };

  const mode = String(r.mode || DEFAULT_INPUT.mode) as Mode;
  if (!MODES.includes(mode))
    throw new InputError(`mode must be one of ${MODES.join(", ")}.`);
  const period = String(r.period || DEFAULT_INPUT.period) as Period;
  if (!PERIODS.includes(period))
    throw new InputError(`period must be one of ${PERIODS.join(", ")}.`);

  const today = ptDate(now)!;
  const startDate =
    parseDate(r.startDate, "startDate", now) ?? addDays(today, -1);
  const endDate =
    parseDate(r.endDate, "endDate", now) ??
    (r.startDate ? startDate : addDays(today, -1));
  if (endDate < startDate)
    throw new InputError("endDate must be on or after startDate.");
  if (startDate > today) throw new InputError("startDate is in the future.");
  const spanDays =
    (Date.parse(`${endDate}T00:00:00Z`) -
      Date.parse(`${startDate}T00:00:00Z`)) /
    86_400_000;
  if (spanDays > MAX_RANGE_DAYS)
    throw new InputError(
      `The date range is limited to ${MAX_RANGE_DAYS} days; split longer ranges into several runs.`,
    );

  const topics: string[] = [];
  const posts = new Map<string, PostRef>();
  try {
    for (const t of r.topics ?? []) {
      if (typeof t !== "string" || !t.trim()) continue;
      const slug = parseTopic(t);
      if (!topics.includes(slug)) topics.push(slug);
    }
    for (const item of r.postUrls ?? []) {
      const s = typeof item === "string" ? item : item?.url;
      if (typeof s !== "string" || !s.trim()) continue;
      const ref = parsePostRef(s);
      posts.set(refKey(ref), ref);
    }
  } catch (e) {
    if (e instanceof PostRefError) throw new InputError(e.message);
    throw e;
  }
  if (mode === "topics" && !topics.length)
    throw new InputError(
      'Mode "topics" needs at least one topic, e.g. artificial-intelligence or https://www.producthunt.com/topics/developer-tools.',
    );
  if (mode === "posts" && !posts.size)
    throw new InputError(
      'Mode "posts" needs at least one Product Hunt post URL in postUrls.',
    );

  const keywords = String(r.searchKeywords ?? "")
    .split(/[,\n]/)
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);

  const maxItems = toInt(r.maxItems, "maxItems") ?? DEFAULT_INPUT.maxItems;
  if (maxItems < 1) throw new InputError("maxItems must be >= 1.");
  const maxPerGroup = toInt(r.maxPerGroup, "maxPerGroup") ?? MAX_ITEMS;
  if (maxPerGroup < 1) throw new InputError("maxPerGroup must be >= 1.");
  const maxComments =
    toInt(r.maxCommentsPerLaunch, "maxCommentsPerLaunch") ?? 20;
  if (maxComments < 1)
    throw new InputError("maxCommentsPerLaunch must be >= 1.");

  const token = typeof r.apiToken === "string" ? r.apiToken.trim() : "";
  const apiToken = token.replace(/^bearer\s+/i, "") || undefined;
  if (mode === "posts" && !apiToken)
    throw new InputError(
      'Mode "posts" needs a Product Hunt API token (www.producthunt.com blocks automated page requests). Add one in "Product Hunt API token" (free: https://www.producthunt.com/v2/oauth/applications), or use mode "latest" / "topics" without a token.',
    );
  if (mode === "leaderboard" && !apiToken && startDate < addDays(today, -1))
    throw new InputError(
      "Historical leaderboards need a Product Hunt API token (free: https://www.producthunt.com/v2/oauth/applications). Without a token only the current launches (today and yesterday) are available.",
    );

  return {
    mode,
    period,
    startDate,
    endDate,
    dateFilter: Boolean(r.startDate || r.endDate),
    topics,
    posts: [...posts.values()],
    keywords,
    maxItems: Math.min(maxItems, MAX_ITEMS),
    maxPerGroup: Math.min(maxPerGroup, MAX_ITEMS),
    featuredOnly: r.featuredOnly ?? true,
    includeMakers: r.includeMakers ?? true,
    includeComments: r.includeComments ?? false,
    maxCommentsPerLaunch: Math.min(maxComments, MAX_COMMENTS),
    resolveWebsites: r.resolveWebsites ?? true,
    apiToken,
    onlyNew: r.onlyNew === true,
  };
}
