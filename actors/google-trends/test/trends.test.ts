import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { GoogleTrends } from "../src/google-trends.js";
import {
  classify,
  HttpError,
  isCaptcha,
  parseSetCookie,
  TrendsClient,
  type FetchLike,
} from "../src/http.js";
import {
  InputError,
  normalizeGeo,
  normalizeInput,
  parseTimeframe,
  type ExploreInput,
} from "../src/input.js";
import { runTrends, type ResultItem, type TrendResult } from "../src/run.js";
import { Seen } from "../src/state.js";
import {
  anchorFactors,
  exploreUrl,
  findWidget,
  parseExplore,
  parseJson,
  parseRegions,
  parseRelatedQueries,
  parseRelatedTopics,
  parseTimeline,
  parseTrending,
  planBatches,
  trendingRequest,
  uiExploreUrl,
  type Query,
} from "../src/trends.js";

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const NOW = new Date("2026-09-29T15:00:00Z");
const Q: Query = {
  geo: "US",
  time: "today 12-m",
  category: 0,
  property: "",
  hl: "en-US",
  tz: 0,
};

type Reply = {
  status?: number;
  body: string;
  headers?: Record<string, string>;
};
type Handler = (url: string, init?: Parameters<FetchLike>[1]) => Reply;
const fakeFetch = (handler: Handler) =>
  vi.fn(async (url: string, init?: Parameters<FetchLike>[1]) => {
    const r = handler(url, init);
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (n: string) => r.headers?.[n.toLowerCase()] ?? null },
      text: async () => r.body,
    };
  });
const HOME: Reply = {
  body: "<html></html>",
  headers: {
    "set-cookie":
      "NID=abc123; expires=Wed, 01-Jan-2027 00:00:00 GMT; path=/; domain=.google.com; HttpOnly",
  },
};
const client = (handler: Handler, rotate = vi.fn()) => {
  const fetch = fakeFetch((url, init) =>
    url.includes("/trends/?geo=") ? HOME : handler(url, init),
  );
  const http = new TrendsClient({
    fetch,
    rotate,
    sleep: async () => {},
    baseDelayMs: 1,
  });
  return { fetch, http, rotate, trends: new GoogleTrends(http) };
};
const reqOf = (url: string) =>
  JSON.parse(new URL(url).searchParams.get("req") ?? "null");

describe("parseJson", () => {
  it("strips the )]}' prefix with and without comma", () => {
    expect(parseJson(')]}\'\n{"a":1}')).toEqual({ a: 1 });
    expect(parseJson(')]}\',\n{"a":1}')).toEqual({ a: 1 });
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
  });
  it("throws a readable error on HTML", () => {
    expect(() => parseJson("<html>429</html>")).toThrow(/Unexpected response/);
  });
});

