import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  classify,
  HttpError,
  LumaClient,
  type FetchLike,
  type Page,
} from "../src/http.js";
import { InputError, normalizeInput } from "../src/input.js";
import {
  calendarItemsUrl,
  discoverUrl,
  mirrorToText,
  parseCoordinates,
  parseEntriesPage,
  parseEventDetail,
  parseResolved,
  parseSlug,
  toLocal,
  toResult,
  type EventResult,
} from "../src/luma.js";
import { mapLimit, runEvents, type ChargeEvent } from "../src/run.js";
import { Seen } from "../src/state.js";

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const P1 = fixture("discover-nyc-p1.json");
const P2 = fixture("discover-nyc-p2.json");
const SEARCH = fixture("search-ai-nyc.json");
const PLACE = fixture("url-place-nyc.json");
const CATEGORY = fixture("url-category-ai.json");
const CALENDAR = fixture("url-calendar-genai-sf.json");
const CAL_ITEMS = fixture("calendar-items.json");
const EVENT = fixture("url-event.json");
const EVENT_DETAIL = JSON.stringify(JSON.parse(EVENT).data);

const NOW = new Date("2026-10-17T00:00:00.000Z");

describe("URLs and slugs", () => {
  it("parses slugs from slugs and Luma URLs", () => {
    expect(parseSlug("nyc")).toBe("nyc");
    expect(parseSlug(" https://lu.ma/nyc ")).toBe("nyc");
    expect(parseSlug("https://luma.com/genai-sf?k=c#x")).toBe("genai-sf");
    expect(parseSlug("luma.com/craftnook-f70s/")).toBe("craftnook-f70s");
    expect(parseSlug("https://www.lu.ma/event/evt-BY6CUfvAuCM89l4")).toBe(
      "evt-BY6CUfvAuCM89l4",
    );
    expect(parseSlug("https://example.com/nyc")).toBeNull();
    expect(parseSlug("https://luma.com/a/b")).toBeNull();
    expect(parseSlug("new york")).toBeNull();
    expect(parseSlug("")).toBeNull();
  });

  it("parses coordinates", () => {
    expect(parseCoordinates("40.015,-105.27")).toEqual({
      latitude: 40.015,
      longitude: -105.27,
    });
    expect(parseCoordinates(" 51.5 , -0.12 ")).toEqual({
      latitude: 51.5,
      longitude: -0.12,
    });
    expect(parseCoordinates("91,0")).toBeNull();
    expect(parseCoordinates("nyc")).toBeNull();
  });

  it("builds API URLs", () => {
    const coordinates = { latitude: 40.7128, longitude: -74.006 };
    expect(discoverUrl({ coordinates })).toBe(
      "https://api.lu.ma/discover/get-paginated-events?latitude=40.7128&longitude=-74.006&pagination_limit=50",
    );
    expect(
      discoverUrl({
        coordinates,
        categoryId: "cat-ai",
        query: "agents & tools",
        cursor: "abc=",
      }),
    ).toBe(
      "https://api.lu.ma/discover/get-paginated-events?latitude=40.7128&longitude=-74.006&discover_category_api_id=cat-ai&query=agents+%26+tools&pagination_limit=50&pagination_cursor=abc%3D",
    );
    expect(
      calendarItemsUrl({ calendarId: "cal-1", period: "past", cursor: null }),
    ).toBe(
      "https://api.lu.ma/calendar/get-items?calendar_api_id=cal-1&period=past&pagination_limit=50",
    );
  });
});

