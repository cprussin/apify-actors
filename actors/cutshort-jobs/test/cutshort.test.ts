import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  citySlug,
  detailLocations,
  explicitListingSlug,
  htmlToText,
  jobPageUrl,
  ldSalary,
  listingDataUrl,
  listingSalary,
  listingSlug,
  parseDetail,
  parseListing,
  parseSitemap,
  shortIdOf,
  SITEMAP_URL,
  skillSlugs,
  snippet,
  type RawDetail,
  type RawJob,
} from "../src/cutshort.js";
import {
  classify,
  CutshortClient,
  HttpError,
  type FetchLike,
} from "../src/http.js";
import { InputError, normalizeInput, type RawInput } from "../src/input.js";
import { Monitor, stateKey } from "../src/monitor.js";
import {
  contentFingerprint,
  fromDetail,
  fromListing,
  runJobs,
  type ChargeEvent,
  type JobResult,
} from "../src/run.js";

// Recorded with `npm run smoke -w actors/cutshort-jobs -- --record`.
const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const LISTING = fixture("listing-python-pune.json");
const END = fixture("listing-end.json");
const UNKNOWN = fixture("listing-unknown.json");
const JOB_PAGE = fixture("job-page.html");
const GONE = fixture("job-gone.html");
const SITEMAP = fixture("sitemap-jobs.xml");

const listingJobs = (): RawJob[] => {
  const l = parseListing(LISTING)!;
  if (l.kind !== "jobs") throw new Error("fixture");
  return l.jobs;
};
const listed = (id: string) =>
  listingJobs().find((j) => shortIdOf(j.publicUrl) === id)!;
const detail = (): RawDetail => {
  const d = parseDetail(JOB_PAGE)!;
  if (d.kind !== "job") throw new Error("fixture");
  return d.job;
};

describe("URLs and slugs", () => {
  it("builds URLs", () => {
    expect(listingDataUrl("python-jobs-in-pune", 2)).toBe(
      "https://cutshort.io/backend-api/webpage/jobs/python-jobs-in-pune?page=2",
    );
    expect(jobPageUrl("Foo-Bar-xhH8K6kb")).toBe(
      "https://cutshort.io/job/Foo-Bar-xhH8K6kb",
    );
    expect(jobPageUrl("https://cutshort.io/job/x-12345678")).toBe(
      "https://cutshort.io/job/x-12345678",
    );
  });

  it("extracts short job IDs", () => {
    expect(
      shortIdOf(
        "https://cutshort.io/job/Integration-Engineer-Bengaluru-Bangalore-OneFin-xhH8K6kb",
      ),
    ).toBe("xhH8K6kb");
    expect(shortIdOf("https://cutshort.io/job/Tech-Lead-_-a_b-Cd12")).toBe(
      "a_b-Cd12",
    );
    expect(shortIdOf("https://cutshort.io/jobs/python-jobs")).toBeNull();
    expect(shortIdOf(null)).toBeNull();
  });

  it("maps skill names and cities to Cutshort slugs", () => {
    expect(skillSlugs("python")).toEqual(["python"]);
    expect(skillSlugs("React.js")).toEqual(["reactjs"]);
    expect(skillSlugs("Data Science")).toEqual(["data-science", "datascience"]);
    expect(skillSlugs("python-jobs-in-pune")).toEqual(["python"]);
    expect(skillSlugs("C++")).toEqual(["cplusplus"]);
    expect(citySlug("Bangalore")).toBe("bangalore-bengaluru");
    expect(citySlug("Gurugram")).toBe("delhi-ncr-gurgaon-noida");
    expect(citySlug("Pune")).toBe("pune");
    expect(citySlug("remote")).toBe("remote");
    expect(listingSlug("python", null)).toBe("python-jobs");
    expect(listingSlug("python", "pune")).toBe("python-jobs-in-pune");
    expect(listingSlug("python", "remote")).toBe("remote-python-jobs");
    expect(
      explicitListingSlug("https://cutshort.io/jobs/machine-learning-ml-jobs"),
    ).toBe("machine-learning-ml-jobs");
    expect(explicitListingSlug("python-jobs-in-pune")).toBe(
      "python-jobs-in-pune",
    );
    expect(explicitListingSlug("python")).toBeNull();
  });
});

