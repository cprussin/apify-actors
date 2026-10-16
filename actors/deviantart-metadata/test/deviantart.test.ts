import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DeviantArtClient } from "../src/deviantart.js";
import { HttpClient, HttpError, type FetchLike } from "../src/http.js";
import { InputError, normalizeInput, parseSince } from "../src/input.js";
import {
  deviationIdFromUrl,
  fromOembed,
  splitTags,
  thumbnailUrl,
  type Item,
} from "../src/item.js";
import {
  decodeXml,
  parseDeviationPage,
  parseGalleryPage,
  parseProfilePage,
  parseRss,
  parseSearchPage,
  parseWatchers,
} from "../src/parse.js";
import type { RawOembed } from "../src/raw.js";
import {
  EVENT_DEVIATION,
  EVENT_PROFILE,
  runScrape,
  type ChargeEvent,
} from "../src/run.js";
import { decodeJsString, extractInitialState } from "../src/state.js";
import { parseDeviationUrl, parseUsername } from "../src/target.js";

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const SEARCH = fixture("search.html");
const GALLERY = fixture("gallery.html");
const DEVIATION = fixture("deviation.html");
const PROFILE = fixture("profile.html");
const RSS = fixture("rss.xml");
const OEMBED = fixture("oembed.json");
const NERA = "https://www.deviantart.com/wlop/art/Nera2-1385671838";

const resp = (status: number, body: string) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  text: async () => body,
});
/** fetch stub: `route` maps a URL to [status, body]; records requested URLs. */
function mockFetch(route: (url: string) => [number, string]) {
  const urls: string[] = [];
  const fetch: FetchLike = async (url) => {
    urls.push(url);
    const [status, body] = route(url);
    return resp(status, body);
  };
  return { fetch, urls };
}
const fastHttp = (fetch: FetchLike) =>
  new HttpClient({
    fetch,
    baseDelayMs: 0,
    minIntervalMs: 0,
    sleep: async () => {},
  });

/** Routes the saved fixtures by URL, like the live site. */
const siteRoute = (url: string): [number, string] => {
  if (url.startsWith("https://www.deviantart.com/search?q=dragon"))
    return url.includes("page=") ? [200, "<html></html>"] : [200, SEARCH];
  if (url.startsWith("https://www.deviantart.com/wlop/gallery"))
    return [200, GALLERY];
  if (url === NERA) return [200, DEVIATION];
  if (url === "https://www.deviantart.com/wlop") return [200, PROFILE];
  if (url.startsWith("https://backend.deviantart.com/oembed"))
    return [200, OEMBED];
  if (url.startsWith("https://backend.deviantart.com/rss.xml"))
    return [200, RSS];
  return [404, "Not found"];
};

const run = async (
  raw: Parameters<typeof normalizeInput>[0],
  route = siteRoute,
) => {
  const { fetch, urls } = mockFetch(route);
  const out: { item: Item; event: ChargeEvent }[] = [];
  const stats = await runScrape(normalizeInput(raw), {
    client: new DeviantArtClient(fastHttp(fetch)),
    emit: async (item, event) => (out.push({ item, event }), true),
  });
  return { out, items: out.map((o) => o.item), stats, urls };
};

describe("state", () => {
  it("decodes JS string escapes", () => {
    expect(decodeJsString(String.raw`a\"b\'c\\d/e\x41\n`)).toBe(
      "a\"b'c\\d/eA\n",
    );
  });
  it("extracts __INITIAL_STATE__", () => {
    const s = extractInitialState(SEARCH);
    expect(s).toHaveProperty("@@entities");
  });
  it("returns null without state or with broken JSON", () => {
    expect(extractInitialState("<html></html>")).toBeNull();
    expect(
      extractInitialState('window.__INITIAL_STATE__ = JSON.parse("{nope");'),
    ).toBeNull();
  });
});