describe("explore + widgets (fixtures)", () => {
  it("finds widgets for multi- and single-term explores", () => {
    const multi = parseExplore(fixture("explore-multi.txt"));
    const single = parseExplore(fixture("explore-single.txt"));
    expect(findWidget(multi, "TIMESERIES", 0, 2)?.id).toBe("TIMESERIES");
    expect(findWidget(multi, "GEO_MAP", 1, 2)?.id).toBe("GEO_MAP_1");
    expect(findWidget(multi, "RELATED_QUERIES", 0, 2)?.id).toBe(
      "RELATED_QUERIES_0",
    );
    expect(findWidget(multi, "RELATED_TOPICS", 0, 2)).toBeUndefined();
    expect(findWidget(single, "GEO_MAP", 0, 1)?.id).toBe("GEO_MAP");
    expect(findWidget(single, "RELATED_TOPICS", 0, 1)?.id).toBe(
      "RELATED_TOPICS",
    );
    for (const w of [...multi, ...single]) expect(w.token).toBeTruthy();
  });

  it("parses interest over time", () => {
    const pts = parseTimeline(fixture("multiline.txt"));
    expect(pts.length).toBe(53);
    expect(pts[0]).toMatchObject({
      date: "2025-09-28T00:00:00.000Z",
      formattedTime: "Sep 28 – Oct 4, 2025",
      values: [74, 32],
      hasData: [true, true],
      isPartial: false,
    });
    expect(pts.at(-1)?.isPartial).toBe(true);
    expect(Math.max(...pts.flatMap((p) => p.values))).toBe(100);
  });

  it("parses interest by region", () => {
    const rows = parseRegions(fixture("geo-dma.txt"));
    expect(rows.length).toBe(210);
    expect(rows[0]).toEqual({
      geoCode: "759",
      geoName: "Cheyenne WY-Scottsbluff NE",
      value: 100,
      hasData: true,
      coordinates: null,
    });
  });

  it("parses related queries (top + rising)", () => {
    const rows = parseRelatedQueries(fixture("related-queries.txt"));
    const top = rows.filter((r) => r.ranking === "top");
    const rising = rows.filter((r) => r.ranking === "rising");
    expect(top.length).toBe(25);
    expect(rising.length).toBe(25);
    expect(top[0]).toEqual({
      ranking: "top",
      rank: 1,
      query: "coffee near me",
      value: 100,
      formattedValue: "100",
      isBreakout: false,
      link: "https://trends.google.com/trends/explore?q=coffee+near+me&date=today+12-m&geo=US",
    });
    expect(rising[0]?.isBreakout).toBe(true);
    expect(rising.filter((r) => !r.isBreakout)[0]?.formattedValue).toMatch(
      /^\+[\d,]+%$/,
    );
  });

  // Hand-made fixture: Google currently returns an empty rankedList for topics.
  it("parses related topics", () => {
    const rows = parseRelatedTopics(fixture("related-topics.txt"));
    expect(rows.length).toBe(4);
    expect(rows[0]).toEqual({
      ranking: "top",
      rank: 1,
      topicId: "/m/02vqfm",
      title: "Coffee",
      topicType: "Drink",
      value: 100,
      formattedValue: "100",
      isBreakout: false,
      link: "https://trends.google.com/trends/explore?q=/m/02vqfm&date=today+12-m&geo=US",
    });
    expect(rows[2]).toMatchObject({
      ranking: "rising",
      rank: 1,
      isBreakout: true,
    });
    expect(parseRelatedTopics(')]}\',\n{"default":{"rankedList":[]}}')).toEqual(
      [],
    );
  });

  it("parses trending now", () => {
    const list = parseTrending(fixture("trending.txt"));
    expect(list.length).toBe(256);
    expect(list[0]).toEqual({
      term: "wnba playoffs",
      geo: "US",
      searchVolume: 500000,
      increasePercent: 1000,
      startedAt: "2026-09-29T12:10:00.000Z",
      endedAt: null,
      isActive: true,
      categories: ["Sports"],
      relatedQueries: ["wnba playoffs"],
      newsArticleCount: 8,
    });
    const ended = list.find((t) => t.term === "jalen hurts")!;
    expect(ended.isActive).toBe(false);
    expect(ended.endedAt).toBe("2026-09-29T15:10:00.000Z");
  });
});

describe("request builders", () => {
  it("builds explore and UI URLs", () => {
    const u = new URL(exploreUrl(["a b", "c"], { ...Q, property: "news" }));
    expect(u.pathname).toBe("/trends/api/explore");
    expect(JSON.parse(u.searchParams.get("req")!)).toEqual({
      comparisonItem: [
        { keyword: "a b", geo: "US", time: "today 12-m" },
        { keyword: "c", geo: "US", time: "today 12-m" },
      ],
      category: 0,
      property: "news",
    });
    expect(uiExploreUrl(["a b", "c"], { ...Q, category: 7 })).toBe(
      "https://trends.google.com/trends/explore?q=a+b%2Cc&date=today+12-m&geo=US&cat=7&hl=en-US",
    );
  });
  it("builds the trending batchexecute request", () => {
    const { url, body } = trendingRequest("GB", 4, "en-GB");
    expect(url).toContain("rpcids=i0OFE");
    const freq = JSON.parse(
      decodeURIComponent(body.replace(/^f\.req=/, "")),
    ) as [[[string, string]]];
    expect(JSON.parse(freq[0][0][1])).toEqual([
      null,
      null,
      "GB",
      0,
      "en-GB",
      4,
      1,
    ]);
  });
});

