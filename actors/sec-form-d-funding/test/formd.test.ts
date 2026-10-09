import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EdgarClient,
  HttpError,
  searchUrl,
  toFilingRef,
  type FetchLike,
  type SearchParams,
  type SearchResponse,
} from "../src/edgar.js";
import { industryCategory, parseFormD, type FilingRef } from "../src/formd.js";
import {
  computeWindow,
  InputError,
  normalizeInput,
  stateParams,
} from "../src/input.js";
import { matches, runFeed } from "../src/run.js";
import { Seen, stateKey } from "../src/state.js";
import { parseXml, text } from "../src/xml.js";

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const search = JSON.parse(fixture("search.json")) as SearchResponse;
const ref = (
  accessionNumber: string,
  cik: string,
  formType = "D",
): FilingRef => ({
  accessionNumber,
  cik,
  formType,
  filingDate: "2026-10-08",
});
const NOW = new Date("2026-10-09T15:00:00Z");

describe("xml", () => {
  it("parses elements, entities, CDATA and self-closing tags", () => {
    const doc = parseXml(
      '<?xml version="1.0"?><!-- c --><a x="1"><b>A &amp; B &#38; &#x41;</b><c/><d><![CDATA[<raw>]]></d></a>',
    );
    expect(doc.name).toBe("a");
    expect(text(doc, "b")).toBe("A & B & A");
    expect(text(doc, "c")).toBeNull();
    expect(text(doc, "d")).toBe("<raw>");
    expect(() => parseXml("not xml")).toThrow();
  });
});

describe("parseFormD", () => {
  it("parses a new operating-company style filing", () => {
    const r = parseFormD(
      fixture("0002159635-26-000001.xml"),
      ref("0002159635-26-000001", "2159635"),
    );
    expect(r).toMatchObject({
      issuerName: "BCP Wildcat LP",
      cik: "2159635",
      formType: "D",
      filingDate: "2026-10-08",
      isAmendment: false,
      entityType: "Limited Partnership",
      yearOfIncorporation: 2026,
      incorporatedWithinFiveYears: true,
      stateOfIncorporation: "TEXAS",
      address: {
        street: "1608 W. 5TH STREET",
        street2: "SUITE 240",
        city: "AUSTIN",
        state: "TX",
        stateName: "TEXAS",
        zip: "78703",
      },
      phone: "512-692-6200",
      industryGroup: "Commercial",
      industryCategory: "Real Estate",
      securityTypes: ["Equity"],
      dateOfFirstSale: "2026-10-06",
      totalOfferingAmount: 9280683,
      offeringAmountIndefinite: false,
      totalAmountSold: 9280683,
      totalRemaining: 0,
      minimumInvestment: 25000,
      totalInvestors: 35,
      nonAccreditedInvestors: 0,
      salesCommissions: 0,
      findersFees: 0,
      exemptions: ["06b"],
      relatedPersons: [
        {
          name: "Keith Buchanan",
          roles: ["Executive Officer"],
          title: "Managing Member",
          city: "Austin",
          state: "TX",
        },
      ],
      salesRecipients: [],
      filingUrl:
        "https://www.sec.gov/Archives/edgar/data/2159635/000215963526000001/0002159635-26-000001-index.htm",
      xmlUrl:
        "https://www.sec.gov/Archives/edgar/data/2159635/000215963526000001/primary_doc.xml",
    });
  });

  it("parses indefinite offerings, middle names and sales recipients", () => {
    const r = parseFormD(
      fixture("0002159321-26-000001.xml"),
      ref("0002159321-26-000001", "2159321"),
    );
    expect(r.issuerName).toBe("WT Venture Fund LLC Series 1");
    expect(r.industryGroup).toBe("Pooled Investment Fund");
    expect(r.industryCategory).toBe("Banking & Financial Services");
    expect(r.totalOfferingAmount).toBeNull();
    expect(r.offeringAmountIndefinite).toBe(true);
    expect(r.totalAmountSold).toBe(1186871);
    expect(r.totalInvestors).toBe(14);
    expect(r.exemptions).toEqual(["06c", "3C", "3C.1"]);
    expect(r.relatedPersons[0]!.name).toBe("Daniel Joseph Rutledge");
    expect(r.salesRecipients).toEqual([
      {
        name: "TSG Capital Advisors",
        crdNumber: null,
        brokerDealer: "TSG Capital Advisors",
        brokerDealerCrd: "147509",
      },
    ]);
  });

  it("parses amendments and co-issuers", () => {
    const a = parseFormD(
      fixture("0002158132-26-000002.xml"),
      ref("0002158132-26-000002", "2158132", "D/A"),
    );
    expect(a.isAmendment).toBe(true);
    expect(a.formType).toBe("D/A");
    expect(a.previousAccessionNumber).toBe("0002158132-26-000001");
    expect(a.dateOfFirstSale).toBeNull();
    expect(a.totalOfferingAmount).toBe(24000000);

    const c = parseFormD(
      fixture("0002159119-26-000001.xml"),
      ref("0002159119-26-000001", "2159119"),
    );
    expect(c.issuerName).toBe(
      "Brookfield Real Estate Value Add Logistics Venture L.P.",
    );
    expect(c.otherIssuers).toEqual([
      "Brookfield Real Estate Value Add Logistics Venture B L.P.",
    ]);
  });

  it("rejects non-Form D documents", () => {
    expect(() =>
      parseFormD("<html><body/></html>", ref("0000000001-26-000001", "1")),
    ).toThrow(/Unexpected/);
  });

  it("maps industry groups to categories", () => {
    expect(industryCategory("Oil and Gas")).toBe("Energy");
    expect(industryCategory("Other Technology")).toBe("Technology");
    expect(industryCategory("Nope")).toBeNull();
    expect(industryCategory(null)).toBeNull();
  });
});