describe("parsers", () => {
  it("parses listing pages", () => {
    const p = parseEntriesPage(P1)!;
    expect(p.entries).toHaveLength(4);
    expect(p.hasMore).toBe(true);
    expect(p.nextCursor).toBeTruthy();
    const last = parseEntriesPage(P2)!;
    expect(last.hasMore).toBe(false);
    expect(last.nextCursor).toBeNull();
    expect(parseEntriesPage("<html>")).toBeNull();
    expect(parseEntriesPage('{"message":"x"}')).toBeNull();
  });

  it("resolves places, categories, calendars and events", () => {
    const place = parseResolved("nyc", PLACE)!;
    expect(place).toMatchObject({ kind: "place", slug: "nyc" });
    if (place.kind !== "place") throw new Error();
    expect(place.latitude).toBeCloseTo(40.7, 0);
    expect(place.longitude).toBeCloseTo(-74, 0);
    expect(parseResolved("ai", CATEGORY)).toMatchObject({
      kind: "category",
      id: "cat-ai",
    });
    expect(parseResolved("genai-sf", CALENDAR)).toMatchObject({
      kind: "calendar",
      id: "cal-JTdFQadEz0AOxyV",
      slug: "genai-sf",
    });
    expect(parseResolved("craftnook-f70s", EVENT)).toMatchObject({
      kind: "event",
    });
    expect(
      parseResolved("x", '{"kind":"user","data":{"user":{}}}'),
    ).toMatchObject({ kind: "other", type: "user" });
    expect(parseResolved("x", "not json")).toBeNull();
  });

  it("parses event details", () => {
    expect(parseEventDetail(EVENT_DETAIL)).toBeTruthy();
    expect(parseEventDetail('{"event":{}}')).toBeNull();
  });

  it("converts ProseMirror descriptions to text", () => {
    expect(
      mirrorToText({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Hello " },
              { type: "text", text: "world", marks: [{ type: "bold" }] },
            ],
          },
          {
            type: "bullet_list",
            content: [
              {
                type: "list_item",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "a" }] },
                ],
              },
              {
                type: "list_item",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "b" }] },
                ],
              },
            ],
          },
          {
            type: "paragraph",
            content: [
              { type: "text", text: "line1" },
              { type: "hard_break" },
              { type: "text", text: "line2" },
            ],
          },
          { type: "paragraph" },
        ],
      }),
    ).toBe("Hello world\n\n- a\n\n- b\n\nline1\nline2");
    expect(mirrorToText(null)).toBeNull();
    expect(mirrorToText({ type: "doc", content: [] })).toBeNull();
  });

  it("converts UTC to local time", () => {
    expect(toLocal("2026-10-17T22:00:00.000Z", "America/New_York")).toBe(
      "2026-10-17T18:00:00",
    );
    expect(toLocal("2026-10-17T22:00:00.000Z", "Asia/Kolkata")).toBe(
      "2026-10-18T03:30:00",
    );
    expect(toLocal("2026-10-17T22:00:00.000Z", "Not/AZone")).toBeNull();
    expect(toLocal(null, "UTC")).toBeNull();
  });
});

