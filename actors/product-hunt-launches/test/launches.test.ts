import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  ApiSource,
  postToLaunch,
  TokenError,
  type RawPost,
} from "../src/api.js";
import {
  decodeEntities,
  entryToLaunch,
  FeedSource,
  parseFeed,
  parseRankBadge,
  parseVotesBadge,
} from "../src/feed.js";
import { HttpClient, HttpError, type FetchLike } from "../src/http.js";
import { InputError, normalizeInput, parseDate } from "../src/input.js";
import {
  parsePostRef,
  parseTopic,
  ptDate,
  ptMidnight,
  weekStart,
  windows,
  type Launch,
} from "../src/launch.js";
import {
  looksLikeMainFeed,
  matchesKeywords,
  ONLY_NEW_SEEN_STREAK,
  runLaunches,
} from "../src/run.js";
import { Seen } from "../src/state.js";
import { cleanWebsite, WebsiteResolver } from "../src/website.js";

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const NOW = new Date("2026-09-29T18:00:00Z");
const noSleep = async () => {};

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
const client = (handler: Handler) => {
  const fetch = fakeFetch(handler);
  return {
    fetch,
    http: new HttpClient({ fetch, sleep: noSleep, baseDelayMs: 1 }),
  };
};

const FEED = fixture("feed.xml");
const FEED_PRODUCTIVITY = fixture("feed-productivity.xml");
const VOTES_SVG = fixture("featured.svg");
const TOP_SVG = fixture("top-daily.svg");

/** Fake Product Hunt: feed, badges (votes = id % 1000, #1 for one post). */
const phHandler =
  (opts: { topRank?: Record<string, number> } = {}): Handler =>
  (url) => {
    if (url.startsWith("https://www.producthunt.com/feed")) {
      return {
        body: url.includes("category=productivity") ? FEED_PRODUCTIVITY : FEED,
      };
    }
    const id = /post_id=(\d+)/.exec(url)?.[1] ?? "0";
    if (url.includes("/featured.svg"))
      return { body: VOTES_SVG.replace(">83<", `>${Number(id) % 1000}<`) };
    if (url.includes("/top-post-badge.svg")) {
      const rank = opts.topRank?.[id];
      if (rank && url.includes("period=daily"))
        return { body: TOP_SVG.replace("#1 ", `#${rank} `) };
      return { status: 404, body: '{"error":"not_found"}' };
    }
    return { status: 403, body: "Just a moment..." };
  };

describe("feed parsing", () => {
  const entries = parseFeed(FEED);

  it("parses every entry", () => {
    expect(entries).toHaveLength(50);
    expect(entries[0]).toEqual({
      id: "1263586",
      name: "Gladys Assistant 5",
      tagline: "Private, self-hosted smart home, no YAML required",
      url: "https://www.producthunt.com/products/gladys-assistant",
      redirectUrl: "https://www.producthunt.com/r/p/1263586",
      createdAt: "2026-09-28T15:17:40.000Z",
      author: "Pierre-Gilles",
    });
    expect(new Set(entries.map((e) => e.id)).size).toBe(50);
    expect(entries.every((e) => e.tagline && e.name)).toBe(true);
  });

  it("decodes entities and trims dangling colons", () => {
    const e = entries.find((x) => x.id === "1263960")!;
    expect(e.name).toBe("ShipHappens");
    expect(e.tagline).toBe("ASO, keywords & screenshots for the app store");
    expect(decodeEntities("a &amp;amp; b &#39;c&#x27; &lt;p&gt;")).toBe(
      "a &amp; b 'c' <p>",
    );
  });

  it("rejects non-feeds (e.g. a Cloudflare page)", () => {
    expect(() => parseFeed("<html><title>Just a moment...</title>")).toThrow(
      /not an Atom feed/,
    );
  });

  it("reads votes and ranks from badges", () => {
    expect(parseVotesBadge(VOTES_SVG)).toBe(83);
    expect(parseRankBadge(TOP_SVG)).toBe(1);
    expect(parseRankBadge("<tspan>#4 Product of the Week</tspan>")).toBe(4);
    expect(parseRankBadge(VOTES_SVG)).toBeNull();
    expect(parseVotesBadge("<svg></svg>")).toBeNull();
  });

  it("maps an entry to a launch", () => {
    const l = entryToLaunch(entries[0]!, ["ai"], NOW.toISOString());
    expect(l).toMatchObject({
      id: "1263586",
      source: "feed",
      topics: ["ai"],
      hunter: { name: "Pierre-Gilles", username: null },
      votesCount: null,
      launchDate: null,
    });
  });
});

