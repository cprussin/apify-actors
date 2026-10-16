import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  classify,
  HttpError,
  InstahyreClient,
  type FetchLike,
} from "../src/http.js";
import {
  detailUrl,
  JOB_FUNCTIONS_URL,
  matchesLocations,
  parseJobFunctions,
  parseJobResponse,
  parseSearchResponse,
  resolveJobFunctions,
  searchUrl,
  splitLocations,
  type RawJob,
  type SearchFilters,
} from "../src/instahyre.js";
import { InputError, normalizeInput, type RawInput } from "../src/input.js";
import {
  fingerprint,
  runJobs,
  toResult,
  type JobResult,
  type RunDeps,
} from "../src/run.js";
import { MonitorState } from "../src/state.js";

// Recorded with `npm run smoke -w actors/instahyre-jobs -- --record`.
const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const PY = fixture("python.json");
const PY2 = fixture("python-p2.json");
const NONE = fixture("no-results.json");
const JOB = fixture("job.json");
const FUNCTIONS = fixture("job-functions.json");

const jobs = (body: string): RawJob[] => parseSearchResponse(body)!.jobs;

/** The python fixtures, with `total_count` set (to end paging early). */
const withTotal = (body: string, total: number) => {
  const json = JSON.parse(body) as { meta: Record<string, unknown> };
  json.meta.total_count = total;
  return JSON.stringify(json);
};

const NO_FILTERS: SearchFilters = {
  skills: [],
  locations: [],
  years: null,
  jobFunctionIds: [],
  companySize: null,
  jobType: null,
};

/** Fake API: python pages at offsets 0 and 35 (total 70), job + functions. */
function api(pages: Record<number, string> = { 0: PY, 35: PY2 }) {
  const urls: string[] = [];
  const get = vi.fn(async (url: string) => {
    urls.push(url);
    if (url === JOB_FUNCTIONS_URL) return { url, body: FUNCTIONS };
    if (url.startsWith(detailUrl(""))) {
      const id = url.split("/").pop()!;
      if (id === "439850") return { url, body: JOB };
      throw new HttpError(404, "<html>", url);
    }
    const offset = Number(new URL(url).searchParams.get("offset"));
    const page = pages[offset];
    return { url, body: page ? withTotal(page, 70) : NONE };
  });
  return { get, urls };
}

async function run(
  raw: RawInput,
  opts: { state?: MonitorState; pages?: Record<number, string> } = {},
) {
  const out: JobResult[] = [];
  const logs: string[] = [];
  const { get, urls } = api(opts.pages);
  const deps: RunDeps = {
    get,
    emit: async (r) => (out.push(r), true),
    log: (m) => logs.push(m),
    now: () => new Date("2026-10-16T00:00:00Z"),
    state: opts.state,
  };
  const stats = await runJobs(normalizeInput(raw), deps);
  return { out, stats, urls, logs };
}

describe("URLs", () => {
  it("builds search URLs", () => {
    expect(searchUrl({ ...NO_FILTERS, skills: ["Python"] })).toBe(
      "https://www.instahyre.com/api/v1/job_search?skills=Python&limit=20&offset=0",
    );
    expect(
      searchUrl(
        {
          skills: ["Python", "Java"],
          locations: ["Pune"],
          years: 3,
          jobFunctionIds: [10, 9],
          companySize: "medium",
          jobType: "internship",
        },
        70,
      ),
    ).toBe(
      "https://www.instahyre.com/api/v1/job_search?skills=Python&skills=Java&locations=Pune&years=3&job_functions=10&job_functions=9&job_type=2&company_size=3&limit=20&offset=70",
    );
    // An empty skills= matches nothing on Instahyre: never send it.
    expect(searchUrl(NO_FILTERS)).not.toContain("skills");
    expect(searchUrl({ ...NO_FILTERS, companySize: "large" })).toContain(
      "company_size=2",
    );
    expect(searchUrl({ ...NO_FILTERS, years: 0 })).toContain("years=0");
    expect(detailUrl("439850")).toBe(
      "https://www.instahyre.com/api/v1/job_search/439850",
    );
  });
});

