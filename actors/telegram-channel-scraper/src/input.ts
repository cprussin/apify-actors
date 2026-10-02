import { ChannelRefError, parseChannelRef } from "./channel.js";

/** Raw actor input, as defined in .actor/input_schema.json. */
export interface RawInput {
  channels?: (string | { url?: string })[];
  maxPostsPerChannel?: number | string;
  sinceDate?: string;
  includeChannelInfo?: boolean;
  onlyNew?: boolean;
  proxyConfiguration?: Record<string, unknown>;
}

export interface ChannelEntry {
  /** What the user typed. */
  input: string;
  /** Lowercased username, or null when `error` is set. */
  username: string | null;
  error?: string;
}

export interface NormalizedInput {
  channels: ChannelEntry[];
  maxPostsPerChannel: number;
  /** ISO timestamp; only posts on or after it. */
  since?: string;
  includeChannelInfo: boolean;
  /** Skip posts returned by earlier runs with the same channels (monitoring). */
  onlyNew: boolean;
}

export const DEFAULT_MAX_POSTS = 100;
export const MAX_POSTS_PER_CHANNEL = 100_000;

export class InputError extends Error {}

/**
 * Parse "2026-09-01", a full ISO timestamp, or a relative "7 days" /
 * "2 weeks" / "3 months" (relative to `now`).
 */
export function parseSince(v: unknown, now: Date): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const s = String(v).trim().toLowerCase();
  const rel = /^(\d+)\s*(hour|day|week|month|year)s?(\s+ago)?$/.exec(s);
  if (rel) {
    const n = Number(rel[1]);
    const d = new Date(now);
    const unit = rel[2];
    if (unit === "hour") d.setUTCHours(d.getUTCHours() - n);
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
  if (!Array.isArray(r.channels) || r.channels.length === 0) {
    throw new InputError(
      "Add at least one public channel to channels, e.g. durov or https://t.me/telegram.",
    );
  }
  const channels: ChannelEntry[] = [];
  const seen = new Set<string>();
  for (const item of r.channels) {
    const s = (typeof item === "string" ? item : item?.url)?.trim();
    if (!s) continue;
    try {
      const username = parseChannelRef(s);
      if (seen.has(username)) continue;
      seen.add(username);
      channels.push({ input: s, username });
    } catch (e) {
      if (!(e instanceof ChannelRefError)) throw e;
      channels.push({ input: s, username: null, error: e.message });
    }
  }
  if (!channels.length) throw new InputError("channels contains no entries.");

  const rawMax = r.maxPostsPerChannel;
  let max = DEFAULT_MAX_POSTS;
  if (rawMax !== undefined && rawMax !== null && rawMax !== "") {
    max = Math.floor(Number(rawMax));
    if (!Number.isFinite(max))
      throw new InputError("maxPostsPerChannel must be a number.");
    if (max < 1) throw new InputError("maxPostsPerChannel must be >= 1.");
  }

  return {
    channels,
    maxPostsPerChannel: Math.min(max, MAX_POSTS_PER_CHANNEL),
    since: parseSince(r.sinceDate, now),
    includeChannelInfo: r.includeChannelInfo ?? true,
    onlyNew: r.onlyNew === true,
  };
}
