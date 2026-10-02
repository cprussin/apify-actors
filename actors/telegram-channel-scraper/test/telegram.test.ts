import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  ChannelRefError,
  parseChannelRef,
  previewUrl,
} from "../src/channel.js";
import { HttpClient, HttpError, type FetchLike } from "../src/http.js";
import { InputError, normalizeInput, parseSince } from "../src/input.js";
import {
  classifyPage,
  parseCount,
  parsePostUrl,
  parsePreviewPage,
  parseProfilePage,
} from "../src/parse.js";
import {
  OLD_STREAK_STOP,
  ONLY_NEW_SEEN_STREAK,
  runChannels,
  type ChargeEvent,
} from "../src/run.js";
import { Seen } from "../src/state.js";
import type { OutputItem, Post } from "../src/types.js";

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const NOW = new Date("2026-09-30T12:00:00Z");

describe("parseChannelRef", () => {
  it.each([
    ["durov", "durov"],
    ["@Durov", "durov"],
    ["t.me/durov", "durov"],
    ["https://t.me/durov", "durov"],
    ["https://t.me/s/durov", "durov"],
    ["https://t.me/durov/528", "durov"],
    ["https://t.me/s/durov?before=100", "durov"],
    ["https://telegram.me/Telegram/", "telegram"],
    ["http://www.t.me/nytimes#x", "nytimes"],
  ])("%s -> %s", (input, expected) => {
    expect(parseChannelRef(input)).toBe(expected);
  });

  it.each([
    "https://t.me/+AbCdEf123",
    "https://t.me/joinchat/AbCdEf",
    "https://t.me/c/123456/7",
    "https://example.com/durov",
    "ab",
    "",
  ])("rejects %s", (input) => {
    expect(() => parseChannelRef(input)).toThrow(ChannelRefError);
  });
});

describe("parseCount / parsePostUrl", () => {
  it.each([
    ["10.6M", 10_600_000],
    ["6.43K", 6430],
    ["768", 768],
    ["24 240", 24_240],
    ["10 579 605", 10_579_605],
    ["1,234", 1234],
    ["1.2B", 1_200_000_000],
    ["", null],
    ["abc", null],
  ])("%s -> %s", (s, n) => {
    expect(parseCount(s)).toBe(n);
  });

  it("parses post URLs", () => {
    expect(parsePostUrl("https://t.me/khabib_nurmagomedov/127")).toEqual({
      channel: "khabib_nurmagomedov",
      postId: 127,
    });
    expect(parsePostUrl("https://t.me/c/123/4")).toEqual({
      channel: null,
      postId: null,
    });
    expect(parsePostUrl(undefined).postId).toBeNull();
  });
});

describe("input", () => {
  it("normalizes, dedupes and keeps invalid entries as errors", () => {
    const n = normalizeInput(
      {
        channels: ["durov", "https://t.me/s/Durov", "https://t.me/+abc", ""],
        maxPostsPerChannel: "50",
        sinceDate: "7 days",
      },
      NOW,
    );
    expect(n.channels).toEqual([
      { input: "durov", username: "durov" },
      {
        input: "https://t.me/+abc",
        username: null,
        error: expect.stringContaining("private invite link"),
      },
    ]);
    expect(n.maxPostsPerChannel).toBe(50);
    expect(n.since).toBe("2026-09-23T12:00:00.000Z");
    expect(n.includeChannelInfo).toBe(true);
  });

  it("applies defaults and limits", () => {
    const n = normalizeInput({ channels: ["durov"] }, NOW);
    expect(n.maxPostsPerChannel).toBe(100);
    expect(n.since).toBeUndefined();
    expect(
      normalizeInput({ channels: ["durov"], maxPostsPerChannel: 1e9 })
        .maxPostsPerChannel,
    ).toBe(100_000);
  });

  it.each([
    [{}],
    [{ channels: [] }],
    [{ channels: ["  "] }],
    [{ channels: ["durov"], maxPostsPerChannel: 0 }],
    [{ channels: ["durov"], sinceDate: "yesterday-ish" }],
  ])("rejects %j", (raw) => {
    expect(() => normalizeInput(raw, NOW)).toThrow(InputError);
  });

  it("parses sinceDate forms", () => {
    expect(parseSince("2026-09-01", NOW)).toBe("2026-09-01T00:00:00.000Z");
    expect(parseSince("24 hours", NOW)).toBe("2026-09-29T12:00:00.000Z");
    expect(parseSince("1 month ago", NOW)).toBe("2026-08-30T12:00:00.000Z");
    expect(parseSince("2026-09-01T10:00:00+02:00", NOW)).toBe(
      "2026-09-01T08:00:00.000Z",
    );
  });
});