describe("FeedSource.enrich", () => {
  it("adds votes, daily rank, and only asks for weekly/monthly when ranked", async () => {
    const { http, fetch } = client(phHandler({ topRank: { "1263543": 2 } }));
    const src = new FeedSource(http);
    const ls = parseFeed(FEED)
      .slice(0, 3)
      .map((e) => entryToLaunch(e, [], ""));
    await src.enrich(ls);
    expect(ls.map((l) => [l.votesCount, l.dailyRank])).toEqual([
      [586, null],
      [543, 2],
      [92, null],
    ]);
    const urls = fetch.mock.calls.map((c) => c[0] as string);
    expect(urls.filter((u) => u.includes("period=weekly"))).toHaveLength(1);
    expect(urls.every((u) => u.includes("&_="))).toBe(true);
  });

  it("keeps going when a badge request fails", async () => {
    const { http } = client((url) =>
      url.includes("1263586") ? { status: 500, body: "err" } : phHandler()(url),
    );
    const logs: string[] = [];
    const src = new FeedSource(http, (m) => logs.push(m));
    const ls = parseFeed(FEED)
      .slice(0, 2)
      .map((e) => entryToLaunch(e, [], ""));
    await src.enrich(ls);
    expect(ls[0]!.votesCount).toBeNull();
    expect(ls[1]!.votesCount).toBe(543);
    expect(logs[0]).toMatch(/1263586/);
  });
});

describe("refs, topics and dates", () => {
  it.each([
    ["https://www.producthunt.com/posts/notion-ai", { slug: "notion-ai" }],
    [
      "https://www.producthunt.com/products/notion/launches/notion-ai?x=1",
      { slug: "notion-ai" },
    ],
    ["producthunt.com/products/Linear", { slug: "linear" }],
    ["1263586", { id: "1263586" }],
    ["https://www.producthunt.com/r/p/1263586?app_id=339", { id: "1263586" }],
    ["chatgpt", { slug: "chatgpt" }],
  ])("parsePostRef(%s)", (s, want) => {
    expect(parsePostRef(s)).toEqual(want);
  });

  it("rejects other URLs", () => {
    expect(() => parsePostRef("https://example.com/posts/x")).toThrow();
    expect(() =>
      parsePostRef("https://www.producthunt.com/leaderboard"),
    ).toThrow();
  });

  it("parses topics", () => {
    expect(
      parseTopic("https://www.producthunt.com/topics/developer-tools"),
    ).toBe("developer-tools");
    expect(parseTopic("Artificial Intelligence")).toBe(
      "artificial-intelligence",
    );
    expect(parseTopic("Design & Tools")).toBe("design-tools");
  });

  it("uses Pacific Time with DST", () => {
    expect(ptMidnight("2026-07-01").toISOString()).toBe(
      "2026-07-01T07:00:00.000Z",
    );
    expect(ptMidnight("2026-12-01").toISOString()).toBe(
      "2026-12-01T08:00:00.000Z",
    );
    expect(ptMidnight("2026-03-08").toISOString()).toBe(
      "2026-03-08T08:00:00.000Z",
    );
    expect(ptMidnight("2026-03-09").toISOString()).toBe(
      "2026-03-09T07:00:00.000Z",
    );
    expect(ptMidnight("2026-11-01").toISOString()).toBe(
      "2026-11-01T07:00:00.000Z",
    );
    expect(ptMidnight("2026-11-02").toISOString()).toBe(
      "2026-11-02T08:00:00.000Z",
    );
    expect(ptDate("2026-09-29T06:59:00Z")).toBe("2026-09-28");
    expect(ptDate("2026-09-29T07:01:00Z")).toBe("2026-09-29");
  });

  it("builds leaderboard windows", () => {
    expect(weekStart("2026-09-27")).toBe("2026-09-21"); // Sunday -> Monday
    expect(
      windows("daily", "2026-09-27", "2026-09-28").map((w) => w.start),
    ).toEqual(["2026-09-27", "2026-09-28"]);
    expect(windows("weekly", "2026-09-27", "2026-09-29")).toEqual([
      {
        period: "weekly",
        start: "2026-09-21",
        end: "2026-09-28",
        label: "week of 2026-09-21",
      },
      {
        period: "weekly",
        start: "2026-09-28",
        end: "2026-10-05",
        label: "week of 2026-09-28",
      },
    ]);
    expect(
      windows("monthly", "2026-01-31", "2026-02-01").map((w) => [
        w.start,
        w.end,
      ]),
    ).toEqual([
      ["2026-01-01", "2026-02-01"],
      ["2026-02-01", "2026-03-01"],
    ]);
  });

  it("parses dates", () => {
    expect(parseDate("today", "d", NOW)).toBe("2026-09-29");
    expect(parseDate("yesterday", "d", NOW)).toBe("2026-09-28");
    expect(parseDate("7 days", "d", NOW)).toBe("2026-09-22");
    expect(parseDate("2026-9-1", "d", NOW)).toBe("2026-09-01");
    expect(() => parseDate("last tuesday", "d", NOW)).toThrow(InputError);
  });
});

