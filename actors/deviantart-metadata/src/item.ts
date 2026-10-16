import type {
  RawAbout,
  RawDeviation,
  RawDeviationExtended,
  RawMedia,
  RawOembed,
  RawProfileOwner,
  RawUser,
} from "./raw.js";

export const BASE = "https://www.deviantart.com";

/** One dataset item: a deviation or a profile. Fields that don't apply are null. */
export interface Item {
  type: "deviation" | "profile";
  id: number | null;
  url: string | null;
  title: string | null;
  author: string | null;
  authorUrl: string | null;
  authorId: number | null;
  authorWatchers: number | null;
  publishedAt: string | null;
  views: number | null;
  favourites: number | null;
  comments: number | null;
  downloads: number | null;
  tags: string[] | null;
  category: string | null;
  isMature: boolean | null;
  isDownloadable: boolean | null;
  license: string | null;
  /** DeviantArt's `noai` flag (isAiUseDisallowed), passed through unchanged. */
  noai: boolean | null;
  isAiGenerated: boolean | null;
  isDailyDeviation: boolean | null;
  thumbnailUrl: string | null;
  avatarUrl: string | null;
  tagline: string | null;
  country: string | null;
  countryCode: string | null;
  isArtist: boolean | null;
  joinedAt: string | null;
  watchers: number | null;
  watching: number | null;
  deviationCount: number | null;
  pageviews: number | null;
  /** Where the record came from: page (full), oembed or rss (fallbacks, partial). */
  dataSource: "page" | "oembed" | "rss";
  /** The input (search query, username or URL) this item came from. */
  source: string | null;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;
const bool = (v: unknown): boolean | null =>
  typeof v === "boolean" ? v : null;
export const iso = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

export const profileUrl = (username: string): string =>
  `${BASE}/${encodeURIComponent(username)}`;

/** Numeric deviation id from the trailing `-<id>` of a deviation URL. */
export function deviationIdFromUrl(url: string): number | null {
  const m = /-(\d+)\/?(?:[?#].*)?$/.exec(url);
  return m ? Number(m[1]) : null;
}

/** Preferred thumbnail sizes, smallest useful first. */
const THUMB_TYPES = ["300W", "250T", "350T", "150"];

/**
 * A thumbnail URL built from a deviation's media descriptor (the same URL the
 * gallery grid shows). The actor never downloads it.
 */
export function thumbnailUrl(media: RawMedia | undefined): string | null {
  const base = str(media?.baseUri);
  if (!media || !base) return null;
  for (const t of THUMB_TYPES) {
    const type = media.types?.find((x) => x.t === t && str(x.c));
    if (!type) continue;
    const path = type.c!.replace(/<prettyName>/g, media.prettyName ?? "");
    const token = media.token?.[0];
    return `${base}${path}${token ? `?token=${token}` : ""}`;
  }
  return null;
}

const blank = (source: string | null): Item => ({
  type: "deviation",
  id: null,
  url: null,
  title: null,
  author: null,
  authorUrl: null,
  authorId: null,
  authorWatchers: null,
  publishedAt: null,
  views: null,
  favourites: null,
  comments: null,
  downloads: null,
  tags: null,
  category: null,
  isMature: null,
  isDownloadable: null,
  license: null,
  noai: null,
  isAiGenerated: null,
  isDailyDeviation: null,
  thumbnailUrl: null,
  avatarUrl: null,
  tagline: null,
  country: null,
  countryCode: null,
  isArtist: null,
  joinedAt: null,
  watchers: null,
  watching: null,
  deviationCount: null,
  pageviews: null,
  dataSource: "page",
  source,
});

export interface DeviationContext {
  /** The author entity, when the deviation references it by id. */
  author?: RawUser | null;
  /** Author watcher count from another part of the page (gallery/profile). */
  authorWatchers?: number | null;
  extended?: RawDeviationExtended | null;
  source: string | null;
}

/** Map a deviation entity from `__INITIAL_STATE__` to an Item. */
export function fromDeviation(d: RawDeviation, ctx: DeviationContext): Item {
  const author =
    d.author && typeof d.author === "object" ? d.author : (ctx.author ?? null);
  const username = str(author?.username);
  const tags = ctx.extended?.tags
    ? ctx.extended.tags.map((t) => str(t.name)).filter((t): t is string => !!t)
    : null;
  return {
    ...blank(ctx.source),
    id: num(d.deviationId),
    url: str(d.url),
    title: str(d.title),
    author: username,
    authorUrl: username ? profileUrl(username) : null,
    authorId: num(author?.userId),
    authorWatchers: num(author?.stats?.watchers) ?? ctx.authorWatchers ?? null,
    publishedAt: iso(d.publishedTime),
    views: num(ctx.extended?.stats?.views) ?? num(d.stats?.views),
    favourites: num(d.stats?.favourites),
    comments: num(d.stats?.comments),
    downloads: num(ctx.extended?.stats?.downloads) ?? num(d.stats?.downloads),
    tags,
    category: str(d.type),
    isMature: bool(d.isMature),
    isDownloadable: bool(d.isDownloadable),
    license: str(d.license),
    noai: bool(d.isAiUseDisallowed),
    isAiGenerated: bool(d.isAiGenerated),
    isDailyDeviation: bool(d.isDailyDeviation),
    thumbnailUrl: thumbnailUrl(d.media),
    avatarUrl: str(author?.usericon),
  };
}

/** Split a comma-separated tag list ("coil, dragon, dream"). */
export const splitTags = (s: string | null | undefined): string[] =>
  (s ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

/** Fallback: a partial deviation item from the oEmbed endpoint. */
export function fromOembed(
  url: string,
  o: RawOembed,
  source: string | null,
): Item {
  const stats = o.community?.statistics?._attributes;
  const author = str(o.author_name);
  return {
    ...blank(source),
    dataSource: "oembed",
    id: deviationIdFromUrl(url),
    url,
    title: str(o.title),
    author,
    authorUrl: str(o.author_url) ?? (author ? profileUrl(author) : null),
    publishedAt: iso(o.pubdate),
    views: num(stats?.views),
    favourites: num(stats?.favorites),
    comments: num(stats?.comments),
    downloads: num(stats?.downloads),
    tags: splitTags(o.tags),
    isMature: o.safety ? o.safety === "adult" : null,
    thumbnailUrl: str(o.thumbnail_url),
  };
}

/** One `<item>` of DeviantArt's MRSS feed. */
export interface RssItem {
  url: string;
  title: string | null;
  author: string | null;
  publishedAt: string | null;
  isMature: boolean | null;
  tags: string[];
  thumbnailUrl: string | null;
}

/** Fallback: a partial deviation item from the RSS feed. */
export function fromRss(r: RssItem, source: string | null): Item {
  return {
    ...blank(source),
    dataSource: "rss",
    id: deviationIdFromUrl(r.url),
    url: r.url,
    title: r.title,
    author: r.author,
    authorUrl: r.author ? profileUrl(r.author) : null,
    publishedAt: r.publishedAt,
    tags: r.tags,
    isMature: r.isMature,
    thumbnailUrl: r.thumbnailUrl,
  };
}

export interface ProfileParts {
  user: RawUser | null;
  owner: RawProfileOwner | null;
  about: RawAbout | null;
}

/** Map a profile page's state to a profile Item. */
export function fromProfile(p: ProfileParts, source: string | null): Item {
  const username = str(p.user?.username) ?? str(p.about?.username);
  const stats = p.owner?.stats;
  const id = num(p.user?.userId) ?? num(p.owner?.user?.id);
  const url = username ? profileUrl(username) : null;
  return {
    ...blank(source),
    type: "profile",
    id,
    url,
    author: username,
    authorUrl: url,
    authorId: id,
    authorWatchers: num(stats?.watchers),
    favourites: num(stats?.favourites),
    comments: num(stats?.commentsReceivedProfile),
    avatarUrl: str(p.user?.usericon),
    tagline: str(p.owner?.tagline) ?? str(p.about?.tagline),
    country: str(p.about?.country),
    countryCode: str(p.about?.countrycode)?.toUpperCase() ?? null,
    isArtist: bool(p.about?.isArtist),
    joinedAt: iso(stats?.joinDate),
    watchers: num(stats?.watchers),
    watching: num(stats?.watching),
    deviationCount: num(stats?.deviations),
    pageviews: num(stats?.pageviews),
  };
}