describe("toResult", () => {
  const opts = {
    source: "city:nyc",
    scrapedAt: NOW.toISOString(),
    includeDetails: false,
  };

  it("maps a listing entry", () => {
    const e = parseEntriesPage(P1)!.entries[1]!;
    const r = toResult(e, null, opts);
    expect(r).toMatchObject({
      eventId: "evt-8B9O1EBFRmZsQVG",
      url: "https://luma.com/xt9dfpcx",
      timezone: "America/New_York",
      startUtc: "2026-10-16T16:00:00.000Z",
      startLocal: "2026-10-16T12:00:00",
      locationType: "offline",
      isOnline: false,
      venueCity: "New York",
      venueCountryCode: "US",
      isFree: true,
      priceMin: 0,
      priceMax: 0,
      guestCount: 83,
      hostNames: ["ANIQUEEN"],
      calendarName: "Aniqueen",
      source: "city:nyc",
    });
    expect(r.name).toBeTruthy();
    expect(r.latitude).toBeTypeOf("number");
    expect(r).not.toHaveProperty("description");
  });

  it("hides guests-only addresses and personal calendars", () => {
    const e = parseEntriesPage(P1)!.entries[0]!;
    const r = toResult(e, null, opts);
    expect(r.addressHidden).toBe(true);
    expect(r.venueAddress).toBeNull();
    expect(r.venueName).toBeNull();
    expect(r.venueCity).toBe("Brooklyn");
    const personal = parseEntriesPage(P1)!.entries[2]!;
    const p = toResult(personal, null, opts);
    expect(p.calendarName).toBeNull();
    expect(p.calendarUrl).toBeNull();
    expect(p.calendarId).toBeTruthy();
  });

  it("maps prices in cents to amounts", () => {
    const e = parseEntriesPage(P1)!.entries[3]!;
    const r = toResult(e, null, opts);
    expect(r.isFree).toBe(false);
    expect(r.priceMin).toBeTypeOf("number");
    expect(r.priceMax).toBeGreaterThanOrEqual(r.priceMin!);
    expect(r.currency).toBe("USD");
    const t = toResult(
      {
        event: { api_id: "evt-x", location_type: "online" },
        ticket_info: {
          price: { cents: 2500, currency: "usd", min_cents: 1000 },
          max_price: { cents: 4500, currency: "usd" },
          is_free: false,
          is_sold_out: true,
          require_approval: true,
        },
      },
      null,
      opts,
    );
    expect(t).toMatchObject({
      priceMin: 10,
      priceMax: 45,
      currency: "USD",
      isSoldOut: true,
      requiresApproval: true,
      isOnline: true,
      url: null,
    });
  });

  it("adds details: description, categories, ticket types", () => {
    const detail = JSON.parse(EVENT_DETAIL);
    const e = parseEntriesPage(P1)!.entries[0]!;
    const r = toResult(e, detail, { ...opts, includeDetails: true });
    expect(r.description).toBeTruthy();
    expect(r.categories).toEqual(["Arts & Culture"]);
    expect(r.ticketTypes).toEqual([
      { name: "free rsvp", price: 0, currency: null, type: "free" },
    ]);
    // Detail only (event start URL).
    const d = toResult(null, detail, { ...opts, includeDetails: true });
    expect(d.eventId).toBe("evt-BY6CUfvAuCM89l4");
    expect(d.hostNames).toEqual(["craftnook"]);
    // Details on but fetch failed.
    const f = toResult(e, null, { ...opts, includeDetails: true });
    expect(f.description).toBeNull();
    expect(f.categories).toEqual([]);
  });

  it("never outputs guest data", () => {
    const e = {
      ...parseEntriesPage(P1)!.entries[1]!,
      featured_guests: [{ name: "Guest Person" }],
    };
    expect(JSON.stringify(toResult(e, null, opts))).not.toContain(
      "Guest Person",
    );
  });
});

describe("input", () => {
  it("defaults to NYC with details", () => {
    expect(normalizeInput({})).toEqual({
      targets: [{ type: "city", slug: "nyc" }],
      category: null,
      keyword: null,
      calendarPeriod: "future",
      maxEvents: 20,
      includeDetails: true,
      onlyNew: false,
    });
  });

  it("parses cities, coordinates and start URLs; dedupes", () => {
    const n = normalizeInput({
      cities: ["sf", "https://luma.com/sf", "40.015,-105.27"],
      startUrls: [
        { url: "https://lu.ma/genai-sf" },
        "https://luma.com/genai-sf",
      ],
      category: "ai",
      keyword: " founders ",
      maxEvents: "100",
      includeDetails: false,
    });
    expect(n.targets).toEqual([
      { type: "city", slug: "sf" },
      { type: "coords", coordinates: { latitude: 40.015, longitude: -105.27 } },
      { type: "page", slug: "genai-sf" },
    ]);
    expect(n.category).toBe("ai");
    expect(n.keyword).toBe("founders");
    expect(n.maxEvents).toBe(100);
    expect(n.includeDetails).toBe(false);
  });

  it("start URLs alone don't add the default city", () => {
    expect(
      normalizeInput({ startUrls: ["https://luma.com/genai-sf"] }).targets,
    ).toEqual([{ type: "page", slug: "genai-sf" }]);
  });

  it("rejects bad input", () => {
    expect(() => normalizeInput({ cities: ["new york"] })).toThrow(InputError);
    expect(() => normalizeInput({ startUrls: ["https://x.com/a"] })).toThrow(
      /not a Luma page/,
    );
    expect(() => normalizeInput({ category: "music" })).toThrow(/category/);
    expect(() => normalizeInput({ keyword: "!!" })).toThrow(/keyword/);
    expect(() => normalizeInput({ maxEvents: 0 })).toThrow(/maxEvents/);
    expect(() => normalizeInput({ calendarPeriod: "all" })).toThrow(
      /calendarPeriod/,
    );
    expect(() => normalizeInput({ cities: [], startUrls: [] })).toThrow(
      /at least one/,
    );
  });
});

