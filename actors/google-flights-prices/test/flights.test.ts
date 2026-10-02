import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  buildTfs,
  extractBlobs,
  formatDuration,
  hasFlightsPage,
  localTime,
  parseItineraries,
  searchUrl,
  tokenCurrency,
  type Search,
} from "../src/flights.js";
import {
  classify,
  FlightsClient,
  HttpError,
  isBlockPage,
  type FetchLike,
} from "../src/http.js";
import {
  InputError,
  normalizeInput,
  parseDate,
  parseRouteString,
} from "../src/input.js";
import {
  itineraryKey,
  runFlights,
  toResults,
  type FlightResult,
} from "../src/run.js";
import { Seen } from "../src/state.js";

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const NOW = new Date("2026-09-30T15:00:00Z");
const S: Search = {
  origin: "JFK",
  destination: "LHR",
  date: "2026-11-15",
  returnDate: null,
  adults: 1,
  cabin: "economy",
  maxStops: null,
  currency: "USD",
  gl: "us",
  hl: "en",
};

describe("search URL", () => {
  it("encodes the tfs protobuf like Google Flights", () => {
    // Verified live: returns JFK -> LHR one way on 2026-11-15.
    expect(buildTfs(S)).toBe(
      "GhoSCjIwMjYtMTEtMTVqBRIDSkZLcgUSA0xIUkABSAGYAQI=",
    );
    expect(
      buildTfs({
        ...S,
        returnDate: "2026-11-22",
        adults: 2,
        cabin: "business",
      }),
    ).toBe(
      "GhoSCjIwMjYtMTEtMTVqBRIDSkZLcgUSA0xIUhoaEgoyMDI2LTExLTIyagUSA0xIUnIFEgNKRktAAUABSAOYAQE=",
    );
    // max stops is field 5 of each leg.
    const b = Buffer.from(buildTfs({ ...S, maxStops: 0 }), "base64");
    expect([...b.subarray(2, 16)]).toEqual([
      0x12,
      10,
      ...Buffer.from("2026-11-15"),
      0x28,
      0,
    ]);
  });

  it("builds the search URL with locale params", () => {
    const u = new URL(searchUrl({ ...S, currency: "EUR", gl: "de", hl: "de" }));
    expect(u.origin + u.pathname).toBe(
      "https://www.google.com/travel/flights/search",
    );
    expect(u.searchParams.get("tfs")).toBe(buildTfs(S));
    expect(u.searchParams.get("curr")).toBe("EUR");
    expect(u.searchParams.get("gl")).toBe("de");
    expect(u.searchParams.get("hl")).toBe("de");
  });
});

