import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { makeRow, ROW_FIELDS } from "../src/app.js";
import {
  AppleClient,
  legacyChartUrl,
  lookupUrl,
  marketingChartUrl,
  parseLegacyChart,
  parseMarketingChart,
  parseResults,
  searchUrl,
} from "../src/apple.js";
import { AppRefError, parseAppRef } from "../src/appref.js";
import {
  chartBody,
  GoogleClient,
  htmlToText,
  parseChart,
  parseDetails,
} from "../src/google.js";
import { HttpClient, type FetchLike } from "../src/http.js";

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

type Handler = (
  url: string,
  init?: Parameters<FetchLike>[1],
) => { status?: number; body: string; headers?: Record<string, string> };
export const fakeFetch = (handler: Handler) =>
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
    http: new HttpClient({
      fetch,
      sleep: async () => {},
      baseDelayMs: 1,
      minIntervalMs: {},
    }),
  };
};

describe("parseAppRef", () => {
  it.each([
    ["https://apps.apple.com/us/app/spotify/id324684580", "apple", "324684580"],
    ["id324684580", "apple", "324684580"],
    ["apple:com.spotify.client", "apple", "bundle:com.spotify.client"],
    [
      "https://play.google.com/store/apps/details?id=com.spotify.music&hl=en",
      "google",
      "com.spotify.music",
    ],
    ["com.spotify.music", "google", "com.spotify.music"],
  ])("%s", (input, store, id) => {
    expect(parseAppRef(input)).toEqual({ store, id });
  });

  it("rejects unknown references", () => {
    expect(() => parseAppRef("spotify")).toThrow(AppRefError);
    expect(() => parseAppRef("https://example.com/app")).toThrow(AppRefError);
  });
});