describe("planBatches / anchorFactors", () => {
  it("keeps <= 5 terms in one batch", () => {
    expect(planBatches(["a", "b", "c", "d", "e"])).toEqual([
      ["a", "b", "c", "d", "e"],
    ]);
  });
  it("repeats the anchor in every batch", () => {
    expect(planBatches(["a", "b", "c", "d", "e", "f", "g"])).toEqual([
      ["a", "b", "c", "d", "e"],
      ["a", "f", "g"],
    ]);
    expect(planBatches("abcdefghij".split("")).length).toBe(3);
  });
  it("computes scale factors from the anchor totals", () => {
    expect(
      anchorFactors([
        [50, 50],
        [100, 100],
        [0, 0],
      ]),
    ).toEqual([1, 0.5, null]);
  });
});

describe("input", () => {
  it("applies defaults", () => {
    const i = normalizeInput({}, NOW) as ExploreInput;
    expect(i).toEqual({
      mode: "explore",
      terms: ["coffee", "tea"],
      query: Q,
      datasets: ["interestOverTime", "interestByRegion", "relatedQueries"],
      resolution: null,
      includeLowVolumeRegions: false,
    });
  });
  it("dedupes terms, maps property and geo", () => {
    const i = normalizeInput(
      {
        searchTerms: [" Coffee ", "coffee", "", null, "iced  tea"],
        geo: "worldwide",
        property: "shopping",
        datasets: ["relatedQueries", "interestOverTime"],
        regionResolution: "country",
      },
      NOW,
    ) as ExploreInput;
    expect(i.terms).toEqual(["Coffee", "iced tea"]);
    expect(i.query.geo).toBe("");
    expect(i.query.property).toBe("froogle");
    expect(i.datasets).toEqual(["interestOverTime", "relatedQueries"]);
    expect(i.resolution).toBe("COUNTRY");
  });
  it("normalizes geo", () => {
    expect(normalizeGeo("uk")).toBe("GB");
    expect(normalizeGeo("us-ca")).toBe("US-CA");
    expect(normalizeGeo("US-NY-501")).toBe("US-NY-501");
    expect(() => normalizeGeo("USA")).toThrow(InputError);
  });
  it("parses timeframes", () => {
    expect(parseTimeframe("now 7-d")).toBe("now 7-d");
    expect(parseTimeframe("today 2-y")).toBe("today 2-y");
    expect(parseTimeframe(undefined, "2024-01-01", "2024-06-30")).toBe(
      "2024-01-01 2024-06-30",
    );
    expect(parseTimeframe("custom", "2026-09-01", undefined, NOW)).toBe(
      "2026-09-01 2026-09-29",
    );
    expect(parseTimeframe(undefined, "2026-09-20T00", "2026-09-25T12")).toBe(
      "2026-09-20T00 2026-09-25T12",
    );
    expect(parseTimeframe("2024-01-01 2024-02-01")).toBe(
      "2024-01-01 2024-02-01",
    );
    expect(() => parseTimeframe("last year")).toThrow(InputError);
    expect(() => parseTimeframe("custom")).toThrow(InputError);
    expect(() => parseTimeframe(undefined, "2024-02-01", "2024-01-01")).toThrow(
      /after/,
    );
    expect(() => parseTimeframe(undefined, "2001-01-01")).toThrow(/2004/);
  });
  it("rejects bad input", () => {
    expect(() => normalizeInput({ searchTerms: [] })).toThrow(/at least one/);
    expect(() => normalizeInput({ searchTerms: ["a,b"] })).toThrow(/comma/);
    expect(() => normalizeInput({ datasets: ["nope"] })).toThrow(/Unknown/);
    expect(() => normalizeInput({ property: "maps" })).toThrow(InputError);
    expect(() =>
      normalizeInput({ geo: "US", regionResolution: "COUNTRY" }),
    ).toThrow(/worldwide/);
    expect(() =>
      normalizeInput({ geo: "GB", regionResolution: "DMA" }),
    ).toThrow(/US/);
    expect(() => normalizeInput({ mode: "x" })).toThrow(/mode/);
  });
  it("normalizes trending input", () => {
    expect(
      normalizeInput({ mode: "trendingNow", geo: "de", trendingHours: "4" }),
    ).toEqual({
      mode: "trendingNow",
      geo: "DE",
      hours: 4,
      hl: "en-US",
      maxResults: 50,
      onlyNew: false,
    });
    expect(() => normalizeInput({ mode: "trendingNow", geo: "US-CA" })).toThrow(
      /country/,
    );
    expect(() =>
      normalizeInput({ mode: "trendingNow", trendingHours: 12 }),
    ).toThrow(/trendingHours/);
  });
});

