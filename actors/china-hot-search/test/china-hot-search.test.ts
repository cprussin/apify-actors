import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parseBaidu,
  parseBilibili,
  parseDouyinBillboard,
  parseDouyinWeb,
  parseToutiao,
  ParseError,
} from "../src/boards.js";
import {
  HttpClient,
  HttpError,
  parseSetCookie,
  type FetchLike,
  type Page,
} from "../src/http.js";
import { InputError, normalizeInput } from "../src/input.js";
import { Robots } from "../src/robots.js";
import { runBoards, URLS, type TrendItem } from "../src/run.js";

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const page = (url: string, body: string, cookies: string[] = []): Page => ({
  url,
  status: 200,
  contentType: "application/json",
  body,
  cookies,
});

type Route = string | Error | ((h: Record<string, string>) => Page);

/** Fake `get` over a URL → response map; unknown URLs are 404. */
function fakeGet(routes: Record<string, Route>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const get = async (url: string, headers: Record<string, string> = {}) => {
    calls.push({ url, headers });
    const r = routes[url];
    if (r === undefined) throw new HttpError(404, "not found", url);
    if (r instanceof Error) throw r;
    if (typeof r === "function") return r(headers);
    return page(url, r);
  };
  return { get, calls };
}

const ALL_OK: Record<string, Route> = {
  "https://www.iesdouyin.com/robots.txt": new HttpError(404, "", ""),
  [URLS.douyinBillboard]: fixture("douyin-billboard.json"),
  "https://top.baidu.com/robots.txt": new HttpError(404, "<html>", ""),
  [URLS.baidu]: fixture("baidu-realtime.json"),
  "https://www.toutiao.com/robots.txt":
    "User-agent: *\nDisallow: /search\nDisallow: /trending/\nDisallow: /item/\n",
  [URLS.toutiao]: fixture("toutiao-hot-board.json"),
  "https://s.search.bilibili.com/robots.txt": "{}",
  [URLS.bilibili]: fixture("bilibili-hotword.json"),
};

const NOW = new Date("2026-10-20T06:00:00.000Z");

async function run(
  routes: Record<string, Route>,
  raw: Parameters<typeof normalizeInput>[0] = {},
  budget = Infinity,
) {
  const { get, calls } = fakeGet(routes);
  const items: TrendItem[] = [];
  const logs: string[] = [];
  const stats = await runBoards(normalizeInput(raw), {
    get,
    log: (m) => logs.push(m),
    now: () => NOW,
    emit: async (item) => {
      items.push(item);
      return items.length < budget;
    },
  });
  return { stats, items, logs, calls };
}

