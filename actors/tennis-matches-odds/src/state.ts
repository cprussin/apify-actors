import { createHash } from "node:crypto";

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