describe("parseSearchPage", () => {
  const p = parseSearchPage(SEARCH, "search:dragon")!;
  it("returns stream deviations in order with author watchers", () => {
    expect(p.items.map((i) => i.id)).toEqual([
      1235476545, 589596768, 540934728,
    ]);
    expect(p.hasMore).toBe(true);
    expect(p.total).toBeGreaterThan(1000);
    const d = p.items[1]!;
    expect(d).toMatchObject({
      type: "deviation",
      title: "Dragon's Breath",
      author: "88grzes",
      authorUrl: "https://www.deviantart.com/88grzes",
      authorId: 5683604,
      authorWatchers: 58226,
      publishedAt: "2016-02-08T22:35:40.000Z",
      views: 617985,
      favourites: 18422,
      comments: 569,
      category: "image",
      isMature: false,
      license: "none",
      noai: true,
      tags: null,
      dataSource: "page",
      source: "search:dragon",
    });
    expect(d.url).toMatch(/^https:\/\/www\.deviantart\.com\/88grzes\/art\//);
    expect(d.thumbnailUrl).toMatch(/-300w\.jpg\?token=/);
    expect(typeof d.isDownloadable).toBe("boolean");
  });
  it("returns null for pages without state", () => {
    expect(parseSearchPage("<html></html>", "x")).toBeNull();
  });
});

describe("parseGalleryPage", () => {
  const p = parseGalleryPage(GALLERY, "wlop")!;
  it("returns the All folder, newest first, with watchers from the owner", () => {
    expect(p.items.map((i) => i.title)).toEqual([
      "Nera2",
      "Emerald3",
      "Emerald",
    ]);
    expect(p.items.every((i) => i.author === "wlop")).toBe(true);
    expect(p.items[0]!.authorWatchers).toBe(284253);
    expect(p.total).toBe(50);
    expect(p.hasMore).toBe(true);
  });
});

describe("parseDeviationPage", () => {
  it("includes tags and extended stats", () => {
    const d = parseDeviationPage(DEVIATION, 1385671838, NERA)!;
    expect(d).toMatchObject({
      id: 1385671838,
      url: NERA,
      title: "Nera2",
      author: "wlop",
      tags: ["warrior"],
      views: 31616,
      downloads: 32,
      noai: true,
      authorWatchers: null,
    });
    expect(d.thumbnailUrl).toContain("nera2_by_wlop");
  });
  it("falls back to the only deviation when the id is unknown", () => {
    expect(parseDeviationPage(DEVIATION, null, "x")?.id).toBe(1385671838);
  });
});

describe("parseProfilePage", () => {
  it("returns profile stats and about info", () => {
    const p = parseProfilePage(PROFILE, "wlop")!;
    expect(p).toMatchObject({
      type: "profile",
      id: 11870562,
      url: "https://www.deviantart.com/wlop",
      author: "wlop",
      watchers: 284253,
      authorWatchers: 284253,
      watching: 164,
      deviationCount: 522,
      pageviews: 12947257,
      tagline: "Let there be llight!",
      countryCode: "CN",
      isArtist: true,
      joinedAt: "2009-10-15T08:25:46.000Z",
    });
    expect(parseWatchers(PROFILE)).toBe(284253);
    expect(parseWatchers(GALLERY)).toBe(284253);
  });
  it("returns null for non-profile pages", () => {
    expect(parseProfilePage(DEVIATION, "x")).toBeNull();
  });
});

describe("parseRss", () => {
  it("parses items and the next link", () => {
    const r = parseRss(RSS);
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({
      url: NERA,
      title: "Nera2",
      author: "wlop",
      publishedAt: "2026-09-28T09:44:39.000Z",
      isMature: false,
      tags: [],
    });
    expect(r.items[0]!.thumbnailUrl).toMatch(/^https:\/\/images-wixmp/);
    expect(r.next).toBe(
      "https://backend.deviantart.com/rss.xml?type=deviation&q=by%3Awlop&offset=60",
    );
  });
  it("decodes XML entities", () => {
    expect(decodeXml("a&amp;b &#039;c&#x27; <![CDATA[<d>]]>")).toBe(
      "a&b 'c' <d>",
    );
  });
});

describe("item helpers", () => {
  it("maps oEmbed", () => {
    const o = JSON.parse(OEMBED) as RawOembed;
    expect(fromOembed(NERA, o, NERA)).toMatchObject({
      id: 1385671838,
      title: "Nera2",
      author: "wlop",
      views: expect.any(Number),
      favourites: expect.any(Number),
      tags: ["warrior"],
      isMature: false,
      noai: null,
      dataSource: "oembed",
    });
  });
  it("splits tags and reads ids", () => {
    expect(splitTags("coil, dragon, dream")).toEqual([
      "coil",
      "dragon",
      "dream",
    ]);
    expect(splitTags(undefined)).toEqual([]);
    expect(deviationIdFromUrl(NERA)).toBe(1385671838);
    expect(deviationIdFromUrl("https://x/y")).toBeNull();
  });
  it("builds no thumbnail without a usable size", () => {
    expect(thumbnailUrl(undefined)).toBeNull();
    expect(
      thumbnailUrl({ baseUri: "https://b", types: [{ t: "fullview" }] }),
    ).toBeNull();
  });
});

describe("targets", () => {
  it.each([
    ["wlop", "wlop"],
    ["@WLOP", "wlop"],
    ["https://www.deviantart.com/wlop", "wlop"],
    ["deviantart.com/wlop/gallery", "wlop"],
    ["https://wlop.deviantart.com/", "wlop"],
  ])("username %s", (s, want) => expect(parseUsername(s)).toBe(want));
  it.each([
    "",
    "https://www.deviantart.com/search?q=x",
    "https://example.com/wlop",
    "a b",
  ])("rejects username %j", (s) => expect(() => parseUsername(s)).toThrow());
  it("parses deviation URLs", () => {
    expect(parseDeviationUrl(`${NERA}?foo=1`)).toMatchObject({
      url: NERA,
      id: 1385671838,
    });
    expect(
      parseDeviationUrl("wlop.deviantart.com/art/Nera2-1385671838").url,
    ).toBe(NERA);
    expect(() =>
      parseDeviationUrl("https://www.deviantart.com/wlop"),
    ).toThrow();
  });
});

describe("normalizeInput", () => {
  it("defaults to search", () => {
    expect(normalizeInput({ query: " dragon " })).toMatchObject({
      mode: "search",
      query: "dragon",
      maxItems: 20,
      includeMature: false,
      includeTags: false,
      since: null,
    });
  });
  it.each([
    [{ mode: "search" }],
    [{ mode: "userGallery" }],
    [{ mode: "userProfile", usernames: [] }],
    [{ mode: "deviationUrls" }],
    [{ mode: "nope", query: "x" }],
    [{ query: "x", maxItems: 0 }],
    [{ query: "x", sinceDate: "yesterday-ish" }],
    [{ mode: "deviationUrls", deviationUrls: ["https://example.com"] }],
  ])("rejects %j", (raw) =>
    expect(() => normalizeInput(raw)).toThrow(InputError),
  );
  it("dedupes users and URLs and caps maxItems", () => {
    const n = normalizeInput({
      mode: "userGallery",
      usernames: ["wlop", "WLOP", "https://www.deviantart.com/wlop"],
      deviationUrls: [NERA, NERA.replace("/wlop/", "/WLOP/")],
      maxItems: 99999,
    });
    expect(n.usernames).toEqual(["wlop"]);
    expect(n.deviations).toHaveLength(1);
    expect(n.maxItems).toBe(5000);
  });
  it("parses sinceDate", () => {
    const now = Date.parse("2026-10-16T00:00:00Z");
    expect(parseSince("2026-10-01", now)).toBe(Date.parse("2026-10-01"));
    expect(parseSince("7 days", now)).toBe(now - 7 * 86_400_000);
    expect(parseSince("24 hours ago", now)).toBe(now - 86_400_000);
    expect(parseSince("", now)).toBeNull();
  });
});

describe("HttpClient", () => {
  it("retries 429/503 then succeeds, and passes accepted statuses", async () => {
    let n = 0;
    const { fetch } = mockFetch(() => {
      n += 1;
      return n === 1 ? [429, "slow"] : n === 2 ? [503, "x"] : [200, "ok"];
    });
    const http = fastHttp(fetch);
    expect((await http.get("u")).text).toBe("ok");
    expect(n).toBe(3);
    const nf = fastHttp(mockFetch(() => [404, "nf"]).fetch);
    expect((await nf.get("u", [404])).status).toBe(404);
    await expect(nf.get("u")).rejects.toBeInstanceOf(HttpError);
  });
  it("spaces request starts by the crawl delay", async () => {
    let t = 0;
    const waits: number[] = [];
    const http = new HttpClient({
      fetch: mockFetch(() => [200, ""]).fetch,
      now: () => t,
      sleep: async (ms) => {
        waits.push(ms);
        t += ms;
      },
    });
    await http.get("a");
    await http.get("b");
    t += 300;
    await http.get("c");
    expect(waits).toEqual([1000, 700]);
  });
});

describe("runScrape", () => {
  it("search: emits up to maxItems deviations", async () => {
    const { out, stats } = await run({ query: "dragon", maxItems: 2 });
    expect(out.map((o) => o.item.id)).toEqual([1235476545, 589596768]);
    expect(out.every((o) => o.event === EVENT_DEVIATION)).toBe(true);
    expect(stats).toMatchObject({ emitted: 2, deviations: 2, failed: 0 });
  });

  it("search: pages until results run out, then falls back to RSS", async () => {
    const { items, stats, urls } = await run({ query: "dragon", maxItems: 5 });
    // 3 from page 1; page 2 has no state -> RSS supplies the remaining 2.
    expect(items).toHaveLength(5);
    expect(items.slice(3).every((i) => i.dataSource === "rss")).toBe(true);
    expect(stats.fallbackItems).toBe(2);
    expect(urls.some((u) => u.includes("page=2"))).toBe(true);
    expect(
      urls.every((u) => !u.includes("cursor=") && !u.includes("_puppy")),
    ).toBe(true);
  });

  it("search: fetches tags via oEmbed with includeTags", async () => {
    const { items, urls } = await run({
      query: "dragon",
      maxItems: 1,
      includeTags: true,
    });
    expect(items[0]!.tags).toEqual(["warrior"]);
    expect(urls.filter((u) => u.includes("/oembed?"))).toHaveLength(1);
  });

  it("skips mature items unless includeMature", async () => {
    const mature = SEARCH.replaceAll(
      '\\"isMature\\":false',
      '\\"isMature\\":true',
    );
    expect(mature).not.toBe(SEARCH);
    const route = (u: string): [number, string] =>
      u.startsWith("https://www.deviantart.com/search")
        ? [200, u.includes("page=") ? "<html></html>" : mature]
        : u.includes("rss.xml")
          ? [200, "<rss></rss>"]
          : [404, ""];
    const off = await run({ query: "dragon", maxItems: 3 }, route);
    expect(off.items).toHaveLength(0);
    expect(off.stats.skippedMature).toBe(3);
    const on = await run(
      { query: "dragon", maxItems: 3, includeMature: true },
      route,
    );
    expect(on.items).toHaveLength(3);
  });

  it("userGallery: newest first, stops paging at sinceDate", async () => {
    const { items, stats, urls } = await run({
      mode: "userGallery",
      usernames: ["wlop"],
      maxItems: 50,
      sinceDate: "2026-09-01",
    });
    expect(items.map((i) => i.title)).toEqual(["Nera2"]);
    expect(stats.skippedOld).toBe(2);
    expect(urls.filter((u) => u.includes("/gallery"))).toHaveLength(1);
  });

  it("userGallery: pages with ?page=N up to maxItems", async () => {
    const { items, urls } = await run({
      mode: "userGallery",
      usernames: ["wlop"],
      maxItems: 5,
    });
    expect(items).toHaveLength(5);
    expect(urls).toContain("https://www.deviantart.com/wlop/gallery?page=2");
  });

  it("userGallery: unknown user is notFound, not a failure", async () => {
    const { items, stats } = await run({
      mode: "userGallery",
      usernames: ["nobody-zzz"],
    });
    expect(items).toHaveLength(0);
    expect(stats.notFound).toBe(1);
  });

  it("userProfile: one profile event per user", async () => {
    const { out } = await run({ mode: "userProfile", usernames: ["wlop"] });
    expect(out).toHaveLength(1);
    expect(out[0]!.event).toBe(EVENT_PROFILE);
    expect(out[0]!.item.watchers).toBe(284253);
  });

  it("deviationUrls: page with tags plus author watchers from the profile", async () => {
    const { items, urls } = await run({
      mode: "deviationUrls",
      deviationUrls: [NERA],
    });
    expect(items[0]).toMatchObject({
      tags: ["warrior"],
      authorWatchers: 284253,
      dataSource: "page",
    });
    expect(urls).toEqual([NERA, "https://www.deviantart.com/wlop"]);
  });

  it("deviationUrls: falls back to oEmbed when the page has no state", async () => {
    const route = (u: string): [number, string] =>
      u === NERA ? [200, "<html></html>"] : siteRoute(u);
    const { items } = await run(
      { mode: "deviationUrls", deviationUrls: [NERA] },
      route,
    );
    expect(items[0]).toMatchObject({ dataSource: "oembed", title: "Nera2" });
  });

  it("deviationUrls: 404 is notFound", async () => {
    const { stats } = await run({
      mode: "deviationUrls",
      deviationUrls: ["https://www.deviantart.com/x/art/gone-1"],
    });
    expect(stats.notFound).toBe(1);
  });

  it("stops when emit reports the budget is reached", async () => {
    const { fetch } = mockFetch(siteRoute);
    const out: Item[] = [];
    const stats = await runScrape(
      normalizeInput({ query: "dragon", maxItems: 3 }),
      {
        client: new DeviantArtClient(fastHttp(fetch)),
        emit: async (i) => (out.push(i), out.length < 2),
      },
    );
    expect(out).toHaveLength(2);
    expect(stats.stopReason).toBe("budget");
  });

  it("throws when everything fails", async () => {
    await expect(
      run({ mode: "userProfile", usernames: ["wlop"] }, () => [400, "bad"]),
    ).rejects.toThrow(/Nothing scraped/);
  });
});
