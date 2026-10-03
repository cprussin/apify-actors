import { createHash } from "node:crypto";

/**
 * "Only new items" (monitoring) state, persisted between runs in a named
 * key-value store under a key derived from the input (`STATE-<hash>`).
 *
 * It remembers the IDs of items already returned, each with an optional
 * fingerprint (e.g. a price): an item is new if its ID is unknown or its
 * fingerprint changed. Entries are kept least-recently-seen first and capped
 * at `max`, so items still showing up in results are never evicted first.
 *
 * Identical copy in every actor that has `onlyNew` (each actor builds alone).
 */
export interface SeenState {
  version: 1;
  /** [id, fingerprint] pairs, least recently seen first. */
  items: [string, string][];
}

export const MAX_SEEN = 50_000;

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
  private readonly items = new Map<string, string>();

  /** `raw`: a previous `toJSON()` value; anything unexpected starts empty. */
  constructor(
    raw?: unknown,
    private readonly max = MAX_SEEN,
  ) {
    const items = (raw as SeenState | null)?.items;
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

  /** True if `id` was returned before with the same fingerprint. */
  has(id: string, fingerprint = ""): boolean {
    return this.items.get(id) === fingerprint;
  }

  /**
   * Record an item that was returned (and charged), or refresh one that was
   * skipped so it stays in the capped state.
   */
  add(id: string, fingerprint = ""): void {
    this.items.delete(id);
    this.items.set(id, fingerprint);
  }

  /** Serializable state, keeping the `max` most recently seen entries. */
  toJSON(): SeenState {
    const all = [...this.items];
    return { version: 1, items: all.slice(Math.max(0, all.length - this.max)) };
  }
}
