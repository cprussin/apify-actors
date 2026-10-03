import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  htmlToText,
  jobLocations,
  jobSalary,
  parseSearchResponse,
  searchUrl,
  snippet,
  type RawJob,
} from "../src/foundit.js";
import {
  classify,
  FounditClient,
  HttpError,
  type FetchLike,
} from "../src/http.js";
import { InputError, normalizeInput } from "../src/input.js";
import { runJobs, toResult, type JobResult } from "../src/run.js";
import { Seen } from "../src/state.js";

// Recorded with `npm run smoke -w actors/foundit-jobs -- --record`.
const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const PY = "python-developer-bangalore.json";
const PY2 = "python-developer-bangalore-p2.json";
const DA = "data-analyst.json";
const NONE = "no-results.json";

const jobs = (name: string): RawJob[] =>
  parseSearchResponse(fixture(name))!.jobs;
const job = (name: string, id: number) =>
  jobs(name).find((j) => j.jobId === id)!;

const PY_SEARCH = { query: "python developer", location: "Bangalore" };

describe("URLs", () => {
  it("builds API URLs", () => {
    expect(searchUrl(PY_SEARCH)).toBe(
      "https://www.foundit.in/home/api/searchResultsPage?query=python+developer&locations=Bangalore&sort=2&limit=20&start=0",
    );
    expect(
      searchUrl({ query: "data analyst", location: null }, 40, "relevance"),
    ).toBe(
      "https://www.foundit.in/home/api/searchResultsPage?query=data+analyst&sort=1&limit=20&start=40",
    );
    expect(searchUrl({ query: "", location: "Pune" })).toContain(
      "?query=&locations=Pune&",
    );
  });
});

