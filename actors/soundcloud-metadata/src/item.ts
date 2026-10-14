/** SoundCloud api-v2 objects, trimmed to the fields we read. */

export interface RawUserRef {
  id?: number;
  username?: string | null;
  permalink_url?: string | null;
}

export interface RawTrack {
  kind?: string;
  id?: number;
  urn?: string | null;
  title?: string | null;
  permalink?: string | null;
  permalink_url?: string | null;
  description?: string | null;
  genre?: string | null;
  tag_list?: string | null;
  created_at?: string | null;
  artwork_url?: string | null;
  duration?: number | null;
  playback_count?: number | null;
  likes_count?: number | null;
  reposts_count?: number | null;
  comment_count?: number | null;
  download_count?: number | null;
  label_name?: string | null;
  license?: string | null;
  purchase_url?: string | null;
  purchase_title?: string | null;
  downloadable?: boolean | null;
  streamable?: boolean | null;
  user?: RawUserRef | null;
  user_id?: number | null;
}

export interface RawUser {
  kind?: string;
  id?: number;
  urn?: string | null;
  username?: string | null;
  full_name?: string | null;
  permalink?: string | null;
  permalink_url?: string | null;
  description?: string | null;
  created_at?: string | null;
  avatar_url?: string | null;
  followers_count?: number | null;
  followings_count?: number | null;
  track_count?: number | null;
  playlist_count?: number | null;
  likes_count?: number | null;
  reposts_count?: number | null;
  comments_count?: number | null;
  city?: string | null;
  country_code?: string | null;
  verified?: boolean | null;
}

export interface RawPlaylist {
  kind?: string;
  id?: number;
  urn?: string | null;
  title?: string | null;
  permalink?: string | null;
  permalink_url?: string | null;
  description?: string | null;
  genre?: string | null;
  tag_list?: string | null;
  created_at?: string | null;
  artwork_url?: string | null;
  duration?: number | null;
  likes_count?: number | null;
  reposts_count?: number | null;
  track_count?: number | null;
  label_name?: string | null;
  license?: string | null;
  purchase_url?: string | null;
  is_album?: boolean | null;
  set_type?: string | null;
  user?: RawUserRef | null;
  user_id?: number | null;
}

export type RawObject = RawTrack | RawUser | RawPlaylist;

/** One dataset item (track, user or playlist). Fields not applicable are null. */
export interface Item {
  type: "track" | "user" | "playlist";
  id: number | null;
  urn: string | null;
  url: string | null;
  permalink: string | null;
  title: string | null;
  username: string | null;
  userUrl: string | null;
  userId: number | null;
  fullName: string | null;
  description: string | null;
  genre: string | null;
  tags: string[] | null;
  createdAt: string | null;
  artworkUrl: string | null;
  avatarUrl: string | null;
  durationMs: number | null;
  playbackCount: number | null;
  likesCount: number | null;
  repostsCount: number | null;
  commentCount: number | null;
  trackCount: number | null;
  playlistCount: number | null;
  followersCount: number | null;
  followingsCount: number | null;
  city: string | null;
  countryCode: string | null;
  verified: boolean | null;
  labelName: string | null;
  license: string | null;
  isAlbum: boolean | null;
  setType: string | null;
  purchaseUrl: string | null;
  downloadable: boolean | null;
  streamable: boolean | null;
  /** The input URL or search query this item came from. */
  source: string | null;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v : null;
const bool = (v: unknown): boolean | null =>
  typeof v === "boolean" ? v : null;
const iso = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

/**
 * SoundCloud `tag_list` is space-separated, with multi-word tags wrapped in
 * double quotes, e.g. `edm "deep house" chill`.
 */
export function parseTagList(tagList: string | null | undefined): string[] {
  if (!tagList) return [];
  const tags: string[] = [];
  for (const m of tagList.matchAll(/"([^"]*)"|(\S+)/g)) {
    const t = (m[1] ?? m[2] ?? "").trim();
    if (t) tags.push(t);
  }
  return tags;
}

