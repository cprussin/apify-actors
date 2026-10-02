import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  classify,
  HttpError,
  WellfoundClient,
  type FetchLike,
} from "../src/http.js";
import { InputError, normalizeInput } from "../src/input.js";
import { runJobs, toResult, type JobResult } from "../src/run.js";
import { Seen } from "../src/state.js";
import {
  companySize,
  isBlockPage,
  listingUrl,
  parseCompensation,
  parseListingPage,
  parseListingUrl,
  slugify,
  workplace,
} from "../src/wellfound.js";

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const SF = "software-engineer-san-francisco.html";
const SF2 = "software-engineer-san-francisco-p2.html";
const REMOTE = "data-analyst-remote.html";
const NY = "location-new-york.html";

describe("URLs", () => {
  it("builds listing URLs for every page type", () => {
    const s = { role: "software-engineer", location: "san-francisco" };
    expect(listingUrl(s)).toBe(
      "https://wellfound.com/role/l/software-engineer/san-francisco",
    );
    expect(listingUrl(s, 3)).toBe(
      "https://wellfound.com/role/l/software-engineer/san-francisco?page=3",
    );
    expect(listingUrl({ role: "data-analyst", location: "remote" })).toBe(
      "https://wellfound.com/role/r/data-analyst",
    );
    expect(listingUrl({ role: "data-analyst", location: null })).toBe(
      "https://wellfound.com/role/data-analyst",
    );
    expect(listingUrl({ role: null, location: "new-york" }, 2)).toBe(
      "https://wellfound.com/location/new-york?page=2",
    );
    expect(() => listingUrl({ role: null, location: "remote" })).toThrow();
  });

  it("parses listing URLs", () => {
    expect(
      parseListingUrl(
        "https://wellfound.com/role/l/software-engineer/san-francisco?page=4",
      ),
    ).toEqual({
      search: { role: "software-engineer", location: "san-francisco" },
      page: 4,
    });
    expect(parseListingUrl("wellfound.com/role/r/data-analyst/")).toEqual({
      search: { role: "data-analyst", location: "remote" },
      page: 1,
    });
    expect(parseListingUrl("https://wellfound.com/role/designer")).toEqual({
      search: { role: "designer", location: null },
      page: 1,
    });
    expect(parseListingUrl("https://wellfound.com/location/london")).toEqual({
      search: { role: null, location: "london" },
      page: 1,
    });
    expect(parseListingUrl("https://wellfound.com/jobs/123-x")).toBeNull();
    expect(parseListingUrl("https://example.com/role/x")).toBeNull();
  });

  it("slugifies names", () => {
    expect(slugify("San Francisco")).toBe("san-francisco");
    expect(slugify(" Software Engineer ")).toBe("software-engineer");
    expect(slugify("São Paulo")).toBe("sao-paulo");
  });
});

describe("compensation", () => {
  it.each([
    [
      "$160k – $200k • 0.5% – 1.0%",
      { salaryMin: 160000, salaryMax: 200000, salaryCurrency: "USD" },
      { equityMin: 0.5, equityMax: 1, hasEquity: true },
    ],
    [
      "$130k – $140k CAD",
      { salaryMin: 130000, salaryMax: 140000, salaryCurrency: "CAD" },
      { equityMin: null, equityMax: null, hasEquity: null },
    ],
    [
      "₹5L – ₹8L • No equity",
      { salaryMin: 500000, salaryMax: 800000, salaryCurrency: "INR" },
      { equityMin: null, equityMax: null, hasEquity: false },
    ],
    [
      "Up to $150k",
      { salaryMin: null, salaryMax: 150000, salaryCurrency: "USD" },
      { equityMin: null, equityMax: null, hasEquity: null },
    ],
    [
      "€60k – €80k",
      { salaryMin: 60000, salaryMax: 80000, salaryCurrency: "EUR" },
      { equityMin: null, equityMax: null, hasEquity: null },
    ],
    [
      "£1.2M – £1.5M • 0.0% – 0.3%",
      { salaryMin: 1200000, salaryMax: 1500000, salaryCurrency: "GBP" },
      { equityMin: 0, equityMax: 0.3, hasEquity: true },
    ],
    [
      "0.0% – 0.3%",
      { salaryMin: null, salaryMax: null, salaryCurrency: null },
      { equityMin: 0, equityMax: 0.3, hasEquity: true },
    ],
    [
      "",
      { salaryMin: null, salaryMax: null, salaryCurrency: null },
      { equityMin: null, equityMax: null, hasEquity: null },
    ],
  ])("parses %j", (raw, salary, equity) => {
    expect(parseCompensation(raw)).toEqual({ ...salary, ...equity });
  });
});

