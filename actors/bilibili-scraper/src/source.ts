import { ApiError, RiskControlError, type GetOptions } from "./bili.js";
import {
  parseArcSearch,
  parseDetail,
  parseMainReplies,
  parsePopular,
  parseReply,
  parseSubReplies,
  parseUserArchives,
  parseUserSearch,
  parseVideoSearch,
  pickUser,
  type Comment,
  type ListedVideo,
  type RawDetail,
  type RawReply,
  type Video,
  type VideoRef,
} from "./parse.js";
import type { Params } from "./wbi.js";

export interface Api {
  get<T>(path: string, params: Params, opts?: GetOptions): Promise<T | null>;
}

export type SearchOrder =
  "relevance" | "views" | "newest" | "danmaku" | "favorites";

export const SEARCH_ORDER: Record<SearchOrder, string> = {
  relevance: "totalrank",
  views: "click",
  newest: "pubdate",
  danmaku: "dm",
  favorites: "stow",
};

export const POPULAR_PAGE_SIZE = 50;
export const USER_PAGE_SIZE = 30;
export const SUB_REPLY_PAGE_SIZE = 20;
/** Bilibili's search returns at most 50 pages. */
export const MAX_SEARCH_PAGES = 50;

/** Canvas/WebGL fingerprint params the web client sends to space endpoints. */
const DM_PARAMS: Params = {
  dm_img_list: "[]",
  dm_img_str: "V2ViR0wgMS4wIChPcGVuR0wgRVMgMi4wIENocm9taXVtKQ",
  dm_cover_img_str:
    "QU5HTEUgKEludGVsLCBJbnRlbChSKSBVSEQgR3JhcGhpY3MgNjIwICgweDAwMDA1OTE3KSBEaXJlY3QzRDExIHZzXzVfMCBwc181XzAsIEQzRDExKUdvb2dsZSBJbmMuIChJbnRlbC",
  dm_img_inter: '{"ds":[],"wh":[0,0,0],"of":[0,0,0]}',
};

/** Bilibili endpoints, one method per operation. */
export class BiliSource {
  constructor(
    private readonly api: Api,
    private readonly log: (msg: string) => void = () => {},
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Trending ("热门") videos, page by page. */
  async *trending(): AsyncGenerator<ListedVideo> {
    for (let pn = 1; pn <= 20; pn++) {
      const data = await this.api.get("/x/web-interface/popular", {
        ps: POPULAR_PAGE_SIZE,
        pn,
      });
      const { videos, noMore } = parsePopular(data);
      yield* videos;
      if (noMore) return;
    }
  }

  async *search(
    keyword: string,
    order: SearchOrder,
  ): AsyncGenerator<ListedVideo> {
    const referer = `https://search.bilibili.com/all?keyword=${encodeURIComponent(keyword)}`;
    for (let page = 1; page <= MAX_SEARCH_PAGES; page++) {
      const data = await this.api.get(
        "/x/web-interface/wbi/search/type",
        {
          search_type: "video",
          keyword,
          order: SEARCH_ORDER[order],
          page,
        },
        { wbi: true, referer },
      );
      const { videos, numPages } = parseVideoSearch(data);
      yield* videos;
      if (!videos.length || page >= numPages) return;
    }
  }

  /** Resolves a display name to a UID via user search. */
  async findUser(name: string): Promise<{ mid: string; name: string } | null> {
    const data = await this.api.get(
      "/x/web-interface/wbi/search/type",
      { search_type: "bili_user", keyword: name, page: 1 },
      {
        wbi: true,
        referer: `https://search.bilibili.com/upuser?keyword=${encodeURIComponent(name)}`,
      },
    );
    const hit = pickUser(parseUserSearch(data), name);
    if (hit && !hit.exact)
      this.log(
        `No user named exactly "${name}"; using top match "${hit.name}" (UID ${hit.mid}).`,
      );
    return hit;
  }

  /**
   * A channel's uploads, newest first. Uses /x/series/recArchivesByKeywords,
   * falling back to /x/space/wbi/arc/search, which is more often blocked.
   */
  async *userVideos(mid: string): AsyncGenerator<ListedVideo> {
    let useArc = false;
    for (let pn = 1; pn <= 500; pn++) {
      let page: { videos: ListedVideo[]; total: number } | null = null;
      if (!useArc) {
        try {
          page = parseUserArchives(
            await this.api.get(
              "/x/series/recArchivesByKeywords",
              {
                mid,
                keywords: "",
                orderby: "pubdate",
                ps: USER_PAGE_SIZE,
                pn,
              },
              { maxRiskRetries: 0 },
            ),
          );
          if (pn === 1 && !page.videos.length) page = null;
        } catch (e) {
          if (!(e instanceof ApiError || e instanceof RiskControlError))
            throw e;
          this.log(
            `UID ${mid}: archive list failed (${e.message}); trying space search.`,
          );
        }
        useArc = page === null;
      }
      if (!page) {
        page = parseArcSearch(
          await this.api.get(
            "/x/space/wbi/arc/search",
            {
              mid,
              ps: USER_PAGE_SIZE,
              pn,
              order: "pubdate",
              platform: "web",
              web_location: 1550101,
              ...DM_PARAMS,
            },
            { wbi: true, referer: `https://space.bilibili.com/${mid}/video` },
          ),
        );
      }
      yield* page.videos;
      if (!page.videos.length || pn * USER_PAGE_SIZE >= page.total) return;
    }
  }

  /** Full details + tags; null if the video doesn't exist or is hidden. */
  async video(
    ref: VideoRef,
    ctx: { source: string; category?: string | null },
  ): Promise<Video | null> {
    const params: Params =
      "bvid" in ref ? { bvid: ref.bvid } : { aid: ref.aid };
    const data = await this.api.get<RawDetail>(
      "/x/web-interface/wbi/view/detail",
      params,
      { wbi: true },
    );
    return data ? parseDetail(data, { ...ctx, now: this.now() }) : null;
  }

  /**
   * Hot comments: each top-level comment followed by its replies. Guests
   * (no login) get the first page only, i.e. about 3 top-level comments plus
   * up to 20 replies to each.
   */
  async comments(aid: number, bvid: string, max: number): Promise<Comment[]> {
    const out: Comment[] = [];
    const seen = new Set<string>();
    const add = (r: RawReply) => {
      const c = parseReply(r);
      if (!c || seen.has(c.rpid) || out.length >= max) return;
      seen.add(c.rpid);
      out.push(c);
    };
    const referer = `https://www.bilibili.com/video/${bvid}/`;
    let offset = "";
    for (let page = 0; page < 50 && out.length < max; page++) {
      const main = parseMainReplies(
        await this.api.get(
          "/x/v2/reply/wbi/main",
          {
            oid: aid,
            type: 1,
            mode: 3,
            pagination_str: JSON.stringify({ offset }),
            plat: 1,
            web_location: 1315875,
          },
          { wbi: true, referer },
        ),
      );
      for (const r of [...main.top, ...main.replies]) {
        if (out.length >= max) break;
        add(r);
        const previews = r.replies ?? [];
        if (out.length < max && (r.rcount ?? 0) > previews.length && r.rpid) {
          const sub = await this.api.get(
            "/x/v2/reply/reply",
            {
              oid: aid,
              type: 1,
              root: r.rpid_str || r.rpid,
              ps: SUB_REPLY_PAGE_SIZE,
              pn: 1,
            },
            { referer },
          );
          parseSubReplies(sub).forEach(add);
        } else previews.forEach(add);
      }
      if (main.isEnd || !main.nextOffset) break;
      offset = main.nextOffset;
    }
    return out;
  }
}
