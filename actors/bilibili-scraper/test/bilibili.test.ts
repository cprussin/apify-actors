import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  BiliClient,
  isVoucherOnly,
  parseSetCookie,
  RiskControlError,
} from "../src/bili.js";
import { HttpClient, type FetchLike } from "../src/http.js";
import { InputError, normalizeInput } from "../src/input.js";
import {
  httpsUrl,
  parseArcSearch,
  parseDetail,
  parseMainReplies,
  parsePopular,
  parseReply,
  parseSubReplies,
  parseUserArchives,
  parseUserRef,
  parseUserSearch,
  parseVideoRef,
  parseVideoSearch,
  pickUser,
  RefError,
  type RawDetail,
  type Video,
} from "../src/parse.js";
import { ONLY_NEW_SEEN_STREAK, runScrape, type RunDeps } from "../src/run.js";
import { Seen } from "../src/state.js";
import { BiliSource } from "../src/source.js";
import { keyFromUrl, mixinKey, signQuery } from "../src/wbi.js";

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const json = (name: string) =>
  JSON.parse(fixture(`${name}.json`)) as { code: number; data: unknown };

const NOW = new Date("2026-09-30T09:00:00Z");
const noSleep = async () => {};

type Handler = (url: URL) => {
  status?: number;
  body: string;
  cookies?: string[];
};
const fakeFetch = (handler: Handler) =>
  vi.fn(async (url: string, _init?: Parameters<FetchLike>[1]) => {
    const r = handler(new URL(url));
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: {
        get: () => null,
        getSetCookie: () => r.cookies ?? [],
      },
      text: async () => r.body,
    };
  });

/** Serves every endpoint from fixtures; `override` can replace any path. */
const bili = (
  override: (u: URL) => ReturnType<Handler> | undefined = () => undefined,
) => {
  const fetch = fakeFetch((u) => {
    const o = override(u);
    if (o) return o;
    switch (u.hostname === "www.bilibili.com" ? "/" : u.pathname) {
      case "/":
        return {
          body: "<html></html>",
          cookies: [
            "buvid3=ABC-infoc; path=/; domain=.bilibili.com",
            "b_nut=1790758728; path=/; domain=.bilibili.com",
          ],
        };
      case "/x/frontend/finger/spi":
        return {
          body: JSON.stringify({ code: 0, data: { b_3: "X", b_4: "B4==" } }),
        };
      case "/x/web-interface/nav":
        return { body: fixture("nav.json") };
      case "/x/web-interface/popular":
        return { body: fixture("popular.json") };
      case "/x/web-interface/wbi/search/type":
        return {
          body: fixture(
            u.searchParams.get("search_type") === "bili_user"
              ? "search-user.json"
              : "search-video.json",
          ),
        };
      case "/x/web-interface/wbi/view/detail":
        return { body: fixture("view-detail.json") };
      case "/x/v2/reply/wbi/main":
        return { body: fixture("reply-main.json") };
      case "/x/v2/reply/reply":
        return { body: fixture("reply-sub.json") };
      case "/x/series/recArchivesByKeywords":
        return { body: fixture("user-archives.json") };
      case "/x/space/wbi/arc/search":
        return { body: fixture("user-arc-search.json") };
    }
    return { status: 404, body: "not found" };
  });
  const http = new HttpClient({ fetch, sleep: noSleep, baseDelayMs: 1 });
  const client = new BiliClient(http, {
    sleep: noSleep,
    riskBaseDelayMs: 1,
    random: () => 0.5,
  });
  const source = new BiliSource(
    client,
    () => {},
    () => NOW,
  );
  return { fetch, http, client, source };
};

const calls = (fetch: ReturnType<typeof fakeFetch>, path: string) =>
  fetch.mock.calls.filter(([u]) => new URL(u).pathname === path);