describe("input", () => {
  it("applies defaults and computes the window", () => {
    const i = normalizeInput({});
    expect(i).toMatchObject({
      lastNDays: 7,
      filingType: "both",
      maxResults: 100,
      onlyNew: false,
      excludeInvestmentFunds: false,
    });
    expect(computeWindow(i, NOW)).toEqual({
      from: "2026-10-03",
      to: "2026-10-09",
    });
    expect(
      computeWindow(normalizeInput({ startDate: "2026-09-01" }), NOW),
    ).toEqual({ from: "2026-09-01", to: "2026-10-09" });
    expect(
      computeWindow(
        normalizeInput({ endDate: "2026-09-30", lastNDays: 2 }),
        NOW,
      ),
    ).toEqual({ from: "2026-09-29", to: "2026-09-30" });
  });

  it("validates", () => {
    expect(() => normalizeInput({ states: ["California"] })).toThrow(
      InputError,
    );
    expect(() => normalizeInput({ industryGroups: ["Crypto"] })).toThrow(
      InputError,
    );
    expect(() => normalizeInput({ filingType: "x" })).toThrow(InputError);
    expect(() =>
      normalizeInput({ minOfferingAmount: 10, maxOfferingAmount: 5 }),
    ).toThrow(InputError);
    expect(() =>
      normalizeInput({ startDate: "2026-10-05", endDate: "2026-10-01" }),
    ).toThrow(InputError);
    expect(() => normalizeInput({ lastNDays: 0 })).toThrow(InputError);
    expect(() =>
      computeWindow(normalizeInput({ startDate: "2027-01-01" }), NOW),
    ).toThrow(InputError);
    expect(normalizeInput({ states: [" ca "] }).states).toEqual(["CA"]);
  });

  it("keys delta state by filters only, order-insensitively", () => {
    const a = normalizeInput({ states: ["CA", "NY"], lastNDays: 2 });
    const b = normalizeInput({ states: ["NY", "CA"], maxResults: 5 });
    const c = normalizeInput({ states: ["TX"] });
    expect(stateKey(stateParams(a))).toBe(stateKey(stateParams(b)));
    expect(stateKey(stateParams(a))).not.toBe(stateKey(stateParams(c)));
  });
});

describe("edgar", () => {
  it("builds search URLs", () => {
    const p: SearchParams = {
      date: "2026-10-08",
      forms: "D",
      states: ["CA", "TX"],
      from: 100,
    };
    const u = new URL(searchUrl(p));
    expect(u.origin + u.pathname).toBe(
      "https://efts.sec.gov/LATEST/search-index",
    );
    expect(Object.fromEntries(u.searchParams)).toEqual({
      forms: "D",
      dateRange: "custom",
      startdt: "2026-10-08",
      enddt: "2026-10-08",
      locationCodes: "CA,TX",
      from: "100",
    });
    expect(searchUrl({ ...p, states: [], from: 0 })).not.toMatch(
      /locationCodes|from=/,
    );
  });

  it("maps search hits to filing refs", () => {
    expect(search.hits.hits.map(toFilingRef)).toEqual([
      ref("0002159635-26-000001", "2159635"),
      ref("0002159321-26-000001", "2159321"),
      ref("0002159119-26-000001", "2159119"),
      ref("0002158132-26-000002", "2158132", "D/A"),
    ]);
    expect(
      toFilingRef({ _id: "0002159635-26-000001:ex99.htm", _source: {} }),
    ).toBeNull();
  });

  const response = (status: number, body = "", headers = {}) => ({
    ok: status < 400,
    status,
    headers: new Headers(headers),
    text: async () => body,
  });

  it("sends the declared User-Agent, rate-limits and retries 429/503", async () => {
    const calls: { url: string; ua: string; at: number }[] = [];
    let now = 0;
    const statuses = [429, 503, 200, 200];
    const fetch: FetchLike = async (url, init) => {
      calls.push({ url, ua: init.headers["user-agent"]!, at: now });
      return response(statuses.shift()!, "<x/>", { "retry-after": "2" });
    };
    const c = new EdgarClient({
      fetch,
      userAgent: "test-agent admin@example.com",
      now: () => now,
      sleep: async (ms) => void (now += ms),
    });
    await c.get("https://www.sec.gov/a", "*/*");
    await c.get("https://www.sec.gov/b", "*/*");
    expect(calls.map((c) => c.ua)).toEqual(
      Array(4).fill("test-agent admin@example.com"),
    );
    expect(calls.map((c) => c.at)).toEqual([0, 2000, 4000, 4125]);
    expect(c.requests).toBe(4);
  });

  it("does not retry 403/404", async () => {
    let n = 0;
    const c = new EdgarClient({
      fetch: async () => (n++, response(403, "denied")),
      sleep: async () => {},
    });
    await expect(c.get("https://www.sec.gov/x", "*/*")).rejects.toThrow(
      HttpError,
    );
    expect(n).toBe(1);
  });
});

