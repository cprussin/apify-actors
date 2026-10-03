import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AlgoliaSearch,
  encodeParams,
  INDEX,
  INDEX_BY_LAUNCH,
  type SearchParams,
  type SearchResult,
} from "../src/algolia.js";
import { HttpError, YcClient, type FetchLike } from "../src/http.js";
import {
  InputError,
  normalizeCompanySlug,
  normalizeInput,
  normalizeRole,
  stateParams,
} from "../src/input.js";
import {
  buildSearch,
  FilterError,
  resolveFacetValues,
  run,
  toCompany,
  toJob,
  type CompanyResult,
  type Item,
  type JobResult,
  type RunDeps,
} from "../src/run.js";
import { Seen, stateKey } from "../src/state.js";
import {
  batchCode,
  batchRank,
  extractAlgoliaOpts,
  isBlockPage,
  isRemote,
  jobsListingUrl,
  normalizeBatch,
  parseEquity,
  parseExperience,
  parseJobsPage,
  parseSalary,
  splitLocations,
  type RawCompany,
} from "../src/yc.js";

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const DIRECTORY = fixture("companies.html");
const SE = fixture("jobs-software-engineer.html");
const PM_REMOTE = fixture("jobs-product-manager-remote.html");
const COMPANY = fixture("company-jobs.html");
const FACETS = JSON.parse(fixture("algolia-facets.json")) as {
  results: SearchResult[];
};
const S25 = JSON.parse(fixture("algolia-summer-2025.json")) as {
  results: SearchResult[];
};

describe("Algolia key", () => {
  it("extracts the app id and search key from the directory page", () => {
    const o = extractAlgoliaOpts(DIRECTORY);
    expect(o?.app).toBe("45BWZJ1SGC");
    expect(o?.key.length).toBeGreaterThan(100);
    // Secured key restricted to the public company indices.
    expect(Buffer.from(o!.key, "base64").toString()).toContain(
      "YCCompany_production",
    );
  });

  it("returns null when the page has no key", () => {
    expect(extractAlgoliaOpts("<html><body>nothing</body></html>")).toBeNull();
  });

  it("encodes search params", () => {
    const q = new URLSearchParams(
      encodeParams({
        query: "ai",
        facetFilters: [["batch:Summer 2025", "batch:Winter 2025"]],
        numericFilters: ["team_size>=10"],
        hitsPerPage: 50,
        page: 2,
        facets: ["batch"],
      }),
    );
    expect(q.get("query")).toBe("ai");
    expect(JSON.parse(q.get("facetFilters")!)).toEqual([
      ["batch:Summer 2025", "batch:Winter 2025"],
    ]);
    expect(JSON.parse(q.get("numericFilters")!)).toEqual(["team_size>=10"]);
    expect(q.get("hitsPerPage")).toBe("50");
    expect(q.get("page")).toBe("2");
    expect(q.get("maxValuesPerFacet")).toBe("1000");
    expect(q.get("attributesToHighlight")).toBe("[]");
  });
});

describe("batches", () => {
  it("normalizes batch names and codes", () => {
    expect(normalizeBatch("S25")).toBe("Summer 2025");
    expect(normalizeBatch("w2024")).toBe("Winter 2024");
    expect(normalizeBatch("X26")).toBe("Spring 2026");
    expect(normalizeBatch("f25")).toBe("Fall 2025");
    expect(normalizeBatch("summer 2025")).toBe("Summer 2025");
    expect(normalizeBatch("Winter-23")).toBe("Winter 2023");
    expect(normalizeBatch("Unspecified")).toBe("Unspecified");
  });

  it("builds batch codes and sorts newest first", () => {
    expect(batchCode("Summer 2025")).toBe("S25");
    expect(batchCode("Spring 2026")).toBe("X26");
    expect(batchCode("Unspecified")).toBeNull();
    const sorted = ["Winter 2025", "Unspecified", "Fall 2025", "Summer 2025"]
      .sort((a, b) => batchRank(a) - batchRank(b))
      .slice();
    expect(sorted).toEqual([
      "Fall 2025",
      "Summer 2025",
      "Winter 2025",
      "Unspecified",
    ]);
  });
});

