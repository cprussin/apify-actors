import type { SeenStore } from "./run.js";

export const STATE_STORE_NAME = "new-business-registrations-state";
/** Cap on remembered IDs per input hash (oldest dropped first). */
export const MAX_SEEN_IDS = 200_000;

export interface KeyValueLike {
  getValue<T>(key: string): Promise<T | null>;
  setValue(key: string, value: unknown): Promise<void>;
}

export const seenKey = (hash: string): string => `SEEN-${hash}`;

/** Set of previously emitted "STATE:entityId" keys, persisted in a named key-value store. */
export class PersistentSeenStore implements SeenStore {
  private dirty = false;

  private constructor(
    private readonly kv: KeyValueLike,
    private readonly key: string,
    private readonly ids: Set<string>,
  ) {}

  static async open(
    kv: KeyValueLike,
    hash: string,
  ): Promise<PersistentSeenStore> {
    const key = seenKey(hash);
    const stored = await kv.getValue<{ ids?: string[] }>(key);
    return new PersistentSeenStore(kv, key, new Set(stored?.ids ?? []));
  }

  get size(): number {
    return this.ids.size;
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }

  add(id: string): void {
    if (this.ids.has(id)) return;
    this.ids.add(id);
    this.dirty = true;
  }

  async save(): Promise<void> {
    if (!this.dirty) return;
    let ids = [...this.ids];
    if (ids.length > MAX_SEEN_IDS) ids = ids.slice(ids.length - MAX_SEEN_IDS);
    this.dirty = false;
    await this.kv.setValue(this.key, {
      updatedAt: new Date().toISOString(),
      ids,
    });
  }
}
