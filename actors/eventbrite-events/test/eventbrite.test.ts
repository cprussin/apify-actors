import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  eventIdFromUrl,
  extractWindowJson,
  htmlToText,
  isBlockPage,
  localDateTime,
  localToUtc,
  locationSlug,
  pageUrl,
  parseEventPage,
  parseSearchPage,
  parseStartUrl,
  searchPath,
  tagNames,
} from "../src/eventbrite.js";
import {
  classify,
  EventbriteClient,
  HttpError,
  type FetchLike,
} from "../src/http.js";
import { InputError, normalizeInput } from "../src/input.js";
import { mapLimit, runEvents, toResult, type EventResult } from "../src/run.js";
import { Seen } from "../src/state.js";

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const NY = "ny-new-york-all-events.html";
const NY2 = "ny-new-york-all-events-p2.html";
const MUSIC = "ny-new-york-music-this-weekend.html";
const IN_PERSON = "event-in-person.html";
const ONLINE = "event-online.html";
const SERIES = "event-series.html";

const NY_URL = "https://www.eventbrite.com/d/ny--new-york/all-events/";
const EVENT_URL =
  "https://www.eventbrite.com/e/friday-night-lights-at-mama-taco-everyone-free-b4-12am-wrsvp-tickets-1990839672051";

describe("URLs", () => {
  it("builds search paths from filters", () => {
    const f = { location: "ny--new-york", category: null, date: null };
    expect(searchPath({ ...f, keyword: null })).toBe(
      "/d/ny--new-york/all-events/",
    );
    expect(
      searchPath({
        ...f,
        category: "music",
        date: "this-weekend",
        keyword: null,
      }),
    ).toBe("/d/ny--new-york/music--events--this-weekend/");
    expect(searchPath({ ...f, category: "business", keyword: null })).toBe(
      "/d/ny--new-york/business--events/",
    );
    expect(searchPath({ ...f, date: "today", keyword: null })).toBe(
      "/d/ny--new-york/events--today/",
    );
    expect(searchPath({ ...f, keyword: "Wine Tasting" })).toBe(
      "/d/ny--new-york/wine-tasting/",
    );
    expect(
      searchPath({ ...f, category: "food-and-drink", keyword: "wine" }),
    ).toBe("/d/ny--new-york/food-and-drink--events/wine/");
    expect(pageUrl(NY_URL, 1)).toBe(NY_URL);
    expect(pageUrl(NY_URL, 3)).toBe(`${NY_URL}?page=3`);
  });

  it("normalizes location slugs", () => {
    expect(locationSlug("ny--new-york")).toBe("ny--new-york");
    expect(locationSlug(" NY--New York ")).toBe("ny--new-york");
    expect(locationSlug("United Kingdom--London")).toBe(
      "united-kingdom--london",
    );
    expect(locationSlug("online")).toBe("online");
  });

  it("parses start URLs", () => {
    expect(
      parseStartUrl(
        "https://www.eventbrite.com/d/ny--new-york/music--events--this-weekend/?page=2&x=1",
      ),
    ).toEqual({
      kind: "search",
      url: "https://www.eventbrite.com/d/ny--new-york/music--events--this-weekend/",
      page: 2,
    });
    expect(
      parseStartUrl("eventbrite.co.uk/d/united-kingdom--london/jazz"),
    ).toEqual({
      kind: "search",
      url: "https://www.eventbrite.co.uk/d/united-kingdom--london/jazz/",
      page: 1,
    });
    expect(parseStartUrl(`${EVENT_URL}?aff=ebdssbdestsearch`)).toEqual({
      kind: "event",
      url: EVENT_URL,
      id: "1990839672051",
    });
    expect(
      parseStartUrl("https://www.eventbrite.com/o/someone-123"),
    ).toBeNull();
    expect(
      parseStartUrl("https://example.com/d/ny--new-york/events/"),
    ).toBeNull();
    expect(eventIdFromUrl(EVENT_URL)).toBe("1990839672051");
    expect(eventIdFromUrl("not a url")).toBeNull();
  });
});