describe("Apple", () => {
  it("builds URLs", () => {
    expect(searchUrl("photo editor", "us", 50)).toBe(
      "https://itunes.apple.com/search?term=photo%20editor&entity=software&country=us&limit=50",
    );
    expect(lookupUrl(["1", "2"], "gb")).toBe(
      "https://itunes.apple.com/lookup?id=1,2&country=gb&entity=software",
    );
    expect(lookupUrl(["bundle:com.a", "bundle:com.b"], "us")).toContain(
      "bundleId=com.a,com.b",
    );
    expect(marketingChartUrl("de", "topPaid")).toBe(
      "https://rss.marketingtools.apple.com/api/v2/de/apps/top-paid/100/apps.json",
    );
    expect(marketingChartUrl("de", "topGrossing")).toBeNull();
    expect(legacyChartUrl("us", "topGrossing", "6014", 25)).toBe(
      "https://itunes.apple.com/us/rss/topgrossingapplications/limit=25/genre=6014/json",
    );
    expect(legacyChartUrl("us", "topFree", null, 10)).toBe(
      "https://itunes.apple.com/us/rss/topfreeapplications/limit=10/json",
    );
  });

  it("parses search results in rank order with full metadata", () => {
    const apps = parseResults(fixture("apple-search.json"), "us");
    expect(apps.map((a) => a.appId)).toEqual([
      "587366035",
      "998411110",
      "878783582",
    ]);
    const a = apps[0]!;
    expect(a).toMatchObject({
      store: "apple",
      bundleId: "com.picsart.studio",
      name: "Picsart AI Photo Editor, Video",
      developer: "PicsArt, Inc.",
      developerId: "587366038",
      developerUrl:
        "https://apps.apple.com/us/developer/picsart-inc/id587366038",
      url: "https://apps.apple.com/us/app/picsart-ai-photo-editor-video/id587366035",
      category: "Photo & Video",
      categoryId: "6008",
      price: 0,
      currency: "USD",
      free: true,
      contentRating: "12+",
      summary: null,
      installs: null,
    });
    expect(a.rating).toBeGreaterThan(4);
    expect(a.ratingCount).toBeGreaterThan(1000);
    expect(a.releaseDate).toBe("2013-01-02T22:14:40.000Z");
    expect(a.updatedDate).toMatch(/^2026-/);
    expect(a.sizeBytes).toBeGreaterThan(1e6);
    expect(a.languages).toContain("EN");
    expect(a.screenshots?.[0]).toMatch(/^https:\/\//);
    expect(a.genres).toEqual(["Photo & Video", "Graphics & Design"]);
  });

  it("always searches at the maximum limit", async () => {
    const { http, fetch } = client(() => ({
      body: fixture("apple-search.json"),
    }));
    const apps = await new AppleClient(http).search("photo editor", "us");
    expect(apps).toHaveLength(3);
    expect(fetch.mock.calls[0]![0]).toContain("&limit=200");
  });

  it("rejects HTML instead of JSON", () => {
    expect(() => parseResults("<html>", "us")).toThrow(/non-JSON/);
  });

  it("parses both chart feeds", () => {
    const m = parseMarketingChart(fixture("apple-chart.json"));
    expect(m.map((e) => [e.appId, e.name])).toEqual([
      ["6760173601", "Muse from Meta"],
      ["632064380", "Vinted: Pre-loved marketplace"],
      ["6448311069", "ChatGPT"],
    ]);
    const l = parseLegacyChart(fixture("apple-chart-legacy.json"));
    expect(l[0]).toMatchObject({
      appId: "1621328561",
      bundleId: "com.scopely.monopolygo",
      name: "MONOPOLY GO!",
      category: "Games",
      categoryId: "6014",
    });
    expect(l[0]!.iconUrl).toMatch(/100x100/);
    expect(l).toHaveLength(3);
  });

  it("enriches chart entries with /lookup and keeps unmatched ones", async () => {
    const { http, fetch } = client((url) => {
      if (url.includes("marketingtools"))
        return { body: fixture("apple-chart.json") };
      if (url.includes("/lookup")) {
        expect(url).toContain("id=6760173601,632064380,6448311069");
        return { body: fixture("apple-lookup.json") };
      }
      throw new Error(url);
    });
    const apps = await new AppleClient(http).chart("topFree", null, "us", 3);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(apps.map((a) => a.appId)).toEqual([
      "6760173601",
      "632064380",
      "6448311069",
    ]);
    // In the lookup fixture: full record.
    expect(apps[0]).toMatchObject({
      bundleId: "com.facebook.hatch",
      version: "10.0",
    });
    // Not in the lookup fixture: chart feed data only.
    expect(apps[1]).toMatchObject({
      name: "Vinted: Pre-loved marketplace",
      version: null,
      url: "https://apps.apple.com/us/app/vinted-pre-loved-marketplace/id632064380",
    });
  });

  it("falls back to the iTunes RSS feed when Marketing Tools fails", async () => {
    const log = vi.fn();
    const { http } = client((url) => {
      if (url.includes("marketingtools")) return { status: 404, body: "" };
      if (url.includes("/rss/"))
        return { body: fixture("apple-chart-legacy.json") };
      return { body: '{"resultCount":0,"results":[]}' };
    });
    const apps = await new AppleClient(http, log).chart(
      "topFree",
      null,
      "us",
      2,
    );
    expect(apps.map((a) => a.name)).toEqual(["MONOPOLY GO!", "Roblox"]);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/iTunes RSS/));
  });

  it("looks up numeric and bundle IDs", async () => {
    const urls: string[] = [];
    const { http } = client((url) => {
      urls.push(url);
      return { body: fixture("apple-lookup.json") };
    });
    const out = await new AppleClient(http).lookup(
      ["324684580", "bundle:com.facebook.hatch", "111"],
      "us",
    );
    expect(urls).toHaveLength(2);
    expect([...out.keys()]).toEqual(["324684580", "bundle:com.facebook.hatch"]);
    expect(out.get("bundle:com.facebook.hatch")?.appId).toBe("6760173601");
  });
});

