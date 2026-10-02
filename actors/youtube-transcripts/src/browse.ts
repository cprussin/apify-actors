/** Pure parsing of InnerTube /browse (playlist) and /navigation/resolve_url responses. */

export interface PlaylistPage {
  videoIds: string[];
  continuation?: string;
  title?: string;
}

type Json = Record<string, unknown>;

/**
 * Walk the (deeply nested, frequently redesigned) browse response and collect
 * video IDs from both the current `lockupViewModel` and the legacy
 * `playlistVideoRenderer` shapes, plus the next-page continuation token.
 */
export function parsePlaylistPage(json: unknown): PlaylistPage {
  const ids: string[] = [];
  const seen = new Set<string>();
  let continuation: string | undefined;
  let title: string | undefined;
  const add = (id: unknown) => {
    if (typeof id === "string" && /^[\w-]{11}$/.test(id) && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  };
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (!v || typeof v !== "object") return;
    const o = v as Json;
    for (const [k, val] of Object.entries(o)) {
      const inner = (val ?? {}) as Json;
      if (k === "lockupViewModel") {
        if (inner.contentType === "LOCKUP_CONTENT_TYPE_VIDEO")
          add(inner.contentId);
        continue;
      }
      if (k === "playlistVideoRenderer") {
        add(inner.videoId);
        continue;
      }
      if (k === "continuationCommand" && typeof inner.token === "string") {
        continuation = inner.token;
        continue;
      }
      if (
        k === "playlistMetadataRenderer" &&
        typeof inner.title === "string" &&
        !title
      ) {
        title = inner.title;
      }
      walk(val);
    }
  };
  walk(json);
  return { videoIds: ids, continuation, title };
}

/** Channel ID (UC...) from a /navigation/resolve_url response, if it points to a channel. */
export function parseResolvedChannelId(json: unknown): string | undefined {
  const ep = (json as Json | null)?.endpoint as Json | undefined;
  const id = (ep?.browseEndpoint as Json | undefined)?.browseId;
  return typeof id === "string" && /^UC[\w-]{22}$/.test(id) ? id : undefined;
}