describe("normalizeInput", () => {
  it("has token-free defaults", () => {
    expect(normalizeInput({}, NOW)).toMatchObject({
      mode: "latest",
      period: "daily",
      startDate: "2026-09-28",
      endDate: "2026-09-28",
      dateFilter: false,
      maxItems: 20,
      includeComments: false,
      apiToken: undefined,
    });
  });

  it("validates", () => {
    expect(() => normalizeInput({ mode: "x" }, NOW)).toThrow(InputError);
    expect(() => normalizeInput({ mode: "topics" }, NOW)).toThrow(/topic/);
    expect(() =>
      normalizeInput({ mode: "posts", postUrls: ["chatgpt"] }, NOW),
    ).toThrow(/token/);
    expect(() =>
      normalizeInput({ mode: "leaderboard", startDate: "2026-01-01" }, NOW),
    ).toThrow(/token/);
    expect(() =>
      normalizeInput({ startDate: "2026-09-10", endDate: "2026-09-01" }, NOW),
    ).toThrow(/endDate/);
    expect(() =>
      normalizeInput(
        { startDate: "2020-01-01", endDate: "2026-01-01", apiToken: "t" },
        NOW,
      ),
    ).toThrow(/366/);
  });

  it("normalizes lists, keywords and token", () => {
    const n = normalizeInput(
      {
        mode: "posts",
        postUrls: [
          "chatgpt",
          { url: "https://www.producthunt.com/posts/chatgpt" },
        ],
        topics: ["AI", "ai"],
        searchKeywords: " CRM, sales ,",
        apiToken: " Bearer abc ",
        startDate: "2026-09-01",
      },
      NOW,
    );
    expect(n.posts).toEqual([{ slug: "chatgpt" }]);
    expect(n.topics).toEqual(["ai"]);
    expect(n.keywords).toEqual(["crm", "sales"]);
    expect(n.apiToken).toBe("abc");
    expect(n.endDate).toBe("2026-09-01");
    expect(n.dateFilter).toBe(true);
  });
});

const collect = () => {
  const out: Launch[] = [];
  return { out, emit: async (l: Launch) => (out.push(l), true) };
};

