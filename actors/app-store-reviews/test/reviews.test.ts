import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  APPLE_PAGE_SIZE,
  AppleSource,
  ITUNES_UA,
  lookupUrl,
  parseLookup,
  parseRssVersions,
  parseUserReviews,
  reviewsUrl,
} from "../src/apple.js";
import {
  batchBody,
  GoogleSource,
  parseBatchResponse,
  parseDetailsName,
} from "../src/google.js";
import { HttpClient, HttpError, type FetchLike } from "../src/http.js";
import { InputError, normalizeInput, parseSince } from "../src/input.js";
import { AppRefError, parseAppRef, type RawReview } from "../src/review.js";
import { OLD_STREAK_STOP, runReviews } from "../src/run.js";
import { Monitor } from "../src/state.js";
import type { AppInfo, ReviewSource } from "../src/source.js";

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const NOW = new Date("2026-09-29T15:00:00Z");
const noSleep = async () => {};

type Handler = (
  url: string,
  init?: Parameters<FetchLike>[1],
) => { status?: number; body: string; headers?: Record<string, string> };
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
const client = (handler: Handler) => {
  const fetch = fakeFetch(handler);
  return {
    fetch,
    http: new HttpClient({ fetch, sleep: noSleep, baseDelayMs: 1 }),
  };
};

describe("parseAppRef", () => {
  it.each([
    [
      "https://apps.apple.com/us/app/spotify-music-and-podcasts/id324684580",
      "apple",
      "324684580",
    ],
    [
      "https://apps.apple.com/gb/app/id324684580?platform=iphone",
      "apple",
      "324684580",
    ],
    ["https://itunes.apple.com/app/id324684580", "apple", "324684580"],
    ["id324684580", "apple", "324684580"],
    ["324684580", "apple", "324684580"],
    [
      "https://play.google.com/store/apps/details?id=com.spotify.music&hl=en",
      "google",
      "com.spotify.music",
    ],
    ["com.spotify.music", "google", "com.spotify.music"],
    ["  android:com.whatsapp ", "google", "com.whatsapp"],
    ["ios:324684580", "apple", "324684580"],
    ["apple:com.spotify.client", "apple", "bundle:com.spotify.client"],
  ])("%s", (input, store, id) => {
    expect(parseAppRef(input)).toEqual({ store, id });
  });

  it.each([
    "",
    "spotify",
    "https://example.com/app/id1",
    "https://play.google.com/store/apps/details",
    "google:12345",
  ])("rejects %j", (input) => {
    expect(() => parseAppRef(input)).toThrow(AppRefError);
  });
});

describe("input", () => {
  it("applies defaults and dedupes apps", () => {
    const i = normalizeInput(
      {
        apps: [
          "com.spotify.music",
          "https://play.google.com/store/apps/details?id=com.spotify.music",
          { url: "id324684580" },
        ],
      },
      NOW,
    );
    expect(i.apps).toEqual([
      { store: "google", id: "com.spotify.music" },
      { store: "apple", id: "324684580" },
    ]);
    expect(i).toMatchObject({
      country: "us",
      language: "en",
      sort: "newest",
      maxReviewsPerApp: 100,
      minRating: 1,
      maxRating: 5,
    });
    expect(i.since).toBeUndefined();
  });

  it("normalizes country, language and ratings", () => {
    const i = normalizeInput(
      {
        apps: ["com.a.b"],
        country: "UK",
        language: "PT-BR",
        minRating: "1",
        maxRating: 2,
        sort: "mostRelevant",
        sinceDate: "2026-09-01",
      },
      NOW,
    );
    expect(i).toMatchObject({
      country: "gb",
      language: "pt-br",
      minRating: 1,
      maxRating: 2,
      sort: "mostRelevant",
      since: "2026-09-01T00:00:00.000Z",
    });
  });

  it.each([
    [{}],
    [{ apps: [] }],
    [{ apps: ["nope"] }],
    [{ apps: ["com.a.b"], country: "usa" }],
    [{ apps: ["com.a.b"], sort: "oldest" }],
    [{ apps: ["com.a.b"], maxReviewsPerApp: 0 }],
    [{ apps: ["com.a.b"], minRating: 4, maxRating: 2 }],
    [{ apps: ["com.a.b"], minRating: 6 }],
    [{ apps: ["com.a.b"], sinceDate: "last tuesday" }],
  ])("rejects %j", (raw) => {
    expect(() => normalizeInput(raw, NOW)).toThrow(InputError);
  });

  it("parses relative and absolute since dates", () => {
    expect(parseSince("7 days", NOW)).toBe("2026-09-22T15:00:00.000Z");
    expect(parseSince("2 weeks ago", NOW)).toBe("2026-09-15T15:00:00.000Z");
    expect(parseSince("1 month", NOW)).toBe("2026-08-29T15:00:00.000Z");
    expect(parseSince("2026-09-01T12:00:00Z", NOW)).toBe(
      "2026-09-01T12:00:00.000Z",
    );
    expect(parseSince("", NOW)).toBeUndefined();
  });
});

