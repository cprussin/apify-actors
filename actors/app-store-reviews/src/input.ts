import { AppRefError, appKey, parseAppRef, type AppRef } from "./review.js";
import type { Sort } from "./source.js";

/** Raw actor input, as defined in .actor/input_schema.json. */
export interface RawInput {
  apps?: (string | { url?: string })[];
  country?: string;
  language?: string;
  sort?: string;
  maxReviewsPerApp?: number;
  sinceDate?: string;
  minRating?: number | string;
  maxRating?: number | string;
  onlyNew?: boolean;
  proxyConfiguration?: Record<string, unknown>;
}

export interface NormalizedInput {
  apps: AppRef[];
  country: string;
  language: string;
  sort: Sort;
  maxReviewsPerApp: number;
  /** ISO timestamp; only reviews on or after it. */
  since?: string;
  minRating: number;
  maxRating: number;
  /** Skip reviews returned by earlier runs with the same input (monitoring). */
  onlyNew: boolean;
}

export const DEFAULT_INPUT = {
  country: "us",
  language: "en",
  sort: "newest",
  maxReviewsPerApp: 100,
} satisfies RawInput;

export const MAX_REVIEWS_PER_APP = 100_000;
export const SORTS: readonly Sort[] = ["newest", "mostRelevant"];

export class InputError extends Error {}

const toInt = (v: unknown, name: string): number | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new InputError(`${name} must be a number.`);
  return Math.floor(n);
};

/**
 * Parse "2026-09-01", a full ISO timestamp, or a relative "7 days" /
 * "2 weeks" / "3 months" (relative to `now`).
 */
export function parseSince(v: unknown, now: Date): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const s = String(v).trim().toLowerCase();
  const rel = /^(\d+)\s*(day|week|month|year)s?(\s+ago)?$/.exec(s);
  if (rel) {
    const n = Number(rel[1]);
    const d = new Date(now);
    const unit = rel[2];
    if (unit === "day") d.setUTCDate(d.getUTCDate() - n);
    if (unit === "week") d.setUTCDate(d.getUTCDate() - 7 * n);
    if (unit === "month") d.setUTCMonth(d.getUTCMonth() - n);
    if (unit === "year") d.setUTCFullYear(d.getUTCFullYear() - n);
    return d.toISOString();
  }
  if (/^\d{4}-\d{2}-\d{2}([t ][\d:.]+(z|[+-]\d{2}:?\d{2})?)?$/.test(s)) {
    const t = Date.parse(s.length === 10 ? `${s}T00:00:00Z` : s);
    if (!Number.isNaN(t)) return new Date(t).toISOString();
  }
  throw new InputError(
    `sinceDate "${String(v)}" must be YYYY-MM-DD, an ISO timestamp, or relative like "7 days".`,
  );
}

export function normalizeInput(
  raw: RawInput | null | undefined,
  now: Date = new Date(),
): NormalizedInput {
  const r: RawInput = { ...DEFAULT_INPUT, ...(raw ?? {}) };

  if (!Array.isArray(r.apps) || r.apps.length === 0) {
    throw new InputError(
      "Add at least one app URL or ID to apps, e.g. https://apps.apple.com/us/app/id324684580 or com.spotify.music.",
    );
  }
  const apps = new Map<string, AppRef>();
  for (const item of r.apps) {
    const s = typeof item === "string" ? item : item?.url;
    if (typeof s !== "string" || !s.trim()) continue;
    try {
      const ref = parseAppRef(s);
      apps.set(appKey(ref), ref);
    } catch (e) {
      if (e instanceof AppRefError) throw new InputError(e.message);
      throw e;
    }
  }
  if (!apps.size) throw new InputError("apps contains no valid entries.");

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

  let sort = String(r.sort || DEFAULT_INPUT.sort) as Sort;
  if (!SORTS.includes(sort))
    throw new InputError(`sort must be one of ${SORTS.join(", ")}.`);
  const onlyNew = r.onlyNew === true;
  // onlyNew needs newest-first order to stop paging early.
  if (onlyNew) sort = "newest";

  const max = toInt(r.maxReviewsPerApp, "maxReviewsPerApp") ?? 100;
  if (max < 1) throw new InputError("maxReviewsPerApp must be >= 1.");

  const minRating = toInt(r.minRating, "minRating") ?? 1;
  const maxRating = toInt(r.maxRating, "maxRating") ?? 5;
  if (minRating < 1 || minRating > 5 || maxRating < 1 || maxRating > 5)
    throw new InputError("minRating and maxRating must be between 1 and 5.");
  if (minRating > maxRating)
    throw new InputError("minRating must be <= maxRating.");

  return {
    apps: [...apps.values()],
    country,
    language,
    sort,
    maxReviewsPerApp: Math.min(max, MAX_REVIEWS_PER_APP),
    since: parseSince(r.sinceDate, now),
    minRating,
    maxRating,
    onlyNew,
  };
}
