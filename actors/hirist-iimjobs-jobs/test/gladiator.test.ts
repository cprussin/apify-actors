import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  detailUrl,
  htmlToText,
  jobCompany,
  jobLocations,
  jobSalary,
  locationId,
  parseDetailResponse,
  parseSearchResponse,
  searchUrl,
  snippet,
  type RawJob,
  type Search,
  type Site,
} from "../src/gladiator.js";
import {
  classify,
  GladiatorClient,
  HttpError,
  type FetchLike,
} from "../src/http.js";
import { InputError, normalizeInput } from "../src/input.js";
import { runJobs, toResult, type JobResult } from "../src/run.js";
import { Seen } from "../src/state.js";

// Recorded with `npm run smoke -w actors/hirist-iimjobs-jobs -- --record`.
const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const PY = "hirist-python-bangalore.json";
const PY2 = "hirist-python-bangalore-p2.json";
const NONE = "hirist-no-results.json";
const MK = "iimjobs-marketing.json";
const HD = "hirist-detail.json";
const ID = "iimjobs-detail.json";

const jobs = (name: string): RawJob[] =>
  parseSearchResponse(fixture(name))!.jobs;
const job = (name: string, id: number) => jobs(name).find((j) => j.id === id)!;

const search = (
  site: Site,
  query: string,
  locationIds: number[] = [],
): Search => ({
  site,
  query,
  locationIds,
  minExperience: null,
  maxExperience: null,
});
const PY_SEARCH = search("hirist", "python developer", [3]);
const MK_SEARCH = search("iimjobs", "marketing manager");

describe("URLs", () => {
  it("builds API URLs", () => {
    expect(searchUrl(PY_SEARCH)).toBe(
      "https://gladiator.hirist.tech/job/search?query=python+developer&size=50&page=0&loc=3",
    );
    expect(
      searchUrl(
        {
          site: "iimjobs",
          query: "marketing",
          locationIds: [3, 7],
          minExperience: 2,
          maxExperience: 5,
        },
        2,
      ),
    ).toBe(
      "https://gladiator.iimjobs.com/job/search?query=marketing&size=50&page=2&loc=3%2C7&minexp=2&maxexp=5",
    );
    expect(detailUrl("hirist", "1675600")).toBe(
      "https://gladiator.hirist.tech/job/detail?jobcode=1675600",
    );
  });

  it("maps location names to IDs", () => {
    expect(locationId("Bengaluru")).toBe(3);
    expect(locationId(" delhi  NCR ")).toBe(1);
    expect(locationId("Gurugram")).toBe(37);
    expect(locationId("Remote")).toBe(132);
    expect(locationId("137")).toBe(137);
    expect(locationId("Atlantis")).toBeNull();
  });
});