describe("wbi", () => {
  it("matches the documented test vector", () => {
    const m = mixinKey(
      "7cd084941338484aae1ad9425b84077c",
      "4932caff0ff746eab6f01bf08b70ac45",
    );
    expect(m).toBe("ea1db124af3c7062474693fa704f4ff8");
    expect(
      signQuery({ foo: "114", bar: "514", zab: 1919810 }, m, 1702204169),
    ).toBe(
      "bar=514&foo=114&wts=1702204169&zab=1919810&w_rid=8f6f2b5b3d485fe1886cec6a0be8c5d4",
    );
  });

  it("strips !'()* and percent-encodes values", () => {
    const q = signQuery({ keyword: "原神 (test)!" }, "x".repeat(32), 1);
    expect(q.startsWith("keyword=%E5%8E%9F%E7%A5%9E%20test&wts=1&w_rid=")).toBe(
      true,
    );
  });

  it("extracts keys from nav URLs", () => {
    expect(keyFromUrl("https://i0.hdslb.com/bfs/wbi/7cd0849413.png")).toBe(
      "7cd0849413",
    );
  });
});

describe("parseVideoRef / parseUserRef", () => {
  it.each([
    [
      "https://www.bilibili.com/video/BV1xx411c7mD/?spm_id_from=333",
      { bvid: "BV1xx411c7mD" },
    ],
    ["BV18fhb65EGs", { bvid: "BV18fhb65EGs" }],
    ["https://m.bilibili.com/video/BV18fhb65EGs", { bvid: "BV18fhb65EGs" }],
    ["av170001", { aid: 170001 }],
    ["https://www.bilibili.com/video/av170001", { aid: 170001 }],
    ["170001", { aid: 170001 }],
  ])("%s", (s, want) => expect(parseVideoRef(s)).toEqual(want));

  it("rejects short links and junk", () => {
    expect(() => parseVideoRef("https://b23.tv/abc")).toThrow(/b23\.tv/);
    expect(() => parseVideoRef("hello")).toThrow(RefError);
  });

  it.each([
    ["https://space.bilibili.com/546195/video", { mid: "546195" }],
    ["546195", { mid: "546195" }],
    ["UID:546195", { mid: "546195" }],
    ["老番茄", { name: "老番茄" }],
  ])("user %s", (s, want) => expect(parseUserRef(s)).toEqual(want));
});

