import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { HttpClient, type FetchLike } from "../src/http.js";
import { InputError, normalizeInput, parseSince } from "../src/input.js";
import { htmlToText, toPost, type RawPost } from "../src/post.js";
import {
  EVENT_POST,
  EVENT_POST_WITH_CONTENT,
  eventFor,
  OLD_STREAK_STOP,
  ONLY_NEW_SEEN_STREAK,
  runScrape,
  type RunDeps,
} from "../src/run.js";
import { Seen } from "../src/state.js";
import {
  archiveUrl,
  NotSubstackError,
  parseArchive,
  postUrl,
  SubstackClient,
} from "../src/substack.js";
import { parseTarget, TargetError } from "../src/target.js";

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const json = <T>(name: string): T => JSON.parse(fixture(name)) as T;

const ARCHIVE = json<RawPost[]>("archive.json");
const FREE = json<RawPost>("post-free.json");
const PAID = json<RawPost>("post-paid.json");
const LENNY = "https://www.lennysnewsletter.com";
const NOW = new Date("2026-09-30T12:00:00Z");

describe("parseTarget", () => {
  it.each([
    ["lenny", "publication", "https://lenny.substack.com", undefined],
    [
      "Lenny.Substack.com",
      "publication",
      "https://lenny.substack.com",
      undefined,
    ],
    [
      "https://lenny.substack.com/archive?sort=new",
      "publication",
      "https://lenny.substack.com",
      undefined,
    ],
    ["www.lennysnewsletter.com", "publication", LENNY, undefined],
    [`${LENNY}/`, "publication", LENNY, undefined],
    [`${LENNY}/p/my-post?utm=x`, "post", LENNY, "my-post"],
    [
      "https://x.substack.com/p/slug/comments",
      "post",
      "https://x.substack.com",
      "slug",
    ],
    [
      "https://open.substack.com/pub/lenny/p/abc",
      "post",
      "https://lenny.substack.com",
      "abc",
    ],
    [
      "https://substack.com/pub/lenny",
      "publication",
      "https://lenny.substack.com",
      undefined,
    ],
  ])("%s", (input, kind, origin, slug) => {
    expect(parseTarget(input)).toEqual(
      slug ? { kind, origin, slug } : { kind, origin },
    );
  });

  it.each([
    "",
    "   ",
    "https://substack.com/@lenny",
    "not a url!",
    "www.substack.com",
  ])("rejects %j", (input) => {
    expect(() => parseTarget(input)).toThrow(TargetError);
  });
});

describe("normalizeInput", () => {
  it("applies defaults and dedupes", () => {
    const n = normalizeInput(
      {
        publications: [
          "lenny",
          "https://lenny.substack.com/",
          { url: "x.substack.com" },
        ],
      },
      NOW,
    );
    expect(n.targets).toEqual([
      { kind: "publication", origin: "https://lenny.substack.com" },
      { kind: "publication", origin: "https://x.substack.com" },
    ]);
    expect(n.maxPostsPerPublication).toBe(50);
    expect(n.includeContent).toBe(false);
    expect(n.since).toBeUndefined();
    expect(n.search).toBeUndefined();
  });

  it("parses options", () => {
    const n = normalizeInput(
      {
        publications: ["lenny"],
        maxPostsPerPublication: "7",
        includeContent: true,
        sinceDate: "7 days",
        search: "  pricing ",
      },
      NOW,
    );
    expect(n).toMatchObject({
      maxPostsPerPublication: 7,
      includeContent: true,
      since: "2026-09-23T12:00:00.000Z",
      search: "pricing",
    });
  });

  it.each([
    [{}],
    [{ publications: [] }],
    [{ publications: [""] }],
    [{ publications: ["https://substack.com/@x"] }],
    [{ publications: ["x"], maxPostsPerPublication: 0 }],
    [{ publications: ["x"], sinceDate: "yesterday-ish" }],
  ])("rejects %j", (raw) => {
    expect(() => normalizeInput(raw, NOW)).toThrow(InputError);
  });

  it("parseSince", () => {
    expect(parseSince("2026-09-01", NOW)).toBe("2026-09-01T00:00:00.000Z");
    expect(parseSince("2 weeks", NOW)).toBe("2026-09-16T12:00:00.000Z");
    expect(parseSince("1 month ago", NOW)).toBe("2026-08-30T12:00:00.000Z");
  });
});

