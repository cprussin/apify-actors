import {
  parseDeviationUrl,
  parseUsername,
  TargetError,
  type DeviationTarget,
} from "./target.js";

export type Mode = "search" | "userGallery" | "userProfile" | "deviationUrls";
export const MODES: Mode[] = [
  "search",
  "userGallery",
  "userProfile",
  "deviationUrls",
];

/** Raw actor input, as defined in .actor/input_schema.json. */
export interface RawInput {
  mode?: string;
  query?: string;
  usernames?: (string | { url?: string })[];
  deviationUrls?: (string | { url?: string })[];
  maxItems?: number | string;
  includeMature?: boolean;
  includeTags?: boolean;
  sinceDate?: string;
  proxyConfiguration?: Record<string, unknown>;
}

export interface NormalizedInput {
  mode: Mode;
  query?: string;
  usernames: string[];
  deviations: DeviationTarget[];
  maxItems: number;
  includeMature: boolean;
  includeTags: boolean;
  /** Only deviations published at or after this time (ms since epoch). */
  since: number | null;
}

export const DEFAULT_MAX_ITEMS = 20;
export const MAX_ITEMS_CAP = 5000;

export class InputError extends Error {}

const strings = (v: RawInput["usernames"]): string[] =>
  (Array.isArray(v) ? v : [])
    .map((x) => (typeof x === "string" ? x : x?.url))
    .filter((x): x is string => typeof x === "string" && !!x.trim());

const UNIT_MS: Record<string, number> = {
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000,
};

/**
 * "2026-10-01", "2026-10-01T12:00:00Z", or relative "7 days" / "24 hours" /
 * "2 weeks" (before `now`).
 */
export function parseSince(
  v: string | undefined,
  now = Date.now(),
): number | null {
  const s = v?.trim();
  if (!s) return null;
  const rel = /^(\d+)\s*(hour|day|week|month)s?(?:\s+ago)?$/i.exec(s);
  if (rel) return now - Number(rel[1]) * UNIT_MS[rel[2]!.toLowerCase()]!;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const t = Date.parse(s);
    if (!Number.isNaN(t)) return t;
  }
  throw new InputError(
    `sinceDate "${s}" must be a date (2026-10-01) or a relative time ("7 days").`,
  );
}

export function normalizeInput(
  raw: RawInput | null | undefined,
  now = Date.now(),
): NormalizedInput {
  const r: RawInput = raw ?? {};
  const mode = (r.mode || "search") as Mode;
  if (!MODES.includes(mode))
    throw new InputError(`mode must be one of: ${MODES.join(", ")}.`);

  const wrap = <T>(f: () => T): T => {
    try {
      return f();
    } catch (e) {
      if (e instanceof TargetError) throw new InputError(e.message);
      throw e;
    }
  };

  const query =
    typeof r.query === "string" && r.query.trim() ? r.query.trim() : undefined;
  const usernames = [
    ...new Set(wrap(() => strings(r.usernames).map(parseUsername))),
  ];
  const seen = new Set<string>();
  const deviations = wrap(() =>
    strings(r.deviationUrls).map(parseDeviationUrl),
  ).filter(
    (d) => !seen.has(d.url.toLowerCase()) && seen.add(d.url.toLowerCase()),
  );

  if (mode === "search" && !query)
    throw new InputError('mode "search" needs a `query`.');
  if ((mode === "userGallery" || mode === "userProfile") && !usernames.length)
    throw new InputError(`mode "${mode}" needs at least one of \`usernames\`.`);
  if (mode === "deviationUrls" && !deviations.length)
    throw new InputError(
      'mode "deviationUrls" needs at least one of `deviationUrls`.',
    );

  let maxItems = DEFAULT_MAX_ITEMS;
  if (r.maxItems !== undefined && r.maxItems !== null && r.maxItems !== "") {
    const n = Math.floor(Number(r.maxItems));
    if (!Number.isFinite(n) || n < 1)
      throw new InputError("maxItems must be a number >= 1.");
    maxItems = Math.min(n, MAX_ITEMS_CAP);
  }

  return {
    mode,
    query,
    usernames,
    deviations,
    maxItems,
    includeMature: r.includeMature === true,
    includeTags: r.includeTags === true,
    since: parseSince(r.sinceDate, now),
  };
}