describe("parsers", () => {
  it("parses view/detail into a video", () => {
    const v = parseDetail(json("view-detail").data as RawDetail, {
      source: "video",
      category: "单机游戏",
      now: NOW,
    })!;
    expect(v).toMatchObject({
      bvid: "BV18fhb65EGs",
      aid: 117320588531711,
      title: "超市里已经……没有人类了……",
      url: "https://www.bilibili.com/video/BV18fhb65EGs",
      author: { mid: "546195", name: "老番茄" },
      publishDate: "2026-09-24T08:20:00.000Z",
      durationSec: 2022,
      category: "单机游戏",
      categoryId: 17,
      parts: 1,
      source: "video",
    });
    expect(v.views).toBeGreaterThan(1_000_000);
    expect(v.likes).toBeGreaterThan(0);
    expect(v.coins).toBeGreaterThan(0);
    expect(v.favorites).toBeGreaterThan(0);
    expect(v.danmaku).toBeGreaterThan(0);
    expect(v.replies).toBe(1965);
    expect(v.cover).toMatch(/^https:\/\/i\d\.hdslb\.com\//);
    expect(v.tags).toContain("搞笑");
    expect(parseDetail({}, { source: "x", now: NOW })).toBeNull();
  });

  it("parses listings", () => {
    const p = parsePopular(json("popular").data);
    expect(p.videos).toHaveLength(3);
    expect(p.videos[0]!.bvid).toMatch(/^BV1/);
    expect(p.videos[0]!.category).toBeTruthy();
    expect(p.noMore).toBe(false);

    const s = parseVideoSearch(json("search-video").data);
    expect(s.videos).toHaveLength(2); // 3rd result is a "ketang" course ad
    expect(s.numPages).toBe(50);
    expect(s.videos[0]!.category).toBeTruthy();

    const users = parseUserSearch(json("search-user").data);
    expect(users[0]).toMatchObject({ mid: "546195", name: "老番茄" });
    expect(pickUser(users, "老番茄")).toMatchObject({
      mid: "546195",
      exact: true,
    });
    expect(pickUser(users, "nobody")?.exact).toBe(false);
    expect(pickUser([], "x")).toBeNull();

    const a = parseUserArchives(json("user-archives").data);
    expect(a.videos.map((x) => x.bvid)).toContain("BV18fhb65EGs");
    expect(a.total).toBeGreaterThan(100);

    const arc = parseArcSearch(json("user-arc-search").data);
    expect(arc.videos.length).toBeGreaterThan(0);
    expect(arc.total).toBeGreaterThan(100);
  });

  it("parses comments", () => {
    const m = parseMainReplies(json("reply-main").data);
    expect(m.replies).toHaveLength(3);
    expect(m.isEnd).toBe(true);
    const c = parseReply(m.replies[0]!)!;
    expect(c).toMatchObject({
      rpid: "314902383633",
      parentRpid: null,
      replyCount: 18,
    });
    expect(c.text.length).toBeGreaterThan(0);
    expect(c.author.name).toBeTruthy();
    expect(Date.parse(c.date)).toBeGreaterThan(0);
    const sub = parseSubReplies(json("reply-sub").data).map(parseReply);
    expect(sub.length).toBeGreaterThan(0);
    expect(sub[0]!.parentRpid).toBe("314902383633");
  });

  it("detects voucher-only risk responses and parses cookies", () => {
    expect(isVoucherOnly({ v_voucher: "voucher_x" })).toBe(true);
    expect(isVoucherOnly(json("search-video").data)).toBe(false);
    expect(parseSetCookie("buvid3=abc; path=/")).toEqual(["buvid3", "abc"]);
    expect(httpsUrl("//i0.hdslb.com/a.jpg")).toBe("https://i0.hdslb.com/a.jpg");
    expect(httpsUrl("http://i0.hdslb.com/a.jpg")).toBe(
      "https://i0.hdslb.com/a.jpg",
    );
  });
});

describe("normalizeInput", () => {
  it("defaults to trending", () => {
    expect(normalizeInput({})).toMatchObject({
      mode: "trending",
      maxItems: 10,
      includeComments: true,
      maxCommentsPerVideo: 10,
      searchOrder: "relevance",
    });
  });

  it("validates per mode", () => {
    expect(() => normalizeInput({ mode: "search" })).toThrow(InputError);
    expect(() => normalizeInput({ mode: "videos", videos: [] })).toThrow(
      InputError,
    );
    expect(() => normalizeInput({ mode: "user" })).toThrow(InputError);
    expect(() => normalizeInput({ mode: "x" })).toThrow(InputError);
    expect(() => normalizeInput({ mode: "videos", videos: ["nope"] })).toThrow(
      InputError,
    );
    expect(() => normalizeInput({ maxItems: 0 })).toThrow(InputError);
    expect(
      normalizeInput({
        mode: "videos",
        videos: [
          "BV1xx411c7mD",
          "https://www.bilibili.com/video/BV1xx411c7mD",
          { url: "av2" },
        ],
      }).videos,
    ).toEqual([{ bvid: "BV1xx411c7mD" }, { aid: 2 }]);
    expect(
      normalizeInput({ mode: "user", userIds: [546195, "老番茄"] }).users,
    ).toEqual([{ mid: "546195" }, { name: "老番茄" }]);
  });
});

describe("BiliClient", () => {
  it("builds a session and signs WBI requests", async () => {
    const { fetch, source } = bili();
    await source.video({ bvid: "BV18fhb65EGs" }, { source: "video" });
    const [url, init] = calls(fetch, "/x/web-interface/wbi/view/detail")[0]!;
    const u = new URL(url);
    expect(u.searchParams.get("w_rid")).toMatch(/^[0-9a-f]{32}$/);
    expect(u.searchParams.get("wts")).toMatch(/^\d+$/);
    expect(init?.headers?.cookie).toContain("buvid3=ABC-infoc");
    expect(init?.headers?.cookie).toContain("buvid4=B4%3D%3D");
    expect(init?.headers?.referer).toBe("https://www.bilibili.com/");
  });

  it("backs off and refreshes the session on risk control", async () => {
    let n = 0;
    const { fetch, source, client } = bili((u) => {
      if (u.pathname !== "/x/web-interface/wbi/search/type") return;
      n += 1;
      if (n === 1)
        return {
          status: 412,
          body: '{"code":-412,"message":"request was banned"}',
        };
      if (n === 2)
        return { body: '{"code":0,"data":{"v_voucher":"voucher_x"}}' };
      if (n === 3) return { body: '{"code":-352,"message":"风控校验失败"}' };
    });
    const out = [];
    for await (const v of source.search("minecraft", "relevance")) {
      out.push(v);
      if (out.length === 3) break;
    }
    expect(out).toHaveLength(3);
    expect(client.riskHits).toBe(3);
    expect(calls(fetch, "/x/web-interface/nav")).toHaveLength(4);
  });

  it("gives up after repeated risk control", async () => {
    const { source } = bili((u) =>
      u.pathname === "/x/web-interface/popular"
        ? { body: '{"code":-352,"message":"风控校验失败"}' }
        : undefined,
    );
    await expect(source.trending().next()).rejects.toThrow(RiskControlError);
  });

  it("returns null for removed videos", async () => {
    const { source } = bili((u) =>
      u.pathname === "/x/web-interface/wbi/view/detail"
        ? { body: '{"code":-404,"message":"啥都木有"}' }
        : undefined,
    );
    expect(await source.video({ aid: 1 }, { source: "video" })).toBeNull();
  });
});

describe("BiliSource.comments", () => {
  it("collects top comments with their replies, capped", async () => {
    const { fetch, source } = bili();
    const c = await source.comments(117320588531711, "BV18fhb65EGs", 6);
    expect(c).toHaveLength(6);
    expect(c[0]!.parentRpid).toBeNull();
    expect(c[1]!.parentRpid).toBe(c[0]!.rpid);
    expect(new Set(c.map((x) => x.rpid)).size).toBe(6);
    expect(calls(fetch, "/x/v2/reply/reply")).toHaveLength(1);
  });
});

describe("BiliSource.userVideos", () => {
  it("falls back to space search when the archive list is empty", async () => {
    const { fetch, source } = bili((u) =>
      u.pathname === "/x/series/recArchivesByKeywords"
        ? { body: '{"code":0,"data":{"archives":[],"page":{"total":0}}}' }
        : undefined,
    );
    const it = source.userVideos("546195");
    const first = await it.next();
    expect(first.value?.bvid).toMatch(/^BV1/);
    const [url] = calls(fetch, "/x/space/wbi/arc/search")[0]!;
    expect(new URL(url).searchParams.get("dm_img_str")).toBeTruthy();
  });
});

describe("runScrape", () => {
  const run = async (
    raw: Parameters<typeof normalizeInput>[0],
    emitLimit = Infinity,
  ) => {
    const { source, fetch } = bili();
    const out: Video[] = [];
    const stats = await runScrape(normalizeInput(raw), {
      source,
      emit: async (v) => (out.push(v), out.length < emitLimit),
    });
    return { out, stats, fetch };
  };

  it("scrapes trending with comments", async () => {
    const { out, stats } = await run({
      mode: "trending",
      maxItems: 2,
      maxCommentsPerVideo: 5,
    });
    // Every detail call returns the same fixture video, so it's deduped to one.
    expect(out).toHaveLength(1);
    expect(out[0]!.comments).toHaveLength(5);
    expect(out[0]!.source).toBe("trending");
    expect(stats.groups.trending!.status).toBe("exhausted");
  });

  it("stops at the budget", async () => {
    const { stats } = await run({ mode: "search", keywords: ["a", "b"] }, 1);
    expect(stats.stopReason).toBe("budget");
    expect(stats.emitted).toBe(1);
  });

  it("resolves channel names and skips comments when off", async () => {
    const { out, fetch } = await run({
      mode: "user",
      userIds: ["老番茄"],
      includeComments: false,
    });
    expect(out[0]!.source).toBe("user:546195");
    expect(out[0]!.comments).toBeUndefined();
    expect(calls(fetch, "/x/v2/reply/wbi/main")).toHaveLength(0);
  });

  it("onlyNew: skips known videos before fetching details, never charges them", async () => {
    const fake = (bvids: string[]) => {
      const video = vi.fn(
        async (ref: { bvid?: string }) =>
          ({ bvid: ref.bvid, aid: 1, replies: 0 }) as unknown as Video,
      );
      const list = async function* () {
        for (const bvid of bvids) yield { bvid } as never;
      };
      const source = {
        trending: list,
        userVideos: list,
        video,
      } as unknown as RunDeps["source"];
      return { source, video };
    };
    const go = async (
      raw: Parameters<typeof normalizeInput>[0],
      bvids: string[],
      state: unknown,
    ) => {
      const seen = new Seen(state);
      const { source, video } = fake(bvids);
      const out: string[] = [];
      const stats = await runScrape(normalizeInput({ ...raw, onlyNew: true }), {
        source,
        seen,
        emit: async (v) => (out.push(v.bvid), true),
      });
      return { out, stats, video, state: seen.toJSON() };
    };
    const trending = { mode: "trending", includeComments: false };

    const r1 = await go(trending, ["BV1", "BV2"], undefined);
    expect(r1.out).toEqual(["BV1", "BV2"]);
    const r2 = await go(trending, ["BV3", "BV1", "BV2"], r1.state);
    expect(r2.out).toEqual(["BV3"]);
    expect(r2.video).toHaveBeenCalledTimes(1);
    expect(r2.stats.groups.trending!.skippedSeen).toBe(2);
    // Nothing new is not an error.
    const r3 = await go(trending, ["BV3", "BV1"], r2.state);
    expect(r3.out).toEqual([]);

    // Channels are newest first: stop after a streak of known videos.
    const old = Array.from(
      { length: ONLY_NEW_SEEN_STREAK + 10 },
      (_, i) => `BVo${i}`,
    );
    const user = {
      mode: "user",
      userIds: ["546195"],
      includeComments: false,
      maxItems: 1000,
    };
    const u1 = await go(user, old, undefined);
    const u2 = await go(user, ["BVnew", ...old, "BVolder"], u1.state);
    expect(u2.out).toEqual(["BVnew"]);
    expect(u2.stats.groups["user:546195"]).toMatchObject({
      skippedSeen: ONLY_NEW_SEEN_STREAK,
      status: "exhausted",
    });
  });

  it("fails loudly with zero results", async () => {
    const { source } = bili((u) =>
      u.pathname === "/x/web-interface/wbi/view/detail"
        ? { body: '{"code":-404,"message":"啥都木有"}' }
        : undefined,
    );
    await expect(
      runScrape(normalizeInput({ mode: "videos", videos: ["BV1xx411c7mD"] }), {
        source,
        emit: async () => true,
      }),
    ).rejects.toThrow(/No videos scraped.*1 not found/);
  });

  it("reports a group as failed on persistent risk control, keeps others", async () => {
    const { source } = bili((u) =>
      u.pathname === "/x/web-interface/wbi/search/type" &&
      u.searchParams.get("keyword") === "bad"
        ? { body: '{"code":-352,"message":"风控校验失败"}' }
        : undefined,
    );
    const out: Video[] = [];
    const stats = await runScrape(
      normalizeInput({
        mode: "search",
        keywords: ["bad", "good"],
        includeComments: false,
      }),
      { source, emit: async (v) => (out.push(v), true) },
    );
    expect(stats.groups["search:bad"]!.status).toBe("failed");
    expect(stats.groups["search:good"]!.emitted).toBe(1);
  });
});