describe("substack urls and parsing", () => {
  it("builds API urls", () => {
    expect(archiveUrl(LENNY, 50)).toBe(
      `${LENNY}/api/v1/archive?sort=new&offset=50&limit=50`,
    );
    expect(archiveUrl(LENNY, 0, "ai agents")).toBe(
      `${LENNY}/api/v1/archive?sort=new&search=ai+agents&offset=0&limit=50`,
    );
    expect(postUrl(LENNY, "a-b")).toBe(`${LENNY}/api/v1/posts/a-b`);
  });

  it("parses the archive fixture", () => {
    const posts = parseArchive(fixture("archive.json"), LENNY);
    expect(posts).toHaveLength(ARCHIVE.length);
    expect(posts[0]!.slug).toBeTruthy();
  });

  it("rejects non-JSON (not a Substack site)", () => {
    expect(() => parseArchive("<html>", LENNY)).toThrow(NotSubstackError);
    expect(() => parseArchive('{"error":"x"}', LENNY)).toThrow(
      NotSubstackError,
    );
  });
});

describe("toPost", () => {
  it("maps archive metadata", () => {
    const p = toPost(ARCHIVE[0]!, LENNY);
    expect(p).toMatchObject({
      publication: "www.lennysnewsletter.com",
      publicationName: "Lenny's Newsletter",
      postId: ARCHIVE[0]!.id,
      slug: ARCHIVE[0]!.slug,
      url: ARCHIVE[0]!.canonical_url,
      type: "newsletter",
      bodyHtml: null,
      bodyText: null,
      truncated: null,
    });
    expect(p.title.length).toBeGreaterThan(0);
    expect(Date.parse(p.postDate!)).not.toBeNaN();
    expect(["free", "paid"]).toContain(p.audience);
    expect(p.likes).toBeTypeOf("number");
    expect(p.commentCount).toBeTypeOf("number");
    expect(p.wordcount).toBeGreaterThan(0);
    expect(p.authors[0]).toMatchObject({
      name: "Lenny Rachitsky",
      handle: "lenny",
    });
    expect(p.coverImage).toMatch(/^https:\/\//);
    expect(Object.keys(p)).toEqual([
      "publication",
      "publicationName",
      "postId",
      "title",
      "subtitle",
      "slug",
      "url",
      "postDate",
      "audience",
      "type",
      "likes",
      "restacks",
      "commentCount",
      "wordcount",
      "authors",
      "coverImage",
      "section",
      "tags",
      "bodyHtml",
      "bodyText",
      "truncated",
    ]);
  });

  it("free post content is not truncated", () => {
    const p = toPost(FREE, LENNY, { bodyHtml: FREE.body_html ?? null });
    expect(p.audience).toBe("free");
    expect(p.truncated).toBe(false);
    expect(p.bodyHtml).toContain("<p");
    expect(p.bodyText).not.toMatch(/<[a-z]/i);
    expect(p.bodyText!.length).toBeGreaterThan(500);
  });

  it("paid post content is flagged as a truncated preview", () => {
    const p = toPost(PAID, LENNY, { bodyHtml: PAID.body_html ?? null });
    expect(p.audience).toBe("paid");
    expect(p.truncated).toBe(true);
    expect(p.bodyText!.length).toBeGreaterThan(100);
  });

  it("paid post with no public body is truncated", () => {
    const p = toPost({ ...PAID, body_html: null }, LENNY, { bodyHtml: null });
    expect(p).toMatchObject({
      bodyHtml: null,
      bodyText: null,
      truncated: true,
    });
  });

  it("maps founding audience and podcast type", () => {
    const p = toPost({ ...FREE, audience: "founding", type: "podcast" }, LENNY);
    expect(p).toMatchObject({ audience: "paid", type: "podcast" });
  });
});

describe("htmlToText", () => {
  it("strips tags, decodes entities, keeps paragraphs", () => {
    expect(
      htmlToText(
        '<h2>Hi &amp; bye</h2><p>One<br>two&#8217;s <a href="x">link</a></p><ul><li>a</li><li>b</li></ul><button>Subscribe</button><p>&nbsp;End&hellip;</p>',
      ),
    ).toBe("Hi & bye\n\nOne\ntwo’s link\n\n• a\n• b\n\nEnd…");
  });
});

// ---- HTTP + run ----

type Handler = (url: string) => {
  status?: number;
  body: string;
  headers?: Record<string, string>;
};
const fakeFetch = (handler: Handler) =>
  vi.fn(async (url: string) => {
    const r = handler(url);
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (n: string) => r.headers?.[n.toLowerCase()] ?? null },
      text: async () => r.body,
    };
  });

const mkPost = (
  id: number,
  date: string,
  extra: Partial<RawPost> = {},
): RawPost => ({
  ...ARCHIVE[0]!,
  id,
  slug: `post-${id}`,
  canonical_url: `${LENNY}/p/post-${id}`,
  post_date: date,
  ...extra,
});