describe("input", () => {
  it("uses the default search for a bare input", () => {
    const i = normalizeInput({});
    expect(i.mode).toBe("listing");
    expect(i.searches).toEqual([
      {
        label: "python in bangalore-bengaluru",
        candidates: ["python-jobs-in-bangalore-bengaluru"],
      },
    ]);
    expect(i).toMatchObject({
      maxItems: 20,
      startPage: 1,
      maxPages: 0,
      includeDetails: false,
      monitorMode: false,
    });
  });

  it("crosses skills with cities and dedupes", () => {
    const i = normalizeInput({
      skills: ["Data Science", "reactjs"],
      cities: ["Bangalore", "Bengaluru", "remote"],
    });
    expect(i.searches.map((s) => s.candidates)).toEqual([
      [
        "data-science-jobs-in-bangalore-bengaluru",
        "datascience-jobs-in-bangalore-bengaluru",
      ],
      ["remote-data-science-jobs", "remote-datascience-jobs"],
      ["reactjs-jobs-in-bangalore-bengaluru"],
      ["remote-reactjs-jobs"],
    ]);
  });

  it("uses a pasted listing URL as is", () => {
    const i = normalizeInput({
      skills: ["https://cutshort.io/jobs/machine-learning-ml-jobs-in-pune"],
      cities: ["Mumbai"],
    });
    expect(i.searches[0]!.candidates[0]).toBe(
      "machine-learning-ml-jobs-in-pune",
    );
    expect(i.searches).toHaveLength(1);
  });

  it("switches to the sitemap without skills", () => {
    const i = normalizeInput({ skills: [], maxItems: 5 });
    expect(i.mode).toBe("sitemap");
    expect(i.searches).toEqual([]);
  });

  it("rejects bad input", () => {
    const bad: RawInput[] = [
      { skills: [], cities: ["pune"] },
      { maxItems: 0 },
      { maxItems: "x" },
      { startPage: 0 },
      { maxPages: -1 },
      { skills: ["x".repeat(201)] },
      { skills: ["!!!"] },
    ];
    for (const raw of bad)
      expect(() => normalizeInput(raw), JSON.stringify(raw)).toThrow(
        InputError,
      );
  });
});