describe("job fields", () => {
  it("parses salary ranges", () => {
    expect(parseSalary("$200K - $250K")).toEqual({
      salaryMin: 200000,
      salaryMax: 250000,
      salaryCurrency: "USD",
      salaryPeriod: null,
    });
    expect(parseSalary("₹3M - ₹8M INR")).toMatchObject({
      salaryMin: 3e6,
      salaryMax: 8e6,
      salaryCurrency: "INR",
    });
    expect(parseSalary("₹1M - ₹2.5M INR")).toMatchObject({
      salaryMin: 1e6,
      salaryMax: 2.5e6,
    });
    expect(parseSalary("£70K - £120K GBP").salaryCurrency).toBe("GBP");
    expect(parseSalary("$90K - $110K CAD").salaryCurrency).toBe("CAD");
    expect(parseSalary("€70K - €130K EUR")).toMatchObject({
      salaryMin: 70000,
      salaryCurrency: "EUR",
    });
    expect(parseSalary("$2K - $5K / monthly")).toEqual({
      salaryMin: 2000,
      salaryMax: 5000,
      salaryCurrency: "USD",
      salaryPeriod: "monthly",
    });
    expect(parseSalary("$150K")).toMatchObject({
      salaryMin: 150000,
      salaryMax: 150000,
    });
    expect(parseSalary("")).toEqual({
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
    });
  });

  it("parses equity, experience and locations", () => {
    expect(parseEquity("0.50% - 1.00%")).toEqual({
      equityMin: 0.5,
      equityMax: 1,
    });
    expect(parseEquity("1.00%")).toEqual({ equityMin: 1, equityMax: 1 });
    expect(parseEquity("")).toEqual({ equityMin: null, equityMax: null });
    expect(parseExperience("11+ years")).toBe(11);
    expect(parseExperience("1+ years")).toBe(1);
    expect(parseExperience("Any (new grads ok)")).toBe(0);
    expect(parseExperience(null)).toBeNull();
    expect(splitLocations("San Francisco, CA, US / Remote (US)")).toEqual([
      "San Francisco, CA, US",
      "Remote (US)",
    ]);
    expect(isRemote("US / Remote (US)")).toBe(true);
    expect(isRemote("New York, NY")).toBe(false);
  });

  it("builds listing URLs", () => {
    expect(jobsListingUrl({ role: "software-engineer", location: null })).toBe(
      "https://www.ycombinator.com/jobs/role/software-engineer",
    );
    expect(jobsListingUrl({ role: "designer", location: "remote" })).toBe(
      "https://www.ycombinator.com/jobs/role/designer/remote",
    );
    expect(jobsListingUrl({ role: null, location: "london" })).toBe(
      "https://www.ycombinator.com/jobs/location/london",
    );
    expect(() => jobsListingUrl({ role: null, location: null })).toThrow();
  });
});