describe("runLaunches (feed)", () => {
  it("emits the default number of launches with votes", async () => {
    const { http, fetch } = client(phHandler());
    const { out, emit } = collect();
    const stats = await runLaunches(normalizeInput({}, NOW), {
      feed: new FeedSource(http),
      emit,
      now: () => NOW,
    });
    expect(out).toHaveLength(20);
    expect(stats).toMatchObject({ source: "feed", stopReason: "maxItems" });
    expect(out.every((l) => l.votesCount !== null)).toBe(true);
    // Only the first two batches of 12 were enriched.
    const featured = fetch.mock.calls.filter((c) =>
      (c[0] as string).includes("featured.svg"),
    );
    expect(featured).toHaveLength(24);
    expect(Object.keys(out[0]!)[0]).toBe("id");
  });

  it("filters by keywords and stops on budget", async () => {
    const { http } = client(phHandler());
    const { out } = collect();
    let n = 0;
    const stats = await runLaunches(
      normalizeInput(
        { searchKeywords: "music, smart home", maxItems: 50 },
        NOW,
      ),
      {
        feed: new FeedSource(http),
        emit: async (l) => (out.push(l), ++n < 2),
      },
    );
    expect(out.map((l) => l.name)).toEqual(["Gladys Assistant 5", "GhostDeck"]);
    expect(stats.stopReason).toBe("budget");
  });

  it("detects unknown topics and dedupes across topics", async () => {
    const { http } = client(phHandler());
    const { out, emit } = collect();
    const logs: string[] = [];
    const stats = await runLaunches(
      normalizeInput(
        {
          mode: "topics",
          topics: ["productivity", "not-a-topic"],
          maxItems: 100,
        },
        NOW,
      ),
      { feed: new FeedSource(http), emit, log: (m) => logs.push(m) },
    );
    expect(stats.groups["topic:not-a-topic"]!.status).toBe("notFound");
    expect(stats.groups["topic:productivity"]!.emitted).toBe(50);
    expect(out.every((l) => l.topics[0] === "productivity")).toBe(true);
    expect(logs.some((m) => /not-a-topic/.test(m))).toBe(true);
  });

  it("sorts the token-free leaderboard by votes", async () => {
    const { http } = client(phHandler());
    const { out, emit } = collect();
    await runLaunches(
      normalizeInput({ mode: "leaderboard", maxItems: 5 }, NOW),
      {
        feed: new FeedSource(http),
        emit,
        now: () => NOW,
      },
    );
    const v = out.map((l) => l.votesCount!);
    expect(v).toEqual([...v].sort((a, b) => b - a));
  });

  it("onlyNew: skips (and doesn't charge) launches returned before", async () => {
    const go = async (state: unknown) => {
      const { http } = client(phHandler());
      const seen = new Seen(state);
      const { out, emit } = collect();
      const stats = await runLaunches(normalizeInput({ onlyNew: true }, NOW), {
        feed: new FeedSource(http),
        seen,
        emit,
        now: () => NOW,
      });
      return { out, stats, state: seen.toJSON() };
    };
    const r1 = await go(undefined);
    expect(r1.out).toHaveLength(20);
    // Known launches don't count toward maxItems: the next 20 come next.
    const r2 = await go(r1.state);
    expect(r2.out).toHaveLength(20);
    expect(r2.out.some((l) => r1.out.some((o) => o.id === l.id))).toBe(false);
    expect(r2.stats.skippedSeen).toBe(20);
  });

  it("fails when the feed is blocked", async () => {
    const { http } = client(() => ({ status: 403, body: "Just a moment..." }));
    await expect(
      runLaunches(normalizeInput({}, NOW), {
        feed: new FeedSource(http),
        emit: collect().emit,
      }),
    ).rejects.toThrow(/Nothing could be scraped/);
  });

  it("detects main-feed look-alikes", () => {
    const e = parseFeed(FEED);
    const main = new Set(e.map((x) => x.id));
    expect(looksLikeMainFeed(e.slice(5), main)).toBe(true);
    expect(looksLikeMainFeed(parseFeed(FEED_PRODUCTIVITY), main)).toBe(false);
  });
});