describe("parsing (fixtures)", () => {
  it("parses listing pages", () => {
    const l = parseListing(LISTING)!;
    expect(l.kind).toBe("jobs");
    if (l.kind === "jobs") {
      expect(l.jobs.length).toBeGreaterThan(2);
      expect(l.liveJobCount).toBe(505);
    }
    expect(parseListing(END)).toEqual({ kind: "end" });
    expect(parseListing(UNKNOWN)).toEqual({ kind: "unknown" });
    expect(parseListing("<html>blocked</html>")).toBeNull();
    expect(parseListing('{"success":false,"error":{"errorCode":"x"}}')).toBe(
      null,
    );
  });

  it("maps a listing job", () => {
    const r = fromListing(
      listed("klKtwgZO"),
      "klKtwgZO",
      "python-jobs-in-pune",
      "2026-10-16T00:00:00.000Z",
    );
    expect(r).toMatchObject({
      jobId: "klKtwgZO",
      internalId: expect.stringMatching(/^[0-9a-f]{24}$/),
      headline: "Metadata Engineer",
      companyName: "VY SYSTEMS PRIVATE LIMITED",
      hiringForClient: false,
      recruiterName: null,
      companyUrl:
        "https://cutshort.io/company/vy-systems-private-limited-16-e43Khktp",
      companyWebsite: "https://vysystems.com",
      companyType: "Services",
      companySize: "100-1000",
      companyStage: "Profitable",
      companyFounded: 2000,
      locations: ["Pune"],
      workMode: "onsite",
      remote: false,
      experienceMin: 6,
      experienceMax: 17,
      salaryMin: 700000,
      salaryMax: 3200000,
      salaryCurrency: "INR",
      salaryText: "₹7L - ₹32L / yr",
      roleTypes: ["full_time"],
      postedAt: "2026-10-16T12:54:16.418Z",
      url: "https://cutshort.io/job/Metadata-Engineer-Pune-VY-SYSTEMS-PRIVATE-LIMITED-klKtwgZO",
      searchSlug: "python-jobs-in-pune",
    });
    expect(r.skills.slice(0, 3)).toEqual([
      "Metadata modeling",
      "Data engineering",
      "Python",
    ]);
    expect(r.descriptionSnippet!.length).toBeLessThanOrEqual(304);
    expect(r).not.toHaveProperty("description");
    expect(r).not.toHaveProperty("changeType");
  });

  it("names client and recruiter for agency jobs", () => {
    const r = fromListing(listed("iU73PArL"), "iU73PArL", null, "t");
    expect(r).toMatchObject({
      companyName: "Management and Analytics",
      hiringForClient: true,
      recruiterName: "Bean HR Consulting",
      companyLogoUrl: null,
      companyWebsite: null,
      locations: ["Gurugram", "Pune", "Bangarmau"],
    });
    const remote = fromListing(listed("Kq5MsoWa"), "Kq5MsoWa", null, "t");
    expect(remote).toMatchObject({ workMode: "remoteOrOnsite", remote: true });
  });

  it("reads salaries as yearly amounts", () => {
    const month = {
      duration: "MONTH",
      currency: "INR",
      min: 24000,
      max: 30000,
      minVanity: 24000,
      maxVanity: 30000,
    };
    expect(listingSalary(month)).toEqual({
      salaryMin: 24000,
      salaryMax: 30000,
      salaryCurrency: "INR",
    });
    expect(
      listingSalary({ currency: "INR", minVanity: 0, maxVanity: 0 }),
    ).toEqual({ salaryMin: null, salaryMax: null, salaryCurrency: null });
    expect(listingSalary("₹4L - ₹5L / yr").salaryMax).toBeNull();
    expect(
      ldSalary({
        baseSalary: {
          currency: "INR",
          value: { minValue: 2000, maxValue: 2500, unitText: "MONTH" },
        },
      }),
    ).toEqual({ salaryMin: 24000, salaryMax: 30000, salaryCurrency: "INR" });
  });

  it("parses a job page", () => {
    const j = detail();
    expect(j.headline).toBe("GCP Data engineer");
    expect(j.jobPosting?.["@type"]).toBe("JobPosting");
    const r = fromDetail(j, "uhRqRgf1", "2026-10-16T00:00:00.000Z");
    expect(r).toMatchObject({
      jobId: "uhRqRgf1",
      headline: "GCP Data engineer",
      companyName: "VY SYSTEMS PRIVATE LIMITED",
      locations: ["Bengaluru (Bangalore)", "Pune", "Hyderabad", "Chennai"],
      salaryMin: 2000000,
      salaryMax: 3000000,
      salaryCurrency: "INR",
      salaryText: "₹20L - ₹30L / yr",
      experienceMin: 8,
      experienceMax: 12,
      jobValid: true,
      category: "tech",
      tags: ["frontend"],
      postalCode: "560066",
      searchSlug: null,
    });
    expect(r.validThrough).toMatch(/^20\d\d-/);
    expect(r.employmentTypes!.length).toBeGreaterThan(0);
    expect(r.description!.length).toBeGreaterThan(100);
    expect(r.url).toContain("uhRqRgf1");
  });

  it("splits job page locations", () => {
    const loc = (locations: string) =>
      detailLocations({ locations, jobPosting: null });
    expect(loc("Remote only")).toEqual([]);
    expect(loc("Delhi, NCR and Gurgaon, Pune")).toEqual([
      "Delhi, NCR and Gurgaon",
      "Pune",
    ]);
  });

  it("recognizes missing job pages", () => {
    expect(parseDetail(GONE, 404)).toEqual({ kind: "gone" });
    expect(parseDetail("<html></html>", 404)).toEqual({ kind: "gone" });
    expect(parseDetail("<html>blocked</html>", 200)).toBeNull();
  });

  it("parses the jobs sitemap", () => {
    const e = parseSitemap(SITEMAP)!;
    expect(e).toHaveLength(5);
    expect(e[0]).toEqual({
      url: "https://cutshort.io/job/AI-Native-Backend-Engineer-Core-Java-3-Months-Contract-Bengaluru-Bangalore-Staffnixcom-CtwTNjNd",
      jobId: "CtwTNjNd",
      lastmod: "2026-10-15T17:43:19.041Z",
    });
    expect(parseSitemap("<html></html>")).toBeNull();
  });

  it("converts HTML descriptions", () => {
    expect(
      htmlToText("<p>Hi &amp; welcome</p><ul><li>One</li><li>Two</li></ul>"),
    ).toBe("Hi & welcome\n\n- One\n- Two");
    expect(snippet("word ".repeat(100), 20)).toBe("word word word word ...");
  });
});

// ------------------------------------------------------------ run (fake)

const listingPage = (jobs: RawJob[]) =>
  JSON.stringify({
    success: true,
    data: { pageData: { jobs, liveJobCount: jobs.length } },
  });