describe("parsers", () => {
  it("parses the Douyin billboard", () => {
    const rows = parseDouyinBillboard(fixture("douyin-billboard.json"));
    // The empty word is dropped.
    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual({
      rank: 1,
      title: "美舰冲闯南沙群岛仙宾礁附近海域",
      hotValue: 12051956,
      url: "https://www.douyin.com/search/%E7%BE%8E%E8%88%B0%E5%86%B2%E9%97%AF%E5%8D%97%E6%B2%99%E7%BE%A4%E5%B2%9B%E4%BB%99%E5%AE%BE%E7%A4%81%E9%99%84%E8%BF%91%E6%B5%B7%E5%9F%9F",
      label: "新",
      labelEn: "new",
      description: null,
      categories: [],
      videoCount: null,
      eventTime: null,
    });
    expect(rows.map((r) => r.label)).toEqual(["新", "热", "热", "新", null]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  it("parses the douyin.com board", () => {
    const rows = parseDouyinWeb(fixture("douyin-web.json"));
    expect(rows).toHaveLength(4);
    expect(rows[1]).toMatchObject({
      rank: 2,
      title: "英雄联盟S16瑞士轮首日赛程",
      hotValue: 11782300,
      url: "https://www.douyin.com/hot/2703868",
      label: "热",
      labelEn: "hot",
      videoCount: 2,
      eventTime: new Date(1792462324 * 1000).toISOString(),
    });
  });

  it("parses Baidu realtime", () => {
    const rows = parseBaidu(fixture("baidu-realtime.json"));
    expect(rows).toHaveLength(5);
    expect(rows[1]).toMatchObject({
      rank: 2,
      title: "十通陌生电话七通没人接",
      hotValue: 7712334,
      label: "新",
      labelEn: "new",
    });
    expect(rows[1]!.url).toMatch(/^https:\/\/www\.baidu\.com\/s\?wd=/);
    expect(rows[1]!.description).toContain("陌生电话");
    expect(rows[0]!.label).toBeNull();
    // The pinned top item is not a ranked row.
    expect(rows.map((r) => r.title)).not.toContain("军民团结如一人");
  });

  it("parses the Toutiao hot board", () => {
    const rows = parseToutiao(fixture("toutiao-hot-board.json"));
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({
      rank: 1,
      title: "特朗普：中方在乌问题上立场很公允",
      hotValue: 23159743,
      url: "https://www.toutiao.com/trending/7697897058136604715/",
      label: "新",
      labelEn: "new",
      categories: ["international"],
    });
    expect(rows.map((r) => r.labelEn)).toEqual([
      "new",
      "new",
      "hot",
      "debunk",
      null,
    ]);
  });

  it("parses Bilibili hot words", () => {
    const rows = parseBilibili(fixture("bilibili-hotword.json"));
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({
      rank: 1,
      title: "IG出征单曲 仁川共鸣",
      hotValue: 6663570,
      label: "热",
      url: "https://search.bilibili.com/all?keyword=IG%E5%87%BA%E5%BE%81%E5%8D%95%E6%9B%B2%20%E4%BB%81%E5%B7%9D%E5%85%B1%E9%B8%A3",
    });
    expect(rows.map((r) => r.label)).toEqual([
      "热",
      "新",
      "热",
      "新",
      null,
      null,
    ]);
  });

  it("rejects non-JSON and error responses", () => {
    expect(() => parseBaidu("<html>blocked</html>")).toThrow(ParseError);
    expect(() =>
      parseDouyinBillboard('{"status_code":2154,"word_list":null}'),
    ).toThrow(/status_code 2154/);
    expect(() => parseBilibili('{"code":-412}')).toThrow(/code -412/);
    expect(() => parseToutiao('{"status":"fail"}')).toThrow(ParseError);
  });
});

describe("input", () => {
  it("defaults to every board and all rows", () => {
    expect(normalizeInput(undefined)).toEqual({
      platforms: ["douyin", "baidu", "toutiao", "bilibili"],
      maxItemsPerPlatform: 0,
    });
    expect(normalizeInput({ platforms: [] }).platforms).toHaveLength(4);
  });

  it("normalizes platforms and limits", () => {
    expect(
      normalizeInput({
        platforms: ["Bilibili", "douyin"],
        maxItemsPerPlatform: "10",
      }),
    ).toEqual({ platforms: ["douyin", "bilibili"], maxItemsPerPlatform: 10 });
    expect(normalizeInput({ platforms: "baidu, toutiao" }).platforms).toEqual([
      "baidu",
      "toutiao",
    ]);
    expect(
      normalizeInput({ maxItemsPerPlatform: 999 }).maxItemsPerPlatform,
    ).toBe(100);
  });

  it("rejects unknown platforms and bad limits", () => {
    expect(() => normalizeInput({ platforms: ["weibo"] })).toThrow(InputError);
    expect(() => normalizeInput({ maxItemsPerPlatform: -1 })).toThrow(
      InputError,
    );
  });
});

describe("runBoards", () => {
  it("fetches every board with the default input", async () => {
    const { stats, items, calls } = await run(ALL_OK);
    expect(stats.items).toBe(5 + 5 + 5 + 6);
    expect(stats.stopReason).toBe("done");
    expect(stats.platforms.map((p) => [p.platform, p.status, p.items])).toEqual(
      [
        ["douyin", "ok", 5],
        ["baidu", "ok", 5],
        ["toutiao", "ok", 5],
        ["bilibili", "ok", 6],
      ],
    );
    expect(items[0]).toMatchObject({
      platform: "douyin",
      platformName: "Douyin (抖音)",
      board: "抖音热榜",
      rank: 1,
      fetchedAt: NOW.toISOString(),
    });
    // robots.txt is read before each host's first request.
    const urls = calls.map((c) => c.url);
    expect(urls.indexOf("https://www.toutiao.com/robots.txt")).toBeLessThan(
      urls.indexOf(URLS.toutiao),
    );
    expect(urls).toHaveLength(8);
  });

  it("limits rows per board and selected platforms", async () => {
    const { items, calls } = await run(ALL_OK, {
      platforms: ["baidu", "bilibili"],
      maxItemsPerPlatform: 2,
    });
    expect(items.map((i) => `${i.platform}:${i.rank}`)).toEqual([
      "baidu:1",
      "baidu:2",
      "bilibili:1",
      "bilibili:2",
    ]);
    expect(calls.some((c) => c.url.includes("douyin"))).toBe(false);
  });

  it("falls back to douyin.com with the home page cookies", async () => {
    const routes: Record<string, Route> = {
      ...ALL_OK,
      [URLS.douyinBillboard]: new HttpError(403, "denied", ""),
      "https://www.douyin.com/robots.txt":
        "User-agent: Googlebot\nDisallow: /follow\n",
      [URLS.douyinHome]: () =>
        page(URLS.douyinHome, "<html></html>", ["ttwid=abc", "__ac_nonce=1"]),
      [URLS.douyinWeb]: (h) => {
        if (h.cookie !== "ttwid=abc; __ac_nonce=1") throw new Error("cookie");
        return page(URLS.douyinWeb, fixture("douyin-web.json"));
      },
    };
    const { stats, items, logs } = await run(routes, { platforms: ["douyin"] });
    expect(stats.platforms[0]).toMatchObject({
      status: "ok",
      items: 4,
      source: URLS.douyinWeb,
    });
    expect(items[0]!.videoCount).toBe(6);
    expect(logs[0]).toMatch(/billboard API failed/);
  });

  it("keeps going when one board fails", async () => {
    const routes: Record<string, Route> = {
      ...ALL_OK,
      [URLS.baidu]: new HttpError(502, "bad gateway", URLS.baidu),
    };
    const { stats, logs } = await run(routes);
    expect(stats.platforms.map((p) => p.status)).toEqual([
      "ok",
      "failed",
      "ok",
      "ok",
    ]);
    expect(stats.items).toBe(16);
    expect(logs.some((l) => l.startsWith("baidu: failed"))).toBe(true);
  });

  it("skips a board that robots.txt disallows", async () => {
    const routes: Record<string, Route> = {
      ...ALL_OK,
      "https://s.search.bilibili.com/robots.txt":
        "User-agent: *\nDisallow: /\n",
    };
    const { stats, calls } = await run(routes, { platforms: ["bilibili"] });
    expect(stats.platforms[0]!.status).toBe("robotsDisallowed");
    expect(calls.map((c) => c.url)).not.toContain(URLS.bilibili);
  });

  it("treats a 5xx robots.txt as disallow-all", async () => {
    const routes: Record<string, Route> = {
      ...ALL_OK,
      "https://www.toutiao.com/robots.txt": new HttpError(503, "", ""),
    };
    const { stats } = await run(routes, { platforms: ["toutiao"] });
    expect(stats.platforms[0]!.status).toBe("robotsDisallowed");
  });

  it("stops at the max charge", async () => {
    const { stats, items } = await run(ALL_OK, {}, 7);
    expect(items).toHaveLength(7);
    expect(stats.stopReason).toBe("budget");
    expect(stats.platforms.map((p) => [p.status, p.items])).toEqual([
      ["ok", 5],
      ["ok", 2],
      ["skipped", 0],
      ["skipped", 0],
    ]);
  });

  it("outputs no personal data fields", async () => {
    const { items } = await run(ALL_OK);
    const keys = new Set(items.flatMap((i) => Object.keys(i)));
    expect([...keys].sort()).toEqual(
      [
        "board",
        "categories",
        "description",
        "eventTime",
        "fetchedAt",
        "hotValue",
        "label",
        "labelEn",
        "platform",
        "platformName",
        "rank",
        "title",
        "url",
        "videoCount",
      ].sort(),
    );
  });
});

describe("http", () => {
  it("parses Set-Cookie headers", () => {
    expect(
      parseSetCookie(
        "ttwid=1%7Cabc; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT\n__ac_nonce=0f; Max-Age=1800",
      ),
    ).toEqual(["ttwid=1%7Cabc", "__ac_nonce=0f"]);
    expect(parseSetCookie(null)).toEqual([]);
  });

  it("retries 5xx once and returns cookies", async () => {
    let n = 0;
    const fetch: FetchLike = async (url) => {
      n += 1;
      return {
        ok: n > 1,
        status: n > 1 ? 200 : 503,
        url,
        headers: {
          get: (h: string) => (h === "set-cookie" ? "a=1; Path=/" : null),
        },
        text: async () => "{}",
      };
    };
    const client = new HttpClient({ fetch, sleep: async () => {} });
    const p = await client.get("https://example.com/x");
    expect(n).toBe(2);
    expect(p.cookies).toEqual(["a=1"]);
  });

  it("does not retry a 404", async () => {
    let n = 0;
    const fetch: FetchLike = async (url) => {
      n += 1;
      return {
        ok: false,
        status: 404,
        url,
        headers: { get: () => null },
        text: async () => "",
      };
    };
    const client = new HttpClient({ fetch, sleep: async () => {} });
    await expect(client.get("https://example.com/x")).rejects.toThrow(
      HttpError,
    );
    expect(n).toBe(1);
  });
});

describe("robots", () => {
  it("matches the Toutiao rules", () => {
    const r = Robots.parse(
      "User-agent: *\nDisallow: /search\nDisallow: /trending/\n",
    );
    expect(r.isAllowed("/hot-event/hot-board/?origin=toutiao_pc")).toBe(true);
    expect(r.isAllowed("/trending/123/")).toBe(false);
  });

  it("ignores groups for named bots only", () => {
    const r = Robots.parse("User-agent: Googlebot\nDisallow: /\n");
    expect(r.isAllowed("/aweme/v1/web/hot/search/list/")).toBe(true);
  });
});