/** Fake Substack: `posts` newest first, served in pages of `pageSize`. */
function fakeSubstack(
  posts: RawPost[],
  pageSize = 3,
  opts: { failSlugs?: string[] } = {},
) {
  const fetch = fakeFetch((url) => {
    const u = new URL(url);
    if (u.hostname !== "www.lennysnewsletter.com")
      return { status: 404, body: "" };
    if (u.pathname === "/api/v1/archive") {
      const off = Number(u.searchParams.get("offset"));
      return { body: JSON.stringify(posts.slice(off, off + pageSize)) };
    }
    const slug = u.pathname.split("/").pop()!;
    if (opts.failSlugs?.includes(slug)) return { status: 500, body: "boom" };
    const p = posts.find((x) => x.slug === slug);
    if (!p) return { status: 404, body: "" };
    return {
      body: JSON.stringify({ ...p, body_html: `<p>Body of ${slug}</p>` }),
    };
  });
  const http = new HttpClient({
    fetch: fetch as unknown as FetchLike,
    sleep: async () => {},
    baseDelayMs: 1,
    maxRetries: 1,
  });
  return { fetch, client: new SubstackClient(http) };
}

const collect = () => {
  const out: ReturnType<typeof toPost>[] = [];
  const emit: RunDeps["emit"] = async (p) => (out.push(p), true);
  return { out, emit };
};

const POSTS = Array.from({ length: 10 }, (_, i) =>
  mkPost(100 - i, new Date(Date.UTC(2026, 8, 30 - i)).toISOString()),
);

describe("HttpClient", () => {
  it("retries 429 with Retry-After", async () => {
    let n = 0;
    const sleep = vi.fn(async () => {});
    const fetch = fakeFetch(() =>
      ++n === 1
        ? { status: 429, body: "", headers: { "retry-after": "2" } }
        : { body: "[]" },
    );
    const http = new HttpClient({
      fetch: fetch as unknown as FetchLike,
      sleep,
    });
    const res = await http.request({ url: `${LENNY}/api/v1/archive` });
    expect(res.text).toBe("[]");
    expect(sleep).toHaveBeenCalledWith(2000);
  });
});