describe("parsing (fixtures)", () => {
  it("parses a role page", () => {
    const p = parseJobsPage(SE)!;
    expect(p.kind).toBe("listing");
    expect(p.category).toBe("eng");
    expect(p.location).toBeNull();
    expect(p.jobs).toHaveLength(39);
    const j = toJob(p.jobs[0]!, "src", "2026-10-03T00:00:00.000Z");
    expect(j).toMatchObject({
      jobId: "94746",
      title: "Applied AI Engineer",
      jobUrl:
        "https://www.ycombinator.com/companies/infer/jobs/1DhbYdF-applied-ai-engineer",
      companyName: "Infer",
      companySlug: "infer",
      companyUrl: "https://www.ycombinator.com/companies/infer",
      companyBatch: "S21",
      location: "Bengaluru, KA, IN / Bengaluru, Karnataka, IN",
      remote: false,
      jobType: "Full-time",
      role: "Engineering",
      roleCategory: "eng",
      roleSubtype: "Machine learning",
      salaryRange: "₹2M - ₹5M INR",
      salaryMin: 2000000,
      salaryMax: 5000000,
      salaryCurrency: "INR",
      equityMin: 0.01,
      equityMax: 0.2,
      experience: "3+ years",
      minExperienceYears: 3,
      postedAgo: "5 months",
    });
  });

  it("parses a remote role page", () => {
    const p = parseJobsPage(PM_REMOTE)!;
    expect(p.category).toBe("product");
    expect(p.location).toBe("remote");
    expect(p.jobs).toHaveLength(12);
    const jobs = p.jobs.map((j) => toJob(j, "src", "t"));
    expect(jobs.every((j) => j.remote)).toBe(true);
    expect(jobs[0]).toMatchObject({
      title: "Product Manager",
      companyName: "Zippi",
      salaryMin: 70000,
      salaryMax: 150000,
      equityRange: null,
      equityMin: null,
    });
  });

  it("parses a company jobs page", () => {
    const p = parseJobsPage(COMPANY)!;
    expect(p.kind).toBe("company");
    expect(p.companySlug).toBe("infer");
    expect(p.jobs).toHaveLength(4);
    expect(p.jobs.every((j) => j.companyName === "Infer")).toBe(true);
  });

  it("parses every job into a complete item", () => {
    for (const html of [SE, PM_REMOTE, COMPANY]) {
      for (const raw of parseJobsPage(html)!.jobs) {
        const j = toJob(raw, "src", "t");
        expect(j.title).toBeTruthy();
        expect(j.companyName).toBeTruthy();
        expect(j.jobUrl).toMatch(
          /^https:\/\/www\.ycombinator\.com\/companies\//,
        );
        if (j.salaryRange) expect(j.salaryMax).toBeGreaterThan(0);
        if (j.equityRange) expect(j.equityMax).toBeGreaterThan(0);
      }
    }
  });

  it("maps an Algolia company", () => {
    const hit = S25.results[0]!.hits[0]!;
    const c = toCompany(hit, "2026-10-03T00:00:00.000Z");
    expect(c).toMatchObject({
      companyId: "30832",
      name: "F2",
      slug: "f2",
      oneLiner: "The AI platform for private markets investors",
      batch: "Summer 2025",
      batchCode: "S25",
      status: "Active",
      stage: "Early",
      industry: "B2B",
      subindustry: "Engineering, Product and Design",
      industries: ["B2B", "Engineering, Product and Design"],
      teamSize: 15,
      website: "http://f2.ai",
      ycUrl: "https://www.ycombinator.com/companies/f2",
      jobsUrl: "https://www.ycombinator.com/companies/f2/jobs",
      launchedAt: "2025-11-10T15:49:41.000Z",
      isHiring: true,
      topCompany: false,
    });
    expect(c.longDescription).toMatch(/^F2 is the AI platform/);
    expect(c.longDescription).not.toContain("\r");
    expect(c.logoUrl).toMatch(/^https:\/\//);
  });

  it("maps sparse companies to nulls", () => {
    const c = toCompany({ objectID: "1" }, "t");
    expect(c).toMatchObject({
      companyId: "1",
      name: null,
      ycUrl: null,
      jobsUrl: null,
      launchedAt: null,
      teamSize: null,
      industries: [],
      isHiring: false,
    });
  });

  it("detects block pages", () => {
    expect(isBlockPage("<title>Just a moment...</title>")).toBe(true);
    expect(isBlockPage(SE)).toBe(false);
    expect(parseJobsPage("<html></html>")).toBeNull();
  });
});

describe("filters", () => {
  const facets = FACETS.results[0]!.facets!;
  const base = normalizeInput({}).filters;

  it("resolves filter values case-insensitively", () => {
    const f = resolveFacetValues(
      {
        ...base,
        batches: ["Summer 2025"],
        industries: ["fintech", "engineering product and design"],
        regions: ["europe"],
        tags: ["artificial intelligence"],
      },
      facets,
    );
    expect(f.batches).toEqual(["Summer 2025"]);
    expect(f.industries).toEqual([
      "Fintech",
      "Engineering, Product and Design",
    ]);
    expect(f.regions).toEqual(["Europe"]);
    expect(f.tags).toEqual(["Artificial Intelligence"]);
  });

  it("rejects unknown values with suggestions", () => {
    expect(() =>
      resolveFacetValues({ ...base, industries: ["Fin"] }, facets),
    ).toThrow(FilterError);
    expect(() =>
      resolveFacetValues({ ...base, batches: ["Summer 1999"] }, facets),
    ).toThrow(/Unknown batch "Summer 1999"/);
  });

  it("builds facet and numeric filters", () => {
    expect(
      buildSearch({
        ...base,
        query: "ai",
        batches: ["Summer 2025", "Winter 2025"],
        statuses: ["Active"],
        hiringOnly: true,
        topCompaniesOnly: true,
        minTeamSize: 5,
        maxTeamSize: 50,
      }),
    ).toEqual({
      query: "ai",
      facetFilters: [
        ["batch:Summer 2025", "batch:Winter 2025"],
        ["status:Active"],
        ["isHiring:true"],
        ["top_company:true"],
      ],
      numericFilters: ["team_size>=5", "team_size<=50"],
    });
  });
});

describe("input", () => {
  it("applies defaults", () => {
    const i = normalizeInput(undefined);
    expect(i.mode).toBe("companies");
    expect(i.maxItems).toBe(20);
    expect(i.sortBy).toBe("relevance");
    expect(i.onlyNew).toBe(false);
    expect(i.jobRoles).toEqual([]);
  });

  it("normalizes company filters", () => {
    const i = normalizeInput({
      batches: "S25, w24",
      statuses: ["active", "Public"],
      query: "  payments ",
      minTeamSize: "5",
    });
    expect(i.filters.batches).toEqual(["Summer 2025", "Winter 2024"]);
    expect(i.filters.statuses).toEqual(["Active", "Public"]);
    expect(i.filters.query).toBe("payments");
    expect(i.filters.minTeamSize).toBe(5);
    expect(i.filters.maxTeamSize).toBeNull();
  });

  it("normalizes jobs input", () => {
    const i = normalizeInput({
      mode: "jobs",
      jobRoles: ["Software Engineer", "sales", "designer"],
      jobLocation: "New York",
      companySlugs: [
        "https://www.ycombinator.com/companies/Stripe/jobs",
        "airbnb",
      ],
    });
    expect(i.jobRoles).toEqual([
      "software-engineer",
      "sales-manager",
      "designer",
    ]);
    expect(i.jobLocation).toBe("new-york");
    expect(i.companySlugs).toEqual(["stripe", "airbnb"]);
    expect(normalizeInput({ mode: "jobs" }).jobRoles).toEqual([
      "software-engineer",
    ]);
    expect(
      normalizeInput({ mode: "jobs", jobLocation: "remote" }).jobRoles,
    ).toEqual([]);
  });

  it("rejects bad input", () => {
    expect(() => normalizeInput({ mode: "people" })).toThrow(InputError);
    expect(() => normalizeInput({ maxItems: 0 })).toThrow(InputError);
    expect(() => normalizeInput({ maxItems: "x" })).toThrow(InputError);
    expect(() => normalizeInput({ statuses: ["Dead"] })).toThrow(InputError);
    expect(() => normalizeInput({ minTeamSize: 10, maxTeamSize: 5 })).toThrow(
      InputError,
    );
    expect(() => normalizeRole("astronaut")).toThrow(/Unknown job role/);
    expect(() => normalizeCompanySlug("not a slug!")).toThrow(InputError);
  });

  it("keys onlyNew state by mode and filters, not limits or order", () => {
    const a = normalizeInput({ batches: ["S25", "W25"], maxItems: 10 });
    const b = normalizeInput({ batches: ["Winter 2025", "Summer 2025"] });
    const c = normalizeInput({ batches: ["S25"] });
    const j = normalizeInput({ mode: "jobs", batches: ["S25", "W25"] });
    expect(stateKey(stateParams(a))).toBe(stateKey(stateParams(b)));
    expect(stateKey(stateParams(a))).not.toBe(stateKey(stateParams(c)));
    expect(stateKey(stateParams(a))).not.toBe(stateKey(stateParams(j)));
    expect(stateKey(stateParams(a))).toMatch(/^STATE-[0-9a-f]{16}$/);
  });
});

// ---------------------------------------------------------------- run

/** Fake Algolia backed by recorded responses. */
function fixtureAlgolia(calls: SearchParams[] = []) {
  return new AlgoliaSearch({ app: "APP", key: "KEY" }, async (_url, body) => {
    const params = new URLSearchParams(
      (JSON.parse(body) as { requests: { params: string }[] }).requests[0]!
        .params,
    );
    calls.push({
      hitsPerPage: Number(params.get("hitsPerPage")),
      page: Number(params.get("page")),
      facetFilters: JSON.parse(params.get("facetFilters") ?? "[]"),
    });
    if (params.get("hitsPerPage") === "0")
      return { html: JSON.stringify(FACETS) };
    if (params.get("page") === "0") return { html: JSON.stringify(S25) };
    return {
      html: JSON.stringify({ results: [{ ...S25.results[0], hits: [] }] }),
    };
  });
}

function companiesDb(n: number, batches: string[]): RawCompany[] {
  return Array.from({ length: n }, (_, i) => ({
    objectID: String(i),
    name: `Co ${i}`,
    slug: `co-${i}`,
    batch: batches[i % batches.length],
    isHiring: i % 2 === 0,
  }));
}

/** Fake Algolia over an in-memory index with the 1,000-hit pagination cap. */
function memoryAlgolia(db: RawCompany[], indexes: string[] = []) {
  return new AlgoliaSearch({ app: "APP", key: "KEY" }, async (_url, body) => {
    const req = (
      JSON.parse(body) as { requests: { indexName: string; params: string }[] }
    ).requests[0]!;
    indexes.push(req.indexName);
    const params = new URLSearchParams(req.params);
    const ff = JSON.parse(params.get("facetFilters") ?? "[]") as string[][];
    const hits = db.filter((c) =>
      ff.every((group) =>
        group.some((f) => {
          const [k, v] = f.split(/:(.*)/) as [string, string];
          return String((c as Record<string, unknown>)[k]) === v;
        }),
      ),
    );
    const hpp = Number(params.get("hitsPerPage"));
    const page = Number(params.get("page"));
    const reachable = hits.slice(0, 1000);
    const facets: Record<string, number> = {};
    for (const c of hits) facets[c.batch!] = (facets[c.batch!] ?? 0) + 1;
    return {
      html: JSON.stringify({
        results: [
          {
            hits: hpp ? reachable.slice(page * hpp, (page + 1) * hpp) : [],
            nbHits: hits.length,
            nbPages: hpp ? Math.ceil(reachable.length / hpp) : 0,
            page,
            facets: { batch: facets },
          },
        ],
      }),
    };
  });
}

function deps(over: Partial<RunDeps> & { out?: Item[] } = {}): RunDeps {
  const out = over.out ?? [];
  return {
    get: async (url) => ({ url, html: "" }),
    algolia: async () => fixtureAlgolia(),
    emit: async (item) => (out.push(item), true),
    now: () => new Date("2026-10-03T00:00:00.000Z"),
    ...over,
  };
}

describe("run: companies", () => {
  it("returns companies matching the filters", async () => {
    const out: Item[] = [];
    const calls: SearchParams[] = [];
    const stats = await run(normalizeInput({ batches: ["s25"] }), {
      ...deps({ out }),
      algolia: async () => fixtureAlgolia(calls),
    });
    expect(out).toHaveLength(20);
    expect(stats.totalMatches).toBe(166);
    expect(stats.stopReason).toBe("maxItems");
    expect(
      (out as CompanyResult[]).every((c) => c.batch === "Summer 2025"),
    ).toBe(true);
    // Facet lookup, then one page with the resolved filter.
    expect(calls).toHaveLength(2);
    expect(calls[1]!.facetFilters).toEqual([["batch:Summer 2025"]]);
  });

  it("fails on filter values that match nothing", async () => {
    await expect(
      run(normalizeInput({ industries: ["Astrology"] }), deps()),
    ).rejects.toThrow(FilterError);
  });

  it("continues batch by batch past Algolia's 1,000-hit limit", async () => {
    const db = companiesDb(2500, ["Winter 2024", "Summer 2025", "Fall 2025"]);
    const out: Item[] = [];
    const logs: string[] = [];
    const stats = await run(normalizeInput({ maxItems: 2500 }), {
      ...deps({ out }),
      algolia: async () => memoryAlgolia(db),
      log: (m) => logs.push(m),
    });
    expect(out).toHaveLength(2500);
    expect(new Set(out.map((c) => (c as CompanyResult).companyId)).size).toBe(
      2500,
    );
    expect(stats.totalMatches).toBe(2500);
    expect(logs.join(" ")).toMatch(/batch by batch/);
  });

  it("uses the launch-date index only without a query", async () => {
    const db = companiesDb(5, ["Summer 2025"]);
    const indexes: string[] = [];
    await run(normalizeInput({ sortBy: "launchDate" }), {
      ...deps(),
      algolia: async () => memoryAlgolia(db, indexes),
    });
    await run(normalizeInput({ sortBy: "launchDate", query: "x" }), {
      ...deps(),
      algolia: async () => memoryAlgolia(db, indexes),
    });
    expect(indexes).toEqual([INDEX_BY_LAUNCH, INDEX]);
  });

  it("onlyNew skips companies returned before", async () => {
    const db = companiesDb(30, ["Summer 2025"]);
    const seen = new Seen();
    const first: Item[] = [];
    await run(normalizeInput({ maxItems: 10, onlyNew: true }), {
      ...deps({ out: first }),
      algolia: async () => memoryAlgolia(db),
      seen,
    });
    const second: Item[] = [];
    const stats = await run(normalizeInput({ maxItems: 10, onlyNew: true }), {
      ...deps({ out: second }),
      algolia: async () => memoryAlgolia(db),
      seen: new Seen(seen.toJSON()),
    });
    expect(stats.skippedSeen).toBe(10);
    expect(second.map((c) => (c as CompanyResult).companyId)).toEqual(
      db.slice(10, 20).map((c) => c.objectID),
    );
  });

  it("stops when the budget runs out", async () => {
    const db = companiesDb(30, ["Summer 2025"]);
    let n = 0;
    const stats = await run(normalizeInput({ maxItems: 30 }), {
      ...deps(),
      algolia: async () => memoryAlgolia(db),
      emit: async () => ++n < 5,
    });
    expect(n).toBe(5);
    expect(stats.stopReason).toBe("budget");
  });
});

describe("run: jobs", () => {
  const pages: Record<string, string> = {
    "https://www.ycombinator.com/jobs/role/software-engineer": SE,
    "https://www.ycombinator.com/jobs/role/product-manager/remote": PM_REMOTE,
    "https://www.ycombinator.com/companies/infer/jobs": COMPANY,
    // YC shows the software engineer page for unknown roles/locations.
    "https://www.ycombinator.com/jobs/role/software-engineer/atlantis": SE,
    "https://www.ycombinator.com/jobs/location/atlantis": SE,
  };
  const get = async (url: string) => {
    const html = pages[url];
    if (!html) throw new HttpError(404, "not found", url);
    return { url, html };
  };

  it("reads role pages and dedupes jobs across pages", async () => {
    const out: Item[] = [];
    const stats = await run(
      normalizeInput({
        mode: "jobs",
        jobRoles: ["software-engineer"],
        companySlugs: ["infer"],
        maxItems: 1000,
      }),
      deps({ out, get }),
    );
    // The Infer jobs page repeats the one Infer job on the role page.
    expect(out).toHaveLength(39 + 3);
    expect(stats.duplicates).toBe(1);
    expect(stats.sources.map((s) => s.status)).toEqual(["done", "done"]);
    const j = out[0] as JobResult;
    expect(j.sourceUrl).toBe(
      "https://www.ycombinator.com/jobs/role/software-engineer",
    );
    expect(j.scrapedAt).toBe("2026-10-03T00:00:00.000Z");
  });

  it("stops at maxItems", async () => {
    const out: Item[] = [];
    const stats = await run(
      normalizeInput({
        mode: "jobs",
        jobRoles: ["software-engineer"],
        maxItems: 10,
      }),
      deps({ out, get }),
    );
    expect(out).toHaveLength(10);
    expect(stats.stopReason).toBe("maxItems");
  });

  it("detects role pages that fell back to another location", async () => {
    await expect(
      run(
        normalizeInput({
          mode: "jobs",
          jobRoles: ["software-engineer"],
          jobLocation: "atlantis",
        }),
        deps({ get }),
      ),
    ).rejects.toThrow(/no jobs page for location "atlantis"/);
  });

  it("keeps going when one page fails", async () => {
    const out: Item[] = [];
    const logs: string[] = [];
    const stats = await run(
      normalizeInput({
        mode: "jobs",
        jobRoles: ["product-manager"],
        jobLocation: "remote",
        companySlugs: ["no-such-company"],
        maxItems: 100,
      }),
      deps({ out, get, log: (m) => logs.push(m) }),
    );
    expect(out).toHaveLength(12);
    expect(stats.sources.map((s) => s.status)).toEqual(["done", "failed"]);
    expect(logs[0]).toMatch(/HTTP 404/);
  });

  it("reads jobs of hiring companies matching the filters", async () => {
    const db: RawCompany[] = [
      { objectID: "1", slug: "infer", batch: "Summer 2021", isHiring: true },
      { objectID: "2", slug: "gone", batch: "Summer 2021", isHiring: false },
    ];
    const out: Item[] = [];
    const urls: string[] = [];
    const stats = await run(
      normalizeInput({
        mode: "jobs",
        jobsFromFilteredCompanies: true,
        maxItems: 100,
      }),
      deps({
        out,
        get: (url) => (urls.push(url), get(url)),
        algolia: async () => memoryAlgolia(db),
      }),
    );
    expect(urls).toEqual(["https://www.ycombinator.com/companies/infer/jobs"]);
    expect(out).toHaveLength(4);
    expect(stats.totalMatches).toBe(1);
  });

  it("onlyNew skips jobs returned before", async () => {
    const seen = new Seen();
    const input = normalizeInput({
      mode: "jobs",
      companySlugs: ["infer"],
      onlyNew: true,
    });
    await run(input, deps({ get, seen }));
    const out: Item[] = [];
    const stats = await run(input, deps({ out, get, seen }));
    expect(out).toHaveLength(0);
    expect(stats.skippedSeen).toBe(4);
    expect(stats.sources[0]!.status).toBe("done");
  });
});

describe("http client", () => {
  it("retries POSTs on 5xx and returns the body", async () => {
    let n = 0;
    const fetch: FetchLike = async (_url, init) => {
      n += 1;
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe("{}");
      return {
        ok: n > 1,
        status: n > 1 ? 200 : 503,
        headers: { get: () => null },
        text: async () => (n > 1 ? '{"results":[]}' : "busy"),
      };
    };
    const c = new YcClient({ fetch, sleep: async () => {} });
    const res = await c.post(
      "https://x.algolia.net/1/indexes/*/queries",
      "{}",
      {
        "content-type": "application/json",
      },
    );
    expect(res.html).toBe('{"results":[]}');
    expect(c.errors).toBe(1);
  });

  it("does not retry 404s", async () => {
    let n = 0;
    const fetch: FetchLike = async () => {
      n += 1;
      return {
        ok: false,
        status: 404,
        headers: { get: () => null },
        text: async () => "nope",
      };
    };
    const c = new YcClient({ fetch, sleep: async () => {} });
    await expect(c.get("https://www.ycombinator.com/x")).rejects.toThrow(
      HttpError,
    );
    expect(n).toBe(1);
  });
});

describe("dataset schema", () => {
  const schema = JSON.parse(fixture("../../.actor/dataset_schema.json")) as {
    fields: {
      properties: Record<string, { type: string[] }>;
      required?: string[];
    };
  };

  it("describes every output field, all nullable", () => {
    const props = schema.fields.properties;
    const company = toCompany(S25.results[0]!.hits[0]!, "t");
    const job = toJob(parseJobsPage(SE)!.jobs[0]!, "src", "t");
    for (const key of [...Object.keys(company), ...Object.keys(job)]) {
      expect(props[key], key).toBeDefined();
      expect(props[key]!.type).toContain("null");
    }
    expect(schema.fields.required ?? []).toEqual([]);
  });
});
