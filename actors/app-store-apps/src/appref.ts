// Copied from actors/app-store-reviews/src/review.ts (actors are
// self-contained Docker builds, so they can't import each other).
import type { Store } from "./app.js";

export interface AppRef {
  store: Store;
  /** Apple: numeric track ID or "bundle:<bundle ID>". Google: package name. */
  id: string;
}

export class AppRefError extends Error {}

const PACKAGE_RE = /^[a-zA-Z][\w]*(\.[a-zA-Z_][\w]*)+$/;

/**
 * Detect the store from an app URL or ID.
 * - https://apps.apple.com/us/app/name/id324684580, id324684580, 324684580 -> Apple
 * - https://play.google.com/store/apps/details?id=com.spotify.music, com.spotify.music -> Google
 * - Prefixes force a store: "apple:", "ios:", "google:", "android:", "play:"
 */
export function parseAppRef(input: string): AppRef {
  const s = input.trim();
  if (!s) throw new AppRefError("Empty app reference.");

  const prefixed =
    /^(apple|ios|appstore|google|android|play|googleplay):\s*(.+)$/i.exec(s);
  if (prefixed) {
    const [, p, rest] = prefixed;
    const store: Store = /^(apple|ios|appstore)$/i.test(p!)
      ? "apple"
      : "google";
    const ref = parseAppRef(rest!);
    if (ref.store === store) return ref;
    // "google:1234" is invalid; "apple:com.foo" means an Apple bundle ID.
    if (store === "apple" && PACKAGE_RE.test(rest!.trim()))
      return { store, id: `bundle:${rest!.trim()}` };
    throw new AppRefError(`"${s}" is not a valid ${store} app reference.`);
  }

  if (/^https?:\/\//i.test(s)) {
    let url: URL;
    try {
      url = new URL(s);
    } catch {
      throw new AppRefError(`Invalid URL "${s}".`);
    }
    const host = url.hostname.toLowerCase();
    if (host.endsWith("apple.com")) {
      const m =
        /\/id(\d+)/.exec(url.pathname) ??
        /^(\d+)$/.exec(url.searchParams.get("id") ?? "");
      if (m) return { store: "apple", id: m[1]! };
      throw new AppRefError(`No app ID (id123...) found in Apple URL "${s}".`);
    }
    if (host === "play.google.com" || host.endsWith(".play.google.com")) {
      const id = url.searchParams.get("id");
      if (id && PACKAGE_RE.test(id)) return { store: "google", id };
      throw new AppRefError(
        `No "?id=" package name in Google Play URL "${s}".`,
      );
    }
    throw new AppRefError(
      `Unsupported URL "${s}". Use an apps.apple.com or play.google.com link.`,
    );
  }

  const apple = /^(?:id)?(\d{5,})$/i.exec(s);
  if (apple) return { store: "apple", id: apple[1]! };
  if (PACKAGE_RE.test(s)) return { store: "google", id: s };
  throw new AppRefError(
    `Can't tell which store "${s}" belongs to. Use an App Store / Google Play URL, an Apple ID like id324684580, or a package name like com.spotify.music.`,
  );
}

export const appKey = (ref: AppRef): string => `${ref.store}:${ref.id}`;