describe("parsing (fixtures)", () => {
  it("parses search pages", () => {
    const page = parseSearchResponse(PY)!;
    expect(page.total).toBe(4270);
    expect(page.jobs).toHaveLength(8);
    expect(parseSearchResponse(NONE)).toEqual({ jobs: [], total: 0 });
    const intern = parseSearchResponse(fixture("internship.json"))!;
    expect(intern.total).toBe(62);
    expect(intern.jobs.every((j) => /intern/i.test(j.public_url!))).toBe(true);
    expect(parseSearchResponse("<!DOCTYPE html><html>")).toBeNull();
    expect(parseSearchResponse('{"error": "x"}')).toBeNull();
  });

  it("maps a job", () => {
    const r = toResult(jobs(PY)[1]!, "446412", "2026-10-16T00:00:00.000Z");
    expect(r).toEqual({
      jobId: "446412",
      title: "Python Engineer",
      keywords: ["FastAPI", "MySQL", "PostgreSQL", "Python", "SQL"],
      locations: ["Bangalore", "Hyderabad"],
      jobUrl:
        "https://www.instahyre.com/job-446412-python-engineer-at-nineleaps-2-bangalore-hyderabad/",
      employerId: "5003",
      employerName: "Nineleaps",
      employerTagline: "We build high performance solutions",
      employerFoundedYear: 2014,
      employerHeadcount: 200,
      employerLogoUrl:
        "https://media.instahyre.com/images/profile/base/employer/5003/dcac758458/nineleaps.webp",
      changeType: null,
      scrapedAt: "2026-10-16T00:00:00.000Z",
    });
  });

  it("parses a single job", () => {
    const job = parseJobResponse(JOB)!;
    expect(job.id).toBe(439850);
    expect(job.title).toBe("Python Engineer");
    expect(parseJobResponse("<html>")).toBeNull();
    expect(parseJobResponse("{}")).toBeNull();
  });

  it("handles missing fields", () => {
    const r = toResult({}, "1", "t");
    expect(r.title).toBeNull();
    expect(r.keywords).toEqual([]);
    expect(r.locations).toEqual([]);
    expect(r.employerName).toBeNull();
    expect(r.employerFoundedYear).toBeNull();
  });

  it("splits and matches locations", () => {
    expect(splitLocations("Bangalore, Hyderabad,,bangalore")).toEqual([
      "Bangalore",
      "Hyderabad",
    ]);
    expect(splitLocations("")).toEqual([]);
    expect(matchesLocations(["Bangalore"], [])).toBe(true);
    expect(matchesLocations(["Bangalore", "Pune"], ["pune"])).toBe(true);
    expect(matchesLocations(["Bangalore"], ["Bengaluru"])).toBe(true);
    expect(matchesLocations(["Gurgaon"], ["Gurugram"])).toBe(true);
    expect(matchesLocations(["Work From Home"], ["Remote"])).toBe(true);
    expect(matchesLocations(["Mumbai"], ["Pune"])).toBe(false);
  });

  it("resolves job functions", () => {
    const all = parseJobFunctions(FUNCTIONS)!;
    expect(
      resolveJobFunctions(
        ["backend development", "data-science-machine-learning", "8", "Nope"],
        all,
      ),
    ).toEqual({ ids: [10, 9, 8], unknown: ["Nope"] });
    expect(parseJobFunctions("<html>")).toBeNull();
  });
});

describe("input", () => {
  it("uses defaults", () => {
    expect(normalizeInput({})).toEqual({
      skills: ["Python"],
      locations: [],
      years: null,
      jobFunctions: [],
      companySize: null,
      jobType: null,
      maxItems: 20,
      monitorMode: false,
    });
    expect(normalizeInput(null).skills).toEqual(["Python"]);
  });

  it("normalizes values", () => {
    const n = normalizeInput({
      skills: [" Java ", "java", "", null, "Go"],
      locations: "Pune, Mumbai",
      years: "0",
      jobFunctions: ["Backend Development"],
      companySize: "Large",
      jobType: "Full Time",
      maxItems: "50",
      monitorMode: true,
    });
    expect(n).toMatchObject({
      skills: ["Java", "Go"],
      locations: ["Pune", "Mumbai"],
      years: 0,
      companySize: "large",
      jobType: "full-time",
      maxItems: 50,
      monitorMode: true,
    });
    expect(normalizeInput({ skills: [] }).skills).toEqual([]);
    expect(
      normalizeInput({ companySize: "any", jobType: "any" }),
    ).toMatchObject({ companySize: null, jobType: null });
  });

  it("rejects bad input", () => {
    expect(() => normalizeInput({ maxItems: 0 })).toThrow(InputError);
    expect(() => normalizeInput({ years: -1 })).toThrow(InputError);
    expect(() => normalizeInput({ years: 2.5 })).toThrow(InputError);
    expect(() => normalizeInput({ companySize: "huge" })).toThrow(InputError);
    expect(() => normalizeInput({ jobType: "contract" })).toThrow(InputError);
  });
});