describe("parsing (fixtures)", () => {
  it("extracts the embedded ds: blobs", () => {
    const blobs = extractBlobs(fixture("jfk-lhr-oneway.html"));
    expect([...blobs.keys()].sort()).toEqual([
      "ds:0",
      "ds:1",
      "ds:2",
      "ds:3",
      "ds:4",
    ]);
    expect(
      extractBlobs(
        'x AF_initDataCallback({key: \'ds:9\', data:["a]b", {"c": [1]}], y',
      ),
    ).toEqual(new Map([["ds:9", ["a]b", { c: [1] }]]]));
  });

  it("parses a one-way search", () => {
    const { itineraries, totalOther } = parseItineraries(
      fixture("jfk-lhr-oneway.html"),
    );
    expect(itineraries.length).toBe(23);
    expect(totalOther).toBe(74);
    expect(itineraries.filter((i) => i.isBest).length).toBe(5);
    expect(itineraries[0]).toEqual({
      price: 295,
      currency: "USD",
      isBest: true,
      airlines: ["Virgin Atlantic"],
      flightNumbers: ["VS26"],
      departureAirport: "JFK",
      arrivalAirport: "LHR",
      departureTime: "2026-11-15T08:00",
      arrivalTime: "2026-11-15T20:10",
      durationMinutes: 430,
      stops: 0,
      layovers: [],
      legs: [
        {
          flightNumber: "VS26",
          airline: "Virgin Atlantic",
          airlineCode: "VS",
          from: "JFK",
          fromName: "John F. Kennedy International Airport",
          to: "LHR",
          toName: "Heathrow Airport",
          departureTime: "2026-11-15T08:00",
          arrivalTime: "2026-11-15T20:10",
          durationMinutes: 430,
          aircraft: "Airbus A330-900neo",
          legroom: "31 in",
        },
      ],
      emissionsKg: 365,
      typicalEmissionsKg: 431,
      emissionsDiffPercent: -15,
    });
    const oneStop = itineraries.find((i) => i.stops === 1)!;
    expect(oneStop).toMatchObject({
      price: 291,
      flightNumbers: ["FI614", "FI450"],
      arrivalTime: "2026-11-16T10:50",
      layovers: [
        {
          airport: "KEF",
          airportName: "Keflavík International Airport",
          city: "Reykjavík",
          durationMinutes: 85,
        },
      ],
    });
    // Emissions missing for this flight.
    expect(
      itineraries.find((i) => i.flightNumbers[0] === "VS46"),
    ).toMatchObject({ emissionsKg: null, emissionsDiffPercent: null });
  });

  it("parses a round-trip business search in EUR", () => {
    const { itineraries } = parseItineraries(
      fixture("jfk-lhr-roundtrip-business-eur.html"),
    );
    expect(itineraries.length).toBe(20);
    expect(itineraries.every((i) => i.currency === "EUR")).toBe(true);
    expect(Math.min(...itineraries.map((i) => i.price!))).toBe(6257);
    // Hour 0 is omitted by Google: [null, 20] = 00:20.
    const tk = itineraries.find((i) => i.flightNumbers[0] === "TK12")!;
    expect(tk.departureTime).toBe("2026-11-15T00:20");
    expect(tk.layovers[0]?.airport).toBe("IST");
  });

  it("parses multi-day itineraries", () => {
    const { itineraries } = parseItineraries(fixture("lax-nrt-oneway.html"));
    expect(itineraries.length).toBe(8);
    const pr = itineraries.find((i) => i.airlines[0] === "Philippine Airlines");
    expect(pr).toMatchObject({
      departureTime: "2026-11-10T22:10",
      arrivalTime: "2026-11-12T12:50",
      stops: 1,
    });
  });

  it("returns nothing for unknown airports", () => {
    const html = fixture("no-results.html");
    expect(hasFlightsPage(html)).toBe(true);
    expect(parseItineraries(html).itineraries).toEqual([]);
    expect(hasFlightsPage("<html>nope</html>")).toBe(false);
  });

  it("helpers", () => {
    expect(localTime([2026, 1, 5], [7])).toBe("2026-01-05T07:00");
    expect(localTime([2026, 1, 5], null)).toBe("2026-01-05");
    expect(localTime(null, [7])).toBe(null);
    expect(formatDuration(430)).toBe("7h 10m");
    expect(formatDuration(120)).toBe("2h");
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(null)).toBe(null);
    expect(tokenCurrency("not base64 !!")).toBe(null);
    expect(tokenCurrency(null)).toBe(null);
  });
});