describe("helpers", () => {
  it("extracts window JSON followed by more script", () => {
    const html =
      '<script>window.__SERVER_DATA__ = {"a":"}{\\"","b":{"c":[1]}};\nwindow.x = {};</script>';
    expect(extractWindowJson(html, "__SERVER_DATA__")).toEqual({
      a: '}{"',
      b: { c: [1] },
    });
    expect(extractWindowJson("<p>none</p>", "__SERVER_DATA__")).toBeNull();
  });

  it("converts local times to UTC across DST", () => {
    expect(localToUtc("2026-10-02T20:00:00", "America/New_York")).toBe(
      "2026-10-03T00:00:00.000Z",
    );
    expect(localToUtc("2027-01-15T20:00:00", "America/New_York")).toBe(
      "2027-01-16T01:00:00.000Z",
    );
    expect(localToUtc("2026-10-07T09:00:00", "Europe/Berlin")).toBe(
      "2026-10-07T07:00:00.000Z",
    );
    expect(localToUtc("2026-10-07", "Europe/Berlin")).toBeNull();
    expect(localToUtc("2026-10-07T09:00:00", "Not/AZone")).toBeNull();
    expect(localDateTime("2026-10-02", "20:00")).toBe("2026-10-02T20:00:00");
    expect(localDateTime("2026-10-02", null)).toBe("2026-10-02");
  });

  it("turns description HTML into text", () => {
    expect(
      htmlToText(
        "<p>Line <b>one</b></p><p><br></p><p>Two&nbsp;here</p><ul><li>a</li><li>b</li></ul>",
      ),
    ).toBe("Line one\n\nTwo here\n- a\n- b");
  });

  it("dedupes tag names by prefix", () => {
    const tags = [
      { prefix: "OrganizerTag", display_name: "Jazz" },
      { prefix: "EventbriteCategory", display_name: "Music" },
      { prefix: "OrganizerTag", display_name: "Jazz" },
      { prefix: "OrganizerTag", display_name: "Live" },
    ];
    expect(tagNames(tags, "OrganizerTag")).toEqual(["Jazz", "Live"]);
    expect(tagNames(null, "OrganizerTag")).toEqual([]);
  });

  it("detects block pages", () => {
    expect(isBlockPage("<title>Human Verification</title>")).toBe(true);
    expect(isBlockPage("<script>window.awsWafCookieDomainList = [];")).toBe(
      true,
    );
    expect(isBlockPage('<html lang="en">\n<!-- WAF -->\n<title>Whoops!')).toBe(
      true,
    );
    expect(isBlockPage(fixture(NY))).toBe(false);
    expect(isBlockPage(fixture(IN_PERSON))).toBe(false);
  });

  it("maps with a concurrency limit, keeping order", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 3, 2, 4], 2, async (n) => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, n));
      inFlight--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 30, 20, 40]);
    expect(peak).toBe(2);
  });
});