/** Short IDs are 8 characters: "A" -> "A0000000". */
const sid = (id: string) => id.padEnd(8, "0");
const fakeJob = (id: string, extra: Partial<RawJob> = {}): RawJob => ({
  ...listingJobs()[0]!,
  _id: id.padEnd(24, "0"),
  publicUrl: `https://cutshort.io/job/Job-${sid(id)}`,
  headline: `Job ${id}`,
  ...extra,
});

interface FakeSite {
  /** slug -> pages (1-based index - 1); missing slug = unknown. */
  listings?: Record<string, RawJob[][]>;
  /** job URL -> page HTML, status; missing = 404. */
  details?: Record<string, string>;
  sitemap?: string;
  failing?: Set<string>;
}

function fake(site: FakeSite) {
  const requests: string[] = [];
  const get = async (url: string) => {
    requests.push(url);
    if (site.failing?.has(url)) throw new HttpError(500, "boom", url);
    if (url === SITEMAP_URL)
      return { url, status: 200, body: site.sitemap ?? "" };
    const l = /\/backend-api\/webpage\/jobs\/([^?]+)\?page=(\d+)/.exec(url);
    if (l) {
      const pages = site.listings?.[l[1]!];
      if (!pages) return { url, status: 400, body: UNKNOWN };
      const jobs = pages[Number(l[2]) - 1];
      return jobs
        ? { url, status: 200, body: listingPage(jobs) }
        : { url, status: 400, body: END };
    }
    const html = site.details?.[url];
    return html
      ? { url, status: 200, body: html }
      : { url, status: 404, body: GONE };
  };
  return { get, requests };
}

async function collect(raw: RawInput, site: FakeSite, monitor?: Monitor) {
  const out: JobResult[] = [];
  const charges: ChargeEvent[][] = [];
  const logs: string[] = [];
  const f = fake(site);
  const stats = await runJobs(normalizeInput(raw), {
    get: f.get,
    emit: async (item, events) => {
      out.push(item);
      charges.push(events);
      return true;
    },
    log: (m) => logs.push(m),
    monitor,
    now: () => new Date("2026-10-16T00:00:00Z"),
  });
  return { out, charges, logs, stats, requests: f.requests };
}

const page = (ids: string[]) => ids.map((id) => fakeJob(id));