describe("TrendsClient", () => {
  it("sends the NID cookie and retries 429 with a new session", async () => {
    let n = 0;
    const { http, fetch, rotate } = client(() =>
      ++n < 3 ? { status: 429, body: "Too many" } : { body: "ok" },
    );
    expect(await http.request("https://trends.google.com/x")).toBe("ok");
    expect(rotate).toHaveBeenCalledTimes(2);
    expect(http.blocks).toBe(2);
    const calls = fetch.mock.calls.filter(([u]) => u.endsWith("/x"));
    expect(calls.length).toBe(3);
    expect(calls[2]![1]?.headers?.cookie).toBe("NID=abc123");
    // Cookie refreshed after each block: 3 home page visits.
    expect(
      fetch.mock.calls.filter(([u]) => u.includes("/trends/?geo")).length,
    ).toBe(3);
  });
  it("retries blocks quickly when rotating proxy IPs", async () => {
    const sleeps: number[] = [];
    let n = 0;
    const http = new TrendsClient({
      fetch: fakeFetch((url) =>
        url.includes("/trends/?geo=")
          ? HOME
          : ++n < 3
            ? { status: 429, body: "" }
            : { status: n === 3 ? 503 : 200, body: "ok" },
      ),
      rotatedDelayMs: 7,
      baseDelayMs: 1000,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(await http.request("https://trends.google.com/x")).toBe("ok");
    expect(sleeps).toEqual([7, 7, 7]);
  });
  it("does not retry 4xx other than 403/429", async () => {
    const { http, fetch } = client(() => ({ status: 401, body: "bad token" }));
    await expect(http.request("https://trends.google.com/x")).rejects.toThrow(
      HttpError,
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("gives up after maxRetries", async () => {
    const { http } = client(() => ({ status: 429, body: "" }));
    await expect(http.request("https://trends.google.com/x")).rejects.toThrow(
      /429/,
    );
    expect(http.blocks).toBe(6);
  });
  it("rotates the session on timeouts, network errors, 5xx and captcha", async () => {
    let n = 0;
    const { http, rotate } = client(() => {
      n += 1;
      if (n === 1)
        throw new DOMException("aborted due to timeout", "TimeoutError");
      if (n === 2) throw new TypeError("fetch failed");
      if (n === 3) return { status: 502, body: "" };
      if (n === 4)
        return {
          body: "<html>Our systems have detected unusual traffic</html>",
        };
      return { body: "ok" };
    });
    expect(await http.request("https://trends.google.com/x")).toBe("ok");
    expect(rotate).toHaveBeenCalledTimes(4);
    expect(http.errors).toBe(3);
    expect(http.blocks).toBe(1);
  });
  it("falls back to direct when the proxy fails, and back on 429", async () => {
    let proxyApi = 0;
    let directApi = 0;
    const proxyFetch = fakeFetch((url) => {
      if (url.includes("/trends/?geo=")) return HOME;
      proxyApi += 1;
      if (proxyApi <= 2)
        throw new Error("The operation was aborted due to timeout");
      return { body: "proxy ok" };
    });
    const directFetch = fakeFetch((url) => {
      if (url.includes("/trends/?geo=")) return HOME;
      directApi += 1;
      return directApi === 2
        ? { status: 429, body: "" }
        : { body: "direct ok" };
    });
    const rotate = vi.fn();
    const http = new TrendsClient({
      fetch: proxyFetch,
      fallbackFetch: directFetch,
      rotate,
      rotatedDelayMs: 0,
      sleep: async () => {},
    });
    // 2 proxy timeouts -> direct.
    expect(await http.request("https://trends.google.com/x")).toBe("direct ok");
    expect(http.route).toBe("fallback");
    // Direct gets 429 -> back to a new proxy session.
    expect(await http.request("https://trends.google.com/y")).toBe("proxy ok");
    expect(http.route).toBe("primary");
    expect(rotate).toHaveBeenCalledTimes(3);
    expect(directApi).toBe(2);
  });
  it("caps total retry time per request", async () => {
    let t = 0;
    const http = new TrendsClient({
      fetch: fakeFetch(() => {
        t += 15_000; // each attempt burns a full timeout
        throw new Error("The operation was aborted due to timeout");
      }),
      maxRetries: 8,
      rotatedDelayMs: 500,
      maxRequestMs: 45_000,
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
    });
    await expect(http.request("https://trends.google.com/x")).rejects.toThrow(
      /timeout/,
    );
    expect(t).toBeLessThanOrEqual(46_000);
    expect(http.errors).toBe(3);
  });
  it("stops retrying when nothing has succeeded for maxFailingMs", async () => {
    let t = 0;
    let calls = 0;
    const http = new TrendsClient({
      fetch: fakeFetch(() => {
        calls += 1;
        t += 10_000;
        throw new Error("fetch failed");
      }),
      maxFailingMs: 30_000,
      rotatedDelayMs: 0,
      maxRetries: 8,
      now: () => t,
      sleep: async () => {},
    });
    await expect(http.request("https://trends.google.com/x")).rejects.toThrow();
    expect(calls).toBe(3);
    // Later requests get a single attempt until one succeeds.
    await expect(http.request("https://trends.google.com/y")).rejects.toThrow();
    expect(calls).toBe(4);
  });
  it("classifies errors and detects captcha pages", () => {
    expect(classify(new HttpError(429, "", ""))).toBe("blocked");
    expect(classify(new HttpError(503, "", ""))).toBe("transient");
    expect(classify(new HttpError(400, "", ""))).toBe("fatal");
    expect(classify(new Error("aborted due to timeout"))).toBe("transient");
    expect(isCaptcha("https://www.google.com/sorry/index?x", "")).toBe(true);
    expect(isCaptcha(undefined, ")]}'\n{}")).toBe(false);
  });
  it("parses Set-Cookie headers", () => {
    expect(
      parseSetCookie({
        get: () => null,
        getSetCookie: () => ["NID=1; path=/", "AEC=2; HttpOnly"],
      }),
    ).toBe("NID=1; AEC=2");
    expect(
      parseSetCookie({
        get: () =>
          "NID=1; expires=Wed, 01-Jan-2027 00:00:00 GMT; path=/, AEC=2; path=/",
      }),
    ).toBe("NID=1; AEC=2");
  });
});

// ---- End-to-end with a fake Google ----

/** A fake Trends backend: synthetic explore/widget responses per request. */
function fakeGoogle(opts: {
  /** interest-over-time value for term (by name) at point t */
  series?: (term: string, t: number) => number;
  noTopicsFor?: string[];
  failExplore?: (terms: string[]) => boolean;
}) {
  const explores: string[][] = [];
  const handler: Handler = (url) => {
    const u = new URL(url);
    const XSSI = ")]}'\n";
    if (u.pathname === "/trends/api/explore") {
      const req = reqOf(url) as { comparisonItem: { keyword: string }[] };
      const terms = req.comparisonItem.map((c) => c.keyword);
      explores.push(terms);
      if (opts.failExplore?.(terms)) return { status: 400, body: "bad" };
      const kw = (t: string) => ({
        complexKeywordsRestriction: { keyword: [{ value: t }] },
      });
      const w = (id: string, request: object) => ({
        id,
        token: `tok-${id}`,
        request,
      });
      const widgets = [w("TIMESERIES", { comparisonItem: terms.map(kw) })];
      terms.forEach((t, i) => {
        const sfx = terms.length === 1 ? "" : `_${i}`;
        widgets.push(
          w(`GEO_MAP${sfx}`, { comparisonItem: [kw(t)], resolution: "REGION" }),
        );
        widgets.push(
          w(`RELATED_QUERIES${sfx}`, {
            restriction: kw(t),
            keywordType: "QUERY",
          }),
        );
        if (terms.length === 1 && !opts.noTopicsFor?.includes(t))
          widgets.push(
            w("RELATED_TOPICS", { restriction: kw(t), keywordType: "ENTITY" }),
          );
      });
      return { body: XSSI + JSON.stringify({ widgets }) };
    }
    const req = reqOf(url) as {
      comparisonItem?: {
        complexKeywordsRestriction: { keyword: { value: string }[] };
      }[];
      restriction?: {
        complexKeywordsRestriction: { keyword: { value: string }[] };
      };
      resolution?: string;
    };
    const termsOf = (req.comparisonItem ?? []).map(
      (c) => c.complexKeywordsRestriction.keyword[0]!.value,
    );
    if (u.pathname.endsWith("/multiline")) {
      const s = opts.series ?? (() => 10);
      return {
        body:
          XSSI +
          JSON.stringify({
            default: {
              timelineData: [0, 1, 2].map((t) => ({
                time: String(1_700_000_000 + t * 86400),
                formattedTime: `d${t}`,
                value: termsOf.map((term) => s(term, t)),
                hasData: termsOf.map(() => true),
                ...(t === 2 ? { isPartial: true } : {}),
              })),
            },
          }),
      };
    }
    if (u.pathname.endsWith("/comparedgeo")) {
      return {
        body:
          XSSI +
          JSON.stringify({
            default: {
              geoMapData: [
                {
                  geoCode: "US-CA",
                  geoName: `CA ${req.resolution}`,
                  value: [100],
                  hasData: [true],
                },
                {
                  geoCode: "US-WY",
                  geoName: "WY",
                  value: [0],
                  hasData: [false],
                },
              ],
            },
          }),
      };
    }
    if (u.pathname.endsWith("/relatedsearches")) {
      const term =
        req.restriction!.complexKeywordsRestriction.keyword[0]!.value;
      return {
        body:
          XSSI +
          JSON.stringify({
            default: {
              rankedList: [
                {
                  rankedKeyword: [
                    {
                      query: `${term} top`,
                      topic: undefined,
                      value: 100,
                      formattedValue: "100",
                      link: "/trends/explore?q=x",
                    },
                    {
                      topic: {
                        mid: "/m/1",
                        title: `${term} topic`,
                        type: "Drink",
                      },
                      value: 90,
                      formattedValue: "90",
                    },
                  ],
                },
                {
                  rankedKeyword: [
                    {
                      query: `${term} rising`,
                      value: 5000,
                      formattedValue: "Breakout",
                    },
                    {
                      topic: {
                        mid: "/g/2",
                        title: "Rising topic",
                        type: "Topic",
                      },
                      value: 250,
                      formattedValue: "+250%",
                    },
                  ],
                },
              ],
            },
          }),
      };
    }
    return { status: 404, body: "not found" };
  };
  return { handler, explores };
}

async function collect(
  raw: Parameters<typeof normalizeInput>[0],
  g: ReturnType<typeof fakeGoogle>,
  budget = Infinity,
) {
  const { trends, fetch } = client(g.handler);
  const items: { item: ResultItem; charge: boolean }[] = [];
  const logs: string[] = [];
  let charged = 0;
  const stats = await runTrends(normalizeInput(raw, NOW), {
    trends,
    log: (m) => logs.push(m),
    emit: async (item, charge) => {
      items.push({ item, charge });
      if (charge) charged += 1;
      return charged < budget;
    },
  });
  return { items, stats, logs, fetch };
}

describe("runTrends (explore)", () => {
  it("emits one item per term x dataset", async () => {
    const g = fakeGoogle({ series: (t, i) => (t === "coffee" ? 50 + i : 20) });
    const { items, stats } = await collect(
      {
        datasets: [
          "interestOverTime",
          "interestByRegion",
          "relatedQueries",
          "relatedTopics",
        ],
      },
      g,
    );
    expect(items.map(({ item }) => `${item.dataset}:${item.term}`)).toEqual([
      "interestOverTime:coffee",
      "interestOverTime:tea",
      "interestByRegion:coffee",
      "interestByRegion:tea",
      "relatedQueries:coffee",
      "relatedQueries:tea",
      "relatedTopics:coffee",
      "relatedTopics:tea",
    ]);
    expect(stats).toMatchObject({
      emitted: 8,
      charged: 8,
      empty: 0,
      stopReason: "done",
    });
    // One multi-term explore, plus one per term for related topics.
    expect(g.explores).toEqual([["coffee", "tea"], ["coffee"], ["tea"]]);

    const iot = items[0]!.item as TrendResult;
    expect(iot).toMatchObject({
      term: "coffee",
      geo: "US",
      timeframe: "today 12-m",
      category: 0,
      property: "web",
      comparedWith: ["tea"],
      anchorTerm: null,
      hasData: true,
      rowCount: 3,
      exploreUrl:
        "https://trends.google.com/trends/explore?q=coffee%2Ctea&date=today+12-m&geo=US&hl=en-US",
    });
    expect(iot.rows[0]).toEqual({
      date: "2023-11-14T22:13:20.000Z",
      formattedTime: "d0",
      value: 50,
      normalizedValue: 50,
      hasData: true,
      isPartial: false,
    });
    const region = items[2]!.item as TrendResult;
    expect(region.rows).toEqual([
      {
        geoCode: "US-CA",
        geoName: "CA REGION",
        value: 100,
        hasData: true,
        coordinates: null,
      },
    ]);
    expect(region.resolution).toBe("REGION");
    const rq = items[4]!.item as TrendResult;
    expect(rq.rows.map((r) => ("query" in r ? r.query : ""))).toEqual([
      "coffee top",
      "coffee rising",
    ]);
    const rt = items[6]!.item as TrendResult;
    expect(rt.rows.map((r) => ("title" in r ? r.title : ""))).toEqual([
      "coffee topic",
      "Rising topic",
    ]);
  });

  it("normalizes more than 5 terms via the anchor", async () => {
    // Anchor "a" scores 40 in batch 1 and 20 in batch 2 (batch 2 has a bigger term).
    const g = fakeGoogle({
      series: (t) =>
        ({ a: 40, b: 100, c: 10, d: 10, e: 10, f: 20, g: 100 })[t] ?? 0,
    });
    // Make batch 2 values relative: a=20 there.
    const base = g.handler;
    g.handler = (url, init) => {
      const r = base(url, init);
      if (url.includes("/multiline") && decodeURIComponent(url).includes('"g"'))
        r.body = r.body.replace(/\[40,20,100\]/g, "[20,20,100]");
      return r;
    };
    const { items } = await collect(
      {
        searchTerms: ["a", "b", "c", "d", "e", "f", "g"],
        datasets: ["interestOverTime"],
      },
      g,
    );
    const byTerm = Object.fromEntries(
      items.map(({ item }) => [item.term, item as TrendResult]),
    );
    expect(Object.keys(byTerm)).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
    expect(byTerm.f!.comparedWith).toEqual(["a", "g"]);
    expect(byTerm.f!.anchorTerm).toBe("a");
    // batch-2 factor = 40/20 = 2, so g = 200 on batch-1 scale; max = 200.
    const nv = (t: string) =>
      (byTerm[t]!.rows[0] as { normalizedValue: number }).normalizedValue;
    expect(nv("g")).toBe(100);
    expect(nv("b")).toBe(50);
    expect(nv("a")).toBe(20);
    expect(nv("f")).toBe(20);
  });

  it("emits free empty items and skips failed batches", async () => {
    const g = fakeGoogle({ noTopicsFor: ["tea"] });
    const { items, stats } = await collect({ datasets: ["relatedTopics"] }, g);
    expect(items.map((i) => [i.item.term, i.charge])).toEqual([
      ["coffee", true],
      ["tea", false],
    ]);
    expect((items[1]!.item as TrendResult).hasData).toBe(false);
    expect(stats).toMatchObject({ charged: 1, empty: 1 });
  });

  it("fails when some requests fail and none return data", async () => {
    const g = fakeGoogle({ noTopicsFor: ["coffee", "tea"] });
    const handler: Handler = (url, init) =>
      url.includes("/widgetdata/multiline")
        ? { status: 400, body: "bad" }
        : g.handler(url, init);
    await expect(
      collect(
        { datasets: ["interestOverTime", "relatedTopics"] },
        { ...g, handler },
      ),
    ).rejects.toThrow(/All requests failed/);
  });

  it("logs per-term failures and fails when everything fails", async () => {
    const g = fakeGoogle({ failExplore: (t) => t.length > 1 });
    await expect(
      collect({ datasets: ["interestOverTime"] }, g),
    ).rejects.toThrow(/All requests failed/);
    const g2 = fakeGoogle({ failExplore: (t) => t.length > 1 });
    const { items, stats } = await collect(
      { datasets: ["interestOverTime", "relatedTopics"] },
      g2,
    );
    expect(items.map((i) => i.item.dataset)).toEqual([
      "relatedTopics",
      "relatedTopics",
    ]);
    expect(stats.failed.length).toBe(2);
  });

  it("applies region resolution and low-volume option", async () => {
    const g = fakeGoogle({});
    const { items } = await collect(
      {
        searchTerms: ["x"],
        datasets: ["interestByRegion"],
        regionResolution: "DMA",
        includeLowVolumeRegions: true,
      },
      g,
    );
    const r = items[0]!.item as TrendResult;
    expect(r.resolution).toBe("DMA");
    expect(r.rows.length).toBe(2);
    expect(r.comparedWith).toEqual([]);
  });

  it("stops at the budget", async () => {
    const { items, stats } = await collect({}, fakeGoogle({}), 3);
    expect(items.length).toBe(3);
    expect(stats.stopReason).toBe("budget");
  });
});

describe("runTrends (trending now)", () => {
  it("emits trending searches up to maxTrendingSearches", async () => {
    const { trends, fetch } = client((url) =>
      url.includes("batchexecute")
        ? { body: fixture("trending.txt") }
        : { status: 404, body: "" },
    );
    const out: ResultItem[] = [];
    const stats = await runTrends(
      normalizeInput({ mode: "trendingNow", maxTrendingSearches: 5 }),
      { trends, emit: async (i) => (out.push(i), true) },
    );
    expect(out.length).toBe(5);
    expect(stats.charged).toBe(5);
    expect(out[0]).toMatchObject({
      dataset: "trendingNow",
      term: "wnba playoffs",
      geo: "US",
      timeframe: "past 24 hours",
      searchVolume: 500000,
      exploreUrl:
        "https://trends.google.com/trends/explore?q=wnba+playoffs&date=now+1-d&geo=US&hl=en-US",
    });
    const post = fetch.mock.calls.find(([u]) => u.includes("batchexecute"))!;
    expect(post[1]?.method).toBe("POST");
  });

  it("onlyNew: skips (and doesn't charge) searches returned before", async () => {
    const go = async (state: unknown) => {
      const { trends } = client((url) =>
        url.includes("batchexecute")
          ? { body: fixture("trending.txt") }
          : { status: 404, body: "" },
      );
      const seen = new Seen(state);
      const out: string[] = [];
      const stats = await runTrends(
        normalizeInput({
          mode: "trendingNow",
          maxTrendingSearches: 3,
          onlyNew: true,
        }),
        {
          trends,
          seen,
          emit: async (i) => (out.push(i.term), true),
        },
      );
      return { out, stats, state: seen.toJSON() };
    };
    const r1 = await go(undefined);
    expect(r1.out[0]).toBe("wnba playoffs");
    // Known searches don't count toward the limit: the next 3 come next.
    const r2 = await go(r1.state);
    expect(r2.out).toHaveLength(3);
    expect(r2.out.some((t) => r1.out.includes(t))).toBe(false);
    expect(r2.stats).toMatchObject({ skippedSeen: 3, charged: 3 });
  });
});
