import { createHash } from "node:crypto";

/**
 * "Only new reviews" (monitoring) state, persisted between runs in a named
 * key-value store under a key derived from the input.
 *
 * Per group (company / app) it keeps:
 * - `watermark`: newest review date emitted by a run that finished the group.
 *   Later runs stop paging GRACE_DAYS before it.
 * - `seen`: IDs (with dates) of emitted reviews inside that window, so
 *   late-published or re-ordered reviews are neither lost nor re-emitted.
 */
export interface GroupState {
  watermark?: string;
  seen: Record<string, string>;
}

export interface MonitorState {
  version: 1;
  groups: Record<string, GroupState>;
}

export const GRACE_DAYS = 7;
export const MAX_SEEN_PER_GROUP = 5000;

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

/** Tolerant parse: anything unexpected becomes an empty state. */
export function parseState(raw: unknown): MonitorState {
  const out: MonitorState = { version: 1, groups: {} };
  const groups = (raw as MonitorState | null)?.groups;
  if (!groups || typeof groups !== "object") return out;
  for (const [k, g] of Object.entries(groups)) {
    if (!g || typeof g !== "object") continue;
    const seen: Record<string, string> = {};
    for (const [id, d] of Object.entries(g.seen ?? {})) {
      if (typeof d === "string") seen[id] = d;
    }
    out.groups[k] = {
      watermark: typeof g.watermark === "string" ? g.watermark : undefined,
      seen,
    };
  }
  return out;
}

export class Monitor {
  private readonly state: MonitorState;
  /** Newest date emitted per group in this run. */
  private readonly newest = new Map<string, string>();

  constructor(raw?: unknown) {
    this.state = parseState(raw);
  }

  private group(key: string): GroupState {
    return (this.state.groups[key] ??= { seen: {} });
  }

  /** True if the group has run before (i.e. this is not the baseline run). */
  hasHistory(key: string): boolean {
    return this.state.groups[key]?.watermark !== undefined;
  }

  /** ISO timestamp to stop paging at, or undefined on the first run. */
  since(key: string): string | undefined {
    const w = this.state.groups[key]?.watermark;
    if (!w) return undefined;
    const t = Date.parse(w);
    if (Number.isNaN(t)) return undefined;
    return new Date(t - GRACE_DAYS * DAY_MS).toISOString();
  }

  isSeen(key: string, id: string): boolean {
    return id in (this.state.groups[key]?.seen ?? {});
  }

  /** Record a review that was emitted (and charged). */
  record(key: string, id: string, date: string): void {
    this.group(key).seen[id] = date;
    const n = this.newest.get(key);
    if (n === undefined || date > n) this.newest.set(key, date);
  }

  /**
   * Call when a group is done. `complete` = scanned all the way down to its
   * since date. The watermark only advances when complete, or on the first
   * (baseline) run; a later group cut short (max reviews, budget, error)
   * keeps the old watermark so the remaining new reviews come next run.
   */
  finish(key: string, complete: boolean): void {
    const g = this.group(key);
    if (!complete && g.watermark !== undefined) return;
    const n = this.newest.get(key);
    if (n !== undefined && (g.watermark === undefined || n > g.watermark)) {
      g.watermark = n;
    }
    // A group with no reviews still gets a baseline watermark, so the next
    // run doesn't count as a first run.
    g.watermark ??= new Date(0).toISOString();
  }

  /** Serializable state, with IDs older than the paging window dropped. */
  toJSON(): MonitorState {
    const groups: Record<string, GroupState> = {};
    for (const [k, g] of Object.entries(this.state.groups)) {
      const cutoff = this.since(k) ?? "";
      const seen = Object.entries(g.seen)
        .filter(([, d]) => d >= cutoff)
        .sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0))
        .slice(0, MAX_SEEN_PER_GROUP);
      groups[k] = { watermark: g.watermark, seen: Object.fromEntries(seen) };
    }
    return { version: 1, groups };
  }
}

/** Later of two optional date strings (ISO dates/timestamps compare as strings). */
export function laterOf(
  a: string | undefined,
  b: string | undefined,
): string | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return a > b ? a : b;
}
