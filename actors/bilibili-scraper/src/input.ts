import {
  parseUserRef,
  parseVideoRef,
  RefError,
  videoRefKey,
  type UserRef,
  type VideoRef,
} from "./parse.js";
import { SEARCH_ORDER, type SearchOrder } from "./source.js";

export type Mode = "trending" | "search" | "videos" | "user";
export const MODES: readonly Mode[] = ["trending", "search", "videos", "user"];

/** Raw actor input, as defined in .actor/input_schema.json. */
export interface RawInput {
  mode?: string;
  keywords?: string[];
  searchOrder?: string;
  videos?: (string | { url?: string })[];
  userIds?: (string | number)[];
  maxItems?: number | string;
  includeComments?: boolean;
  maxCommentsPerVideo?: number | string;
  onlyNew?: boolean;
  proxyConfiguration?: Record<string, unknown>;
}

export interface NormalizedInput {
  mode: Mode;
  keywords: string[];
  searchOrder: SearchOrder;
  videos: VideoRef[];
  users: UserRef[];
  maxItems: number;
  includeComments: boolean;
  maxCommentsPerVideo: number;
  /** Skip videos returned by earlier runs with the same input (monitoring). */
  onlyNew: boolean;
}

export const DEFAULT_MAX_ITEMS = 10;
export const MAX_ITEMS = 10_000;
export const DEFAULT_MAX_COMMENTS = 10;
export const MAX_COMMENTS = 1000;

export class InputError extends Error {}

const toInt = (v: unknown, name: string, dflt: number): number => {
  if (v === undefined || v === null || v === "") return dflt;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new InputError(`${name} must be a number.`);
  return Math.floor(n);
};

const strings = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [])
    .map((x: unknown) =>
      typeof x === "object" && x !== null
        ? String((x as { url?: unknown }).url ?? "")
        : String(x ?? ""),
    )
    .map((s) => s.trim())
    .filter(Boolean);

export function normalizeInput(
  raw: RawInput | null | undefined,
): NormalizedInput {
  const r = raw ?? {};
  const mode = String(r.mode || "trending").trim() as Mode;
  if (!MODES.includes(mode))
    throw new InputError(`mode must be one of ${MODES.join(", ")}.`);

  const searchOrder = String(r.searchOrder || "relevance") as SearchOrder;
  if (!(searchOrder in SEARCH_ORDER))
    throw new InputError(
      `searchOrder must be one of ${Object.keys(SEARCH_ORDER).join(", ")}.`,
    );

  const keywords = [...new Set(strings(r.keywords))];
  const videos = new Map<string, VideoRef>();
  const users = new Map<string, UserRef>();
  try {
    for (const s of strings(r.videos)) {
      const ref = parseVideoRef(s);
      videos.set(videoRefKey(ref), ref);
    }
    for (const s of strings(r.userIds)) {
      const ref = parseUserRef(s);
      users.set("mid" in ref ? ref.mid : `name:${ref.name}`, ref);
    }
  } catch (e) {
    if (e instanceof RefError) throw new InputError(e.message);
    throw e;
  }

  if (mode === "search" && !keywords.length)
    throw new InputError('mode "search" needs at least one keyword.');
  if (mode === "videos" && !videos.size)
    throw new InputError(
      'mode "videos" needs at least one video URL or BV id in videos.',
    );
  if (mode === "user" && !users.size)
    throw new InputError(
      'mode "user" needs at least one UID or space.bilibili.com URL in userIds.',
    );

  const maxItems = toInt(r.maxItems, "maxItems", DEFAULT_MAX_ITEMS);
  if (maxItems < 1) throw new InputError("maxItems must be >= 1.");
  const maxComments = toInt(
    r.maxCommentsPerVideo,
    "maxCommentsPerVideo",
    DEFAULT_MAX_COMMENTS,
  );
  if (maxComments < 1)
    throw new InputError("maxCommentsPerVideo must be >= 1.");

  return {
    mode,
    keywords,
    searchOrder,
    videos: [...videos.values()],
    users: [...users.values()],
    maxItems: Math.min(maxItems, MAX_ITEMS),
    includeComments: r.includeComments ?? true,
    maxCommentsPerVideo: Math.min(maxComments, MAX_COMMENTS),
    onlyNew: r.onlyNew === true,
  };
}
