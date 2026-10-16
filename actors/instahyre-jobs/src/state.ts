import { createHash } from "node:crypto";

/**
 * Monitor-mode state, persisted between runs in a named key-value store
 * under a key derived from the search filters (`STATE-<hash>`).
 *
 * It maps the ID of every job in the last complete set of results to a
 * fingerprint of its listed data: a job is "new" if its ID is unknown,
 * "updated" if its fingerprint changed, and "removed" if a later complete
 * scan no longer finds it. Capped at `max` entries, least recently seen
 * evicted first.
 */
export interface MonitorStateJSON {
  version: 1;
  /** [id, fingerprint] pairs, least recently seen first. */
  items: [string, string][];
}

export const MAX_JOBS = 50_000;

export type Change = "new" | "updated" | "unchanged";

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

export const hash = (v: unknown, length = 16) =>
  createHash("sha256").update(stable(v)).digest("hex").slice(0, length);

/** Key-value store record key for the given search parameters. */
export const stateKey = (params: unknown) => `STATE-${hash(params)}`;

export class MonitorState {
  private readonly items = new Map<string, string>();
  /** IDs seen in this run's results (new, updated or unchanged). */
  private readonly current = new Set<string>();

  /** `raw`: a previous `toJSON()` value; anything unexpected starts empty. */
  constructor(
    raw?: unknown,
    private readonly max = MAX_JOBS,
  ) {
    const items = (raw as MonitorStateJSON | null)?.items;
    if (!Array.isArray(items)) return;
    for (const e of items) {
      if (Array.isArray(e) && typeof e[0] === "string") {
        this.items.set(e[0], typeof e[1] === "string" ? e[1] : "");
      }
    }
  }

  get size(): number {
    return this.items.size;
  }

  /** True on the first run (nothing stored yet). */
  get isBaseline(): boolean {
    return this.items.size === 0;
  }

  /** How a job found in this run compares with the stored state. */
  classify(id: string, fingerprint: string): Change {
    const prev = this.items.get(id);
    if (prev === undefined) return "new";
    return prev === fingerprint ? "unchanged" : "updated";
  }

  /**
   * Record a job found in this run: after it was output (new/updated), or
   * when unchanged (refreshes it so it is not evicted or reported removed).
   */
  record(id: string, fingerprint: string): void {
    this.current.add(id);
    this.items.delete(id);
    this.items.set(id, fingerprint);
  }

  /** Stored jobs not found in this run, oldest first. */
  missing(): string[] {
    return [...this.items.keys()].filter((id) => !this.current.has(id));
  }

  /** Forget a job after it was output as removed. */
  remove(id: string): void {
    this.items.delete(id);
  }

  /** Serializable state, keeping the `max` most recently seen entries. */
  toJSON(): MonitorStateJSON {
    const all = [...this.items];
    return { version: 1, items: all.slice(Math.max(0, all.length - this.max)) };
  }
}
