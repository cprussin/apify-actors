import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BlockedError,
  HttpError,
  RpcClient,
  type FetchLike,
} from "../src/http.js";
import {
  bestAdvertiser,
  parseContent,
  parseSearchCreatives,
  parseSuggestions,
  searchCreativesRequest,
} from "../src/rpc.js";

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
  ) as Record<string, unknown>;

describe("searchCreativesRequest", () => {
  it("builds the filter object", () => {
    expect(
      searchCreativesRequest(
        {
          advertiserIds: ["AR1"],
          regionId: 2840,
          format: "video",
          platform: "YOUTUBE",
          startDate: 20260101,
          endDate: 20260131,
        },
        40,
        "tok",
      ),
    ).toEqual({
      "2": 40,
      "3": {
        "4": 3,
        "6": 20260101,
        "7": 20260131,
        "8": [2840],
        "13": { "1": ["AR1"] },
        "14": [5],
      },
      "4": "tok",
      "7": { "1": 1 },
    });
    expect(searchCreativesRequest({ domain: "nike.com" }, 10)).toEqual({
      "2": 10,
      "3": { "12": { "1": "nike.com", "2": true } },
      "7": { "1": 1 },
    });
  });
});

describe("parseSearchCreatives", () => {
  it("parses ads, page token and total estimate", () => {
    const p = parseSearchCreatives(fixture("search-page1.txt"));
    expect(p.ads).toHaveLength(4);
    expect(p.nextPageToken).toMatch(/^Cgo/);
    expect(p.totalEstimate).toEqual([expect.any(Number), expect.any(Number)]);
    const a = p.ads[0]!;
    expect(a).toMatchObject({
      advertiserId: "AR16735076323512287233",
      creativeId: "CR10459371884142133249",
      advertiserName: "Nike, Inc.",
      format: "text",
    });
    expect(a.firstShown).toMatch(/^20\d\d-\d\d-\d\dT/);
    expect(a.lastShown! >= a.firstShown!).toBe(true);
    expect(a.totalDaysShown).toBeGreaterThan(0);
    expect(a.previewUrl ?? a.imageUrl).toMatch(/^https:\/\//);
    const p2 = parseSearchCreatives(fixture("search-page2.txt"));
    expect(p2.ads.map((x) => x.creativeId)).not.toContain(a.creativeId);
  });

  it("parses domain searches with target domain and preview URLs", () => {
    const p = parseSearchCreatives(fixture("search-domain-video.txt"));
    expect(p.ads).toHaveLength(2);
    for (const a of p.ads) {
      expect(a.format).toBe("video");
      expect(a.targetDomain).toBe("nike.com");
      expect(a.previewUrl).toMatch(
        /^https:\/\/displayads-formats\.googleusercontent\.com\/ads\/preview\/content\.js\?client=ads-integrity-transparency&/,
      );
    }
  });

  it("handles empty results", () => {
    expect(parseSearchCreatives({})).toEqual({
      ads: [],
      nextPageToken: null,
      totalEstimate: null,
    });
  });
});

describe("parseContent", () => {
  it("reads inline archived images", () => {
    expect(
      parseContent({
        "3": {
          "2": '<img src="https://tpc.googlesyndication.com/archive/simgad/631" height="301" width="348">',
        },
      }),
    ).toEqual({
      previewUrl: null,
      imageUrl: "https://tpc.googlesyndication.com/archive/simgad/631",
      width: 348,
      height: 301,
    });
  });
});

describe("suggestions", () => {
  const s = parseSuggestions(fixture("suggestions-nike.txt"));

  it("parses advertisers and domains", () => {
    expect(s.advertisers.length).toBeGreaterThan(3);
    expect(s.domains).toContain("nike.com");
    expect(s.advertisers).toContainEqual({
      advertiserId: "AR16735076323512287233",
      advertiserName: "Nike, Inc.",
      country: "US",
      adCountMin: expect.any(Number),
      adCountMax: expect.any(Number),
    });
  });

  it("picks the best advertiser for a name", () => {
    expect(bestAdvertiser("nike", s.advertisers)?.advertiserId).toBe(
      "AR16735076323512287233",
    );
    expect(bestAdvertiser("Nike Inc", s.advertisers)?.advertiserName).toBe(
      "Nike, Inc.",
    );
    expect(bestAdvertiser("x", [])).toBeNull();
  });
});

type Resp = { status: number; body: string; location?: string };
function fakeFetch(responses: Resp[]): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const f = (async (url: string, init?: { body?: string }) => {
    calls.push(`${url} ${init?.body ?? ""}`);
    const r = responses.shift();
    if (!r) throw new Error("no more responses");
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: {
        get: (n: string) => (n === "location" ? (r.location ?? null) : null),
      },
      text: async () => r.body,
    };
  }) as FetchLike & { calls: string[] };
  f.calls = calls;
  return f;
}

describe("RpcClient", () => {
  const opts = { sleep: async () => {}, maxRetries: 2 };

  it("posts f.req and parses JSON; empty body is {}", async () => {
    const fetch = fakeFetch([
      { status: 200, body: '{"1":[]}' },
      { status: 200, body: "" },
    ]);
    const c = new RpcClient({ fetch, ...opts });
    expect(
      await c.rpc("SearchService/SearchSuggestions", { "1": "a b" }),
    ).toEqual({
      "1": [],
    });
    expect(fetch.calls[0]).toBe(
      "https://adstransparency.google.com/anji/_/rpc/SearchService/SearchSuggestions?authuser=0 f.req=%7B%221%22%3A%22a%20b%22%7D",
    );
    expect(await c.rpc("X/Y", {})).toEqual({});
  });

  it("rotates on 429, captcha redirects and captcha pages", async () => {
    let rotations = 0;
    const fetch = fakeFetch([
      { status: 429, body: '{"5":429,"9":8}' },
      {
        status: 302,
        body: "",
        location: "https://www.google.com/sorry/index?continue=x",
      },
      { status: 200, body: '{"ok":1}' },
    ]);
    const c = new RpcClient({
      fetch,
      rotate: () => {
        rotations += 1;
      },
      ...opts,
    });
    expect(await c.rpc("X/Y", {})).toEqual({ ok: 1 });
    expect(rotations).toBe(2);
    expect(c.blocks).toBe(2);

    const c2 = new RpcClient({
      fetch: fakeFetch([
        { status: 200, body: "<html>unusual traffic</html>" },
        { status: 200, body: "<html>unusual traffic</html>" },
        { status: 200, body: "<html>unusual traffic</html>" },
      ]),
      ...opts,
    });
    await expect(c2.rpc("X/Y", {})).rejects.toBeInstanceOf(BlockedError);
  });

  it("retries 5xx and fails fast on 400", async () => {
    const c = new RpcClient({
      fetch: fakeFetch([
        { status: 503, body: "" },
        { status: 200, body: "{}" },
      ]),
      ...opts,
    });
    expect(await c.rpc("X/Y", {})).toEqual({});
    const fetch = fakeFetch([{ status: 400, body: "bad" }]);
    const c2 = new RpcClient({ fetch, ...opts });
    await expect(c2.rpc("X/Y", {})).rejects.toBeInstanceOf(HttpError);
    expect(fetch.calls).toHaveLength(1);
  });
});