/** Fake API: routes by URL to fixtures. */
function fakeGet(overrides: Record<string, string | number> = {}) {
  const calls: string[] = [];
  const get = async (url: string): Promise<Page> => {
    calls.push(url);
    const u = new URL(url);
    const key =
      u.pathname === "/url"
        ? `url:${u.searchParams.get("url")}`
        : u.pathname === "/event/get"
          ? "event"
          : u.pathname === "/calendar/get-items"
            ? "calendar"
            : u.searchParams.get("query")
              ? "search"
              : u.searchParams.get("pagination_cursor")
                ? "p2"
                : "p1";
    const routes: Record<string, string | number> = {
      "url:nyc": PLACE,
      "url:ai": CATEGORY,
      "url:genai-sf": CALENDAR,
      "url:craftnook-f70s": EVENT,
      event: EVENT_DETAIL,
      calendar: CAL_ITEMS,
      search: SEARCH,
      p1: P1,
      p2: P2,
      ...overrides,
    };
    const r = routes[key] ?? 404;
    if (typeof r === "number") throw new HttpError(r, "{}", url);
    return { url, body: r };
  };
  return { get, calls };
}

async function run(
  raw: Parameters<typeof normalizeInput>[0],
  opts: {
    overrides?: Record<string, string | number>;
    seen?: Seen;
    budget?: number;
  } = {},
) {
  const f = fakeGet(opts.overrides);
  const out: EventResult[] = [];
  const charges: ChargeEvent[][] = [];
  const logs: string[] = [];
  const stats = await runEvents(normalizeInput(raw), {
    get: f.get,
    now: () => NOW,
    log: (m) => logs.push(m),
    seen: opts.seen,
    emit: async (item, events) => {
      out.push(item);
      charges.push(events);
      return opts.budget === undefined || out.length < opts.budget;
    },
  });
  return { out, charges, stats, logs, calls: f.calls };
}

