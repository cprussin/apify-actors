import { TOURS, type Tour } from "./match.js";

/** Raw actor input, as defined in .actor/input_schema.json. */
export interface RawInput {
  mode?: string;
  daysAhead?: number | string;
  startDate?: string;
  endDate?: string;
  tours?: string[];
  playerSlugs?: string[];
  includeRoundAndSurface?: boolean;
  includeBookmakerOdds?: boolean;
  onlyNew?: boolean;
  maxMatches?: number | string;
}

export type Mode = "results" | "upcoming";
export const MODES: Mode[] = ["results", "upcoming"];

export interface NormalizedInput {
  /** results: finished matches by date or player; upcoming: scheduled matches. */
  mode: Mode;
  /** Upcoming mode: days after today to cover (today's remaining card included). */
  daysAhead: number;
  /** YYYY-MM-DD, inclusive. Upcoming mode: today .. today + daysAhead (CET). */
  startDate: string;
  endDate: string;
  tours: Tour[];
  playerSlugs: string[];
  includeRoundAndSurface: boolean;
  includeBookmakerOdds: boolean;
  onlyNew: boolean;
  maxMatches: number;
}

export const DEFAULT_TOURS: Tour[] = ["ATP", "WTA"];
export const DEFAULT_MAX_MATCHES = 500;
export const MAX_MATCHES = 1_000_000;
/** Longest date range in results mode (one request per day and tour gender). */
export const MAX_RANGE_DAYS = 3 * 366;
export const DEFAULT_DAYS_AHEAD = 1;
export const MAX_DAYS_AHEAD = 7;
/** TennisExplorer's default time zone (its days and start times). */
export const SITE_TIME_ZONE = "Europe/Prague";

export class InputError extends Error {}

const DAY_MS = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * "2026-09-01", "today", "yesterday" or relative "7 days" / "2 weeks" /
 * "3 months" (ago), relative to `now` (UTC).
 */
export function parseDate(
  v: unknown,
  now: Date,
  name: string,
): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const s = String(v).trim().toLowerCase();
  if (s === "today") return iso(now);
  if (s === "yesterday") return iso(new Date(now.getTime() - DAY_MS));
  const rel = /^(\d+)\s*(day|week|month|year)s?(\s+ago)?$/.exec(s);
  if (rel) {
    const n = Number(rel[1]);
    const d = new Date(now);
    const unit = rel[2];
    if (unit === "day") d.setUTCDate(d.getUTCDate() - n);
    if (unit === "week") d.setUTCDate(d.getUTCDate() - 7 * n);
    if (unit === "month") d.setUTCMonth(d.getUTCMonth() - n);
    if (unit === "year") d.setUTCFullYear(d.getUTCFullYear() - n);
    return iso(d);
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) {
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
    if (!Number.isNaN(d.getTime()) && iso(d) === `${m[1]}-${m[2]}-${m[3]}`)
      return iso(d);
  }
  throw new InputError(
    `${name} "${String(v)}" must be YYYY-MM-DD, "yesterday", or relative like "7 days".`,
  );
}

/** Calendar date (YYYY-MM-DD) of `now` in TennisExplorer's time zone. */
export function siteToday(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SITE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** `date` plus `days` days (YYYY-MM-DD). */
export const addDays = (date: string, days: number): string =>
  iso(new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS));

/** Dates from start up to end (oldest first), inclusive. */
export const datesAsc = (start: string, end: string): string[] =>
  datesDesc(start, end).reverse();

/** Dates from end down to start (newest first), inclusive. */
export function datesDesc(start: string, end: string): string[] {
  const out: string[] = [];
  for (
    let t = Date.parse(`${end}T00:00:00Z`);
    t >= Date.parse(`${start}T00:00:00Z`);
    t -= DAY_MS
  ) {
    out.push(iso(new Date(t)));
  }
  return out;
}

/** Accepts "hurkacz", "/player/hurkacz/" or a full player URL. */
export function parsePlayerSlug(v: string): string {
  const s = v.trim();
  const m = /\/player\/([^/?#\s]+)/.exec(s);
  const slug = (m ? m[1]! : s).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug))
    throw new InputError(
      `"${v}" is not a TennisExplorer player slug or URL (e.g. "hurkacz" or https://www.tennisexplorer.com/player/hurkacz/).`,
    );
  return slug;
}