describe("run", () => {
  it("stops at maxItems within a page", async () => {
    const { out, stats, urls } = await run({ skills: ["Python"], maxItems: 5 });
    expect(out).toHaveLength(5);
    expect(urls).toHaveLength(1);
    expect(stats).toMatchObject({ stopReason: "maxItems", totalJobs: 70 });
    expect(out[0]!.jobId).toBe("439850");
  });

  it("pages by 35 until the end of the results", async () => {
    const { out, stats, urls } = await run({ maxItems: 100 });
    expect(out).toHaveLength(16);
    expect(urls.map((u) => new URL(u).searchParams.get("offset"))).toEqual([
      "0",
      "35",
    ]);
    expect(stats).toMatchObject({ pages: 2, complete: true });
  });

  it("dedupes jobs repeated across pages", async () => {
    const { out, stats } = await run(
      { maxItems: 100 },
      { pages: { 0: PY, 35: PY } },
    );
    expect(out).toHaveLength(8);
    expect(stats.duplicates).toBe(8);
  });

  it("filters by location on the client", async () => {
    const { out, stats } = await run({ locations: ["Pune"], maxItems: 100 });
    expect(out.map((j) => j.jobId)).toEqual(["422869", "445594", "445568"]);
    expect(stats.filteredOut).toBe(13);
  });

  it("resolves job functions by name (one lookup)", async () => {
    const { urls } = await run({
      jobFunctions: ["Backend Development", "DevOps / Cloud"],
      maxItems: 1,
    });
    expect(urls[0]).toBe(JOB_FUNCTIONS_URL);
    expect(urls[1]).toContain("job_functions=10&job_functions=8");
    const ids = await run({ jobFunctions: ["10"], maxItems: 1 });
    expect(ids.urls).toHaveLength(1);
    await expect(run({ jobFunctions: ["Basket Weaving"] })).rejects.toThrow(
      InputError,
    );
  });

  it("stops at the budget", async () => {
    const out: JobResult[] = [];
    const stats = await runJobs(normalizeInput({ maxItems: 100 }), {
      get: api().get,
      emit: async (r) => (out.push(r), out.length < 3),
    });
    expect(out).toHaveLength(3);
    expect(stats.stopReason).toBe("budget");
  });

  it("keeps partial results on errors, fails with none", async () => {
    let n = 0;
    const get = async (url: string) => {
      if (n++ > 0) throw new HttpError(503, "", url);
      return { url, body: withTotal(PY, 70) };
    };
    const out: JobResult[] = [];
    const stats = await runJobs(normalizeInput({ maxItems: 100 }), {
      get,
      emit: async (r) => (out.push(r), true),
    });
    expect(out).toHaveLength(8);
    expect(stats.stopReason).toBe("error");
    await expect(
      runJobs(normalizeInput({}), {
        get: async (url) => ({ url, body: "<!DOCTYPE html>" }),
        emit: async () => true,
      }),
    ).rejects.toThrow(/Unexpected response/);
  });
});