const rawPost = (i: number, extra: Partial<RawPost> = {}): RawPost => ({
  id: String(1000 + i),
  name: `Post ${i}`,
  tagline: "Does things",
  description: "Longer text",
  slug: `post-${i}`,
  url: `https://www.producthunt.com/posts/post-${i}?utm_campaign=producthunt-api&utm_medium=api-v2`,
  website: `https://www.producthunt.com/r/ABC${i}?utm_campaign=producthunt-api`,
  votesCount: 500 - i,
  commentsCount: 10,
  createdAt: "2026-09-01T07:01:00Z",
  featuredAt: "2026-09-01T07:01:00Z",
  thumbnail: { type: "image", url: "https://ph-files.imgix.net/t.png" },
  media: [
    { type: "image", url: "https://ph-files.imgix.net/m.png", videoUrl: null },
  ],
  topics: {
    edges: [
      {
        node: {
          name: "Artificial Intelligence",
          slug: "artificial-intelligence",
        },
      },
    ],
  },
  user: { id: "0", name: "[REDACTED]", username: "[REDACTED]" },
  makers: [
    {
      id: "42",
      name: "Ada",
      username: "ada",
      headline: "Maker",
      url: "https://www.producthunt.com/@ada",
    },
    { id: "0", name: "[REDACTED]", username: "[REDACTED]" },
  ],
  ...extra,
});

type Gql = { query: string; variables: Record<string, unknown> };
const apiClient = (answer: (q: Gql, n: number) => Reply) => {
  let n = 0;
  const bodies: Gql[] = [];
  const { http, fetch } = client((url, init) => {
    if (!url.startsWith("https://api.producthunt.com/v2"))
      return phHandler()(url, init);
    const q = JSON.parse(init!.body!) as Gql;
    bodies.push(q);
    return answer(q, n++);
  });
  return { http, fetch, bodies };
};
const ok = (data: unknown, headers?: Record<string, string>): Reply => ({
  body: JSON.stringify({ data }),
  headers,
});
const page = (posts: RawPost[], next: string | null) =>
  ok({
    posts: {
      pageInfo: { hasNextPage: next !== null, endCursor: next },
      edges: posts.map((node) => ({ node })),
    },
  });