describe("Google Play", () => {
  it("parses a free app's details page", () => {
    const a = parseDetails(
      fixture("google-details.html"),
      "com.spotify.music",
      "en",
      "us",
    )!;
    expect(a).toMatchObject({
      store: "google",
      appId: "com.spotify.music",
      bundleId: "com.spotify.music",
      name: "Spotify: Music and Podcasts",
      developer: "Spotify AB",
      developerId: "Spotify AB",
      developerUrl:
        "https://play.google.com/store/apps/developer?id=Spotify+AB",
      url: "https://play.google.com/store/apps/details?id=com.spotify.music&hl=en&gl=us",
      category: "Music & Audio",
      categoryId: "MUSIC_AND_AUDIO",
      price: 0,
      currency: "USD",
      free: true,
      containsAds: true,
      installs: "1,000,000,000+",
      minInstalls: 1000000000,
      contentRating: "Teen",
      releaseDate: "2014-05-27T13:12:17.000Z",
      version: null,
      website: "https://www.spotify.com",
      developerEmail: "support@spotify.com",
      privacyPolicyUrl: "https://www.spotify.com/legal/privacy-policy/",
      inAppPurchases: "$4.99 - $203.88 per item",
    });
    expect(a.rating).toBeCloseTo(4.35, 1);
    expect(a.ratingCount).toBeGreaterThan(1e7);
    expect(a.reviewCount).toBeGreaterThan(1e6);
    expect(a.ratingHistogram).toHaveLength(5);
    expect(a.updatedDate).toMatch(/^2026-10-/);
    expect(a.summary).toMatch(/^Listen to songs/);
    expect(a.description).not.toMatch(/<br>/);
    expect(a.iconUrl).toMatch(/^https:\/\/play-lh/);
    expect(a.screenshots).toHaveLength(2);
  });

  it("parses a paid app's price, version and Android version", () => {
    const a = parseDetails(
      fixture("google-details-paid.html"),
      "com.mojang.minecraftpe",
      "en",
      "us",
    )!;
    expect(a).toMatchObject({
      price: 6.99,
      currency: "USD",
      free: false,
      version: "1.26.52.3",
      minOsVersion: "8.0",
      containsAds: false,
      category: "Arcade",
    });
  });

  it("returns null for pages without app data", () => {
    expect(parseDetails("<html></html>", "a.b", "en", "us")).toBeNull();
  });

  it("converts description HTML to text", () => {
    expect(htmlToText("a<br>b &amp; c<b>d</b>&#39;")).toBe("a\nb & cd'");
    expect(htmlToText(null)).toBeNull();
  });

  it("builds the chart request", () => {
    const body = decodeURIComponent(
      chartBody("topGrossing", "GAME", 50).slice(6),
    );
    const outer = JSON.parse(body) as [[[string, string, null, string]]];
    expect(outer[0][0][0]).toBe("vyAe2");
    const inner = JSON.parse(outer[0][0][1]) as unknown[][];
    expect(JSON.stringify(inner[0]![1])).toContain("[8,[20,50]]");
    expect(inner[0]![2]).toEqual([2, "topgrossing", "GAME"]);
  });

  it("parses a chart response", async () => {
    const apps = parseChart(fixture("google-chart.txt"), "en", "us");
    expect(apps).toHaveLength(3);
    expect(apps[0]).toMatchObject({
      store: "google",
      appId: "com.mojang.minecraftpe",
      name: expect.stringMatching(/Minecraft/),
      developer: "Mojang",
      price: 6.99,
      currency: "USD",
      free: false,
      url: "https://play.google.com/store/apps/details?id=com.mojang.minecraftpe&hl=en&gl=us",
    });
    expect(apps[0]!.rating).toBeGreaterThan(3);
    expect(apps[0]!.installs).toMatch(/\+$/);
    expect(apps[0]!.iconUrl).toMatch(/^https:\/\/play-lh/);
  });

  it("posts the chart request and treats 404 details as not found", async () => {
    const { http, fetch } = client((url, init) => {
      if (url.includes("batchexecute")) {
        expect(init?.method).toBe("POST");
        expect(url).toContain("hl=de&gl=at");
        return { body: fixture("google-chart.txt") };
      }
      return { status: 404, body: "" };
    });
    const g = new GoogleClient(http);
    expect(await g.chart("topPaid", "GAME", "de", "at", 2)).toHaveLength(2);
    expect(await g.details("com.nope.app", "en", "us")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("HttpClient", () => {
  it("spaces requests to the same host", async () => {
    let now = 0;
    const sleeps: number[] = [];
    const fetch = fakeFetch(() => ({ body: "{}" }));
    const http = new HttpClient({
      fetch,
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
      },
      minIntervalMs: { "itunes.apple.com": 3000 },
    });
    await http.request({ url: "https://itunes.apple.com/a" });
    await http.request({ url: "https://itunes.apple.com/b" });
    await http.request({ url: "https://play.google.com/c" });
    expect(sleeps).toEqual([3000]);
  });

  it("retries Apple's rate-limit 403", async () => {
    let n = 0;
    const { http, fetch } = client(() =>
      ++n === 1 ? { status: 403, body: "" } : { body: "{}" },
    );
    expect(
      (await http.request({ url: "https://itunes.apple.com/x" })).text,
    ).toBe("{}");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("makeRow", () => {
  it("emits every schema field in order", () => {
    const row = makeRow(
      {
        type: "error",
        country: "us",
        language: null,
        scrapedAt: "x",
        error: "e",
      },
      null,
    );
    expect(Object.keys(row)).toEqual([...ROW_FIELDS]);
    expect(row.appId).toBeNull();
  });
});
