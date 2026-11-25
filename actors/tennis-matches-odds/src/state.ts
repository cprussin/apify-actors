import { createHash } from "node:crypto";
import type { UpcomingMatch } from "./match.js";

/**
 * "Only new matches" (monitoring) state, persisted between runs in a named
 * key-value store under a key derived from the input. It keeps the IDs (with
 * dates) of matches already returned, so a scheduled run with a rolling date
 * window (e.g. startDate "3 days") returns each match once, including results
 * TennisExplorer adds late.
 */
export interface SeenState {
  version: 1;
  seen: Record<string, string>;
}

/** Keep IDs this many days older than the newest one seen. */
export const KEEP_DAYS = 400;
export const MAX_SEEN = 200_000;
const DAY_MS = 86_400_000;

/** Stable JSON (sorted object keys) for hashing. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v)
      .sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map(
        (k) =>
          `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/** Key-value store record key for the given query parameters. */
export function stateKey(params: unknown): string {
  const h = createHash("sha256").update(stable(params)).digest("hex");
  return `STATE-${h.slice(0, 16)}`;
}

/**
 * Hash of a scheduled match's prices: the average home/away odds plus every
 * bookmaker's current home/away odds (order-independent). Opening odds are
 * left out: they never move once set.
 */
export function oddsHash(m: UpcomingMatch): string {
  const books = (m.bookmakers ?? [])
    .map((b) => [b.name, b.home, b.away] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return createHash("sha256")
    .update(stable({ h: m.oddsHome, a: m.oddsAway, b: books }))
    .digest("hex")
    .slice(0, 16);
}

export interface OddsState {
  version: 1;
  /** matchId -> [odds hash, scheduled date] */
  odds: Record<string, [string, string]>;
}

/** Keep upcoming-match hashes this many days older than the newest date. */
export const ODDS_KEEP_DAYS = 30;

/**
 * Upcoming-mode onlyNew state: the last emitted odds hash per match, so a
 * scheduled run re-emits a match only when its prices change.
 */
export class OddsSeen {
  private readonly odds: Record<string, [string, string]> = {};

  constructor(raw?: unknown) {
    const o = (raw as OddsState | null)?.odds;
    if (o && typeof o === "object") {
      for (const [id, v] of Object.entries(o)) {
        if (
          Array.isArray(v) &&
          typeof v[0] === "string" &&
          typeof v[1] === "string"
        )
          this.odds[id] = [v[0], v[1]];
      }
    }
  }

  get size(): number {
    return Object.keys(this.odds).length;
  }

  /** True when the match was emitted before with exactly these odds. */
  unchanged(id: string, hash: string): boolean {
    return this.odds[id]?.[0] === hash;
  }

  /** Record a match that was emitted (and charged) with these odds. */
  add(id: string, hash: string, date: string): void {
    this.odds[id] = [hash, date];
  }

  toJSON(): OddsState {
    const entries = Object.entries(this.odds).sort((a, b) =>
      a[1][1] < b[1][1] ? 1 : a[1][1] > b[1][1] ? -1 : 0,
    );
    const newest = entries[0]?.[1][1];
    const cutoff = newest
      ? new Date(Date.parse(`${newest}T00:00:00Z`) - ODDS_KEEP_DAYS * DAY_MS)
          .toISOString()
          .slice(0, 10)
      : "";
    return {
      version: 1,
      odds: Object.fromEntries(
        entries.filter(([, v]) => v[1] >= cutoff).slice(0, MAX_SEEN),
      ),
    };
  }
}

export class Seen {
  private readonly seen: Record<string, string> = {};

  constructor(raw?: unknown) {
    const s = (raw as SeenState | null)?.seen;
    if (s && typeof s === "object") {
      for (const [id, d] of Object.entries(s)) {
        if (typeof d === "string") this.seen[id] = d;
      }
    }
  }

  get size(): number {
    return Object.keys(this.seen).length;
  }

  has(id: string): boolean {
    return id in this.seen;
  }

  /** Record a match that was emitted (and charged). */
  add(id: string, date: string): void {
    this.seen[id] = date;
  }

  /** Serializable state, pruned to the newest KEEP_DAYS / MAX_SEEN entries. */
  toJSON(): SeenState {
    const entries = Object.entries(this.seen).sort((a, b) =>
      a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0,
    );
    const newest = entries[0]?.[1];
    const cutoff = newest
      ? new Date(Date.parse(`${newest}T00:00:00Z`) - KEEP_DAYS * DAY_MS)
          .toISOString()
          .slice(0, 10)
      : "";
    return {
      version: 1,
      seen: Object.fromEntries(
        entries.filter(([, d]) => d >= cutoff).slice(0, MAX_SEEN),
      ),
    };
  }
}