describe("parsing (fixtures)", () => {
  it("parses a search page", () => {
    const page = parseSearchResponse(fixture(PY))!;
    expect(page.total).toBe(1867);
    expect(page.jobs).toHaveLength(20);
    expect(parseSearchResponse(fixture(NONE))).toEqual({ jobs: [], total: 0 });
  });

  it("rejects non-API responses", () => {
    expect(parseSearchResponse("<html>blocked</html>")).toBeNull();
    expect(parseSearchResponse('{"error":"x"}')).toBeNull();
  });

  it("maps a job into a complete item", () => {
    const r = toResult(
      job(PY, 61745075),
      "61745075",
      PY_SEARCH,
      "2026-10-03T00:00:00.000Z",
    );
    expect(r).toMatchObject({
      jobId: "61745075",
      title: "Machine Learning Engineer (AI/ML)",
      companyName: "Rarr Technologies Private Limited",
      companyId: "1248443",
      locations: ["Bengaluru / Bangalore"],
      country: "India",
      remote: false,
      experienceMin: 6,
      experienceMax: 9,
      salaryMin: 1300000,
      salaryMax: 1500000,
      salaryCurrency: "INR",
      employmentTypes: ["Full time"],
      jobTypes: ["Permanent Job"],
      postedAt: "2026-08-07T11:47:09.000Z",
      jobUrl:
        "https://www.foundit.in/job/machine-learning-engineer-ai-ml-rarr-technologies-private-limited-bengaluru-bangalore-61745075",
      searchQuery: "python developer",
      searchLocation: "Bangalore",
      scrapedAt: "2026-10-03T00:00:00.000Z",
    });
    expect(r.skills).toEqual(
      expect.arrayContaining(["Python", "Machine Learning", "Tensorflow"]),
    );
    expect(r.descriptionSnippet).toMatch(/^Role Overview We are looking/);
    expect(r.descriptionSnippet!.length).toBeLessThanOrEqual(304);
    expect(r).not.toHaveProperty("description");
  });

  it("parses every job of every fixture", () => {
    for (const name of [PY, PY2, DA]) {
      for (const j of jobs(name)) {
        const r = toResult(j, String(j.jobId), PY_SEARCH, "x", true);
        expect(r.title, r.jobId).toBeTruthy();
        expect(r.jobUrl, r.jobId).toMatch(/^https:\/\/www\.foundit\.in\/job\//);
        expect(r.locations.length, r.jobId).toBeGreaterThan(0);
        expect(r.postedAt, r.jobId).toMatch(/^20\d\d-/);
        expect(r.description, r.jobId).toBeTruthy();
        expect(r.description, r.jobId).not.toMatch(/<\/?[a-z]+[^>]*>/i);
        expect(r.descriptionSnippet!.length, r.jobId).toBeLessThanOrEqual(304);
      }
    }
  });

  it("hides confidential company names", () => {
    const r = toResult(job(PY, 69326195), "69326195", PY_SEARCH, "x");
    expect(r.companyName).toBeNull();
    expect(r.companyId).toBeNull();
    expect(r.salaryMax).toBe(2000000);
  });

  it("omits hidden, confidential and placeholder salaries", () => {
    // jobSalaryConfidential
    expect(jobSalary(job(PY, 69330505)).salaryMin).toBeNull();
    // hideSalary: 2
    expect(jobSalary(job(PY, 69328779)).salaryMin).toBeNull();
    // 0 - 1,000 INR a year: "not disclosed"
    expect(jobSalary(job(DA, 69334086))).toEqual({
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
    });
    expect(jobSalary(job(DA, 69330855))).toEqual({
      salaryMin: 78000,
      salaryMax: 96000,
      salaryCurrency: "SGD",
    });
  });

  it("lists locations with country and remote flag", () => {
    expect(jobLocations(job(DA, 69322084).locations)).toEqual({
      locations: ["Singapore", "Corporation Road"],
      country: "Singapore",
      remote: false,
    });
    expect(
      jobLocations([
        { city: "Pune", country: "India" },
        { city: "pune", country: "India" },
        { country: "India" },
      ]),
    ).toEqual({
      locations: ["Pune", "India"],
      country: "India",
      remote: false,
    });
    expect(jobLocations([{ country: "Remote" }])).toEqual({
      locations: ["Remote"],
      country: null,
      remote: true,
    });
    expect(jobLocations(null).locations).toEqual([]);
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
  it("defaults to one small search", () => {
    expect(normalizeInput({})).toEqual({
      searches: [{ query: "python developer", location: "Bangalore" }],
      maxItems: 20,
      sortBy: "date",
      includeDescription: false,
      onlyNew: false,
    });
  });

  it("crosses queries and locations and dedupes", () => {
    expect(
      normalizeInput({
        queries: ["Java", " java ", "data  analyst"],
        locations: ["Pune", "Mumbai"],
      }).searches,
    ).toEqual([
      { query: "Java", location: "Pune" },
      { query: "Java", location: "Mumbai" },
      { query: "data analyst", location: "Pune" },
      { query: "data analyst", location: "Mumbai" },
    ]);
  });

  it("supports query-only and location-only searches", () => {
    expect(normalizeInput({ queries: ["sales"] }).searches).toEqual([
      { query: "sales", location: null },
    ]);
    expect(normalizeInput({ locations: "Pune, Delhi" }).searches).toEqual([
      { query: "", location: "Pune" },
      { query: "", location: "Delhi" },
    ]);
  });

  it("rejects bad input", () => {
    expect(() => normalizeInput({ maxItems: 0 })).toThrow(InputError);
    expect(() => normalizeInput({ maxItems: "x" })).toThrow(InputError);
    expect(() => normalizeInput({ sortBy: "salary" })).toThrow(InputError);
    expect(() => normalizeInput({ queries: ["x".repeat(201)] })).toThrow(
      InputError,
    );
    expect(() =>
      normalizeInput({
        queries: Array.from({ length: 21 }, (_, i) => `q${i}`),
        locations: Array.from({ length: 10 }, (_, i) => `l${i}`),
      }),
    ).toThrow(/At most 200 searches/);
  });
});

describe("run", () => {
  const pages: Record<string, string> = {
    [searchUrl(PY_SEARCH, 0)]: fixture(PY),
    [searchUrl(PY_SEARCH, 20)]: fixture(PY2),
    [searchUrl({ query: "data analyst", location: null }, 0)]: fixture(DA),
    [searchUrl({ query: "nothing", location: null }, 0)]: fixture(NONE),
  };
  const get = vi.fn(async (url: string) => {
    const body = pages[url];
    if (body === undefined) throw new HttpError(404, "not found", url);
    return { url, body };
  });

  it("paginates and stops at maxItems", async () => {
    const out: JobResult[] = [];
    const stats = await runJobs(
      normalizeInput({
        queries: ["python developer"],
        maxItems: 30,
        locations: ["Bangalore"],
      }),
      { get, emit: async (r) => (out.push(r), true) },
    );
    expect(out).toHaveLength(30);
    expect(new Set(out.map((r) => r.jobId)).size).toBe(30);
    expect(stats).toMatchObject({
      pages: 2,
      emitted: 30,
      stopReason: "maxItems",
    });
    expect(stats.searches[0]).toMatchObject({ totalJobs: 1867, jobs: 30 });
  });

  it("dedupes jobs across searches", async () => {
    const twice: Record<string, string> = {
      [searchUrl({ query: "a", location: null }, 0)]: fixture(DA),
      [searchUrl({ query: "b", location: null }, 0)]: fixture(DA),
    };
    const out: string[] = [];
    const stats = await runJobs(
      normalizeInput({ queries: ["a", "b"], maxItems: 1000 }),
      {
        // One page each: pretend the total fits on it.
        get: async (url) => ({
          url,
          body: twice[url]!.replace('"total":32575', '"total":20'),
        }),
        emit: async (r) => (out.push(r.jobId), true),
      },
    );
    expect(out).toHaveLength(20);
    expect(stats.duplicates).toBe(20);
    expect(stats.searches.map((s) => s.status)).toEqual(["done", "done"]);
  });

  it("onlyNew: skips (and doesn't charge) jobs returned before", async () => {
    const go = async (maxItems: number, state: unknown) => {
      const seen = new Seen(state);
      const out: string[] = [];
      const stats = await runJobs(
        normalizeInput({
          queries: ["python developer"],
          locations: ["Bangalore"],
          maxItems,
          onlyNew: true,
        }),
        {
          get: async (url) => {
            // Only the two recorded pages exist.
            if (url.endsWith("start=40")) return { url, body: fixture(NONE) };
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
    const r2 = await go(5, r1.state);
    expect(r2.out).toHaveLength(5);
    expect(r2.out.some((id) => r1.out.includes(id))).toBe(false);
    expect(r2.stats.skippedSeen).toBe(5);
    const all = await go(1000, r2.state);
    expect(all.out).toHaveLength(30);
    const none = await go(1000, all.state);
    expect(none.out).toEqual([]);
    expect(none.stats.skippedSeen).toBe(40);
    expect(none.stats.searches[0]!.status).toBe("done");
  });

  it("stops when the charge limit is reached", async () => {
    let n = 0;
    const stats = await runJobs(normalizeInput({ queries: ["data analyst"] }), {
      get,
      emit: async () => ++n < 3,
    });
    expect(n).toBe(3);
    expect(stats).toMatchObject({ emitted: 3, stopReason: "budget" });
  });

  it("reports empty searches", async () => {
    const logs: string[] = [];
    const stats = await runJobs(normalizeInput({ queries: ["nothing"] }), {
      get,
      emit: async () => true,
      log: (m) => logs.push(m),
    });
    expect(stats.searches[0]!.status).toBe("empty");
    expect(logs).toEqual(['"nothing": no jobs found.']);
  });

  it("keeps going when one search fails, fails when all do", async () => {
    const out: JobResult[] = [];
    const logs: string[] = [];
    const stats = await runJobs(
      normalizeInput({ queries: ["missing", "data analyst"], maxItems: 5 }),
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
    const client = new FounditClient({ fetch, rotate, sleep: async () => {} });
    expect((await client.get("https://www.foundit.in/x")).body).toBe("{}");
    expect(rotate).toHaveBeenCalledTimes(2);
    expect(client.blocks).toBe(2);
  });

  it("spaces requests out", async () => {
    let t = 0;
    const sleeps: number[] = [];
    const client = new FounditClient({
      fetch: (async () => ok("{}")) as unknown as FetchLike,
      minIntervalMs: 1000,
      now: () => t,
      sleep: async (ms) => {
        sleeps.push(ms);
        t += ms;
      },
    });
    await client.get("https://www.foundit.in/a");
    t += 300;
    await client.get("https://www.foundit.in/b");
    expect(sleeps).toEqual([700]);
  });

  it("falls back to direct when the proxy keeps failing", async () => {
    const primary = vi.fn(async () => {
      throw new Error("proxy timeout");
    }) as unknown as FetchLike;
    const fallback = vi.fn(async () => ok("{}")) as unknown as FetchLike;
    const client = new FounditClient({
      fetch: primary,
      fallbackFetch: fallback,
      sleep: async () => {},
    });
    expect((await client.get("https://www.foundit.in/x")).body).toBe("{}");
    expect(primary).toHaveBeenCalledTimes(2);
    expect(client.route).toBe("fallback");
  });

  it("does not retry 404", async () => {
    const fetch = vi.fn(async () => status(404)) as unknown as FetchLike;
    const client = new FounditClient({ fetch, sleep: async () => {} });
    await expect(client.get("https://www.foundit.in/x")).rejects.toThrow(
      /HTTP 404/,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