export function normalizeInput(
  raw: RawInput | null | undefined,
  now: Date = new Date(),
): NormalizedInput {
  const r = raw ?? {};
  const today = iso(now);

  const modeRaw =
    r.mode === undefined || r.mode === null || r.mode === ""
      ? "results"
      : String(r.mode).trim().toLowerCase();
  if (!MODES.includes(modeRaw as Mode))
    throw new InputError(
      `Unknown mode "${String(r.mode)}". Use: ${MODES.join(", ")}.`,
    );
  const mode = modeRaw as Mode;

  let daysAhead = DEFAULT_DAYS_AHEAD;
  if (r.daysAhead !== undefined && r.daysAhead !== null && r.daysAhead !== "") {
    daysAhead = Number(r.daysAhead);
    if (
      !Number.isInteger(daysAhead) ||
      daysAhead < 1 ||
      daysAhead > MAX_DAYS_AHEAD
    )
      throw new InputError(
        `daysAhead must be a whole number from 1 to ${MAX_DAYS_AHEAD}.`,
      );
  }

  const playerSlugs = [
    ...new Set(
      (Array.isArray(r.playerSlugs) ? r.playerSlugs : [])
        .filter((s): s is string => typeof s === "string" && !!s.trim())
        .map(parsePlayerSlug),
    ),
  ];
  if (mode === "upcoming" && playerSlugs.length)
    throw new InputError(
      'playerSlugs works in "results" mode only; upcoming mode lists every scheduled match of the selected tours.',
    );

  const tours = normalizeTours(r.tours);
  const maxMatches = normalizeMax(r.maxMatches);
  const flags = {
    includeRoundAndSurface: r.includeRoundAndSurface !== false,
    includeBookmakerOdds: r.includeBookmakerOdds === true,
    onlyNew: r.onlyNew === true,
    maxMatches,
  };

  if (mode === "upcoming") {
    // startDate/endDate are ignored: today (site time) .. today + daysAhead.
    const start = siteToday(now);
    return {
      mode,
      daysAhead,
      startDate: start,
      endDate: addDays(start, daysAhead),
      tours,
      playerSlugs,
      ...flags,
    };
  }

  let endDate =
    parseDate(r.endDate, now, "endDate") ??
    parseDate("yesterday", now, "endDate")!;
  if (endDate > today) endDate = today;
  const startDefault = playerSlugs.length
    ? `${endDate.slice(0, 4)}-01-01`
    : endDate;
  const startDate = parseDate(r.startDate, now, "startDate") ?? startDefault;
  if (startDate > endDate)
    throw new InputError(
      `startDate (${startDate}) must be on or before endDate (${endDate}).`,
    );
  if (startDate < "1990-01-01")
    throw new InputError("startDate must be 1990-01-01 or later.");
  const days = datesDesc(startDate, endDate).length;
  if (!playerSlugs.length && days > MAX_RANGE_DAYS)
    throw new InputError(
      `Date range is ${days} days; split it into runs of at most ${MAX_RANGE_DAYS} days.`,
    );

  return {
    mode,
    daysAhead,
    startDate,
    endDate,
    tours,
    playerSlugs,
    ...flags,
  };
}

function normalizeTours(raw: unknown): Tour[] {
  const toursRaw = Array.isArray(raw) && raw.length ? raw : DEFAULT_TOURS;
  return [
    ...new Set(
      toursRaw.map((t) => {
        const u = String(t)
          .trim()
          .toUpperCase()
          .replace(/[\s-]+/g, "_") as Tour;
        if (!TOURS.includes(u))
          throw new InputError(
            `Unknown tour "${t}". Use: ${TOURS.join(", ")}.`,
          );
        return u;
      }),
    ),
  ];
}

function normalizeMax(raw: unknown): number {
  let max = DEFAULT_MAX_MATCHES;
  if (raw !== undefined && raw !== null && raw !== "") {
    max = Math.floor(Number(raw));
    if (!Number.isFinite(max) || max < 1)
      throw new InputError("maxMatches must be a number >= 1.");
  }
  return Math.min(max, MAX_MATCHES);
}
