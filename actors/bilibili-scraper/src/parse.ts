/** Pure parsers from Bilibili API payloads to the actor's output schema. */

export interface Author {
  mid: string;
  name: string;
}

export interface Comment {
  rpid: string;
  /** rpid of the top-level comment this replies to; null for top-level. */
  parentRpid: string | null;
  text: string;
  author: Author;
  likes: number;
  date: string;
  replyCount: number;
}

export interface Video {
  bvid: string;
  aid: number;
  title: string;
  description: string;
  url: string;
  author: Author;
  publishDate: string;
  durationSec: number;
  views: number;
  likes: number;
  coins: number;
  favorites: number;
  shares: number;
  danmaku: number;
  replies: number;
  tags: string[];
  cover: string;
  category: string | null;
  categoryId: number | null;
  parts: number;
  source: string;
  comments?: Comment[];
  scrapedAt: string;
}

export type VideoRef = { bvid: string } | { aid: number };

/** A video found in a listing, before its details are fetched. */
export interface ListedVideo {
  bvid: string;
  category?: string | null;
}

export class RefError extends Error {}

const BVID = /\b(BV1[0-9A-Za-z]{9})\b/;

/** BV id, av id, or any bilibili.com/video URL. */
export function parseVideoRef(input: string): VideoRef {
  const s = input.trim();
  if (/b23\.tv\//i.test(s))
    throw new RefError(
      `"${s}" is a b23.tv short link. Open it in a browser and paste the full bilibili.com/video/... URL.`,
    );
  const bv = BVID.exec(s);
  if (bv) return { bvid: bv[1]! };
  const av = /(?:^|\/|\b)av(\d+)\b/i.exec(s) ?? /^(\d+)$/.exec(s);
  if (av) return { aid: Number(av[1]) };
  throw new RefError(
    `"${s}" is not a Bilibili video. Use a URL like https://www.bilibili.com/video/BV1xx411c7mD, a BV id, or an av id (av170001).`,
  );
}

export const videoRefKey = (r: VideoRef): string =>
  "bvid" in r ? r.bvid : `av${r.aid}`;

export type UserRef = { mid: string } | { name: string };

/** UID, space.bilibili.com URL, or a display name to look up. */
export function parseUserRef(input: string): UserRef {
  const s = input.trim();
  if (!s) throw new RefError("Empty user.");
  const space = /space\.bilibili\.com\/(\d+)/i.exec(s);
  if (space) return { mid: space[1]! };
  const uid = /^(?:uid[:\s]*)?(\d+)$/i.exec(s);
  if (uid) return { mid: uid[1]! };
  if (/^https?:\/\//i.test(s))
    throw new RefError(
      `"${s}" is not a Bilibili channel URL. Use https://space.bilibili.com/<UID>.`,
    );
  return { name: s };
}

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string =>
  typeof v === "string" ? v : v === undefined || v === null ? "" : String(v);

export const isoFromUnix = (sec: unknown): string =>
  new Date(num(sec) * 1000).toISOString();

/** "//i0.hdslb.com/x.jpg" or "http://..." -> "https://..." */
export function httpsUrl(u: unknown): string {
  const s = str(u);
  if (!s) return "";
  if (s.startsWith("//")) return `https:${s}`;
  return s.replace(/^http:\/\//, "https://");
}

export const videoUrl = (bvid: string): string =>
  `https://www.bilibili.com/video/${bvid}`;

interface RawView {
  bvid?: string;
  aid?: number;
  title?: string;
  desc?: string;
  pic?: string;
  pubdate?: number;
  duration?: number;
  tid?: number;
  tname?: string;
  videos?: number;
  owner?: { mid?: number | string; name?: string };
  stat?: Record<string, number>;
}

export interface RawDetail {
  View?: RawView;
  Tags?: { tag_name?: string }[] | null;
}

/** /x/web-interface/wbi/view/detail `data` -> Video (without comments). */
export function parseDetail(
  data: RawDetail,
  ctx: { source: string; category?: string | null; now: Date },
): Video | null {
  const v = data.View;
  if (!v?.bvid) return null;
  const s = v.stat ?? {};
  const tags = [
    ...new Set(
      (data.Tags ?? []).map((t) => str(t.tag_name).trim()).filter(Boolean),
    ),
  ];
  return {
    bvid: v.bvid,
    aid: num(v.aid),
    title: str(v.title),
    description: str(v.desc),
    url: videoUrl(v.bvid),
    author: { mid: str(v.owner?.mid), name: str(v.owner?.name) },
    publishDate: isoFromUnix(v.pubdate),
    durationSec: num(v.duration),
    views: num(s.view),
    likes: num(s.like),
    coins: num(s.coin),
    favorites: num(s.favorite),
    shares: num(s.share),
    danmaku: num(s.danmaku),
    replies: num(s.reply),
    tags,
    cover: httpsUrl(v.pic),
    category: str(v.tname) || ctx.category || null,
    categoryId: v.tid ? num(v.tid) : null,
    parts: num(v.videos) || 1,
    source: ctx.source,
    scrapedAt: ctx.now.toISOString(),
  };
}

/** /x/web-interface/popular */
export function parsePopular(data: unknown): {
  videos: ListedVideo[];
  noMore: boolean;
} {
  const d = (data ?? {}) as {
    list?: { bvid?: string; tname?: string }[];
    no_more?: boolean;
  };
  const list = d.list ?? [];
  return {
    videos: list
      .filter((x) => x.bvid)
      .map((x) => ({ bvid: x.bvid!, category: x.tname || null })),
    noMore: d.no_more === true || list.length === 0,
  };
}

/** /x/web-interface/wbi/search/type?search_type=video */
export function parseVideoSearch(data: unknown): {
  videos: ListedVideo[];
  numPages: number;
} {
  const d = (data ?? {}) as {
    result?: { type?: string; bvid?: string; typename?: string }[];
    numPages?: number;
  };
  return {
    videos: (d.result ?? [])
      .filter((x) => x.bvid && (!x.type || x.type === "video"))
      .map((x) => ({ bvid: x.bvid!, category: x.typename || null })),
    numPages: num(d.numPages),
  };
}

/** /x/web-interface/wbi/search/type?search_type=bili_user */
export function parseUserSearch(
  data: unknown,
): { mid: string; name: string; fans: number }[] {
  const d = (data ?? {}) as {
    result?: { mid?: number; uname?: string; fans?: number }[];
  };
  return (d.result ?? [])
    .filter((u) => u.mid)
    .map((u) => ({
      mid: String(u.mid),
      name: str(u.uname),
      fans: num(u.fans),
    }));
}

/** Picks the exact (case-insensitive) name match, else the top result. */
export function pickUser(
  users: { mid: string; name: string }[],
  name: string,
): { mid: string; name: string; exact: boolean } | null {
  const want = name.trim().toLowerCase();
  const exact = users.find((u) => u.name.toLowerCase() === want);
  if (exact) return { ...exact, exact: true };
  return users[0] ? { ...users[0], exact: false } : null;
}

/** /x/series/recArchivesByKeywords */
export function parseUserArchives(data: unknown): {
  videos: ListedVideo[];
  total: number;
} {
  const d = (data ?? {}) as {
    archives?: { bvid?: string }[];
    page?: { total?: number };
  };
  return {
    videos: (d.archives ?? [])
      .filter((x) => x.bvid)
      .map((x) => ({ bvid: x.bvid! })),
    total: num(d.page?.total),
  };
}

/** /x/space/wbi/arc/search */
export function parseArcSearch(data: unknown): {
  videos: ListedVideo[];
  total: number;
} {
  const d = (data ?? {}) as {
    list?: { vlist?: { bvid?: string }[] };
    page?: { count?: number };
  };
  return {
    videos: (d.list?.vlist ?? [])
      .filter((x) => x.bvid)
      .map((x) => ({ bvid: x.bvid! })),
    total: num(d.page?.count),
  };
}

export interface RawReply {
  rpid?: number;
  rpid_str?: string;
  root?: number;
  root_str?: string;
  rcount?: number;
  ctime?: number;
  like?: number;
  member?: { mid?: string | number; uname?: string };
  content?: { message?: string };
  replies?: RawReply[] | null;
}

export function parseReply(r: RawReply): Comment | null {
  const rpid = r.rpid_str || (r.rpid ? String(r.rpid) : "");
  if (!rpid) return null;
  const root = r.root_str || (r.root ? String(r.root) : "");
  return {
    rpid,
    parentRpid: root && root !== "0" ? root : null,
    text: str(r.content?.message),
    author: { mid: str(r.member?.mid), name: str(r.member?.uname) },
    likes: num(r.like),
    date: isoFromUnix(r.ctime),
    replyCount: num(r.rcount),
  };
}

/** /x/v2/reply/wbi/main */
export function parseMainReplies(data: unknown): {
  top: RawReply[];
  replies: RawReply[];
  nextOffset: string | null;
  isEnd: boolean;
  total: number;
} {
  const d = (data ?? {}) as {
    replies?: RawReply[] | null;
    top_replies?: RawReply[] | null;
    cursor?: {
      is_end?: boolean;
      all_count?: number;
      pagination_reply?: { next_offset?: string };
    };
  };
  const next = d.cursor?.pagination_reply?.next_offset || null;
  const replies = d.replies ?? [];
  return {
    top: d.top_replies ?? [],
    replies,
    nextOffset: next,
    isEnd: d.cursor?.is_end !== false || !next || replies.length === 0,
    total: num(d.cursor?.all_count),
  };
}

/** /x/v2/reply/reply */
export function parseSubReplies(data: unknown): RawReply[] {
  return ((data ?? {}) as { replies?: RawReply[] | null }).replies ?? [];
}