describe("runScrape", () => {
  it("onlyNew: returns only unseen posts and stops at known ones", async () => {
    const go = async (posts: RawPost[], max: number, state: unknown) => {
      const { client, fetch } = fakeSubstack(posts);
      const seen = new Seen(state);
      const { out, emit } = collect();
      const stats = await runScrape(
        normalizeInput(
          { publications: [LENNY], maxPostsPerPublication: max, onlyNew: true },
          NOW,
        ),
        { client, emit, seen },
      );
      return { out, stats, fetch, state: seen.toJSON() };
    };
    // Baseline: the newest 4 posts.
    const r1 = await go(POSTS, 4, undefined);
    expect(r1.out.map((p) => p.postId)).toEqual([100, 99, 98, 97]);

    // Two new posts on top; older posts the baseline didn't reach stay out.
    const fresh = [mkPost(102, "2026-10-02"), mkPost(101, "2026-10-01")];
    const r2 = await go([...fresh, ...POSTS], 100, r1.state);
    expect(r2.out.map((p) => p.postId)).toEqual([102, 101]);
    expect(r2.stats.targets[LENNY]).toMatchObject({
      skippedSeen: ONLY_NEW_SEEN_STREAK,
      status: "reachedSeen",
    });

    const r3 = await go([...fresh, ...POSTS], 100, r2.state);
    expect(r3.out).toEqual([]);
    expect(r3.fetch).toHaveBeenCalledTimes(1);
  });

  it("pages through the archive up to max, metadata only", async () => {
    const { client, fetch } = fakeSubstack(POSTS);
    const { out, emit } = collect();
    const stats = await runScrape(
      normalizeInput({ publications: [LENNY], maxPostsPerPublication: 7 }, NOW),
      { client, emit },
    );
    expect(out.map((p) => p.postId)).toEqual([100, 99, 98, 97, 96, 95, 94]);
    expect(out.every((p) => p.bodyHtml === null)).toBe(true);
    expect(stats.targets[LENNY]).toMatchObject({
      emitted: 7,
      status: "maxPosts",
    });
    expect(
      fetch.mock.calls.every(([u]) => String(u).includes("/archive")),
    ).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("exhausts the archive and dedupes overlapping pages", async () => {
    const withDup = [...POSTS.slice(0, 4), POSTS[2]!, ...POSTS.slice(4)];
    const { client } = fakeSubstack(withDup);
    const { out, emit } = collect();
    const stats = await runScrape(
      normalizeInput({ publications: [LENNY] }, NOW),
      { client, emit },
    );
    expect(out).toHaveLength(10);
    expect(new Set(out.map((p) => p.postId)).size).toBe(10);
    expect(stats.targets[LENNY]).toMatchObject({
      status: "exhausted",
      skippedDuplicate: 1,
    });
  });

  it("fetches content, skipping (not charging) posts that fail", async () => {
    const { client } = fakeSubstack(POSTS, 3, { failSlugs: ["post-99"] });
    const { out, emit } = collect();
    const logs: string[] = [];
    const stats = await runScrape(
      normalizeInput(
        {
          publications: [LENNY],
          maxPostsPerPublication: 3,
          includeContent: true,
        },
        NOW,
      ),
      { client, emit, log: (m) => logs.push(m) },
    );
    expect(out.map((p) => p.postId)).toEqual([100, 98]);
    expect(out[0]).toMatchObject({
      bodyHtml: "<p>Body of post-100</p>",
      bodyText: "Body of post-100",
    });
    expect(stats.targets[LENNY]!.failedPosts).toBe(1);
    expect(logs.join()).toMatch(/post-99.*not charged/);
  });

  it("stops at sinceDate", async () => {
    const { client, fetch } = fakeSubstack([
      ...POSTS,
      ...POSTS.map((p) => ({
        ...p,
        id: p.id - 50,
        post_date: "2020-01-01T00:00:00.000Z",
      })),
    ]);
    const { out, emit } = collect();
    const stats = await runScrape(
      normalizeInput({ publications: [LENNY], sinceDate: "2026-09-25" }, NOW),
      { client, emit },
    );
    expect(out.map((p) => p.postId)).toEqual([100, 99, 98, 97, 96, 95]);
    expect(stats.targets[LENNY]!.status).toBe("reachedSinceDate");
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(
      1 + Math.ceil((6 + OLD_STREAK_STOP) / 3),
    );
  });

  it("passes search and does not stop early on old results", async () => {
    const mixed = [
      POSTS[0]!,
      { ...POSTS[1]!, post_date: "2020-01-01T00:00:00.000Z" },
      ...POSTS.slice(2).map((p, i) =>
        i < 6 ? { ...p, post_date: "2019-01-01T00:00:00.000Z" } : p,
      ),
    ];
    const { client, fetch } = fakeSubstack(mixed);
    const { out, emit } = collect();
    await runScrape(
      normalizeInput(
        { publications: [LENNY], sinceDate: "2026-01-01", search: "ai" },
        NOW,
      ),
      { client, emit },
    );
    expect(String(fetch.mock.calls[0]![0])).toContain("search=ai");
    expect(out.map((p) => p.postId)).toEqual([100, 92, 91]);
  });

  it("fills publicationName for byline-less posts from the same page", async () => {
    const posts = [
      mkPost(100, "2026-09-30T00:00:00.000Z", { publishedBylines: [] }),
      ...POSTS.slice(1, 3),
    ];
    const { client } = fakeSubstack(posts);
    const { out, emit } = collect();
    await runScrape(normalizeInput({ publications: [LENNY] }, NOW), {
      client,
      emit,
    });
    expect(out[0]).toMatchObject({
      postId: 100,
      authors: [],
      publicationName: "Lenny's Newsletter",
    });
  });

  it("scrapes single post URLs and marks unknown publications notFound", async () => {
    const { client } = fakeSubstack(POSTS);
    const { out, emit } = collect();
    const stats = await runScrape(
      normalizeInput(
        {
          publications: [
            `${LENNY}/p/post-97`,
            `${LENNY}/p/missing`,
            "nope.substack.com",
          ],
          includeContent: true,
        },
        NOW,
      ),
      { client, emit },
    );
    expect(out.map((p) => [p.postId, p.bodyText])).toEqual([
      [97, "Body of post-97"],
    ]);
    expect(stats.targets[`${LENNY}/p/missing`]!.status).toBe("notFound");
    expect(stats.targets["https://nope.substack.com"]!.status).toBe("notFound");
  });

  it("stops when the budget is reached", async () => {
    const { client } = fakeSubstack(POSTS);
    let n = 0;
    const stats = await runScrape(
      normalizeInput({ publications: [LENNY] }, NOW),
      {
        client,
        emit: async () => ++n < 4,
      },
    );
    expect(n).toBe(4);
    expect(stats).toMatchObject({ emitted: 4, stopReason: "budget" });
  });

  it("throws when every publication fails", async () => {
    const fetch = fakeFetch(() => ({ body: "<html>not substack</html>" }));
    const client = new SubstackClient(
      new HttpClient({
        fetch: fetch as unknown as FetchLike,
        sleep: async () => {},
      }),
    );
    await expect(
      runScrape(normalizeInput({ publications: ["example.org"] }, NOW), {
        client,
        emit: async () => true,
      }),
    ).rejects.toThrow(/All publications failed.*Substack/);
  });

  it("charges one event per post by mode", () => {
    expect(eventFor(normalizeInput({ publications: ["x"] }, NOW))).toBe(
      EVENT_POST,
    );
    expect(
      eventFor(
        normalizeInput({ publications: ["x"], includeContent: true }, NOW),
      ),
    ).toBe(EVENT_POST_WITH_CONTENT);
  });
});