describe("parsing (fixtures)", () => {
  it("parses a search page", () => {
    const page = parseSearchPage(fixture(NY))!;
    expect(page).toMatchObject({ page: 1, pageCount: 49, totalEvents: 10000 });
    expect(page.events.length).toBe(20);
    expect(page.query).toMatchObject({ places: ["85977539"], page: 1 });
    expect(parseSearchPage(fixture(NY2))).toMatchObject({ page: 2 });
  });

  it("parses a category + date search page", () => {
    const page = parseSearchPage(fixture(MUSIC))!;
    expect(page.query).toMatchObject({
      dates: ["current_future", "this_weekend"],
      tags: ["EventbriteCategory/103"],
    });
    for (const e of page.events)
      expect(tagNames(e.tags, "EventbriteCategory")).toEqual(["Music"]);
  });

  it("builds a complete item from search data and the event page", () => {
    const ev = parseSearchPage(fixture(NY))!.events[0]!;
    const d = parseEventPage(fixture(IN_PERSON))!;
    const { description, ...item } = toResult(ev, d, {
      searchUrl: NY_URL,
      scrapedAt: "2026-10-01T00:00:00.000Z",
      includeDetails: true,
    });
    expect(description).toMatch(/^FRIDAY, OCTOBER 2ND \| 8PM - 4AM\n/);
    expect(item).toEqual({
      eventId: "1990839672051",
      name: "Friday Night Lights at Mama Taco Everyone FREE B4 12am w/RSVP",
      url: EVENT_URL,
      startDate: "2026-10-02T20:00:00",
      endDate: "2026-10-03T04:00:00",
      timezone: "America/New_York",
      startUtc: "2026-10-03T00:00:00.000Z",
      endUtc: "2026-10-03T08:00:00.000Z",
      isOnline: false,
      venueName: "MAMATACO",
      venueAddress: "880 Flushing Avenue, Brooklyn, NY 11206",
      venueCity: "Brooklyn",
      venueRegion: "NY",
      venuePostalCode: "11206",
      venueCountry: "US",
      latitude: 40.7018895,
      longitude: -73.936578,
      organizerId: "5494940201",
      organizerName: "JiggyTime Ent",
      organizerUrl: "https://www.eventbrite.com/o/jiggytime-ent-5494940201",
      isFree: false,
      priceMin: 0,
      priceMax: 55.2,
      currency: "USD",
      salesStatus: "on_sale",
      category: "Music",
      subcategory: "Hip Hop / Rap",
      format: "Party or Social Gathering",
      tags: [
        "Reggae",
        "Afrobeats",
        "Reggaeton",
        "Juneteenth",
        "Dancehall",
        "Randb",
        "Nycnightlife",
        "Socamusic",
        "Hiphopevents",
      ],
      imageUrl: expect.stringMatching(/^https:\/\/img\.evbuc\.com\//),
      summary:
        "Kick off your weekend with free entry before midnight when you RSVP for the ultimate Friday night bash!",
      isCancelled: false,
      seriesId: null,
      publishedAt: "2026-06-02T05:10:10Z",
      searchUrl: NY_URL,
      scrapedAt: "2026-10-01T00:00:00.000Z",
    });
  });

  it("builds items from search data alone", () => {
    for (const f of [NY, NY2, MUSIC]) {
      for (const ev of parseSearchPage(fixture(f))!.events) {
        const r = toResult(ev, null, {
          searchUrl: "",
          scrapedAt: "",
          includeDetails: false,
        });
        expect("description" in r).toBe(false);
        expect(r.eventId).toMatch(/^\d+$/);
        expect(r.name).toBeTruthy();
        expect(r.url).toMatch(/^https:\/\/www\.eventbrite\.[a-z.]+\/e\//);
        expect(r.startDate).toMatch(/^20\d\d-\d\d-\d\dT\d\d:\d\d:00$/);
        expect(r.startUtc).toMatch(/Z$/);
        expect(r.timezone).toMatch(/\//);
        expect(r.format ?? r.category).toBeTruthy();
        expect(r.organizerId).toMatch(/^\d+$/);
        if (!r.isOnline) expect(r.venueName).toBeTruthy();
        expect(r.organizerName).toBeNull();
        expect(r.priceMax).toBeNull();
      }
    }
  });

  it("parses an online event page", () => {
    const r = toResult(null, parseEventPage(fixture(ONLINE)), {
      searchUrl: null,
      scrapedAt: "",
      includeDetails: true,
    });
    expect(r).toMatchObject({
      eventId: "1978395029791",
      isOnline: true,
      venueName: null,
      venueAddress: null,
      timezone: "Europe/Berlin",
      startDate: "2026-10-07T09:00:00",
      startUtc: "2026-10-07T07:00:00.000Z",
      organizerName: "Humana Akademie",
      priceMin: 30,
      priceMax: 40,
      currency: "EUR",
      isFree: false,
      category: "Business",
      format: "Seminar",
      tags: [],
    });
    expect(r.description).toMatch(/^VON DER VORSORGE/);
  });

  it("parses a series event page", () => {
    const d = parseEventPage(fixture(SERIES))!;
    expect(d).toMatchObject({
      seriesId: "74499918261",
      venueName: "Blue Heron Boathouse",
      venueAddress: "50 Blue Heron Drive, San Francisco, CA 94118",
      latitude: 37.77084,
      priceMin: 8,
      priceMax: 38.77,
      subcategory: "Blues & Jazz",
    });
  });

  it("falls back to JSON-LD when the page has no Next.js data", () => {
    const ld =
      /<script type="application\/ld\+json"[^>]*>\{"@context":"https:\/\/schema\.org","@type":"SocialEvent"[\s\S]*?<\/script>/.exec(
        fixture(IN_PERSON),
      )![0];
    expect(parseEventPage(`<html><head>${ld}</head></html>`)).toMatchObject({
      name: "Friday Night Lights at Mama Taco Everyone FREE B4 12am w/RSVP",
      startUtc: "2026-10-03T00:00:00.000Z",
      organizerName: "JiggyTime Ent",
      priceMin: 0,
      priceMax: 55.2,
      currency: "USD",
      isFree: false,
      isOnline: false,
      venueName: "MAMATACO",
    });
  });

  it("returns null for pages without event data", () => {
    expect(parseSearchPage("<html><body>hi</body></html>")).toBeNull();
    expect(parseSearchPage(fixture(IN_PERSON))).toBeNull();
    expect(parseEventPage("<html><body>hi</body></html>")).toBeNull();
  });
});

describe("input", () => {
  it("defaults to one small city", () => {
    expect(normalizeInput({})).toEqual({
      searches: [{ url: NY_URL, startPage: 1, location: "ny--new-york" }],
      eventUrls: [],
      maxEvents: 20,
      includeDetails: true,
      onlyNew: false,
    });
  });

  it("applies filters to every location and dedupes", () => {
    const r = normalizeInput({
      locations: ["ca--san-francisco", "TX--Austin", "ca--san-francisco"],
      category: "music",
      dateFilter: "this-weekend",
      keyword: "jazz",
      startUrls: [
        { url: "https://www.eventbrite.com/d/online/all-events/?page=2" },
        EVENT_URL,
        `${EVENT_URL}/`,
      ],
      includeDetails: false,
    });
    expect(r.searches).toEqual([
      {
        url: "https://www.eventbrite.com/d/online/all-events/",
        startPage: 2,
        location: null,
      },
      {
        url: "https://www.eventbrite.com/d/ca--san-francisco/music--events--this-weekend/jazz/",
        startPage: 1,
        location: "ca--san-francisco",
      },
      {
        url: "https://www.eventbrite.com/d/tx--austin/music--events--this-weekend/jazz/",
        startPage: 1,
        location: "tx--austin",
      },
    ]);
    expect(r.eventUrls).toEqual([EVENT_URL]);
    expect(r.includeDetails).toBe(false);
  });

  it("uses only start URLs when given alone", () => {
    expect(normalizeInput({ startUrls: [EVENT_URL] })).toMatchObject({
      searches: [],
      eventUrls: [EVENT_URL],
    });
  });

  it("treats 'any' as no filter", () => {
    expect(
      normalizeInput({ category: "any", dateFilter: "any", keyword: " " })
        .searches[0]!.url,
    ).toBe(NY_URL);
  });

  it("rejects bad input", () => {
    expect(() => normalizeInput({ category: "bogus" })).toThrow(InputError);
    expect(() => normalizeInput({ dateFilter: "yesterday" })).toThrow(
      InputError,
    );
    expect(() =>
      normalizeInput({ startUrls: ["https://www.eventbrite.com/o/x-1"] }),
    ).toThrow(InputError);
    expect(() => normalizeInput({ locations: [NY_URL] })).toThrow(InputError);
    expect(() => normalizeInput({ maxEvents: 0 })).toThrow(InputError);
    expect(() => normalizeInput({ maxEvents: 10001 })).toThrow(InputError);
  });
});

describe("run", () => {
  const pages: Record<string, string> = {
    [NY_URL]: fixture(NY),
    [`${NY_URL}?page=2`]: fixture(NY2),
    "https://www.eventbrite.com/d/ny--new-york/music--events--this-weekend/":
      fixture(MUSIC),
    [EVENT_URL]: fixture(IN_PERSON),
  };
  const get = vi.fn(async (url: string) => {
    const html = pages[url];
    if (!html) throw new HttpError(404, "not found", url);
    return { url, html };
  });

  it("paginates, dedupes and stops at maxEvents", async () => {
    const out: EventResult[] = [];
    const stats = await runEvents(
      normalizeInput({ maxEvents: 30, includeDetails: false }),
      { get, emit: async (r) => (out.push(r), true) },
    );
    expect(out.length).toBe(30);
    expect(new Set(out.map((r) => r.eventId)).size).toBe(30);
    expect(stats).toMatchObject({
      pages: 2,
      detailPages: 0,
      emitted: 30,
      stopReason: "maxEvents",
    });
    expect(out[29]!.searchUrl).toMatch(/page=2$/);
  });

  it("fetches event pages and keeps search data when one fails", async () => {
    const out: EventResult[] = [];
    const logs: string[] = [];
    const stats = await runEvents(normalizeInput({ maxEvents: 3 }), {
      get,
      emit: async (r) => (out.push(r), true),
      log: (m) => logs.push(m),
    });
    expect(out.length).toBe(3);
    expect(out[0]).toMatchObject({
      organizerName: "JiggyTime Ent",
      priceMax: 55.2,
    });
    expect(out[0]!.description).toMatch(/FRIDAY/);
    // No fixture for the other event pages: search data only.
    expect(out[1]).toMatchObject({
      name: "New York Fashion Week FEB 2027",
      organizerName: null,
      description: null,
    });
    expect(stats).toMatchObject({ detailPages: 3, detailErrors: 2 });
    expect(logs[0]).toMatch(/keeping search data only/);
  });

  it("stops when the charge limit is reached", async () => {
    let n = 0;
    const stats = await runEvents(
      normalizeInput({ maxEvents: 100, includeDetails: false }),
      { get, emit: async () => ++n < 3 },
    );
    expect(n).toBe(3);
    expect(stats).toMatchObject({ emitted: 3, stopReason: "budget" });
  });

  it("scrapes event URLs first and skips them in searches", async () => {
    const out: EventResult[] = [];
    await runEvents(
      normalizeInput({
        startUrls: [EVENT_URL, NY_URL],
        maxEvents: 5,
        includeDetails: false,
      }),
      { get, emit: async (r) => (out.push(r), true) },
    );
    expect(out[0]).toMatchObject({
      eventId: "1990839672051",
      organizerName: "JiggyTime Ent",
      searchUrl: null,
    });
    expect(out.filter((r) => r.eventId === "1990839672051").length).toBe(1);
    expect(out.length).toBe(5);
  });

  it("keeps going when one search fails, fails when all do", async () => {
    const out: EventResult[] = [];
    const logs: string[] = [];
    const stats = await runEvents(
      normalizeInput({
        locations: ["xx--nowhere", "ny--new-york"],
        category: "music",
        dateFilter: "this-weekend",
        maxEvents: 5,
        includeDetails: false,
      }),
      { get, emit: async (r) => (out.push(r), true), log: (m) => logs.push(m) },
    );
    expect(out.length).toBe(5);
    expect(stats.searches.map((s) => s.status)).toEqual(["failed", "done"]);
    expect(logs[0]).toMatch(/HTTP 404/);

    await expect(
      runEvents(normalizeInput({ locations: ["xx--nowhere"] }), {
        get,
        emit: async () => true,
      }),
    ).rejects.toThrow(/All searches failed/);
  });

  it("onlyNew: skips (and doesn't charge) events returned by earlier runs", async () => {
    const go = async (maxEvents: number, state: unknown) => {
      const seen = new Seen(state);
      const out: string[] = [];
      const stats = await runEvents(
        normalizeInput({ maxEvents, includeDetails: false, onlyNew: true }),
        { get, seen, emit: async (r) => (out.push(r.eventId), true) },
      );
      return { out, stats, state: seen.toJSON() };
    };
    const r1 = await go(5, undefined);
    expect(r1.out).toHaveLength(5);
    const r2 = await go(5, r1.state);
    expect(r2.out).toHaveLength(5);
    expect(r2.out.some((id) => r1.out.includes(id))).toBe(false);
    expect(r2.stats.skippedSeen).toBe(5);
    // Everything known: no output and no error.
    const all = await go(1000, r2.state);
    const none = await go(1000, all.state);
    expect(none.out).toEqual([]);
    expect(none.stats.skippedSeen).toBeGreaterThan(0);
  });

  it("reports pages without search data", async () => {
    await expect(
      runEvents(normalizeInput({}), {
        get: async (url) => ({ url, html: "<html></html>" }),
        emit: async () => true,
      }),
    ).rejects.toThrow(/Not an Eventbrite search page/);
    await expect(
      runEvents(normalizeInput({}), {
        get: async (url) => ({
          url,
          html: "<title>Human Verification</title>",
        }),
        emit: async () => true,
      }),
    ).rejects.toThrow(/Blocked by Eventbrite/);
  });
});

describe("http", () => {
  const res = (status: number, body: string) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => body,
  });

  it("classifies errors", () => {
    expect(classify(new HttpError(405, "", ""))).toBe("blocked");
    expect(classify(new HttpError(429, "", ""))).toBe("blocked");
    expect(classify(new HttpError(503, "", ""))).toBe("transient");
    expect(classify(new HttpError(404, "", ""))).toBe("fatal");
    expect(classify(new Error("ETIMEDOUT"))).toBe("transient");
  });

  it("rotates sessions on WAF challenges and retries", async () => {
    const bodies = [
      res(405, "<title>Human Verification</title>"),
      res(200, "<title>Human Verification</title>"),
      res(200, "<html>ok</html>"),
    ];
    const fetch: FetchLike = vi.fn(async () => bodies.shift()!);
    let rotations = 0;
    const client = new EventbriteClient({
      fetch,
      rotate: () => rotations++,
      sleep: async () => {},
    });
    const page = await client.get(NY_URL);
    expect(page.html).toBe("<html>ok</html>");
    expect(client.blocks).toBe(2);
    expect(rotations).toBe(2);
  });

  it("falls back to direct requests when the proxy keeps failing", async () => {
    const proxy: FetchLike = vi.fn(async () => {
      throw new Error("proxy timeout");
    });
    const direct: FetchLike = vi.fn(async () => res(200, "direct"));
    const client = new EventbriteClient({
      fetch: proxy,
      fallbackFetch: direct,
      sleep: async () => {},
    });
    expect((await client.get(NY_URL)).html).toBe("direct");
    expect(client.route).toBe("fallback");
  });

  it("does not retry 404s", async () => {
    const fetch: FetchLike = vi.fn(async () => res(404, "gone"));
    const client = new EventbriteClient({ fetch, sleep: async () => {} });
    await expect(client.get(EVENT_URL)).rejects.toThrow(/HTTP 404/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
