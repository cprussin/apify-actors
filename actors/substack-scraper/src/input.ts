import { parseTarget, TargetError, targetKey, type Target } from "./target.js";

/** Raw actor input, as defined in .actor/input_schema.json. */
export interface RawInput {
  publications?: (string | { url?: string })[];
  maxPostsPerPublication?: number | string;
  includeContent?: boolean;
  sinceDate?: string;
  search?: string;
  onlyNew?: boolean;
  proxyConfiguration?: Record<string, unknown>;
}

export interface NormalizedInput {
  targets: Target[];
  maxPostsPerPublication: number;
  includeContent: boolean;
  /** ISO timestamp; only posts on or after it. */
  since?: string;
  search?: string;
  /** Skip posts returned by earlier runs with the same input (monitoring). */
  onlyNew: boolean;
}

export const DEFAULT_MAX_POSTS = 50;
export const MAX_POSTS_PER_PUBLICATION = 100_000;

export class InputError extends Error {}

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
  const r: RawInput = raw ?? {};

  if (!Array.isArray(r.publications) || r.publications.length === 0) {
    throw new InputError(
      "Add at least one publication to publications, e.g. https://www.lennysnewsletter.com or lenny.substack.com.",
    );
  }
  const targets = new Map<string, Target>();
  for (const item of r.publications) {
    const s = typeof item === "string" ? item : item?.url;
    if (typeof s !== "string" || !s.trim()) continue;
    try {
      const t = parseTarget(s);
      targets.set(targetKey(t), t);
    } catch (e) {
      if (e instanceof TargetError) throw new InputError(e.message);
      throw e;
    }
  }
  if (!targets.size)
    throw new InputError("publications contains no valid entries.");

  let max = DEFAULT_MAX_POSTS;
  if (
    r.maxPostsPerPublication !== undefined &&
    r.maxPostsPerPublication !== null &&
    r.maxPostsPerPublication !== ""
  ) {
    max = Math.floor(Number(r.maxPostsPerPublication));
    if (!Number.isFinite(max) || max < 1)
      throw new InputError("maxPostsPerPublication must be a number >= 1.");
  }

  const search =
    typeof r.search === "string" && r.search.trim()
      ? r.search.trim()
      : undefined;

  return {
    targets: [...targets.values()],
    maxPostsPerPublication: Math.min(max, MAX_POSTS_PER_PUBLICATION),
    includeContent: r.includeContent === true,
    since: parseSince(r.sinceDate, now),
    search,
    onlyNew: r.onlyNew === true,
  };
}