describe("apple parsing", () => {
  it("parses userReviewsRow", () => {
    const { reviews, rawCount } = parseUserReviews(
      fixture("apple-reviews.json"),
      "1459969523",
      "us",
    );
    expect(rawCount).toBe(4);
    expect(reviews).toHaveLength(4);
    expect(reviews[0]).toEqual({
      reviewId: "14603032413",
      rating: 5,
      title: "Accurate, detailed & interesting",
      text: "❤️‍🔥",
      author: "Dna2some",
      date: "2026-09-28T11:36:54.000Z",
      appVersion: null,
      developerReply: null,
      developerReplyDate: null,
      helpfulCount: 0,
      url: "https://apps.apple.com/us/app/id1459969523?see-all=reviews",
    });
    expect(reviews[2]).toMatchObject({
      rating: 1,
      title: "Paywall",
      developerReplyDate: "2026-09-28T18:37:26.000Z",
    });
    expect(reviews[2]!.developerReply).toMatch(/^Hi,/);
  });

  it("rejects the HTML page served to non-iTunes clients", () => {
    expect(() => parseUserReviews("<!DOCTYPE HTML>", "1", "us")).toThrow(
      /non-JSON/,
    );
  });

  it("parses RSS versions", () => {
    const { versions, oldest, count } = parseRssVersions(
      fixture("apple-rss.json"),
    );
    expect(count).toBe(5);
    expect(versions.get("14603032413")).toBe("6.59.0");
    expect(oldest).toBe("2026-09-27T05:40:50.000Z");
    expect(parseRssVersions('{"feed":{}}').count).toBe(0);
  });

  it("parses lookup", () => {
    expect(parseLookup(fixture("apple-lookup.json"))).toEqual({
      id: "1459969523",
      name: "Nebula: Spiritual Guidance",
    });
    expect(parseLookup('{"resultCount":0,"results":[]}')).toBeNull();
    expect(lookupUrl("bundle:com.x.y", "us", "en")).toContain(
      "bundleId=com.x.y",
    );
  });

  it("builds review URLs", () => {
    expect(reviewsUrl("1", "de", "newest", 0, 200)).toBe(
      "https://itunes.apple.com/WebObjects/MZStore.woa/wa/userReviewsRow?id=1&displayable-kind=11&startIndex=0&endIndex=200&sort=0&cc=de",
    );
    expect(reviewsUrl("1", "de", "mostRelevant", 200, 400)).toContain("sort=1");
  });
});

