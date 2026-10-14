import type { SearchType } from "./soundcloud.js";
import { parseTarget, TargetError, targetKey, type Target } from "./target.js";

/** Raw actor input, as defined in .actor/input_schema.json. */
export interface RawInput {
  urls?: (string | { url?: string })[];
  search?: string;
  searchType?: string;
  maxItems?: number | string;
  maxConcurrency?: number | string;
  proxyConfiguration?: Record<string, unknown>;
}

export interface NormalizedInput {
  targets: Target[];
  search?: string;
  searchType: SearchType;
  maxItems: number;
  maxConcurrency: number;
}

export const SEARCH_TYPES: SearchType[] = ["tracks", "users", "playlists"];
export const DEFAULT_MAX_ITEMS = 10;
export const MAX_ITEMS_CAP = 1000;
export const DEFAULT_CONCURRENCY = 5;
export const MAX_CONCURRENCY_CAP = 20;

export class InputError extends Error {}

const int = (v: unknown, name: string, def: number, min: number): number => {
  if (v === undefined || v === null || v === "") return def;
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < min)
    throw new InputError(`${name} must be a number >= ${min}.`);
  return n;
};

export function normalizeInput(
  raw: RawInput | null | undefined,
): NormalizedInput {
  const r: RawInput = raw ?? {};

  const targets = new Map<string, Target>();
  for (const item of Array.isArray(r.urls) ? r.urls : []) {
    const s = typeof item === "string" ? item : item?.url;
    if (typeof s !== "string" || !s.trim()) continue;
    try {
      const t = parseTarget(s);
      targets.set(targetKey(t), t);
    } catch (e) {
      if (e instanceof TargetError) throw new InputError(e.message);
      throw e;
    }
  }

  const search =
    typeof r.search === "string" && r.search.trim()
      ? r.search.trim()
      : undefined;

  if (!targets.size && !search)
    throw new InputError(
      "Add at least one SoundCloud URL to `urls`, or a `search` keyword.",
    );

  let searchType: SearchType = "tracks";
  if (r.searchType !== undefined && r.searchType !== "") {
    if (!SEARCH_TYPES.includes(r.searchType as SearchType))
      throw new InputError(
        `searchType must be one of: ${SEARCH_TYPES.join(", ")}.`,
      );
    searchType = r.searchType as SearchType;
  }

  return {
    targets: [...targets.values()],
    search,
    searchType,
    maxItems: Math.min(
      int(r.maxItems, "maxItems", DEFAULT_MAX_ITEMS, 1),
      MAX_ITEMS_CAP,
    ),
    maxConcurrency: Math.min(
      int(r.maxConcurrency, "maxConcurrency", DEFAULT_CONCURRENCY, 1),
      MAX_CONCURRENCY_CAP,
    ),
  };
}
