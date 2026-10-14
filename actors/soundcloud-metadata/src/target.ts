/** A SoundCloud URL to resolve into a track, user or playlist object. */
export interface Target {
  /** Canonical https://soundcloud.com/... URL passed to /resolve. */
  url: string;
  /** The original input string, echoed back on each item. */
  input: string;
}

export class TargetError extends Error {}

/** Hosts whose paths map onto soundcloud.com. */
const CANONICAL_HOSTS = new Set([
  "soundcloud.com",
  "www.soundcloud.com",
  "m.soundcloud.com",
]);
/** Short links (soundcloud.com/share buttons); /resolve follows them. */
const SHORT_HOSTS = new Set(["on.soundcloud.com"]);

export const targetKey = (t: Target): string => t.url.toLowerCase();

/**
 * Parse a SoundCloud reference into a canonical URL for /resolve:
 * - "https://soundcloud.com/edsheeran" (user)
 * - "https://soundcloud.com/edsheeran/shape-of-you" (track)
 * - "https://soundcloud.com/edsheeran/sets/x" (playlist)
 * - "soundcloud.com/edsheeran" (scheme added)
 * - "https://on.soundcloud.com/abcd" (short link, passed through)
 */
export function parseTarget(input: string): Target {
  const s = input.trim();
  if (!s) throw new TargetError("Empty SoundCloud reference.");

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    throw new TargetError(`"${s}" is not a SoundCloud URL.`);
  }
  const host = url.hostname.toLowerCase();

  if (SHORT_HOSTS.has(host)) {
    if (!url.pathname.replace(/\/+$/, "").slice(1))
      throw new TargetError(`"${s}" is not a SoundCloud URL.`);
    return { url: `https://${host}${url.pathname}`, input };
  }

  if (!CANONICAL_HOSTS.has(host))
    throw new TargetError(
      `"${s}" is not a soundcloud.com URL (host: ${host || "none"}).`,
    );

  const path = url.pathname.replace(/\/+$/, "");
  const parts = path.split("/").filter(Boolean);
  if (!parts.length)
    throw new TargetError(
      `"${s}" is the SoundCloud homepage, not a track, user or playlist.`,
    );
  // Internal pages that are not resolvable objects.
  const reserved = new Set([
    "discover",
    "search",
    "stream",
    "upload",
    "you",
    "settings",
    "notifications",
    "messages",
    "pages",
    "tags",
    "charts",
  ]);
  if (reserved.has(parts[0]!.toLowerCase()))
    throw new TargetError(`"${s}" is a SoundCloud app page, not an object.`);

  return { url: `https://soundcloud.com/${parts.join("/")}`, input };
}