describe("AppleSource", () => {
  const app: AppInfo = { id: "1459969523", name: "Nebula" };
  const q = { country: "us", language: "en", sort: "newest" as const };

  it("paginates, sends the iTunes UA, and enriches versions from RSS", async () => {
    const full = JSON.parse(fixture("apple-reviews.json")) as {
      userReviewList: { userReviewId: string }[];
    };
    const page = (start: number, n: number) =>
      JSON.stringify({
        userReviewList: Array.from({ length: n }, (_, i) => ({
          ...full.userReviewList[(start + i) % 4],
          userReviewId:
            start + i < 4
              ? full.userReviewList[start + i]!.userReviewId
              : `x${start + i}`,
          date: "2026-09-27T12:00:00Z",
        })),
      });
    const { fetch, http } = client((url) => {
      if (url.includes("/rss/")) {
        return url.includes("page=1/")
          ? { body: fixture("apple-rss.json") }
          : { body: '{"feed":{}}' };
      }
      const start = Number(/startIndex=(\d+)/.exec(url)![1]);
      return { body: page(start, start === 0 ? APPLE_PAGE_SIZE : 3) };
    });
    const out: RawReview[] = [];
    for await (const r of new AppleSource(http).reviews(app, q)) out.push(r);
    expect(out).toHaveLength(APPLE_PAGE_SIZE + 3);
    expect(out[0]!.appVersion).toBe("6.59.0");
    expect(out[10]!.appVersion).toBeNull();
    const reviewCalls = fetch.mock.calls.filter(([u]) =>
      u.includes("userReviewsRow"),
    );
    expect(reviewCalls).toHaveLength(2);
    expect(reviewCalls[0]![1]!.headers!["user-agent"]).toBe(ITUNES_UA);
    // RSS page 1 covers the fixture reviews; page 2 is fetched once, empty.
    expect(fetch.mock.calls.filter(([u]) => u.includes("/rss/"))).toHaveLength(
      2,
    );
  });

  it("fetches RSS lazily, only for consumed reviews", async () => {
    const { fetch, http } = client((url) =>
      url.includes("/rss/")
        ? { body: fixture("apple-rss.json") }
        : { body: fixture("apple-reviews.json") },
    );
    const it = new AppleSource(http).reviews(app, q);
    await it.next();
    await it.return(undefined);
    expect(fetch.mock.calls.filter(([u]) => u.includes("/rss/"))).toHaveLength(
      1,
    );
  });

  it("treats 404 as no reviews and resolves missing apps to null", async () => {
    const { http } = client((url) =>
      url.includes("lookup")
        ? { body: '{"resultCount":0,"results":[]}' }
        : { status: 404, body: "" },
    );
    const src = new AppleSource(http);
    expect(await src.resolve("1", q)).toBeNull();
    const out: RawReview[] = [];
    for await (const r of src.reviews(app, q)) out.push(r);
    expect(out).toEqual([]);
  });
});