describe("input", () => {
  it("parses absolute and relative dates", () => {
    expect(parseDate("2026-11-15", "date", NOW)).toBe("2026-11-15");
    expect(parseDate("+30", "date", NOW)).toBe("2026-10-30");
    expect(parseDate("3", "date", NOW)).toBe("2026-10-03");
    expect(parseDate("", "date", NOW, 30)).toBe("2026-10-30");
    expect(parseDate("", "date", NOW)).toBe(null);
    expect(() => parseDate("2026-02-30", "date", NOW)).toThrow(InputError);
    expect(() => parseDate("15/11/2026", "date", NOW)).toThrow(InputError);
  });

  it("parses route strings", () => {
    expect(parseRouteString("jfk-lhr 2026-11-15 2026-11-22")).toEqual({
      origin: "jfk",
      destination: "lhr",
      date: "2026-11-15",
      returnDate: "2026-11-22",
    });
    expect(parseRouteString("JFK LHR")).toMatchObject({
      origin: "JFK",
      destination: "LHR",
      date: undefined,
    });
    expect(() => parseRouteString("New York to London")).toThrow(InputError);
  });

  it("defaults to one route ~30 days out", () => {
    const n = normalizeInput(undefined, NOW);
    expect(n.maxItineraries).toBe(10);
    expect(n.searches).toEqual([
      {
        origin: "JFK",
        destination: "LHR",
        date: "2026-10-30",
        returnDate: null,
        adults: 1,
        cabin: "economy",
        maxStops: null,
        currency: "USD",
        gl: "us",
        hl: "en",
      },
    ]);
    // The input schema default is the same.
    const schema = JSON.parse(fixtureSchema()) as {
      properties: { routes: { default: unknown } };
    };
    expect(
      normalizeInput({ routes: schema.properties.routes.default as never }, NOW)
        .searches[0]?.date,
    ).toBe("2026-10-30");
  });

  it("expands date ranges and round trips", () => {
    const n = normalizeInput(
      {
        routes: [
          {
            origin: "lax",
            destination: "nrt",
            dateFrom: "2026-11-01",
            dateTo: "2026-11-03",
            stayDays: 7,
          },
          {
            origin: "JFK",
            destination: "LHR",
            date: "+10",
            returnDate: "2026-10-20",
          },
          "SFO-CDG 2026-12-01",
        ],
        adults: "2",
        cabinClass: "premium economy",
        maxStops: "0",
        currency: "eur",
        country: "DE",
        language: "de",
        maxItineraries: 5,
      },
      NOW,
    );
    expect(
      n.searches.map(
        (s) => `${s.origin}-${s.destination} ${s.date} ${s.returnDate}`,
      ),
    ).toEqual([
      "LAX-NRT 2026-11-01 2026-11-08",
      "LAX-NRT 2026-11-02 2026-11-09",
      "LAX-NRT 2026-11-03 2026-11-10",
      "JFK-LHR 2026-10-10 2026-10-20",
      "SFO-CDG 2026-12-01 null",
    ]);
    expect(n.searches[0]).toMatchObject({
      adults: 2,
      cabin: "premiumEconomy",
      maxStops: 0,
      currency: "EUR",
      gl: "de",
      hl: "de",
    });
    expect(n.maxItineraries).toBe(5);
  });

  it("rejects bad input", () => {
    const bad = (raw: object) => () => normalizeInput(raw, NOW);
    expect(bad({ routes: [] })).toThrow(/at least one route/);
    expect(bad({ routes: [{ origin: "JFKX", destination: "LHR" }] })).toThrow(
      /IATA/,
    );
    expect(bad({ routes: [{ origin: "JFK", destination: "jfk" }] })).toThrow(
      /same/,
    );
    expect(
      bad({
        routes: [{ origin: "JFK", destination: "LHR", date: "2026-01-01" }],
      }),
    ).toThrow(/in the past/);
    expect(
      bad({
        routes: [{ origin: "JFK", destination: "LHR", dateFrom: "2026-11-01" }],
      }),
    ).toThrow(/both dateFrom and dateTo/);
    expect(
      bad({
        routes: [
          {
            origin: "JFK",
            destination: "LHR",
            dateFrom: "+1",
            dateTo: "+300",
          },
        ],
      }),
    ).toThrow(/at most 180 days/);
    expect(
      bad({
        routes: [
          {
            origin: "JFK",
            destination: "LHR",
            date: "2026-11-15",
            returnDate: "2026-11-10",
          },
        ],
      }),
    ).toThrow(/before the departure/);
    expect(bad({ adults: 0 })).toThrow(/adults/);
    expect(bad({ cabinClass: "coach" })).toThrow(/cabinClass/);
    expect(bad({ maxStops: "5" })).toThrow(/maxStops/);
    expect(bad({ currency: "dollars" })).toThrow(/currency/);
    expect(bad({ maxItineraries: 0 })).toThrow(/maxItineraries/);
  });
});