describe("parsing (fixtures)", () => {
  it("parses search pages", () => {
    const page = parseSearchResponse(fixture(PY))!;
    expect(page.total).toBe(858);
    expect(page.jobs).toHaveLength(50);
    expect(page.hasMore).toBe(true);
    expect(parseSearchResponse(fixture(NONE))).toEqual({
      jobs: [],
      total: 0,
      hasMore: false,
    });
    expect(parseSearchResponse(fixture(MK))!.total).toBe(4295);
  });

  it("rejects non-API responses", () => {
    expect(parseSearchResponse("<html>blocked</html>")).toBeNull();
    expect(parseSearchResponse('{"error":"x"}')).toBeNull();
    expect(
      parseDetailResponse(
        '{"error":{"statusCode":404,"name":"JOB_NOT_FOUND"}}',
      ),
    ).toBeNull();
  });

  it("maps a Hirist job with salary into a complete item", () => {
    const r = toResult(
      job(PY, 1668247),
      "1668247",
      PY_SEARCH,
      "2026-10-04T00:00:00.000Z",
    );
    expect(r).toMatchObject({
      jobId: "1668247",
      site: "hirist",
      company: "Assiduus Global",
      locations: ["Bangalore"],
      remote: false,
      salaryMin: 2000000,
      salaryMax: 3000000,
      salaryCurrency: "INR",
      applyUrl: null,
      descriptionSnippet: null,
      searchQuery: "python developer",
      scrapedAt: "2026-10-04T00:00:00.000Z",
    });
    expect(r.title).toBeTruthy();
    expect(r.jobUrl).toMatch(/^https:\/\/www\.hirist\.tech\/j\/.+-1668247$/);
    expect(r.skills.length).toBeGreaterThan(0);
    expect(r.postedAt).toMatch(/^2026-/);
    expect(typeof r.experienceMin).toBe("number");
    expect(r).not.toHaveProperty("description");
  });

  it("maps an iimjobs job", () => {
    const r = toResult(job(MK, 1736910), "1736910", MK_SEARCH, "x");
    expect(r).toMatchObject({
      site: "iimjobs",
      company: "Michael Page International",
      locations: ["Gurgaon/Gurugram"],
      salaryMin: 4000000,
      salaryMax: 4500000,
      salaryCurrency: "INR",
    });
    expect(r.jobUrl).toMatch(/^https:\/\/www\.iimjobs\.com\/j\/.+-1736910$/);
    expect(
      toResult(job(MK, 1734749), "1734749", MK_SEARCH, "x").applyUrl,
    ).toMatch(/^https:\/\/ad\.doubleclick\.net\//);
  });

  it("parses every job of every fixture", () => {
    for (const [name, s] of [
      [PY, PY_SEARCH],
      [PY2, PY_SEARCH],
      [MK, MK_SEARCH],
    ] as const) {
      for (const j of jobs(name)) {
        const r = toResult(j, String(j.id), s, "x");
        expect(r.title, r.jobId).toBeTruthy();
        expect(r.jobUrl, r.jobId).toMatch(
          /^https:\/\/www\.(hirist\.tech|iimjobs\.com)\/j\//,
        );
        expect(r.locations.length, r.jobId).toBeGreaterThan(0);
        expect(r.postedAt, r.jobId).toMatch(/^20\d\d-/);
        expect(r.experienceMin, r.jobId).not.toBeNull();
      }
    }
  });

  it("hides salaries marked hidden and confidential companies", () => {
    expect(jobSalary(job(PY, 1675040))).toEqual({
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
    });
    expect(
      jobSalary({ hideSal: 0, minSal: 0, maxSal: 0 }).salaryMin,
    ).toBeNull();
    expect(jobSalary({ hideSal: 0, minSal: 0, maxSal: 8.5 })).toEqual({
      salaryMin: null,
      salaryMax: 850000,
      salaryCurrency: "INR",
    });
    const conf: RawJob = {
      ...job(MK, 1736910),
      confidential: 1,
      companyData: { companyName: "Verified Company" },
    };
    expect(jobCompany(conf)).toBeNull();
    const r = toResult(conf, "1", MK_SEARCH, "x");
    expect(r.companyLogoUrl).toBeNull();
    expect(r.recruiterName).toBeNull();
  });

  it("lists locations with a remote flag", () => {
    expect(jobLocations(job(MK, 1737301))).toEqual({
      locations: ["Remote"],
      remote: true,
    });
    expect(
      jobLocations({
        locations: [{ name: "Pune" }, { name: "pune" }, { name: " " }],
      }),
    ).toEqual({ locations: ["Pune"], remote: false });
    expect(jobLocations({}).locations).toEqual([]);
  });

  it("parses job details into plain-text descriptions", () => {
    for (const name of [HD, ID]) {
      const d = parseDetailResponse(fixture(name))!;
      const text = htmlToText(d.introText)!;
      expect(text.length, name).toBeGreaterThan(500);
      expect(text, name).not.toMatch(/<\/?[a-z]+[^>]*>/i);
    }
  });

  it("converts HTML descriptions to text", () => {
    expect(
      htmlToText(
        "<p>Hello &amp; welcome</p><ul><li>One</li><li>Two&#39;s</li></ul>Bye<br/>now",
      ),
    ).toBe("Hello & welcome\n\n- One\n- Two's\nBye\nnow");
    expect(htmlToText("<div> </div>")).toBeNull();
    expect(htmlToText(null)).toBeNull();
  });

  it("cuts snippets at a word", () => {
    expect(snippet("short text")).toBe("short text");
    const s = snippet("word ".repeat(100))!;
    expect(s.endsWith("word ...")).toBe(true);
    expect(s.length).toBeLessThanOrEqual(304);
  });
});

describe("input", () => {
  it("defaults to one small search on both sites", () => {
    const s = (site: Site) => ({
      site,
      query: "product manager",
      locationIds: [3],
      minExperience: null,
      maxExperience: null,
    });
    expect(normalizeInput({})).toEqual({
      sites: ["hirist", "iimjobs"],
      searches: [s("hirist"), s("iimjobs")],
      maxItems: 20,
      includeDescription: false,
      onlyNew: false,
    });
  });

  it("crosses sites and queries, dedupes, maps filters", () => {
    const n = normalizeInput({
      queries: ["Java", " java ", "data  analyst"],
      locations: ["Pune", "Bengaluru", "bangalore"],
      minExperience: "2",
      maxExperience: 5,
    });
    expect(n.searches.map((s) => `${s.site}:${s.query}`)).toEqual([
      "hirist:Java",
      "hirist:data analyst",
      "iimjobs:Java",
      "iimjobs:data analyst",
    ]);
    expect(n.searches[0]).toMatchObject({
      locationIds: [7, 3],
      minExperience: 2,
      maxExperience: 5,
    });
    const one = normalizeInput({ site: "iimjobs", queries: "sales, finance" });
    expect(one.sites).toEqual(["iimjobs"]);
    expect(one.searches.map((s) => s.query)).toEqual(["sales", "finance"]);
    expect(one.searches[0]!.locationIds).toEqual([]);
  });

  it("rejects bad input", () => {
    expect(() => normalizeInput({ maxItems: 0 })).toThrow(InputError);
    expect(() => normalizeInput({ maxItems: "x" })).toThrow(InputError);
    expect(() => normalizeInput({ site: "naukri" })).toThrow(InputError);
    expect(() => normalizeInput({ locations: ["Atlantis"] })).toThrow(
      /Unknown location "Atlantis"/,
    );
    expect(() =>
      normalizeInput({ minExperience: 8, maxExperience: 3 }),
    ).toThrow(InputError);
    expect(() => normalizeInput({ maxExperience: -1 })).toThrow(InputError);
    expect(() => normalizeInput({ queries: ["x".repeat(201)] })).toThrow(
      InputError,
    );
    expect(() =>
      normalizeInput({
        queries: Array.from({ length: 101 }, (_, i) => `q${i}`),
      }),
    ).toThrow(/At most 100 queries/);
  });
});

describe("run", () => {
  const pages: Record<string, string> = {
    [searchUrl(PY_SEARCH, 0)]: fixture(PY),
    [searchUrl(PY_SEARCH, 1)]: fixture(PY2),
    [searchUrl(search("iimjobs", "python developer", [3]), 0)]: fixture(MK),
    [searchUrl(MK_SEARCH, 0)]: fixture(MK),
    [searchUrl(search("hirist", "nothing"), 0)]: fixture(NONE),
    [searchUrl(search("iimjobs", "nothing"), 0)]: fixture(NONE),
    [detailUrl("hirist", "1675533")]: fixture(HD),
  };
  const get = vi.fn(async (url: string) => {
    const body = pages[url];
    if (body === undefined) throw new HttpError(404, "not found", url);
    return { url, body };
  });
  const PY_INPUT = {
    site: "hirist",
    queries: ["python developer"],
    locations: ["Bangalore"],
  };

  it("paginates and stops at maxItems", async () => {
    const out: JobResult[] = [];
    const stats = await runJobs(normalizeInput({ ...PY_INPUT, maxItems: 70 }), {
      get,
      emit: async (r) => (out.push(r), true),
    });
    expect(out).toHaveLength(70);
    expect(new Set(out.map((r) => r.jobId)).size).toBe(70);
    expect(stats).toMatchObject({
      pages: 2,
      emitted: 70,
      stopReason: "maxItems",
    });
    expect(stats.searches[0]).toMatchObject({ totalJobs: 858, jobs: 70 });
  });

  it("splits maxItems between the sites", async () => {
    const out: JobResult[] = [];
    await runJobs(
      normalizeInput({
        queries: ["python developer"],
        locations: ["Bangalore"],
        maxItems: 9,
      }),
      { get, emit: async (r) => (out.push(r), true) },
    );
    expect(out.map((r) => r.site)).toEqual([
      ...Array<string>(5).fill("hirist"),
      ...Array<string>(4).fill("iimjobs"),
    ]);
  });

  it("gives an empty site's share to the next one", async () => {
    const out: JobResult[] = [];
    const stats = await runJobs(
      normalizeInput({
        queries: ["nothing", "marketing manager"],
        maxItems: 8,
      }),
      {
        get: async (url) =>
          url.startsWith("https://gladiator.hirist.tech") &&
          url.includes("marketing")
            ? { url, body: fixture(NONE) }
            : get(url),
        emit: async (r) => (out.push(r), true),
      },
    );
    expect(out).toHaveLength(8);
    expect(out.every((r) => r.site === "iimjobs")).toBe(true);
    expect(stats.searches.map((s) => s.status)).toEqual([
      "empty",
      "empty",
      "empty",
      "done",
    ]);
  });

  it("fetches descriptions when asked, keeps jobs when a detail fails", async () => {
    const out: JobResult[] = [];
    const logs: string[] = [];
    const stats = await runJobs(
      normalizeInput({ ...PY_INPUT, maxItems: 2, includeDescription: true }),
      {
        get,
        emit: async (r) => (out.push(r), true),
        log: (m) => logs.push(m),
      },
    );
    // The recorded detail belongs to another job; only ids matter here.
    expect(out[0]!.jobId).toBe("1675533");
    expect(out[0]!.description).toMatch(/\w{3,}/);
    expect(out[0]!.descriptionSnippet!.length).toBeLessThanOrEqual(304);
    expect(out[1]!.description).toBeNull();
    expect(out[1]!.descriptionSnippet).toBeNull();
    expect(stats.descriptionErrors).toBe(1);
    expect(logs[0]).toMatch(/no description \(HTTP 404/);
  });

  it("dedupes jobs across searches within a site only", async () => {
    const out: string[] = [];
    const stats = await runJobs(
      normalizeInput({ site: "iimjobs", queries: ["a", "b"], maxItems: 1000 }),
      {
        // One page each.
        get: async (url) => ({
          url,
          body: fixture(MK).replace('"hasMore":true', '"hasMore":false'),
        }),
        emit: async (r) => (out.push(r.jobId), true),
      },
    );
    expect(out).toHaveLength(50);
    expect(stats.duplicates).toBe(50);
    expect(stats.searches.map((s) => s.status)).toEqual(["done", "done"]);
  });

  it("onlyNew: skips (and doesn't charge) jobs returned before", async () => {
    const go = async (maxItems: number, state: unknown) => {
      const seen = new Seen(state);
      const out: string[] = [];
      const stats = await runJobs(
        normalizeInput({ ...PY_INPUT, maxItems, onlyNew: true }),
        {
          get: async (url) => {
            // Only the two recorded pages exist.
            if (url.includes("page=2")) return { url, body: fixture(NONE) };
            return get(url);
          },
          seen,
          emit: async (r) => (out.push(r.jobId), true),
        },
      );
      return { out, stats, state: seen.toJSON() };
    };
    const r1 = await go(5, undefined);
    expect(r1.out).toHaveLength(5);
    expect(r1.state.items[0]![0]).toBe(`hirist:${r1.out[0]}`);
    const r2 = await go(5, r1.state);
    expect(r2.out).toHaveLength(5);
    expect(r2.out.some((id) => r1.out.includes(id))).toBe(false);
    expect(r2.stats.skippedSeen).toBe(5);
    const all = await go(1000, r2.state);
    expect(all.out).toHaveLength(90);
    const none = await go(1000, all.state);
    expect(none.out).toEqual([]);
    expect(none.stats.skippedSeen).toBe(100);
    expect(none.stats.searches[0]!.status).toBe("done");
  });

  it("stops when the charge limit is reached", async () => {
    let n = 0;
    const stats = await runJobs(
      normalizeInput({ queries: ["marketing manager"], maxItems: 100 }),
      {
        get: async (url) =>
          url.includes("hirist") ? { url, body: fixture(MK) } : get(url),
        emit: async () => ++n < 3,
      },
    );
    expect(n).toBe(3);
    expect(stats).toMatchObject({ emitted: 3, stopReason: "budget" });
    expect(stats.searches).toHaveLength(1);
  });

  it("keeps going when one search fails, fails when all do", async () => {
    const out: JobResult[] = [];
    const logs: string[] = [];
    const stats = await runJobs(
      normalizeInput({
        site: "iimjobs",
        queries: ["missing", "marketing manager"],
        maxItems: 5,
      }),
      { get, emit: async (r) => (out.push(r), true), log: (m) => logs.push(m) },
    );
    expect(out).toHaveLength(5);
    expect(stats.searches.map((s) => s.status)).toEqual(["failed", "done"]);
    expect(logs[0]).toMatch(/HTTP 404/);

    await expect(
      runJobs(normalizeInput({ queries: ["missing"] }), {
        get: async (url) => ({ url, body: "<html></html>" }),
        emit: async () => true,
      }),
    ).rejects.toThrow(/All searches failed: Unexpected response/);
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

  it("rotates the session on blocks and HTML pages", async () => {
    const responses = [status(403), ok("<!DOCTYPE html><html>"), ok("{}")];
    const fetch = vi.fn(async () => responses.shift()!) as unknown as FetchLike;
    const rotate = vi.fn();
    const client = new GladiatorClient({
      fetch,
      rotate,
      sleep: async () => {},
    });
    expect((await client.get("https://gladiator.hirist.tech/x")).body).toBe(
      "{}",
    );
    expect(rotate).toHaveBeenCalledTimes(2);
    expect(client.blocks).toBe(2);
  });

  it("spaces requests out (10 s for iimjobs)", async () => {
    let t = 0;
    const sleeps: number[] = [];
    const client = new GladiatorClient({
      fetch: (async () => ok("{}")) as unknown as FetchLike,
      minIntervalMs: 10_000,
      now: () => t,
      sleep: async (ms) => {
        sleeps.push(ms);
        t += ms;
      },
    });
    await client.get("https://gladiator.iimjobs.com/a");
    t += 300;
    await client.get("https://gladiator.iimjobs.com/b");
    expect(sleeps).toEqual([9700]);
  });

  it("falls back to direct when the proxy keeps failing", async () => {
    const primary = vi.fn(async () => {
      throw new Error("proxy timeout");
    }) as unknown as FetchLike;
    const fallback = vi.fn(async () => ok("{}")) as unknown as FetchLike;
    const client = new GladiatorClient({
      fetch: primary,
      fallbackFetch: fallback,
      sleep: async () => {},
    });
    expect((await client.get("https://gladiator.hirist.tech/x")).body).toBe(
      "{}",
    );
    expect(primary).toHaveBeenCalledTimes(2);
    expect(client.route).toBe("fallback");
  });

  it("does not retry 404", async () => {
    const fetch = vi.fn(async () => status(404)) as unknown as FetchLike;
    const client = new GladiatorClient({ fetch, sleep: async () => {} });
    await expect(client.get("https://gladiator.hirist.tech/x")).rejects.toThrow(
      /HTTP 404/,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