describe("google parsing", () => {
  it("parses a batchexecute page", () => {
    const { reviews, nextToken } = parseBatchResponse(
      fixture("google-page1.txt"),
      "com.robinhood.android",
      "en",
      "us",
    );
    expect(nextToken).toMatch(/^Ct/);
    expect(reviews).toHaveLength(3);
    expect(reviews[0]).toMatchObject({
      reviewId: "2f636dde-f240-4a34-8380-b1908d2f1cd5",
      rating: 5,
      title: null,
      author: "william warnick",
      date: new Date(1790613893 * 1000).toISOString(),
      appVersion: "2026.38.6",
      helpfulCount: 0,
      url: "https://play.google.com/store/apps/details?id=com.robinhood.android&hl=en&gl=us&reviewId=2f636dde-f240-4a34-8380-b1908d2f1cd5",
    });
    expect(reviews[0]!.developerReply).toMatch(/^We're so happy/);
    expect(reviews[0]!.developerReplyDate).toMatch(/^2026-09-2/);
    expect(reviews[2]).toMatchObject({
      developerReply: null,
      developerReplyDate: null,
    });
  });

  it("handles an empty payload (unknown app)", () => {
    const text = `)]}'\n\n[["wrb.fr","UsvDTd","[]",null,null,null,"generic"],["di",54]]`;
    expect(parseBatchResponse(text, "x.y", "en", "us")).toEqual({
      reviews: [],
      nextToken: null,
    });
  });

  it("throws on a missing payload", () => {
    const text = `)]}'\n\n[["wrb.fr","UsvDTd",null,null,null,[3],"generic"]]`;
    expect(() => parseBatchResponse(text, "x.y", "en", "us")).toThrow(
      /no review payload/,
    );
  });

  it("builds the request body", () => {
    const body = batchBody("com.a.b", "newest", 150, "TOKEN");
    const req = JSON.parse(decodeURIComponent(body.slice("f.req=".length)));
    expect(JSON.parse(req[0][0][1])).toEqual([
      null,
      null,
      [2, 2, [150, null, "TOKEN"], null, []],
      ["com.a.b", 7],
    ]);
    const rel = JSON.parse(
      JSON.parse(
        decodeURIComponent(
          batchBody("com.a.b", "mostRelevant", 10, null).slice(6),
        ),
      )[0][0][1],
    );
    expect(rel[2]).toEqual([2, 1, [10, null, null], null, []]);
  });

  it("parses the app name", () => {
    expect(parseDetailsName(fixture("google-details.html"))).toBe(
      "Robinhood: Trading & Investing",
    );
    expect(
      parseDetailsName(
        '<meta property="og:title" content="WhatsApp Messenger – Apps bei Google Play">',
      ),
    ).toBe("WhatsApp Messenger");
  });
});

describe("GoogleSource", () => {
  const q = { country: "us", language: "en", sort: "newest" as const };

  it("follows pagination tokens until none is left", async () => {
    const page1 = fixture("google-page1.txt");
    const last = page1.replace(/\\"Ct[\w-]+\\"/, "null");
    const { fetch, http } = client((_url, init) =>
      init?.body?.includes("Ct") ? { body: last } : { body: page1 },
    );
    const out: RawReview[] = [];
    for await (const r of new GoogleSource(http).reviews(
      { id: "com.robinhood.android", name: null },
      q,
    ))
      out.push(r);
    expect(out).toHaveLength(6);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]![1]!.method).toBe("POST");
  });

  it("resolves 404 details to null", async () => {
    const { http } = client(() => ({ status: 404, body: "" }));
    expect(await new GoogleSource(http).resolve("x.y", q)).toBeNull();
    const ok = client(() => ({ body: fixture("google-details.html") }));
    expect(await new GoogleSource(ok.http).resolve("x.y", q)).toEqual({
      id: "x.y",
      name: "Robinhood: Trading & Investing",
    });
  });
});