describe("runJobs", () => {
  it("pages to the end, dedupes and charges one job event each", async () => {
    const r = await collect(
      { skills: ["python"], cities: ["pune"], maxItems: 100 },
      {
        listings: {
          "python-jobs-in-pune": [page(["A", "B", "C"]), page(["C", "D"])],
        },
      },
    );
    expect(r.out.map((j) => j.jobId)).toEqual(["A", "B", "C", "D"].map(sid));
    expect(r.stats).toMatchObject({ pages: 3, emitted: 4, duplicates: 1 });
    expect(r.stats.searches[0]).toMatchObject({
      status: "done",
      slug: "python-jobs-in-pune",
    });
    expect(r.charges.every((c) => c.join() === "job")).toBe(true);
  });

  it("stops at maxItems and maxPages, starts at startPage", async () => {
    const listings = {
      "python-jobs": [page(["A1", "A2"]), page(["B1", "B2"]), page(["C1"])],
    };
    const max = await collect(
      { skills: ["python"], maxItems: 3 },
      { listings },
    );
    expect(max.out).toHaveLength(3);
    expect(max.stats.stopReason).toBe("maxItems");
    const pages = await collect(
      { skills: ["python"], maxItems: 100, startPage: 2, maxPages: 1 },
      { listings },
    );
    expect(pages.out.map((j) => j.headline)).toEqual(["Job B1", "Job B2"]);
    expect(pages.stats.searches[0]!.status).toBe("pageLimit");
    expect(pages.requests).toEqual([listingDataUrl("python-jobs", 2)]);
  });

  it("tries slug candidates and reports unknown skills", async () => {
    const r = await collect(
      { skills: ["Data Science", "zzqxv"], maxItems: 10 },
      { listings: { "datascience-jobs": [page(["A"])] } },
    );
    expect(r.stats.searches.map((s) => [s.slug, s.status])).toEqual([
      ["datascience-jobs", "done"],
      [null, "notFound"],
    ]);
    expect(r.out).toHaveLength(1);
    expect(r.logs.some((l) => /zzqxv: no Cutshort listing/.test(l))).toBe(true);
  });

  it("adds details and charges job-detail only when fetched", async () => {
    const withPage = fakeJob("AAAAAAAA", {
      publicUrl: "https://cutshort.io/job/Has-Page-AAAAAAAA",
    });
    const gone = fakeJob("BBBBBBBB", {
      publicUrl: "https://cutshort.io/job/Gone-BBBBBBBB",
    });
    const r = await collect(
      { skills: ["python"], maxItems: 10, includeDetails: true },
      {
        listings: { "python-jobs": [[withPage, gone]] },
        details: { "https://cutshort.io/job/Has-Page-AAAAAAAA": JOB_PAGE },
      },
    );
    expect(r.charges).toEqual([["job", "job-detail"], ["job"]]);
    expect(r.out[0]).toMatchObject({ jobValid: true, category: "tech" });
    expect(r.out[0]!.description).toBeTruthy();
    // Listing fields win over the job page's.
    expect(r.out[0]!.headline).toBe("Job AAAAAAAA");
    expect(r.out[1]).toMatchObject({ jobValid: false });
    expect(r.out[1]).not.toHaveProperty("description");
  });

  it("stops fetching details after many failures in a row", async () => {
    const jobs = page("ABCDEFGHIJKL".split(""));
    const r = await collect(
      { skills: ["python"], maxItems: 100, includeDetails: true },
      {
        listings: { "python-jobs": [jobs] },
        failing: new Set(jobs.map((j) => j.publicUrl!)),
      },
    );
    // 9 jobs kept without details; the 10th failure stops the search.
    expect(r.out).toHaveLength(9);
    expect(r.charges.every((c) => c.join() === "job")).toBe(true);
    expect(r.stats.searches[0]!.status).toBe("stopped");
    const sm = parseSitemap(SITEMAP)!;
    await expect(
      collect(
        { skills: [] },
        { sitemap: SITEMAP, failing: new Set(sm.map((e) => e.url)) },
      ),
    ).rejects.toThrow(/All job pages failed/);
  });

  it("fails only when every search failed", async () => {
    const url = listingDataUrl("python-jobs", 1);
    await expect(
      collect(
        { skills: ["python"] },
        { listings: { "python-jobs": [page(["A"])] }, failing: new Set([url]) },
      ),
    ).rejects.toThrow(/All searches failed/);
    const partial = await collect(
      { skills: ["python", "java"] },
      {
        listings: { "python-jobs": [page(["A"])], "java-jobs": [page(["B"])] },
        failing: new Set([url]),
      },
    );
    expect(partial.out).toHaveLength(1);
    expect(partial.stats.searches[0]!.status).toBe("failed");
  });

  it("exports all jobs from the sitemap with details", async () => {
    const r = await collect(
      { skills: [], maxItems: 2 },
      {
        sitemap: SITEMAP,
        details: {
          "https://cutshort.io/job/Sap-EWM-consultant-Chennai-Nexant-tech-solutions-MxxTz9eT":
            JOB_PAGE,
          "https://cutshort.io/job/Sales-Development-Representative-SDR-Kris-Work-8Stw6NjH":
            JOB_PAGE,
        },
      },
    );
    expect(r.out.map((j) => j.jobId)).toEqual(["8Stw6NjH", "MxxTz9eT"]);
    expect(r.charges).toEqual([
      ["job", "job-detail"],
      ["job", "job-detail"],
    ]);
    expect(r.stats.gone).toBeGreaterThan(0);
    expect(r.stats.stopReason).toBe("maxItems");
  });
});

