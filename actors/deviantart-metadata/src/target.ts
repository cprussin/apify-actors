import { BASE } from "./item.js";

export class TargetError extends Error {}

const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,49}$/;
const MAIN_HOSTS = new Set(["deviantart.com", "www.deviantart.com"]);
/** First path segments that are site pages, not usernames. */
const RESERVED = new Set([
  "search",
  "tag",
  "topic",
  "popular",
  "watch",
  "notifications",
  "settings",
  "users",
  "join",
  "download",
  "checkout",
  "global",
  "api",
  "about",
  "team",
  "core-membership",
  "shop",
  "deviation",
  "daily-deviations",
  "_nsfgfb",
]);

const toUrl = (s: string): URL | null => {
  try {
    return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
};

/**
 * A DeviantArt username from "wlop", "@wlop", "deviantart.com/wlop",
 * "https://www.deviantart.com/wlop/gallery" or "wlop.deviantart.com".
 */
export function parseUsername(input: string): string {
  const s = input.trim().replace(/^@/, "");
  if (!s) throw new TargetError("Empty username.");
  if (USERNAME_RE.test(s)) return s.toLowerCase();
  const url = s.includes(".") || s.includes("/") ? toUrl(s) : null;
  if (url) {
    const host = url.hostname.toLowerCase();
    let name: string | undefined;
    if (MAIN_HOSTS.has(host)) name = url.pathname.split("/").filter(Boolean)[0];
    else if (host.endsWith(".deviantart.com")) name = host.split(".")[0];
    if (name && USERNAME_RE.test(name) && !RESERVED.has(name.toLowerCase()))
      return name.toLowerCase();
  }
  throw new TargetError(
    `"${input}" is not a DeviantArt username or profile URL.`,
  );
}

export interface DeviationTarget {
  /** Canonical https://www.deviantart.com/<user>/art/<slug>-<id> URL. */
  url: string;
  id: number | null;
  input: string;
}

/**
 * Parse a deviation URL: www.deviantart.com/<user>/art/<slug>-<id> or the
 * legacy <user>.deviantart.com/art/<slug>-<id>.
 */
export function parseDeviationUrl(input: string): DeviationTarget {
  const s = input.trim();
  const url = toUrl(s);
  if (!url) throw new TargetError(`"${s}" is not a DeviantArt deviation URL.`);
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);
  let user: string | undefined;
  let slug: string | undefined;
  if (MAIN_HOSTS.has(host) && parts[1]?.toLowerCase() === "art" && parts[2]) {
    user = parts[0];
    slug = parts[2];
  } else if (
    host.endsWith(".deviantart.com") &&
    !MAIN_HOSTS.has(host) &&
    parts[0]?.toLowerCase() === "art" &&
    parts[1]
  ) {
    user = host.split(".")[0];
    slug = parts[1];
  }
  if (!user || !slug || !USERNAME_RE.test(user))
    throw new TargetError(
      `"${s}" is not a DeviantArt deviation URL (expected deviantart.com/<user>/art/<title>-<id>).`,
    );
  const id = /-(\d+)$/.exec(slug)?.[1];
  return {
    url: `${BASE}/${user.toLowerCase()}/art/${slug}`,
    id: id ? Number(id) : null,
    input,
  };
}