describe("API source", () => {
  it("maps posts and hides redacted users", () => {
    const l = postToLaunch(rawPost(1), "now", true);
    expect(l).toMatchObject({
      id: "1001",
      url: "https://www.producthunt.com/posts/post-1",
      websiteRedirectUrl: "https://www.producthunt.com/r/ABC1",
      topics: ["Artificial Intelligence"],
      launchDate: "2026-09-01",
      featured: true,
      thumbnail: "https://ph-files.imgix.net/t.png",
      hunter: null,
      source: "api",
    });
    expect(l.makers).toHaveLength(1);
    expect(l.makers![0]).toMatchObject({ name: "Ada", username: "ada" });
    expect(postToLaunch(rawPost(1), "now", false).makers).toBeNull();
  });

  it("ranks a daily leaderboard across pages, newest day first", async () => {
    const { http, bodies } = apiClient((q) => {
      const day = String(q.variables.postedAfter).slice(0, 10);
      const base = day === "2026-09-01" ? 0 : 100;
      if (!q.variables.after)
        return page([rawPost(base + 1), rawPost(base + 2)], "c1");
      return page([rawPost(base + 3)], null);
    });
    const { out, emit } = collect();
    const input = normalizeInput(
      {
        mode: "leaderboard",
        startDate: "2026-09-01",
        endDate: "2026-09-02",
        apiToken: "tok",
        maxPerGroup: 3,
        resolveWebsites: false,
      },
      NOW,
    );
    const stats = await runLaunches(input, {
      feed: new FeedSource(http),
      api: new ApiSource(http, {
        token: "tok",
        includeMakers: true,
        sleep: noSleep,
      }),
      emit,
      now: () => NOW,
    });
    expect(stats.source).toBe("api");
    expect(out.map((l) => [l.id, l.dailyRank])).toEqual([
      ["1101", 1],
      ["1102", 2],
      ["1103", 3],
      ["1001", 1],
      ["1002", 2],
      ["1003", 3],
    ]);
    expect(bodies[0]!.variables).toMatchObject({
      order: "RANKING",
      featured: true,
      postedAfter: "2026-09-02T07:00:00.000Z",
      postedBefore: "2026-09-03T07:00:00.000Z",
      first: 20,
    });
    expect(bodies[0]!.query).toContain("makers { ...U }");
  });

  it("onlyNew: stops a newest-first API stream after a streak of known launches", async () => {
    const go = async (ids: number[], state: unknown) => {
      const { http } = apiClient(() =>
        page(
          ids.map((i) => rawPost(i)),
          null,
        ),
      );
      const seen = new Seen(state);
      const { out, emit } = collect();
      const stats = await runLaunches(
        normalizeInput(
          {
            mode: "latest",
            apiToken: "tok",
            maxItems: 1000,
            maxPerGroup: 1000,
            resolveWebsites: false,
            onlyNew: true,
          },
          NOW,
        ),
        {
          feed: new FeedSource(http),
          api: new ApiSource(http, {
            token: "tok",
            includeMakers: false,
            sleep: noSleep,
          }),
          seen,
          emit,
          now: () => NOW,
        },
      );
      return { out, stats, state: seen.toJSON() };
    };
    const old = Array.from(
      { length: ONLY_NEW_SEEN_STREAK + 10 },
      (_, i) => i + 10,
    );
    const r1 = await go(old, undefined);
    expect(r1.out).toHaveLength(old.length);
    const r2 = await go([1, ...old], r1.state);
    expect(r2.out.map((l) => l.id)).toEqual([rawPost(1).id]);
    expect(r2.stats.skippedSeen).toBe(ONLY_NEW_SEEN_STREAK);
    expect(r2.stats.groups.latest!.scanned).toBe(1 + ONLY_NEW_SEEN_STREAK);
  });

  it("drops fields the schema rejects and retries", async () => {
    const logs: string[] = [];
    const { http, bodies } = apiClient((q, n) => {
      if (n === 0)
        return {
          body: JSON.stringify({
            errors: [
              { message: "Field 'reviewsRating' doesn't exist on type 'Post'" },
              { message: "Field 'videoUrl' doesn't exist on type 'Media'" },
            ],
          }),
        };
      return ok({ post: rawPost(1) });
    });
    const api = new ApiSource(http, {
      token: "t",
      includeMakers: false,
      log: (m) => logs.push(m),
    });
    const p = await api.post({ slug: "post-1" });
    expect(p?.id).toBe("1001");
    expect(bodies[1]!.query).not.toContain("reviewsRating");
    expect(bodies[1]!.query).toContain("thumbnail { type url }");
    expect(bodies[1]!.query).not.toContain("makers");
    expect(bodies[1]!.query).toContain("post(slug: $key)");
    expect(logs).toHaveLength(2);
  });

  it("waits for the rate limit to reset", async () => {
    const sleeps: number[] = [];
    const { http } = apiClient((_q, n) =>
      n === 0
        ? { status: 429, body: "{}", headers: { "x-rate-limit-reset": "30" } }
        : ok({ post: null }),
    );
    const api = new ApiSource(http, {
      token: "t",
      includeMakers: true,
      sleep: async (ms) => void sleeps.push(ms),
    });
    expect(await api.post({ id: "1" })).toBeNull();
    expect(sleeps).toEqual([32_000]);
  });

  it("fails the run on a bad token", async () => {
    const { http } = apiClient(() => ({ status: 401, body: '{"errors":[]}' }));
    const input = normalizeInput(
      { mode: "posts", postUrls: ["a", "b"], apiToken: "bad" },
      NOW,
    );
    await expect(
      runLaunches(input, {
        feed: new FeedSource(http),
        api: new ApiSource(http, { token: "bad", includeMakers: true }),
        emit: collect().emit,
      }),
    ).rejects.toThrow(TokenError);
  });

  it("fetches posts by URL with comments; reports not found", async () => {
    const { http, bodies } = apiClient((q) => {
      if (q.query.includes("Comments"))
        return ok({
          post: {
            comments: {
              pageInfo: { hasNextPage: true, endCursor: "x" },
              edges: [
                {
                  node: {
                    id: "c1",
                    body: " Congrats! ",
                    createdAt: "2026-09-01T08:00:00Z",
                    votesCount: 3,
                    parentId: null,
                    url: "https://www.producthunt.com/posts/p#comment-c1",
                    user: { id: "7", name: "Bob", username: "bob" },
                  },
                },
                { node: { id: "c2", body: "Nice", user: null } },
              ],
            },
          },
        });
      return ok({ post: q.variables.key === "missing" ? null : rawPost(1) });
    });
    const { out, emit } = collect();
    const input = normalizeInput(
      {
        mode: "posts",
        postUrls: ["https://www.producthunt.com/posts/post-1", "missing"],
        apiToken: "t",
        includeComments: true,
        maxCommentsPerLaunch: 2,
        resolveWebsites: false,
      },
      NOW,
    );
    const stats = await runLaunches(input, {
      feed: new FeedSource(http),
      api: new ApiSource(http, { token: "t", includeMakers: true }),
      emit,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.comments).toEqual([
      {
        id: "c1",
        body: "Congrats!",
        createdAt: "2026-09-01T08:00:00Z",
        votesCount: 3,
        parentId: null,
        url: "https://www.producthunt.com/posts/p#comment-c1",
        author: expect.objectContaining({ name: "Bob", username: "bob" }),
      },
      expect.objectContaining({ id: "c2", body: "Nice", author: null }),
    ]);
    expect(stats.groups["slug:missing"]!.status).toBe("notFound");
    const c = bodies.find((b) => b.query.includes("Comments"))!;
    expect(c.query).toContain("order: VOTES_COUNT");
    expect(c.variables).toMatchObject({ id: "1001", first: 2 });
  });
});

describe("websites and http", () => {
  it("follows Product Hunt redirects to the real site", async () => {
    const { http } = client((url) =>
      url.includes("/r/ABC")
        ? {
            status: 302,
            body: "",
            headers: {
              location:
                "https://acme.io/?ref=producthunt&utm_source=x&plan=pro",
            },
          }
        : { status: 404, body: "" },
    );
    const r = new WebsiteResolver(http);
    expect(await r.resolve("https://www.producthunt.com/r/ABC")).toBe(
      "https://acme.io/?plan=pro",
    );
    expect(await r.resolve(null)).toBeNull();
    expect(cleanWebsite("https://x.com/?ref=producthunt")).toBe(
      "https://x.com/",
    );
  });

  it("stops trying after a Cloudflare block", async () => {
    const { http, fetch } = client(() => ({
      status: 403,
      body: "Just a moment...",
    }));
    const r = new WebsiteResolver(http);
    expect(await r.resolve("https://www.producthunt.com/r/p/1")).toBeNull();
    expect(await r.resolve("https://www.producthunt.com/r/p/2")).toBeNull();
    expect(r.blocked).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retries 5xx and honours Retry-After", async () => {
    const sleeps: number[] = [];
    let n = 0;
    const fetch = fakeFetch(() =>
      ++n < 3
        ? { status: 503, body: "", headers: { "retry-after": "2" } }
        : { body: "ok" },
    );
    const http = new HttpClient({
      fetch,
      sleep: async (ms) => void sleeps.push(ms),
    });
    expect((await http.request({ url: "https://x" })).text).toBe("ok");
    expect(sleeps).toEqual([2000, 2000]);
    const blocked = new HttpClient({
      fetch: fakeFetch(() => ({ status: 403, body: "no" })),
      sleep: noSleep,
    });
    await expect(blocked.request({ url: "https://x" })).rejects.toBeInstanceOf(
      HttpError,
    );
  });

  it("matches keywords on name, tagline, description and topics", () => {
    const l = postToLaunch(rawPost(1), "", false);
    expect(matchesKeywords(l, [])).toBe(true);
    expect(matchesKeywords(l, ["intelligence"])).toBe(true);
    expect(matchesKeywords(l, ["longer"])).toBe(true);
    expect(matchesKeywords(l, ["crm"])).toBe(false);
  });
});