describe("HttpClient", () => {
  it("retries 429 and 5xx, honoring Retry-After", async () => {
    let n = 0;
    const sleep = vi.fn(async () => {});
    const fetch = fakeFetch(() =>
      ++n === 1
        ? { status: 429, body: "slow down", headers: { "retry-after": "2" } }
        : n === 2
          ? { status: 503, body: "" }
          : { body: "ok" },
    );
    const http = new HttpClient({ fetch, sleep, baseDelayMs: 1 });
    expect(await http.request({ url: "https://x" })).toEqual({
      status: 200,
      text: "ok",
    });
    expect(sleep).toHaveBeenNthCalledWith(1, 2000);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("does not retry 400, returns accepted statuses", async () => {
    const fetch = fakeFetch(() => ({ status: 400, body: "bad" }));
    const http = new HttpClient({ fetch, sleep: noSleep });
    await expect(http.request({ url: "https://x" })).rejects.toBeInstanceOf(
      HttpError,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await http.request({ url: "https://x" }, [400])).status).toBe(400);
  });

  it("gives up after maxRetries", async () => {
    const fetch = fakeFetch(() => ({ status: 500, body: "" }));
    const http = new HttpClient({ fetch, sleep: noSleep, maxRetries: 2 });
    await expect(http.request({ url: "https://x" })).rejects.toThrow(
      /HTTP 500/,
    );
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

describe("runReviews", () => {
  const mk = (id: string, date: string, rating = 5): RawReview => ({
    reviewId: id,
    rating,
    title: null,
    text: `review ${id}`,
    author: "a",
    date,
    appVersion: "1.0",
    developerReply: null,
    developerReplyDate: null,
    helpfulCount: 0,
    url: `https://x/${id}`,
  });
  const fakeSource = (
    reviews: RawReview[] | (() => never),
    name: string | null = "App",
  ): ReviewSource & { consumed: number } => {
    const src = {
      consumed: 0,
      resolve: async (id: string) => (name === null ? null : { id, name }),
      async *reviews() {
        if (typeof reviews === "function") reviews();
        for (const r of reviews as RawReview[]) {
          src.consumed += 1;
          yield r;
        }
      },
    };
    return src;
  };
  const days = (n: number) =>
    new Date(NOW.getTime() - n * 86_400_000).toISOString();

  it("normalizes, filters and dedupes across both stores", async () => {
    const apple = fakeSource([
      mk("1", days(1), 5),
      mk("2", days(1), 1),
      mk("2", days(1), 1),
      mk("3", days(2), 2),
    ]);
    const google = fakeSource([mk("g1", days(1), 1)], "GApp");
    const out: unknown[] = [];
    const input = normalizeInput(
      { apps: ["id12345", "com.a.b"], maxRating: 2, language: "de" },
      NOW,
    );
    const stats = await runReviews(input, {
      sources: { apple, google },
      emit: async (r) => (out.push(r), true),
    });
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({
      store: "apple",
      appId: "12345",
      appName: "App",
      reviewId: "2",
      rating: 1,
      title: null,
      text: "review 2",
      author: "a",
      date: days(1),
      appVersion: "1.0",
      developerReply: null,
      developerReplyDate: null,
      helpfulCount: 0,
      country: "us",
      language: null,
      url: "https://x/2",
    });
    expect(Object.keys(out[0] as object)[0]).toBe("store");
    expect(out[2]).toMatchObject({
      store: "google",
      appName: "GApp",
      language: "de",
    });
    expect(stats.apps["apple:12345"]).toMatchObject({
      emitted: 2,
      skippedFilter: 1,
      skippedDuplicate: 1,
      status: "exhausted",
    });
  });

  it("onlyNew: forces newest, emits only unseen reviews, stops at watermark - grace", async () => {
    const input = normalizeInput(
      { apps: ["id12345"], sort: "mostRelevant", onlyNew: true },
      NOW,
    );
    expect(input.sort).toBe("newest");
    const run = async (reviews: RawReview[], state: unknown) => {
      const apple = fakeSource(reviews);
      const monitor = new Monitor(state);
      const out: string[] = [];
      const afterApp = vi.fn(async () => {});
      const stats = await runReviews(input, {
        sources: { apple, google: fakeSource([]) },
        monitor,
        afterApp,
        emit: async (r) => (out.push(r.reviewId), true),
      });
      expect(afterApp).toHaveBeenCalledTimes(1);
      return { out, stats, state: monitor.toJSON(), consumed: apple.consumed };
    };

    const r1 = await run([mk("b", days(10)), mk("a", days(11))], undefined);
    expect(r1.out).toEqual(["b", "a"]);

    // Watermark = days(10); everything older than days(17) is outside the window.
    const old = Array.from({ length: OLD_STREAK_STOP + 5 }, (_, i) =>
      mk(`old${i}`, days(30 + i)),
    );
    const r2 = await run(
      [mk("c", days(1)), mk("b", days(10)), mk("a", days(11)), ...old],
      r1.state,
    );
    expect(r2.out).toEqual(["c"]);
    expect(r2.stats.apps["apple:12345"]).toMatchObject({
      skippedSeen: 2,
      status: "reachedSinceDate",
    });
    expect(r2.consumed).toBe(3 + OLD_STREAK_STOP);

    const r3 = await run([mk("c", days(1)), mk("b", days(10))], r2.state);
    expect(r3.out).toEqual([]);
  });

  it("stops each app at maxReviewsPerApp", async () => {
    const apple = fakeSource(
      Array.from({ length: 50 }, (_, i) => mk(`${i}`, days(1))),
    );
    const out: unknown[] = [];
    const stats = await runReviews(
      normalizeInput({ apps: ["id12345"], maxReviewsPerApp: 5 }, NOW),
      {
        sources: { apple, google: fakeSource([]) },
        emit: async (r) => (out.push(r), true),
      },
    );
    expect(out).toHaveLength(5);
    expect(apple.consumed).toBe(5);
    expect(stats.apps["apple:12345"]!.status).toBe("maxReviews");
  });

  it("stops at sinceDate when sorted by newest", async () => {
    const reviews = [
      mk("new1", days(1)),
      mk("new2", days(3)),
      ...Array.from({ length: 100 }, (_, i) => mk(`old${i}`, days(30))),
    ];
    const apple = fakeSource(reviews);
    const out: unknown[] = [];
    const stats = await runReviews(
      normalizeInput({ apps: ["id12345"], sinceDate: "7 days" }, NOW),
      {
        sources: { apple, google: fakeSource([]) },
        emit: async (r) => (out.push(r), true),
      },
    );
    expect(out).toHaveLength(2);
    expect(apple.consumed).toBe(2 + OLD_STREAK_STOP);
    expect(stats.apps["apple:12345"]!.status).toBe("reachedSinceDate");
  });

  it("filters (without early stop) by sinceDate when sorted by relevance", async () => {
    const apple = fakeSource([
      ...Array.from({ length: 30 }, (_, i) => mk(`old${i}`, days(30))),
      mk("new", days(1)),
    ]);
    const out: unknown[] = [];
    await runReviews(
      normalizeInput(
        { apps: ["id12345"], sinceDate: "7 days", sort: "mostRelevant" },
        NOW,
      ),
      {
        sources: { apple, google: fakeSource([]) },
        emit: async (r) => (out.push(r), true),
      },
    );
    expect(out).toHaveLength(1);
  });

  it("stops everything when the charge limit is reached", async () => {
    const apple = fakeSource([mk("1", days(1)), mk("2", days(1))]);
    const google = fakeSource([mk("g", days(1))]);
    const out: unknown[] = [];
    const stats = await runReviews(
      normalizeInput({ apps: ["id12345", "com.a.b"] }, NOW),
      {
        sources: { apple, google },
        emit: async (r) => (out.push(r), out.length < 1),
      },
    );
    expect(out).toHaveLength(1);
    expect(stats.stopReason).toBe("budget");
    expect(google.consumed).toBe(0);
  });

  it("skips failed and missing apps; throws only if all fail", async () => {
    const boom = () => {
      throw new Error("blocked");
    };
    const logs: string[] = [];
    const stats = await runReviews(
      normalizeInput({ apps: ["id12345", "com.a.b"] }, NOW),
      {
        sources: { apple: fakeSource(boom), google: fakeSource([], null) },
        emit: async () => true,
        log: (m) => logs.push(m),
      },
    );
    expect(stats.apps["apple:12345"]).toMatchObject({
      status: "failed",
      error: "blocked",
    });
    expect(stats.apps["google:com.a.b"]!.status).toBe("notFound");
    expect(logs).toHaveLength(2);

    await expect(
      runReviews(normalizeInput({ apps: ["id12345"] }, NOW), {
        sources: { apple: fakeSource(boom), google: fakeSource([]) },
        emit: async () => true,
      }),
    ).rejects.toThrow(/All apps failed/);
  });
});