describe("runEvents", () => {
  it("pages through a city, dedupes and fetches details", async () => {
    const r = await run({ cities: ["nyc"], maxEvents: 100 });
    // 4 on page 1, page 2 repeats one of them + 2 new.
    expect(r.out).toHaveLength(6);
    expect(r.stats.duplicates).toBe(1);
    expect(r.stats.pages).toBe(2);
    expect(r.stats.detailPages).toBe(6);
    expect(new Set(r.out.map((e) => e.eventId)).size).toBe(6);
    expect(r.charges.every((c) => c.join() === "event,event-detail")).toBe(
      true,
    );
    expect(r.out[0]!.source).toBe("city:nyc");
    expect(r.calls[1]).toContain("latitude=40.7");
    expect(r.stats.targets[0]).toMatchObject({ kind: "city", status: "done" });
  });

  it("stops at maxEvents without extra detail requests", async () => {
    const r = await run({ cities: ["nyc"], maxEvents: 2 });
    expect(r.out).toHaveLength(2);
    expect(r.stats.detailPages).toBe(2);
    expect(r.stats.stopReason).toBe("maxEvents");
  });

  it("stops at the budget", async () => {
    const r = await run({ cities: ["nyc"], maxEvents: 100 }, { budget: 3 });
    expect(r.out).toHaveLength(3);
    expect(r.stats.stopReason).toBe("budget");
  });

  it("listing only: no details, no detail charge", async () => {
    const r = await run({ cities: ["nyc"], includeDetails: false });
    expect(r.stats.detailPages).toBe(0);
    expect(r.charges.every((c) => c.join() === "event")).toBe(true);
    expect(r.out[0]).not.toHaveProperty("description");
  });

  it("keeps listing data when a detail request fails", async () => {
    const r = await run({ cities: ["nyc"] }, { overrides: { event: 500 } });
    expect(r.out).toHaveLength(6);
    expect(r.stats.detailErrors).toBe(6);
    expect(r.charges.every((c) => c.join() === "event")).toBe(true);
    expect(r.out[0]!.description).toBeNull();
  });

  it("applies category and keyword", async () => {
    const r = await run({
      cities: ["nyc"],
      category: "ai",
      keyword: "ai",
      includeDetails: false,
    });
    expect(r.calls[0]).toBe("https://api.lu.ma/url?url=ai");
    const search = r.calls.find((c) => c.includes("query=ai"))!;
    expect(search).toContain("discover_category_api_id=cat-ai");
    expect(r.out).toHaveLength(3);
  });

  it("searches around coordinates without resolving", async () => {
    const r = await run({ cities: ["40.015,-105.27"], includeDetails: false });
    expect(r.calls[0]).toContain("latitude=40.015&longitude=-105.27");
    expect(r.stats.targets[0]!.kind).toBe("coordinates");
  });

  it("lists calendars and single events from start URLs", async () => {
    const r = await run({
      startUrls: ["https://luma.com/genai-sf", "https://lu.ma/craftnook-f70s"],
      calendarPeriod: "past",
      maxEvents: 100,
    });
    expect(r.calls).toContain(
      "https://api.lu.ma/calendar/get-items?calendar_api_id=cal-JTdFQadEz0AOxyV&period=past&pagination_limit=50",
    );
    expect(r.out).toHaveLength(4);
    expect(r.out[0]!.source).toBe("calendar:genai-sf");
    const ev = r.out[3]!;
    expect(ev.source).toBe("event:craftnook-f70s");
    expect(ev.description).toBeTruthy();
    // Resolver already returned the details: no extra event request.
    expect(r.stats.detailPages).toBe(3);
    expect(r.charges[3]).toEqual(["event", "event-detail"]);
  });

  it("reports unknown and wrong-kind targets, keeps going", async () => {
    const r = await run({
      cities: ["nowhere", "genai-sf", "nyc"],
      startUrls: ["https://luma.com/ai"],
      includeDetails: false,
    });
    expect(r.stats.targets.map((t) => t.status)).toEqual([
      "notFound",
      "notFound",
      "done",
      "notFound",
    ]);
    expect(r.logs.join("\n")).toMatch(/No Luma page "nowhere"/);
    expect(r.logs.join("\n")).toMatch(/calendar, not a city/);
    expect(r.logs.join("\n")).toMatch(/Set category: "ai"/);
    expect(r.out).toHaveLength(6);
  });

  it("throws when every target fails", async () => {
    await expect(run({ cities: ["nowhere"] })).rejects.toThrow(
      /All targets failed/,
    );
    await expect(
      run({ cities: ["nyc"] }, { overrides: { p1: 503 } }),
    ).rejects.toThrow(/All targets failed/);
  });

  it("onlyNew skips events returned before", async () => {
    const seen = new Seen();
    const first = await run(
      { cities: ["nyc"], includeDetails: false },
      { seen },
    );
    expect(first.out).toHaveLength(6);
    const second = await run(
      { cities: ["nyc"], includeDetails: false },
      { seen },
    );
    expect(second.out).toHaveLength(0);
    expect(second.stats.skippedSeen).toBe(6);
    expect(second.stats.targets[0]!.status).toBe("done");
  });
});

describe("mapLimit", () => {
  it("keeps order and limits concurrency", async () => {
    let active = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 1));
      active -= 1;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBe(2);
  });
});

describe("LumaClient", () => {
  const ok = (body: string) => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => body,
  });
  const fail = (status: number) => ({
    ok: false,
    status,
    headers: { get: () => null },
    text: async () => "{}",
  });

  it("classifies errors", () => {
    expect(classify(new HttpError(429, "", ""))).toBe("blocked");
    expect(classify(new HttpError(503, "", ""))).toBe("transient");
    expect(classify(new HttpError(404, "", ""))).toBe("fatal");
    expect(classify(new Error("socket hang up"))).toBe("transient");
  });

  it("retries blocks and transient errors, not 404s", async () => {
    const fetch = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(fail(429))
      .mockResolvedValueOnce(fail(502))
      .mockResolvedValueOnce(ok('{"entries":[]}'));
    const c = new LumaClient({ fetch, sleep: async () => {} });
    expect((await c.get("https://api.lu.ma/x")).body).toBe('{"entries":[]}');
    expect(c.requests).toBe(3);
    expect(c.blocks).toBe(1);

    const nf = new LumaClient({
      fetch: vi.fn<FetchLike>().mockResolvedValue(fail(404)),
      sleep: async () => {},
    });
    await expect(nf.get("https://api.lu.ma/url?url=x")).rejects.toMatchObject({
      status: 404,
    });
    expect(nf.requests).toBe(1);
  });
});