describe("parsing (fixtures)", () => {
  it("parses a role + location page", () => {
    const page = parseListingPage(fixture(SF))!;
    expect(page).toMatchObject({
      role: "software-engineer",
      location: "san-francisco",
      remote: false,
      page: 1,
      pageCount: 15,
      totalJobCount: 775,
      totalStartupCount: 285,
    });
    expect(page.jobs.length).toBe(46);
    expect(new Set(page.jobs.map((j) => j.startup.id)).size).toBe(20);
    const { job, startup } = page.jobs[0]!;
    const { description, ...item } = toResult(
      job,
      startup,
      { role: "software-engineer", location: "san-francisco" },
      "https://wellfound.com/role/l/software-engineer/san-francisco",
      "2026-10-01T00:00:00.000Z",
    );
    expect(description).toMatch(/Nextdoor/);
    expect(item).toEqual({
      jobId: "4692045",
      title: "Software Engineer",
      role: "Software Engineer",
      jobUrl: "https://wellfound.com/jobs/4692045-software-engineer",
      jobType: "full-time",
      postedAt: "2026-09-09T08:09:39.000Z",
      locations: ["San Francisco"],
      remote: false,
      workplace: "onsite",
      remoteLocations: [],
      compensation: "$185k – $210k",
      salaryMin: 185000,
      salaryMax: 210000,
      salaryCurrency: "USD",
      equityMin: null,
      equityMax: null,
      hasEquity: null,
      yearsExperienceMin: null,
      yearsExperienceMax: null,
      companyId: "50223",
      companyName: "Nextdoor",
      companySlug: "nextdoor",
      companyUrl: "https://wellfound.com/company/nextdoor",
      companyLogoUrl: expect.stringMatching(/^https:\/\/photos\.wellfound/),
      companySize: "501-1000",
      companyStage: "Public Stage",
      companyOneLiner:
        "Nextdoor is the private social network for your neighborhood",
      companyBadges: [
        "Actively Hiring",
        "B2C",
        "Top Investors",
        "Highly rated",
      ],
      searchRole: "software-engineer",
      searchLocation: "san-francisco",
      searchUrl: "https://wellfound.com/role/l/software-engineer/san-francisco",
      scrapedAt: "2026-10-01T00:00:00.000Z",
    });
  });

  it("parses every job into a complete item", () => {
    for (const f of [SF, SF2, REMOTE, NY]) {
      const page = parseListingPage(fixture(f))!;
      expect(page.jobs.length).toBeGreaterThan(30);
      for (const { job, startup } of page.jobs) {
        const r = toResult(job, startup, { role: "x", location: null }, "", "");
        expect(r.jobUrl).toMatch(/^https:\/\/wellfound\.com\/jobs\/\d+-/);
        expect(r.title).toBeTruthy();
        expect(r.companyName).toBeTruthy();
        expect(r.companyUrl).toMatch(/^https:\/\/wellfound\.com\/company\//);
        expect(r.postedAt).toMatch(/^20\d\d-/);
        if (r.salaryMax !== null)
          expect(r.salaryCurrency).toMatch(/^[A-Z]{3}$/);
      }
    }
  });

  it("parses a remote page", () => {
    const page = parseListingPage(fixture(REMOTE))!;
    expect(page).toMatchObject({
      role: "data-analyst",
      location: null,
      remote: true,
      pageCount: 10,
    });
    expect(page.jobs.every((j) => j.job.remote)).toBe(true);
    const r = page.jobs.find((j) => j.job.acceptedRemoteLocationNames?.length);
    expect(r).toBeDefined();
    expect(workplace(r!.job)).toBe("remote");
  });

  it("parses a location page and page 2", () => {
    expect(parseListingPage(fixture(NY))).toMatchObject({
      role: null,
      location: "new-york",
      pageCount: 50,
    });
    expect(parseListingPage(fixture(SF2))).toMatchObject({
      page: 2,
      pageCount: 15,
    });
  });

  it("omits the description when asked", () => {
    const { job, startup } = parseListingPage(fixture(SF))!.jobs[0]!;
    const r = toResult(
      job,
      startup,
      { role: "a", location: null },
      "",
      "",
      false,
    );
    expect("description" in r).toBe(false);
  });

  it("returns null for pages without job data", () => {
    expect(parseListingPage("<html><body>hi</body></html>")).toBeNull();
    expect(
      parseListingPage(
        '<script id="__NEXT_DATA__">{"props":{"pageProps":{}}}</script>',
      ),
    ).toBeNull();
  });

  it("maps company sizes", () => {
    expect(companySize("SIZE_1_10")).toBe("1-10");
    expect(companySize("SIZE_10001_PLUS")).toBe("10001+");
    expect(companySize(null)).toBeNull();
  });

  it("detects block pages", () => {
    expect(isBlockPage("<title>Just a moment...</title>")).toBe(true);
    expect(
      isBlockPage('<script src="https://geo.captcha-delivery.com/x">'),
    ).toBe(true);
    expect(isBlockPage(fixture(SF))).toBe(false);
  });
});

describe("input", () => {
  it("defaults to one small role + location", () => {
    expect(normalizeInput({})).toEqual({
      searches: [
        { role: "software-engineer", location: "san-francisco", startPage: 1 },
      ],
      maxJobs: 20,
      maxPages: 5,
      includeDescription: true,
      onlyNew: false,
    });
  });

  it("crosses roles and locations, normalizes names and dedupes", () => {
    const { searches } = normalizeInput({
      roles: ["Software Engineer", "product-manager"],
      locations: ["New York", "Remote"],
      startUrls: [
        { url: "https://wellfound.com/role/r/software-engineer?page=2" },
      ],
    });
    expect(searches).toEqual([
      { role: "software-engineer", location: "remote", startPage: 2 },
      { role: "software-engineer", location: "new-york", startPage: 1 },
      { role: "product-manager", location: "new-york", startPage: 1 },
      { role: "product-manager", location: "remote", startPage: 1 },
    ]);
  });

  it("uses only start URLs when given alone", () => {
    expect(
      normalizeInput({ startUrls: ["https://wellfound.com/location/london"] })
        .searches,
    ).toEqual([{ role: null, location: "london", startPage: 1 }]);
  });

  it("supports role-only and location-only searches", () => {
    expect(normalizeInput({ roles: ["designer"] }).searches).toEqual([
      { role: "designer", location: null, startPage: 1 },
    ]);
    expect(normalizeInput({ locations: ["austin"] }).searches).toEqual([
      { role: null, location: "austin", startPage: 1 },
    ]);
  });

  it("rejects bad input", () => {
    expect(() => normalizeInput({ locations: ["remote"] })).toThrow(InputError);
    expect(() =>
      normalizeInput({ startUrls: ["https://wellfound.com/jobs/1"] }),
    ).toThrow(InputError);
    expect(() => normalizeInput({ maxJobs: 0 })).toThrow(InputError);
    expect(() => normalizeInput({ maxPages: 101 })).toThrow(InputError);
  });
});

describe("run", () => {
  const pages: Record<string, string> = {
    "https://wellfound.com/role/l/software-engineer/san-francisco": fixture(SF),
    "https://wellfound.com/role/l/software-engineer/san-francisco?page=2":
      fixture(SF2),
    "https://wellfound.com/role/r/data-analyst": fixture(REMOTE),
  };
  const get = vi.fn(async (url: string) => {
    const html = pages[url];
    if (!html) throw new HttpError(404, "not found", url);
    return { url, html };
  });

  it("paginates, dedupes and stops at maxJobs", async () => {
    const out: JobResult[] = [];
    const stats = await runJobs(
      normalizeInput({
        roles: ["software-engineer"],
        locations: ["san-francisco"],
        maxJobs: 60,
      }),
      { get, emit: async (r) => (out.push(r), true) },
    );
    expect(out.length).toBe(60);
    expect(new Set(out.map((r) => r.jobId)).size).toBe(60);
    expect(stats).toMatchObject({
      pages: 2,
      emitted: 60,
      stopReason: "maxJobs",
    });
    expect(out[59]!.searchUrl).toMatch(/page=2$/);
  });

  it("onlyNew: skips (and doesn't charge) jobs returned before", async () => {
    const go = async (maxJobs: number, state: unknown) => {
      const seen = new Seen(state);
      const out: string[] = [];
      const stats = await runJobs(
        normalizeInput({
          roles: ["data-analyst"],
          locations: ["remote"],
          maxJobs,
          onlyNew: true,
        }),
        { get, seen, emit: async (r) => (out.push(r.jobId), true) },
      );
      return { out, stats, state: seen.toJSON() };
    };
    const r1 = await go(5, undefined);
    expect(r1.out).toHaveLength(5);
    const r2 = await go(5, r1.state);
    expect(r2.out).toHaveLength(5);
    expect(r2.out.some((id) => r1.out.includes(id))).toBe(false);
    expect(r2.stats.skippedSeen).toBe(5);
    const all = await go(1000, r2.state);
    const none = await go(1000, all.state);
    expect(none.out).toEqual([]);
    expect(none.stats.skippedSeen).toBeGreaterThan(0);
  });

  it("stops when the charge limit is reached", async () => {
    let n = 0;
    const stats = await runJobs(
      normalizeInput({ roles: ["data-analyst"], locations: ["remote"] }),
      { get, emit: async () => ++n < 3 },
    );
    expect(n).toBe(3);
    expect(stats).toMatchObject({ emitted: 3, stopReason: "budget" });
  });

  it("fails a search that was redirected to another page", async () => {
    const logs: string[] = [];
    const redirect = async (_url: string) => ({
      url: "https://wellfound.com/location/san-francisco",
      html: fixture(NY),
    });
    await expect(
      runJobs(normalizeInput({ roles: ["nope"], locations: ["x"] }), {
        get: redirect,
        emit: async () => true,
        log: (m) => logs.push(m),
      }),
    ).rejects.toThrow(/All searches failed: .*no listing page for nope @ x/);
  });

  it("keeps going when one search fails", async () => {
    const out: JobResult[] = [];
    const logs: string[] = [];
    const stats = await runJobs(
      normalizeInput({
        startUrls: [
          "https://wellfound.com/role/r/designer",
          "https://wellfound.com/role/r/data-analyst",
        ],
        maxPages: 1,
        maxJobs: 1000,
      }),
      { get, emit: async (r) => (out.push(r), true), log: (m) => logs.push(m) },
    );
    expect(out.length).toBe(32);
    expect(stats.searches.map((s) => s.status)).toEqual(["failed", "done"]);
    expect(logs[0]).toMatch(/HTTP 404/);
  });
});

describe("http client", () => {
  const ok = (body: string) => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => body,
  });
  const status = (s: number, body = "") => ({
    ok: false,
    status: s,
    headers: { get: () => null },
    text: async () => body,
  });

  it("classifies failures", () => {
    expect(classify(new HttpError(403, "", ""))).toBe("blocked");
    expect(classify(new HttpError(429, "", ""))).toBe("blocked");
    expect(classify(new HttpError(503, "", ""))).toBe("transient");
    expect(classify(new HttpError(404, "", ""))).toBe("fatal");
    expect(classify(new Error("ECONNRESET"))).toBe("transient");
  });

  it("rotates the session on blocks and captchas", async () => {
    const responses = [
      status(403),
      ok("<title>Just a moment...</title>"),
      ok("fine"),
    ];
    const fetch = vi.fn(async () => responses.shift()!) as unknown as FetchLike;
    const rotate = vi.fn();
    const client = new WellfoundClient({
      fetch,
      rotate,
      sleep: async () => {},
    });
    expect((await client.get("https://wellfound.com/x")).html).toBe("fine");
    expect(rotate).toHaveBeenCalledTimes(2);
    expect(client.blocks).toBe(2);
  });

  it("falls back to direct when the proxy keeps failing", async () => {
    const primary = vi.fn(async () => {
      throw new Error("proxy timeout");
    }) as unknown as FetchLike;
    const fallback = vi.fn(async () => ok("direct")) as unknown as FetchLike;
    const client = new WellfoundClient({
      fetch: primary,
      fallbackFetch: fallback,
      sleep: async () => {},
    });
    expect((await client.get("https://wellfound.com/x")).html).toBe("direct");
    expect(primary).toHaveBeenCalledTimes(2);
    expect(client.route).toBe("fallback");
  });

  it("does not retry 404", async () => {
    const fetch = vi.fn(async () => status(404)) as unknown as FetchLike;
    const client = new WellfoundClient({ fetch, sleep: async () => {} });
    await expect(client.get("https://wellfound.com/x")).rejects.toThrow(
      /HTTP 404/,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
