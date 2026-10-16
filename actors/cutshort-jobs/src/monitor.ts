import { createHash } from "node:crypto";

/**
 * Monitor-mode state, persisted between runs in a named key-value store
 * under a key derived from the input (`STATE-<hash>`).
 *
 * For every job returned before it keeps a fingerprint of its content and
 * enough to describe it once it disappears. A job is "new" if its ID is
 * unknown, "updated" if its fingerprint changed, and "removed" if a complete
 * crawl no longer finds it. Entries are kept least-recently-seen first and
 * capped at `max`.
 */
export type ChangeType = "new" | "updated" | "removed";

export interface Known {
  fingerprint: string;
  headline: string | null;
  companyName: string | null;
  url: string | null;
}

export interface MonitorState {
  version: 1;
  /** [id, fingerprint, headline, companyName, url], least recently seen first. */
  items: [string, string, string | null, string | null, string | null][];
}

export const MAX_KNOWN = 50_000;

/** Stable JSON (sorted object keys) for hashing. */
export function stable(v: unknown): string {
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

const hash = (v: unknown, n: number) =>
  createHash("sha256").update(stable(v)).digest("hex").slice(0, n);

/** Key-value store record key for the given query parameters. */
export const stateKey = (params: unknown) => `STATE-${hash(params, 16)}`;

/** Short content fingerprint. */
export const fingerprint = (v: unknown) => hash(v, 12);

const s = (v: unknown) => (typeof v === "string" ? v : null);

export class Monitor {
  private readonly items = new Map<string, Known>();
  private readonly seenNow = new Set<string>();

  /** `raw`: a previous `toJSON()` value; anything unexpected starts empty. */
  constructor(
    raw?: unknown,
    private readonly max = MAX_KNOWN,
  ) {
    const items = (raw as MonitorState | null)?.items;
    if (!Array.isArray(items)) return;
    for (const e of items) {
      if (Array.isArray(e) && typeof e[0] === "string") {
        this.items.set(e[0], {
          fingerprint: s(e[1]) ?? "",
          headline: s(e[2]),
          companyName: s(e[3]),
          url: s(e[4]),
        });
      }
    }
  }

  get size(): number {
    return this.items.size;
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  /** Marks `id` as still listed and says how it changed (null = unchanged). */
  check(id: string, fp: string): "new" | "updated" | null {
    this.seenNow.add(id);
    const known = this.items.get(id);
    if (!known) return "new";
    if (known.fingerprint !== fp) return "updated";
    // Refresh recency so listed jobs are never evicted first.
    this.items.delete(id);
    this.items.set(id, known);
    return null;
  }

  /** Marks `id` as still listed without comparing content. */
  touch(id: string): void {
    this.seenNow.add(id);
  }

  /** Records a job that was returned (and charged). */
  record(id: string, known: Known): void {
    this.seenNow.add(id);
    this.items.delete(id);
    this.items.set(id, known);
  }

  /** Known jobs not listed in this run (only meaningful after a complete crawl). */
  missing(): [string, Known][] {
    return [...this.items].filter(([id]) => !this.seenNow.has(id));
  }

  /** Forgets a job (after reporting it removed). */
  delete(id: string): void {
    this.items.delete(id);
  }

  /** Serializable state, keeping the `max` most recently seen entries. */
  toJSON(): MonitorState {
    const all = [...this.items].map(
      ([id, k]) =>
        [id, k.fingerprint, k.headline, k.companyName, k.url] as [
          string,
          string,
          string | null,
          string | null,
          string | null,
        ],
    );
    return { version: 1, items: all.slice(Math.max(0, all.length - this.max)) };
  }
}
