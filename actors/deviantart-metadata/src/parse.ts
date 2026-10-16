import {
  fromDeviation,
  fromProfile,
  iso,
  splitTags,
  type Item,
  type RssItem,
} from "./item.js";
import type {
  RawAbout,
  RawDeviation,
  RawDeviationExtended,
  RawProfileOwner,
  RawUser,
} from "./raw.js";
import { extractInitialState } from "./state.js";

type State = Record<string, unknown>;

interface Stream {
  items?: unknown[];
  hasMore?: boolean;
  streamParams?: { gallectionType?: string; folderId?: number };
}

const obj = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;

function entities(state: State) {
  const e = obj(state["@@entities"]) ?? {};
  return {
    deviation: (obj(e.deviation) ?? {}) as Record<string, RawDeviation>,
    user: (obj(e.user) ?? {}) as Record<string, RawUser>,
    deviationExtended: (obj(e.deviationExtended) ?? {}) as Record<
      string,
      RawDeviationExtended
    >,
  };
}

const streams = (state: State) =>
  (obj(state["@@streams"]) ?? {}) as Record<string, Stream>;

function streamDeviations(
  state: State,
  stream: Stream | undefined,
): RawDeviation[] {
  const { deviation } = entities(state);
  return (stream?.items ?? [])
    .map((id) => deviation[String(id)])
    .filter((d): d is RawDeviation => !!d && typeof d === "object");
}

const authorOf = (state: State, d: RawDeviation): RawUser | null =>
  typeof d.author === "number"
    ? (entities(state).user[String(d.author)] ?? null)
    : null;

export interface ListPage {
  items: Item[];
  hasMore: boolean;
  /** Search: estimated total results; gallery: total pages. */
  total: number | null;
}

/** `/search?q=...&page=N`: up to 24 deviations. Null if the page has no state. */
export function parseSearchPage(html: string, source: string): ListPage | null {
  const state = extractInitialState(html);
  if (!state) return null;
  const stream = streams(state)["@@BROWSE_PAGE_STREAM"];
  if (!stream) return null;
  const items = streamDeviations(state, stream).map((d) =>
    fromDeviation(d, { author: authorOf(state, d), source }),
  );
  const page = obj(state.currentPageData);
  return {
    items,
    hasMore: !!stream.hasMore && items.length > 0,
    total: typeof page?.estTotal === "number" ? page.estTotal : null,
  };
}

function ownerOf(state: State): RawProfileOwner | null {
  return (obj(state.profileOwner) as RawProfileOwner | undefined) ?? null;
}

/** `/<user>/gallery?page=N`: the "All" folder, newest first. */
export function parseGalleryPage(
  html: string,
  source: string,
): ListPage | null {
  const state = extractInitialState(html);
  if (!state) return null;
  const all = Object.entries(streams(state)).filter(([k]) =>
    k.startsWith("folder-deviations-gallery-"),
  );
  const stream =
    all.find(([, s]) => s.streamParams?.folderId === -1)?.[1] ?? all[0]?.[1];
  if (!stream) return null;
  const owner = ownerOf(state);
  const watchers = owner?.stats?.watchers ?? null;
  const items = streamDeviations(state, stream).map((d) =>
    fromDeviation(d, {
      author: authorOf(state, d),
      authorWatchers: watchers,
      source,
    }),
  );
  const info = obj(state.pageInfo);
  return {
    items,
    hasMore: !!stream.hasMore && items.length > 0,
    total: typeof info?.totalPages === "number" ? info.totalPages : null,
  };
}

/** `/<user>/art/<slug>-<id>`: one deviation with tags. Null if not parseable. */
export function parseDeviationPage(
  html: string,
  id: number | null,
  source: string,
): Item | null {
  const state = extractInitialState(html);
  if (!state) return null;
  const e = entities(state);
  const d =
    (id !== null ? e.deviation[String(id)] : undefined) ??
    Object.values(e.deviation)[0];
  if (!d) return null;
  const extended =
    Object.values(e.deviationExtended).find(
      (x) => x.parentDeviationEntityId === d.deviationId,
    ) ??
    Object.values(e.deviationExtended)[0] ??
    null;
  return fromDeviation(d, {
    author: authorOf(state, d),
    extended,
    source,
  });
}

/** Find the profile "about" module (under `@@gruser.grusers.*.modules`). */
function findAbout(state: State): RawAbout | null {
  const grusers = obj(obj(state["@@gruser"])?.grusers) ?? {};
  for (const g of Object.values(grusers)) {
    for (const m of Object.values(obj(obj(g)?.modules) ?? {})) {
      const data = obj(obj(m)?.moduleData);
      if (data?.dataKey === "about")
        return (obj(data.about) as RawAbout) ?? null;
    }
  }
  return null;
}

/** `/<user>`: profile stats. Null if the page has no profile state. */
export function parseProfilePage(html: string, source: string): Item | null {
  const state = extractInitialState(html);
  if (!state) return null;
  const owner = ownerOf(state);
  if (!owner) return null;
  const users = entities(state).user;
  const user =
    (owner.user?.id !== undefined ? users[String(owner.user.id)] : undefined) ??
    Object.values(users)[0] ??
    null;
  return fromProfile({ user, owner, about: findAbout(state) }, source);
}

/** Author watcher count from a profile or gallery page. */
export function parseWatchers(html: string): number | null {
  const state = extractInitialState(html);
  const w = state ? ownerOf(state)?.stats?.watchers : undefined;
  return typeof w === "number" ? w : null;
}

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};
export const decodeXml = (s: string): string =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#")
        return String.fromCodePoint(
          e[1]?.toLowerCase() === "x"
            ? parseInt(e.slice(2), 16)
            : parseInt(e.slice(1), 10),
        );
      return XML_ENTITIES[e.toLowerCase()] ?? m;
    });

const tagText = (xml: string, tag: string): string | null => {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml);
  const v = m ? decodeXml(m[1]!).trim() : "";
  return v || null;
};

export interface RssPage {
  items: RssItem[];
  next: string | null;
}

/** DeviantArt MRSS (`backend.deviantart.com/rss.xml`). */
export function parseRss(xml: string): RssPage {
  const items: RssItem[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const x = m[1]!;
    const url = tagText(x, "link");
    if (!url) continue;
    const author = /<media:credit role="author"[^>]*>([^<]+)</.exec(x)?.[1];
    // Thumbnails are listed smallest first; take the second (300w) if present.
    const thumbs = [...x.matchAll(/<media:thumbnail url="([^"]+)"/g)].map((t) =>
      decodeXml(t[1]!),
    );
    const rating = tagText(x, "media:rating");
    items.push({
      url,
      title: tagText(x, "title"),
      author: author ? decodeXml(author).trim() : null,
      publishedAt: iso(tagText(x, "pubDate")),
      isMature: rating ? rating === "adult" : null,
      tags: splitTags(tagText(x, "media:keywords")),
      thumbnailUrl: thumbs[1] ?? thumbs[0] ?? null,
    });
  }
  const next = /<atom:link rel="next" href="([^"]+)"/.exec(xml)?.[1];
  return { items, next: next ? decodeXml(next) : null };
}