describe("runFeed", () => {
  const docs: Record<string, string> = Object.fromEntries(
    [
      "0002159635-26-000001",
      "0002159321-26-000001",
      "0002159119-26-000001",
      "0002158132-26-000002",
    ].map((a) => [a, fixture(`${a}.xml`)]),
  );
  const window = { from: "2026-10-07", to: "2026-10-08" };

  const client = (failing = new Set<string>()) => {
    const searches: SearchParams[] = [];
    return {
      searches,
      search: async (p: SearchParams): Promise<SearchResponse> => {
        searches.push(p);
        return p.date === "2026-10-08"
          ? search
          : { hits: { total: { value: 0 }, hits: [] } };
      },
      primaryDoc: async (r: FilingRef) => {
        if (failing.has(r.accessionNumber)) throw new Error("boom");
        return docs[r.accessionNumber]!;
      },
    };
  };

  const collect = async (
    raw: Parameters<typeof normalizeInput>[0],
    opts: { seen?: Seen; failing?: Set<string> } = {},
  ) => {
    const out: string[] = [];
    const c = client(opts.failing);
    const stats = await runFeed(normalizeInput(raw), window, {
      client: c,
      seen: opts.seen,
      emit: async (r) => (out.push(r.accessionNumber), true),
    });
    return { out, stats, searches: c.searches };
  };

  it("walks days newest first and returns every filing", async () => {
    const { out, stats, searches } = await collect({ states: ["TX"] });
    expect(out).toEqual([
      "0002159635-26-000001",
      "0002159321-26-000001",
      "0002159119-26-000001",
      "0002158132-26-000002",
    ]);
    expect(searches.map((s) => [s.date, s.forms, s.states])).toEqual([
      ["2026-10-08", "D", ["TX"]],
      ["2026-10-07", "D", ["TX"]],
    ]);
    expect(stats).toMatchObject({
      emitted: 4,
      days: 2,
      stopReason: "exhausted",
    });
  });

  it("filters by filing type, industry, funds and amount", async () => {
    expect((await collect({ filingType: "new" })).out).toHaveLength(3);
    const am = await collect({ filingType: "amendment" });
    expect(am.searches[0]!.forms).toBe("D/A");
    expect((await collect({ excludeInvestmentFunds: true })).out).toEqual([
      "0002159635-26-000001",
    ]);
    expect((await collect({ industryGroups: ["Real Estate"] })).out).toEqual([
      "0002159635-26-000001",
    ]);
    // Indefinite counts as unlimited for min, is excluded by max.
    expect((await collect({ minOfferingAmount: 20_000_000 })).out).toContain(
      "0002159321-26-000001",
    );
    expect((await collect({ maxOfferingAmount: 10_000_000 })).out).toEqual([
      "0002159635-26-000001",
    ]);
  });

  it("stops at maxResults and on budget", async () => {
    const a = await collect({ maxResults: 2 });
    expect(a.out).toHaveLength(2);
    expect(a.stats.stopReason).toBe("maxResults");

    let n = 0;
    const stats = await runFeed(normalizeInput({}), window, {
      client: client(),
      emit: async () => ++n < 1,
    });
    expect(stats).toMatchObject({ emitted: 1, stopReason: "budget" });
  });

  it("skips filings seen in earlier runs (delta mode)", async () => {
    const seen = new Seen();
    seen.add("0002159635-26-000001");
    const { out, stats } = await collect({ onlyNew: true }, { seen });
    expect(out).not.toContain("0002159635-26-000001");
    expect(stats.skippedSeen).toBe(1);
    expect(seen.has("0002159321-26-000001")).toBe(true);
    const again = await collect({ onlyNew: true }, { seen });
    expect(again.out).toEqual([]);
  });

  it("skips filings that fail to download", async () => {
    const { out, stats } = await collect(
      {},
      { failing: new Set(["0002159321-26-000001"]) },
    );
    expect(out).toHaveLength(3);
    expect(stats.failed).toBe(1);
  });

  it("matches() treats unknown amounts as non-matching for amount filters", () => {
    const r = parseFormD(
      fixture("0002159635-26-000001.xml"),
      ref("0002159635-26-000001", "2159635"),
    );
    const input = normalizeInput({ minOfferingAmount: 1 });
    expect(matches(r, input)).toBe(true);
    expect(matches({ ...r, totalOfferingAmount: null }, input)).toBe(false);
  });
});