/** The SoundCloud object kind, if present. */
export const kindOf = (o: RawObject): string | undefined =>
  (o as { kind?: string }).kind;

const base = (source: string | null): Item => ({
  type: "track",
  id: null,
  urn: null,
  url: null,
  permalink: null,
  title: null,
  username: null,
  userUrl: null,
  userId: null,
  fullName: null,
  description: null,
  genre: null,
  tags: null,
  createdAt: null,
  artworkUrl: null,
  avatarUrl: null,
  durationMs: null,
  playbackCount: null,
  likesCount: null,
  repostsCount: null,
  commentCount: null,
  trackCount: null,
  playlistCount: null,
  followersCount: null,
  followingsCount: null,
  city: null,
  countryCode: null,
  verified: null,
  labelName: null,
  license: null,
  isAlbum: null,
  setType: null,
  purchaseUrl: null,
  downloadable: null,
  streamable: null,
  source,
});

export function toTrack(t: RawTrack, source: string | null): Item {
  return {
    ...base(source),
    type: "track",
    id: num(t.id),
    urn: str(t.urn),
    url: str(t.permalink_url),
    permalink: str(t.permalink),
    title: str(t.title),
    username: str(t.user?.username),
    userUrl: str(t.user?.permalink_url),
    userId: num(t.user?.id ?? t.user_id),
    description: str(t.description),
    genre: str(t.genre),
    tags: parseTagList(t.tag_list),
    createdAt: iso(t.created_at),
    artworkUrl: str(t.artwork_url),
    durationMs: num(t.duration),
    playbackCount: num(t.playback_count),
    likesCount: num(t.likes_count),
    repostsCount: num(t.reposts_count),
    commentCount: num(t.comment_count),
    labelName: str(t.label_name),
    license: str(t.license),
    purchaseUrl: str(t.purchase_url),
    downloadable: bool(t.downloadable),
    streamable: bool(t.streamable),
  };
}

export function toUser(u: RawUser, source: string | null): Item {
  return {
    ...base(source),
    type: "user",
    id: num(u.id),
    urn: str(u.urn),
    url: str(u.permalink_url),
    permalink: str(u.permalink),
    username: str(u.username),
    userUrl: str(u.permalink_url),
    userId: num(u.id),
    fullName: str(u.full_name),
    description: str(u.description),
    createdAt: iso(u.created_at),
    avatarUrl: str(u.avatar_url),
    likesCount: num(u.likes_count),
    repostsCount: num(u.reposts_count),
    trackCount: num(u.track_count),
    playlistCount: num(u.playlist_count),
    followersCount: num(u.followers_count),
    followingsCount: num(u.followings_count),
    city: str(u.city),
    countryCode: str(u.country_code),
    verified: bool(u.verified),
  };
}

export function toPlaylist(p: RawPlaylist, source: string | null): Item {
  return {
    ...base(source),
    type: "playlist",
    id: num(p.id),
    urn: str(p.urn),
    url: str(p.permalink_url),
    permalink: str(p.permalink),
    title: str(p.title),
    username: str(p.user?.username),
    userUrl: str(p.user?.permalink_url),
    userId: num(p.user?.id ?? p.user_id),
    description: str(p.description),
    genre: str(p.genre),
    tags: parseTagList(p.tag_list),
    createdAt: iso(p.created_at),
    artworkUrl: str(p.artwork_url),
    durationMs: num(p.duration),
    likesCount: num(p.likes_count),
    repostsCount: num(p.reposts_count),
    trackCount: num(p.track_count),
    labelName: str(p.label_name),
    license: str(p.license),
    purchaseUrl: str(p.purchase_url),
    isAlbum: bool(p.is_album),
    setType: str(p.set_type),
  };
}

/** Map any resolved object to an Item by its `kind`; null if unsupported. */
export function toItem(o: RawObject, source: string | null): Item | null {
  switch (kindOf(o)) {
    case "track":
      return toTrack(o as RawTrack, source);
    case "user":
      return toUser(o as RawUser, source);
    case "playlist":
    case "system-playlist":
      return toPlaylist(o as RawPlaylist, source);
    default:
      return null;
  }
}