describe("classifyPage / parseProfilePage", () => {
  it("classifies preview, missing, group, bot and preview-disabled pages", () => {
    expect(classifyPage(fixture("s-durov.html")).kind).toBe("preview");
    expect(classifyPage(fixture("page-notfound.html")).kind).toBe("notFound");
    expect(classifyPage(fixture("page-group.html")).kind).toBe("group");
    expect(classifyPage(fixture("page-bot.html")).kind).toBe("user");
    // A channel landing page without preview = preview disabled.
    expect(classifyPage(fixture("page-durov.html"))).toEqual({
      kind: "channel",
      title: "Pavel Durov",
    });
  });

  it("reads exact subscribers from the landing page", () => {
    expect(parseProfilePage(fixture("page-durov.html"))).toMatchObject({
      title: "Pavel Durov",
      description: "Founder of Telegram.",
      subscribers: 10_579_605,
      verified: true,
      photoUrl: expect.stringMatching(/^https:\/\/cdn\d\.telesco\.pe\//),
    });
    expect(parseProfilePage(fixture("page-notfound.html"))).toBeNull();
  });
});

describe("parsePreviewPage", () => {
  const durov = parsePreviewPage(fixture("s-durov.html"), "durov");

  it("parses channel info", () => {
    expect(durov.channelInfo).toMatchObject({
      username: "durov",
      title: "Pavel Durov",
      description: "Founder of Telegram.",
      subscribers: 10_600_000,
      verified: true,
      counters: { photos: 102, videos: 46, links: 200 },
    });
    expect(durov.channelInfo.photoUrl).toMatch(/^https:\/\//);
  });

  it("parses posts newest first with text, views, reactions and links", () => {
    expect(durov.posts).toHaveLength(20);
    expect(durov.minPostId).toBe(528);
    expect(durov.posts[0]!.postId).toBe(548);
    const p = durov.posts.at(-1)!;
    expect(p).toMatchObject({
      type: "post",
      channel: "durov",
      postId: 528,
      date: "2026-06-15T18:58:13.000Z",
      edited: false,
      author: "Pavel Durov",
      views: 18_900_000,
      permalink: "https://t.me/durov/528",
      links: [
        "https://www.youtube.com/watch?v=1Yq_5aDdJ24",
        "https://t.me/contest/456",
      ],
      forwardedFrom: null,
      replyTo: null,
    });
    expect(p.text).toMatch(/^⛔️ The UK government wants to ban social media/);
    expect(p.text).toContain("under 16.\n\nBut banning");
    expect(p.text).toContain("$200,000");
    expect(p.reactions[0]).toEqual({
      emoji: null,
      customEmojiId: null,
      paid: true,
      count: 14_300,
    });
    expect(p.reactions[1]).toEqual({
      emoji: null,
      customEmojiId: "5265077361648368841",
      paid: false,
      count: 132_000,
    });
    for (const post of durov.posts) {
      expect(Date.parse(post.date)).not.toBeNaN();
      expect(post.permalink).toBe(`https://t.me/durov/${post.postId}`);
    }
  });

  it("skips service messages but still reports their ID for paging", () => {
    const first = parsePreviewPage(fixture("s-durov-first.html"), "durov");
    expect(first.posts).toEqual([]);
    expect(first.minPostId).toBe(1);
  });

  const ru = parsePreviewPage(fixture("s-durov_russia.html"), "durov_russia");
  const byId = (id: number): Post => ru.posts.find((p) => p.postId === id)!;

  it("parses unicode emoji reactions and audio documents", () => {
    expect(byId(67).reactions[0]).toEqual({
      emoji: "👍",
      customEmojiId: null,
      paid: false,
      count: 74_800,
    });
    expect(byId(67).media).toEqual([
      {
        type: "audio",
        url: "https://t.me/durov_russia/67",
        thumbnailUrl: null,
        duration: null,
        title: "Свой Живой Интернет - durikovich",
      },
    ]);
  });

  it("parses forwards with video", () => {
    const p = byId(63);
    expect(p.forwardedFrom).toEqual({
      name: "Khabib Nurmagomedov",
      url: "https://t.me/khabib_nurmagomedov/127",
      channel: "khabib_nurmagomedov",
      postId: 127,
    });
    expect(p.media[0]).toMatchObject({
      type: "video",
      url: expect.stringMatching(
        /^https:\/\/cdn\d\.telesco\.pe\/file\/.*\.mp4/,
      ),
      thumbnailUrl: expect.stringMatching(/^https:\/\//),
    });
  });

  it("parses replies without mixing the quoted text into the post", () => {
    const p = byId(61);
    expect(p.replyTo).toEqual({
      name: "Павел Дуров",
      url: "https://t.me/durov_russia/57",
      channel: "durov_russia",
      postId: 57,
      text: expect.stringMatching(/^Возможно, что мы имеем дело/),
    });
    expect(p.text).toBe("100% 😺");
  });

  it("parses link previews and adds them to links", () => {
    const p = byId(57);
    expect(p.linkPreview).toMatchObject({
      url: expect.stringMatching(/^https:\/\/sotaproject\.com\//),
      siteName: "SOTA",
      title: expect.stringMatching(/^ФСБ и Телеграм/),
      imageUrl: expect.stringMatching(/^https:\/\//),
    });
    expect(p.links).toContain(p.linkPreview!.url);
  });

  it("parses albums, video durations and edited flags", () => {
    const cq = parsePreviewPage(
      fixture("s-cryptoquant.html"),
      "cryptoquant_official",
    );
    const album = cq.posts.find((p) => p.postId === 3816)!;
    expect(album.media.map((m) => m.type)).toEqual(["photo", "photo"]);
    expect(album.media[0]!.url).toMatch(
      /^https:\/\/cdn\d\.telesco\.pe\/.*\.jpg$/,
    );
    expect(cq.posts.some((p) => p.edited)).toBe(true);

    const ny = parsePreviewPage(fixture("s-nytimes.html"), "nytimes");
    const v = ny.posts.find((p) => p.postId === 3615)!;
    expect(v.media[0]).toMatchObject({ type: "video" });
    expect(v.media[0]!.duration).toMatch(/^\d+:\d\d$/);
    expect(v.links).toContain("https://t.me/nytimes");
  });

  it("extracts hashtags", () => {
    const html = page("chan", [
      { id: 5, text: "Hello #crypto and #BTC_2026, not a#tag, #crypto again" },
    ]);
    expect(parsePreviewPage(html, "chan").posts[0]!.hashtags).toEqual([
      "crypto",
      "BTC_2026",
    ]);
  });
});

/** Minimal synthetic t.me/s page with the given posts (any order). */
function page(
  channel: string,
  posts: { id: number; date?: string; text?: string }[],
): string {
  const msgs = posts
    .map(
      (p) => `<div class="tgme_widget_message_wrap js-widget_message_wrap">
<div class="tgme_widget_message js-widget_message" data-post="${channel}/${p.id}">
<div class="tgme_widget_message_text js-message_text">${p.text ?? `Post ${p.id}`}</div>
<div class="tgme_widget_message_footer"><span class="tgme_widget_message_views">1.5K</span>
<span class="tgme_widget_message_meta"><a class="tgme_widget_message_date" href="https://t.me/${channel}/${p.id}"><time datetime="${p.date ?? "2026-09-01T00:00:00+00:00"}"></time></a></span></div>
</div></div>`,
    )
    .join("\n");
  return `<html><body><div class="tgme_channel_info"><div class="tgme_channel_info_header_title"><span>Chan</span></div>
<div class="tgme_channel_info_header_username"><a>@${channel}</a></div>
<div class="tgme_channel_info_counters"><div class="tgme_channel_info_counter"><span class="counter_value">1.2K</span> <span class="counter_type">subscribers</span></div></div></div>
<section class="tgme_channel_history">${msgs}</section></body></html>`;
}

/** 30 posts per page, IDs 1..total, dates one hour apart ending at NOW. */
function pagedSite(channel: string, total: number, perPage = 30) {
  const dateOf = (id: number) =>
    new Date(NOW.getTime() - (total - id) * 3_600_000).toISOString();
  return (url: string): string => {
    const m = /\?before=(\d+)/.exec(url);
    const before = m ? Number(m[1]) : total + 1;
    const ids: { id: number; date: string }[] = [];
    for (let id = Math.max(1, before - perPage); id < before; id++)
      ids.push({ id, date: dateOf(id) });
    return page(channel, ids);
  };
}

function harness(
  routes: (url: string) => string,
  opts: { budget?: number } = {},
) {
  const items: { item: OutputItem; event: ChargeEvent | null }[] = [];
  const urls: string[] = [];
  let charged = 0;
  const deps = {
    fetchHtml: vi.fn(async (url: string) => {
      urls.push(url);
      return routes(url);
    }),
    emit: async (item: OutputItem, event: ChargeEvent | null) => {
      items.push({ item, event });
      if (event) charged += 1;
      return opts.budget === undefined || charged < opts.budget;
    },
  };
  return {
    deps,
    items,
    urls,
    posts: () =>
      items.filter((i) => i.event === "post").map((i) => i.item as Post),
  };
}

describe("runChannels", () => {
  it("paginates backwards with ?before= and stops at maxPostsPerChannel", async () => {
    const h = harness(pagedSite("chan", 200));
    const stats = await runChannels(
      normalizeInput({
        channels: ["chan"],
        maxPostsPerChannel: 75,
        includeChannelInfo: false,
      }),
      h.deps,
    );
    const ids = h.posts().map((p) => p.postId);
    expect(ids).toHaveLength(75);
    expect(ids[0]).toBe(200);
    expect(ids.at(-1)).toBe(126);
    expect(new Set(ids).size).toBe(75);
    expect(h.urls).toEqual([
      previewUrl("chan"),
      previewUrl("chan", 171),
      previewUrl("chan", 141),
    ]);
    expect(stats.channels.chan).toMatchObject({
      status: "maxPosts",
      posts: 75,
      pages: 3,
    });
  });

  it("onlyNew: returns only unseen posts and stops at known ones", async () => {
    const go = async (total: number, state: unknown) => {
      const h = harness(pagedSite("chan", total));
      const seen = new Seen(state);
      const stats = await runChannels(
        normalizeInput({
          channels: ["chan"],
          maxPostsPerChannel: 10,
          includeChannelInfo: false,
          onlyNew: true,
        }),
        { ...h.deps, seen },
      );
      return { h, stats, state: seen.toJSON() };
    };
    const r1 = await go(200, undefined);
    expect(r1.h.posts().map((p) => p.postId)).toEqual(
      Array.from({ length: 10 }, (_, i) => 200 - i),
    );
    const r2 = await go(205, r1.state);
    expect(r2.h.posts().map((p) => p.postId)).toEqual([
      205, 204, 203, 202, 201,
    ]);
    expect(r2.h.urls).toHaveLength(1);
    expect(r2.stats.channels.chan).toMatchObject({
      status: "reachedSeen",
      skippedSeen: ONLY_NEW_SEEN_STREAK,
      posts: 5,
    });
    const r3 = await go(205, r2.state);
    expect(r3.h.posts()).toEqual([]);
    expect(r3.h.items).toEqual([]);
  });

  it("reads to the first post and stops", async () => {
    const h = harness(pagedSite("chan", 45));
    const stats = await runChannels(
      normalizeInput({ channels: ["chan"], includeChannelInfo: false }),
      h.deps,
    );
    expect(h.posts()).toHaveLength(45);
    expect(stats.channels.chan!.status).toBe("exhausted");
  });

  it("stops at sinceDate", async () => {
    const h = harness(pagedSite("chan", 500));
    const stats = await runChannels(
      normalizeInput(
        {
          channels: ["chan"],
          sinceDate: "48 hours",
          maxPostsPerChannel: 1000,
          includeChannelInfo: false,
        },
        NOW,
      ),
      h.deps,
    );
    // Posts are hourly, ending at NOW: 49 posts within the last 48 hours.
    expect(h.posts()).toHaveLength(49);
    expect(h.posts().every((p) => p.date >= "2026-09-28T12:00:00.000Z")).toBe(
      true,
    );
    expect(stats.channels.chan!.status).toBe("reachedSinceDate");
    expect(OLD_STREAK_STOP).toBeGreaterThan(0);
  });

  it("dedupes posts repeated across pages and stops when paging stalls", async () => {
    const same = page("chan", [{ id: 10 }, { id: 11 }, { id: 12 }]);
    const h = harness(() => same);
    const stats = await runChannels(
      normalizeInput({ channels: ["chan"], includeChannelInfo: false }),
      h.deps,
    );
    expect(h.posts().map((p) => p.postId)).toEqual([12, 11, 10]);
    expect(stats.channels.chan!.status).toBe("exhausted");
    expect(h.urls).toHaveLength(2);
  });

  it("emits channel info with the exact subscriber count", async () => {
    const h = harness((url) =>
      url === "https://t.me/durov"
        ? fixture("page-durov.html")
        : url.includes("before=")
          ? fixture("s-durov-first.html")
          : fixture("s-durov.html"),
    );
    const stats = await runChannels(
      normalizeInput({
        channels: ["https://t.me/durov"],
        maxPostsPerChannel: 5,
      }),
      h.deps,
    );
    expect(h.items[0]).toEqual({
      event: "channel-info",
      item: {
        type: "channel",
        channel: "durov",
        title: "Pavel Durov",
        description: "Founder of Telegram.",
        subscribers: 10_579_605,
        photoUrl: expect.stringMatching(/^https:\/\//),
        verified: true,
        counters: { photos: 102, videos: 46, links: 200 },
        url: "https://t.me/durov",
      },
    });
    expect(h.posts()).toHaveLength(5);
    expect(stats).toMatchObject({ posts: 5, channelInfos: 1, errors: 0 });
  });

  it("keeps rounded subscribers if the landing page fails", async () => {
    const h = harness((url) => {
      if (url === "https://t.me/durov") throw new Error("boom");
      return fixture("s-durov.html");
    });
    const logs: string[] = [];
    await runChannels(
      normalizeInput({ channels: ["durov"], maxPostsPerChannel: 1 }),
      { ...h.deps, log: (m) => logs.push(m) },
    );
    expect((h.items[0]!.item as { subscribers: number }).subscribers).toBe(
      10_600_000,
    );
    expect(logs[0]).toMatch(/exact subscriber count unavailable/);
  });

  it("emits free error items for missing, group, bot, preview-disabled, invalid and failing channels", async () => {
    const h = harness((url) => {
      if (url.endsWith("/nope1")) return fixture("page-notfound.html");
      if (url.endsWith("/somegroup")) return fixture("page-group.html");
      if (url.endsWith("/somebot")) return fixture("page-bot.html");
      if (url.endsWith("/hidden")) return fixture("page-durov.html");
      if (url.endsWith("/broken")) throw new Error("HTTP 500");
      return pagedSite("chan", 3)(url);
    });
    const stats = await runChannels(
      normalizeInput({
        channels: [
          "nope1",
          "somegroup",
          "somebot",
          "hidden",
          "https://t.me/+priv",
          "broken",
          "chan",
        ],
        includeChannelInfo: false,
      }),
      h.deps,
    );
    const errors = h.items.filter((i) => i.item.type === "error");
    expect(errors.every((e) => e.event === null)).toBe(true);
    expect(
      errors.map((e) => [
        e.item.channel,
        (e.item as { errorCode: string }).errorCode,
      ]),
    ).toEqual([
      ["nope1", "notFound"],
      ["somegroup", "notAChannel"],
      ["somebot", "notAChannel"],
      ["hidden", "previewDisabled"],
      ["https://t.me/+priv", "invalidInput"],
      ["broken", "failed"],
    ]);
    expect(h.posts()).toHaveLength(3);
    expect(stats.errors).toBe(6);
  });

  it("stops the whole run when the budget is reached", async () => {
    const h = harness(pagedSite("chan", 100), { budget: 7 });
    const stats = await runChannels(
      normalizeInput({ channels: ["chan", "other"] }),
      h.deps,
    );
    expect(h.items.filter((i) => i.event)).toHaveLength(7);
    expect(h.items[0]!.event).toBe("channel-info");
    expect(stats).toMatchObject({
      stopReason: "budget",
      posts: 6,
      channelInfos: 1,
    });
    expect(stats.channels.chan!.status).toBe("budget");
    expect(stats.channels.other!.status).toBe("notStarted");
  });

  it("throws when every channel fails", async () => {
    const h = harness(() => {
      throw new Error("network down");
    });
    await expect(
      runChannels(normalizeInput({ channels: ["aaaa", "bbbb"] }), h.deps),
    ).rejects.toThrow(/All channels failed/);
  });
});

describe("HttpClient", () => {
  const fakeFetch = (
    responses: {
      status: number;
      body?: string;
      headers?: Record<string, string>;
    }[],
  ) => {
    let i = 0;
    return vi.fn(async () => {
      const r = responses[Math.min(i++, responses.length - 1)]!;
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        headers: { get: (n: string) => r.headers?.[n.toLowerCase()] ?? null },
        text: async () => r.body ?? "",
      };
    }) as unknown as FetchLike & ReturnType<typeof vi.fn>;
  };

  it("backs off on 429 honoring Retry-After", async () => {
    const sleeps: number[] = [];
    const fetch = fakeFetch([
      { status: 429, headers: { "retry-after": "3" } },
      { status: 200, body: "ok" },
    ]);
    const http = new HttpClient({
      fetch,
      sleep: async (ms) => void sleeps.push(ms),
    });
    expect((await http.request({ url: "https://t.me/s/x" })).text).toBe("ok");
    expect(sleeps).toEqual([3000]);
  });

  it("gives up after maxRetries and does not retry 404", async () => {
    const http = new HttpClient({
      fetch: fakeFetch([{ status: 503 }]),
      sleep: async () => {},
      maxRetries: 2,
    });
    await expect(http.request({ url: "https://t.me/s/x" })).rejects.toThrow(
      HttpError,
    );
    const fetch404 = fakeFetch([{ status: 404 }]);
    const http404 = new HttpClient({ fetch: fetch404, sleep: async () => {} });
    await expect(http404.request({ url: "https://t.me/s/x" })).rejects.toThrow(
      /HTTP 404/,
    );
    expect(fetch404).toHaveBeenCalledTimes(1);
  });
});