function fixtureSchema(): string {
  return readFileSync(
    new URL("../.actor/input_schema.json", import.meta.url),
    "utf8",
  );
}

describe("run", () => {
  const html = fixture("jfk-lhr-oneway.html");

  it("emits up to maxItineraries per search with flags and URL", async () => {
    const out: FlightResult[] = [];
    const stats = await runFlights(
      { searches: [S], maxItineraries: 6, onlyNew: false },
      {
        get: async () => html,
        emit: async (i) => (out.push(i), true),
        now: () => NOW,
      },
    );
    expect(stats).toEqual({
      searches: 1,
      emitted: 6,
      skippedSeen: 0,
      empty: [],
      failed: [],
      stopReason: "done",
    });
    expect(out.map((i) => i.rank)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(out[0]).toMatchObject({
      route: "JFK-LHR",
      tripType: "oneWay",
      departureDate: "2026-11-15",
      returnDate: null,
      price: 295,
      currency: "USD",
      isBest: true,
      isCheapest: false,
      duration: "7h 10m",
      layoverAirports: [],
      searchUrl: searchUrl(S),
      scrapedAt: NOW.toISOString(),
    });
    // Cheapest (291, Icelandair) is the first "other" flight.
    expect(out[5]).toMatchObject({
      isBest: false,
      isCheapest: true,
      price: 291,
      layoverAirports: ["KEF"],
    });
  });

  it("marks the cheapest even when it is not emitted", () => {
    const { itineraries } = parseItineraries(html);
    const r = toResults(S, itineraries, 2, NOW.toISOString());
    expect(r.length).toBe(2);
    expect(r.some((i) => i.isCheapest)).toBe(false);
  });

  it("onlyNew: emits only new itineraries and price changes", async () => {
    const go = async (page: string, state: unknown) => {
      const seen = new Seen(state);
      const out: FlightResult[] = [];
      const stats = await runFlights(
        { searches: [S], maxItineraries: 6, onlyNew: true },
        { get: async () => page, seen, emit: async (i) => (out.push(i), true) },
      );
      return { out, stats, state: seen.toJSON() };
    };
    const r1 = await go(html, undefined);
    expect(r1.out).toHaveLength(6);
    expect(new Set(r1.out.map(itineraryKey)).size).toBe(6);

    const r2 = await go(html, r1.state);
    expect(r2.out).toEqual([]);
    expect(r2.stats).toMatchObject({ skippedSeen: 6, emitted: 0 });

    // Same flights, those at 295 re-priced to 279: only they are returned.
    const repriced = await go(html.replace(/\b295\b/g, "279"), r2.state);
    const was295 = r1.out.filter((i) => i.price === 295).map(itineraryKey);
    expect(was295.length).toBeGreaterThan(0);
    expect(repriced.out.map(itineraryKey)).toEqual(was295);
    expect(repriced.out.every((i) => i.price === 279)).toBe(true);
    expect(repriced.stats.skippedSeen).toBe(6 - was295.length);
  });

  it("stops when the charge limit is reached", async () => {
    let n = 0;
    const stats = await runFlights(
      {
        searches: [S, { ...S, date: "2026-11-16" }],
        maxItineraries: 10,
        onlyNew: false,
      },
      { get: async () => html, emit: async () => ++n < 3 },
    );
    expect(stats.emitted).toBe(3);
    expect(stats.stopReason).toBe("budget");
  });

  it("skips empty and failed searches, fails only if all fail", async () => {
    const logs: string[] = [];
    const get = vi.fn(async (url: string) => {
      if (url === searchUrl({ ...S, destination: "XXX" }))
        return fixture("no-results.html");
      if (url === searchUrl({ ...S, destination: "CDG" }))
        throw new Error("boom");
      return html;
    });
    const stats = await runFlights(
      {
        searches: [
          { ...S, destination: "XXX" },
          { ...S, destination: "CDG" },
          S,
        ],
        maxItineraries: 1,
        onlyNew: false,
      },
      { get, emit: async () => true, log: (m) => logs.push(m) },
    );
    expect(stats.emitted).toBe(1);
    expect(stats.empty).toEqual(["JFK-XXX 2026-11-15"]);
    expect(stats.failed).toEqual([
      { search: "JFK-CDG 2026-11-15", error: "boom" },
    ]);
    expect(logs.length).toBe(2);

    await expect(
      runFlights(
        { searches: [S], maxItineraries: 1, onlyNew: false },
        { get: async () => "<html>blocked</html>", emit: async () => true },
      ),
    ).rejects.toThrow(/All searches failed: Unexpected page/);
  });
});

describe("http", () => {
  type Reply = { status?: number; body: string; url?: string };
  const fakeFetch = (replies: Reply[]) =>
    vi.fn(async (url: string) => {
      const r = replies.shift() ?? { body: "ok" };
      const status = r.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        url: r.url ?? url,
        headers: { get: () => null },
        text: async () => r.body,
      };
    });

  it("detects captcha and consent pages", () => {
    expect(isBlockPage("https://www.google.com/sorry/index?x", "")).toBe(true);
    expect(isBlockPage("https://consent.google.com/ml?continue=x", "")).toBe(
      true,
    );
    expect(
      isBlockPage(undefined, "Our systems have detected unusual traffic"),
    ).toBe(true);
    expect(isBlockPage("https://www.google.com/travel/flights", "<html>")).toBe(
      false,
    );
  });

  it("classifies errors", () => {
    expect(classify(new HttpError(429, "", ""))).toBe("blocked");
    expect(classify(new HttpError(503, "", ""))).toBe("transient");
    expect(classify(new HttpError(404, "", ""))).toBe("fatal");
    expect(classify(new Error("ECONNRESET"))).toBe("transient");
  });

  it("retries blocks with a new session and sends the consent cookie", async () => {
    const fetch = fakeFetch([
      { status: 429, body: "slow down" },
      { body: "x", url: "https://www.google.com/sorry/index" },
      { body: "flights" },
    ]);
    const rotate = vi.fn();
    const c = new FlightsClient({
      fetch: fetch as unknown as FetchLike,
      rotate,
      sleep: async () => {},
    });
    expect(await c.get("https://www.google.com/travel/flights/search")).toBe(
      "flights",
    );
    expect(rotate).toHaveBeenCalledTimes(2);
    expect(c.blocks).toBe(2);
    const headers = (
      fetch.mock.calls[0] as unknown as [
        string,
        { headers: Record<string, string> },
      ]
    )[1].headers;
    expect(headers.cookie).toMatch(/^SOCS=/);
  });

  it("falls back to direct after repeated proxy errors", async () => {
    const primary = fakeFetch([
      { status: 502, body: "" },
      { status: 502, body: "" },
    ]);
    const direct = fakeFetch([{ body: "direct" }]);
    const c = new FlightsClient({
      fetch: primary as unknown as FetchLike,
      fallbackFetch: direct as unknown as FetchLike,
      sleep: async () => {},
    });
    expect(await c.get("u")).toBe("direct");
    expect(c.route).toBe("fallback");
  });

  it("does not retry fatal errors and caps retries", async () => {
    const c = new FlightsClient({
      fetch: fakeFetch([{ status: 404, body: "" }]) as unknown as FetchLike,
      sleep: async () => {},
    });
    await expect(c.get("u")).rejects.toThrow(/HTTP 404/);
    const d = new FlightsClient({
      fetch: fakeFetch(
        Array.from({ length: 10 }, () => ({ status: 503, body: "" })),
      ) as unknown as FetchLike,
      maxRetries: 2,
      sleep: async () => {},
    });
    await expect(d.get("u")).rejects.toThrow(/HTTP 503/);
    expect(d.requests).toBe(3);
  });
});