describe("monitor mode", () => {
  const input = { skills: ["python"], maxItems: 100, monitorMode: true };

  it("reports new, updated and removed jobs; skips unchanged", async () => {
    const m = new Monitor();
    const first = await collect(
      input,
      { listings: { "python-jobs": [page(["A", "B", "C"])] } },
      m,
    );
    expect(first.out.map((j) => j.changeType)).toEqual(["new", "new", "new"]);

    // B changed salary, C is gone, D is new.
    const b = fakeJob("B", {
      salaryRange: { currency: "INR", minVanity: 1, maxVanity: 2 },
    });
    const restored = new Monitor(JSON.parse(JSON.stringify(m.toJSON())));
    const second = await collect(
      input,
      { listings: { "python-jobs": [[fakeJob("A"), b, fakeJob("D")]] } },
      restored,
    );
    expect(second.out.map((j) => `${j.changeType}:${j.headline}`)).toEqual([
      "updated:Job B",
      "new:Job D",
      "removed:Job C",
    ]);
    expect(second.stats).toMatchObject({
      new: 1,
      updated: 1,
      removed: 1,
      unchanged: 1,
    });
    expect(second.out[2]!.url).toBe(`https://cutshort.io/job/Job-${sid("C")}`);
    expect(restored.has(sid("C"))).toBe(false);
    expect(restored.size).toBe(3);

    const third = await collect(
      input,
      { listings: { "python-jobs": [[fakeJob("A"), b, fakeJob("D")]] } },
      restored,
    );
    expect(third.out).toEqual([]);
    expect(third.stats.unchanged).toBe(3);
  });

  it("checks removals only after a complete crawl", async () => {
    const m = new Monitor();
    await collect(
      input,
      { listings: { "python-jobs": [page(["A", "B"]), page(["C"])] } },
      m,
    );
    const r = await collect(
      { ...input, maxPages: 1 },
      { listings: { "python-jobs": [page(["A"]), page(["C"])] } },
      m,
    );
    expect(r.out).toEqual([]);
    expect(r.stats.removedSkipped).toMatch(/not read to the end/);
    expect(m.size).toBe(3);
  });

  it("detects sitemap additions and removals", async () => {
    const all = parseSitemap(SITEMAP)!;
    const m = new Monitor({
      version: 1,
      items: [
        ...all.slice(1).map((e) => [e.jobId, "", "x", "y", e.url]),
        ["OLDJOB01", "", "Old", "Co", "https://cutshort.io/job/Old-OLDJOB01"],
      ],
    });
    const r = await collect(
      { skills: [], maxItems: 10, monitorMode: true },
      {
        sitemap: SITEMAP,
        details: { [all[0]!.url]: JOB_PAGE },
      },
      m,
    );
    expect(r.out.map((j) => `${j.changeType}:${j.jobId}`)).toEqual([
      `new:${all[0]!.jobId}`,
      "removed:OLDJOB01",
    ]);
    expect(r.stats.unchanged).toBe(4);
  });

  it("persists and caps state", () => {
    const m = new Monitor(undefined, 2);
    for (const id of ["a", "b", "c"])
      m.record(id, {
        fingerprint: id,
        headline: null,
        companyName: null,
        url: null,
      });
    const json = m.toJSON();
    expect(json.items.map((e) => e[0])).toEqual(["b", "c"]);
    const back = new Monitor(json);
    expect(back.check("c", "c")).toBeNull();
    expect(back.check("b", "x")).toBe("updated");
    expect(back.check("z", "z")).toBe("new");
    expect(new Monitor("garbage").size).toBe(0);
    expect(stateKey({ a: 1, b: 2 })).toBe(stateKey({ b: 2, a: 1 }));
  });

  it("fingerprints content, not scrape time", () => {
    const j = listed("klKtwgZO");
    const a = fromListing(j, "x", "s", "2026-01-01");
    const b = fromListing(j, "x", "s", "2026-02-02");
    expect(contentFingerprint(a)).toBe(contentFingerprint(b));
    expect(contentFingerprint({ ...a, salaryMax: 1 })).not.toBe(
      contentFingerprint(a),
    );
  });
});

// ------------------------------------------------------------------ http

const res = (status: number, body: string) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  text: async () => body,
});

describe("CutshortClient", () => {
  const noSleep = async () => {};

  it("retries blocks and challenge pages, returns 4xx answers", async () => {
    const answers = [
      res(429, "slow down"),
      res(200, "<html><title>Just a moment...</title></html>"),
      res(200, "{}"),
      res(404, "<html>404</html>"),
    ];
    let rotations = 0;
    const fetch: FetchLike = async () => answers.shift()!;
    const c = new CutshortClient({
      fetch,
      sleep: noSleep,
      rotate: () => (rotations += 1),
    });
    expect((await c.get("https://cutshort.io/x", "json")).body).toBe("{}");
    expect(rotations).toBe(2);
    expect(c.blocks).toBe(2);
    expect((await c.get("https://cutshort.io/job/y", "html")).status).toBe(404);
  });

  it("treats HTML instead of JSON as a block and gives up eventually", async () => {
    const fetch: FetchLike = async () => res(200, "<html>nope</html>");
    const c = new CutshortClient({ fetch, sleep: noSleep, maxRetries: 2 });
    await expect(c.get("https://cutshort.io/x", "json")).rejects.toThrow(
      HttpError,
    );
    expect(c.requests).toBe(3);
    expect(classify(new HttpError(401, "", ""))).toBe("fatal");
    expect(classify(new Error("ECONNRESET"))).toBe("transient");
  });
});