describe("monitor mode", () => {
  const input = { maxItems: 100, monitorMode: true };

  it("flags new, skips unchanged, flags updated and removed", async () => {
    const state = new MonitorState();
    const first = await run(input, { state });
    expect(first.out).toHaveLength(16);
    expect(first.out.every((j) => j.changeType === "new")).toBe(true);

    // Same results: nothing to output.
    const again = new MonitorState(JSON.parse(JSON.stringify(state.toJSON())));
    const second = await run(input, { state: again });
    expect(second.out).toHaveLength(0);
    expect(second.stats.unchanged).toBe(16);

    // Page 1 changed: first job's keywords edited, second job gone, page 2
    // unchanged. The removed job is looked up for its latest data.
    const page = JSON.parse(withTotal(PY, 70)) as { objects: RawJob[] };
    page.objects[0]!.keywords = ["Python", "Django"];
    const gone = page.objects.splice(1, 1)[0]!;
    const last = new MonitorState(again.toJSON());
    const third = await run(input, {
      state: last,
      pages: { 0: JSON.stringify(page), 35: PY2 },
    });
    expect(
      third.out.map((j) => [j.jobId, j.changeType, j.title !== null]),
    ).toEqual([
      ["439850", "updated", true],
      [String(gone.id), "removed", false],
    ]);
    expect(third.stats).toMatchObject({ unchanged: 14, removed: 1 });
    expect(third.urls).toContain(detailUrl(String(gone.id)));
    // Removed jobs are forgotten; updated ones get the new fingerprint.
    expect(last.size).toBe(15);
    expect(last.classify("439850", fingerprint(third.out[0]!))).toBe(
      "unchanged",
    );
  });

  it("fills removed jobs from the job endpoint", async () => {
    const state = new MonitorState({
      version: 1,
      items: [["439850", "old"]],
    });
    const { out } = await run(input, { state, pages: { 0: PY2 } });
    const removed = out.find((j) => j.changeType === "removed")!;
    expect(removed).toMatchObject({
      jobId: "439850",
      title: "Python Engineer",
      employerName: "Nineleaps",
    });
  });

  it("does not report removals after an incomplete scan", async () => {
    const state = new MonitorState({ version: 1, items: [["999", "x"]] });
    const { out, logs } = await run({ ...input, maxItems: 3 }, { state });
    expect(out.every((j) => j.changeType === "new")).toBe(true);
    expect(state.missing()).toContain("999");
    expect(logs.join("\n")).toMatch(/Removed jobs not checked/);
  });

  it("caps and survives bad state", () => {
    const s = new MonitorState(undefined, 2);
    s.record("a", "1");
    s.record("b", "1");
    s.record("c", "1");
    expect(s.toJSON().items.map((e) => e[0])).toEqual(["b", "c"]);
    expect(new MonitorState("garbage").isBaseline).toBe(true);
    expect(new MonitorState({ items: [[1, 2], ["x"]] }).size).toBe(1);
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
    expect(classify(new HttpError(400, "", ""))).toBe("fatal");
    expect(classify(new HttpError(404, "", ""))).toBe("fatal");
    expect(classify(new Error("ECONNRESET"))).toBe("transient");
  });

  it("retries blocks and Cloudflare HTML pages", async () => {
    const responses = [status(403), ok("<!DOCTYPE html><html>"), ok("{}")];
    const fetch = vi.fn(async () => responses.shift()!) as unknown as FetchLike;
    const rotate = vi.fn();
    const client = new InstahyreClient({
      fetch,
      rotate,
      sleep: async () => {},
    });
    expect((await client.get("https://www.instahyre.com/x")).body).toBe("{}");
    expect(rotate).toHaveBeenCalledTimes(2);
    expect(client.blocks).toBe(2);
  });

  it("spaces requests out", async () => {
    let t = 0;
    const sleeps: number[] = [];
    const client = new InstahyreClient({
      fetch: (async () => ok("{}")) as unknown as FetchLike,
      minIntervalMs: 1000,
      now: () => t,
      sleep: async (ms) => {
        sleeps.push(ms);
        t += ms;
      },
    });
    await client.get("https://www.instahyre.com/a");
    t += 300;
    await client.get("https://www.instahyre.com/b");
    expect(sleeps).toEqual([700]);
  });

  it("does not retry 404", async () => {
    const fetch = vi.fn(async () => status(404)) as unknown as FetchLike;
    const client = new InstahyreClient({ fetch, sleep: async () => {} });
    await expect(client.get("https://www.instahyre.com/x")).rejects.toThrow(
      /HTTP 404/,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
