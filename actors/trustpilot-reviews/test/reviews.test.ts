import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  BlockedError,
  HttpError,
  SolverError,
  TrustpilotClient,
  type FetchLike,
} from "../src/client.js";
import { proxyUrlOrDirect } from "../src/http.js";
import {
  InputError,
  MAX_REVIEWS_PER_COMPANY,
  normalizeInput,
  parseCompany,
  type RawInput,
} from "../src/input.js";
import {
  challengeScriptUrl,
  extractNextData,
  isWafChallenge,
  parseReviewPage,
  reviewPageUrl,
  type TpBusinessUnit,
  type TpReview,
} from "../src/page.js";
import { toCompanyInfo, toRecord, type ReviewRecord } from "../src/record.js";
import { planFilters, runScrape, type PageClient } from "../src/run.js";
import { Monitor } from "../src/state.js";

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const GYMSHARK = fixture("gymshark-p1.html");
const APIFY_P10 = fixture("apify-p10.html");
const NOT_FOUND = fixture("not-found.html");
const LOGIN_WALL = fixture("login-wall.html");
const WAF = fixture("waf-challenge.html");

const gym = parseReviewPage(GYMSHARK);
if (gym.kind !== "reviews") throw new Error("fixture");
const BU: TpBusinessUnit = gym.businessUnit;
const TEMPLATE: TpReview = gym.reviews[0]!;

/** Synthetic review page: `n` reviews with ids `${prefix}-${i}`, newest first. */
function makePage(opts: {
  page: number;
  totalPages: number;
  ids: string[];
  dates?: string[];
  rating?: number;
  bu?: Partial<TpBusinessUnit>;
}): string {
  const reviews = opts.ids.map((id, i) => ({
    ...TEMPLATE,
    id,
    rating: opts.rating ?? TEMPLATE.rating,
    dates: {
      ...TEMPLATE.dates,
      publishedDate:
        opts.dates?.[i] ??
        new Date(
          Date.UTC(2026, 8, 29) - (opts.page * 100 + i) * 3600_000,
        ).toISOString(),
    },
  }));
  const data = {
    page: "/review/[businessUnit]",
    props: {
      pageProps: {
        businessUnit: { ...BU, ...opts.bu },
        reviews,
        filters: {
          pagination: {
            currentPage: opts.page,
            perPage: 20,
            totalCount: opts.totalPages * 20,
            totalPages: opts.totalPages,
          },
          reviewStatistics: { ratings: { one: 1, five: 2 } },
        },
      },
    },
  };
  return `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></html>`;
}

const ids = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${prefix}-${i}`);

/** Fake client serving pages by (company, page, stars). */
function fakeClient(
  serve: (company: string, page: number, stars: string[]) => string,
) {
  const urls: string[] = [];
  const client: PageClient = {
    get: vi.fn(async (url: string) => {
      urls.push(url);
      const u = new URL(url);
      const company = decodeURIComponent(u.pathname.split("/")[2]!);
      const page = Number(u.searchParams.get("page") ?? 1);
      const body = serve(company, page, u.searchParams.getAll("stars"));
      return { status: body === NOT_FOUND ? 404 : 200, body };
    }),
  };
  return { client, urls };
}

const collect = async (
  raw: RawInput,
  client: PageClient,
  emitResult: (n: number) => boolean = () => true,
) => {
  const out: ReviewRecord[] = [];
  const log = vi.fn();
  const stats = await runScrape(normalizeInput(raw), {
    client,
    log,
    emit: async (r) => {
      out.push(r);
      return emitResult(out.length);
    },
  });
  return { out, stats, log };
};

describe("input", () => {
  it("applies defaults that make a quick, successful run", () => {
    const i = normalizeInput({});
    expect(i.companies).toEqual(["apify.com"]);
    expect(i.maxReviewsPerCompany).toBe(20);
    expect(i.language).toBe("all");
    expect(i.sort).toBe("recency");
    expect(i.stars).toEqual([]);
    expect(i.includeCompanyInfo).toBe(true);
  });

  it("parses domains and Trustpilot URLs", () => {
    expect(parseCompany("Amazon.com")).toBe("amazon.com");
    expect(parseCompany("https://www.amazon.com/gp/help?x=1")).toBe(
      "www.amazon.com",
    );
    expect(
      parseCompany("https://uk.trustpilot.com/review/www.amazon.co.uk?page=2"),
    ).toBe("www.amazon.co.uk");
    expect(parseCompany("trustpilot.com/review/gymshark.com")).toBe(
      "gymshark.com",
    );
    expect(() => parseCompany("Amazon")).toThrow(InputError);
    expect(() => parseCompany("not a domain.com")).toThrow(InputError);
  });

  it("normalizes and validates", () => {
    const i = normalizeInput({
      companies: ["gymshark.com", "https://gymshark.com/", " "],
      stars: ["5", 1, "1"],
      language: "EN",
      sort: "relevance",
      maxReviewsPerCompany: 99_999,
    });
    expect(i.companies).toEqual(["gymshark.com"]);
    expect(i.stars).toEqual([1, 5]);
    expect(i.language).toBe("en");
    expect(i.sort).toBe("relevance");
    expect(i.maxReviewsPerCompany).toBe(MAX_REVIEWS_PER_COMPANY);
    expect(() => normalizeInput({ companies: [] })).toThrow(InputError);
    expect(() => normalizeInput({ stars: ["6"] })).toThrow(InputError);
    expect(() => normalizeInput({ language: "english" })).toThrow(InputError);
    expect(() => normalizeInput({ sort: "oldest" })).toThrow(InputError);
    expect(() => normalizeInput({ sinceDate: "09/01/2026" })).toThrow(
      InputError,
    );
    expect(() => normalizeInput({ maxReviewsPerCompany: 0 })).toThrow(
      InputError,
    );
  });

  it("forces recency sort in delta mode", () => {
    const i = normalizeInput({ sort: "relevance", sinceDate: "2026-09-01" });
    expect(i.sort).toBe("recency");
    expect(i.sinceDate).toBe("2026-09-01");
  });
});

describe("page", () => {
  it("builds review page URLs", () => {
    expect(
      reviewPageUrl("www.amazon.com", {
        page: 3,
        stars: [1, 2],
        language: "all",
        sort: "recency",
      }),
    ).toBe(
      "https://www.trustpilot.com/review/www.amazon.com?languages=all&page=3&sort=recency&stars=1&stars=2",
    );
    expect(
      reviewPageUrl("apify.com", {
        page: 1,
        language: "en",
        sort: "relevance",
      }),
    ).toBe("https://www.trustpilot.com/review/apify.com?languages=en");
  });

  it("parses a real review page", () => {
    expect(gym.kind).toBe("reviews");
    if (gym.kind !== "reviews") return;
    expect(gym.businessUnit.identifyingName).toBe("gymshark.com");
    expect(gym.businessUnit.displayName).toBe("Gymshark");
    expect(gym.reviews).toHaveLength(20);
    expect(gym.filters.pagination?.currentPage).toBe(1);
    const p10 = parseReviewPage(APIFY_P10);
    expect(p10.kind === "reviews" && p10.filters.pagination?.currentPage).toBe(
      10,
    );
  });

  it("recognizes not-found, login-wall and WAF pages", () => {
    expect(parseReviewPage(NOT_FOUND).kind).toBe("notFound");
    expect(parseReviewPage(LOGIN_WALL).kind).toBe("loginWall");
    expect(() => extractNextData(WAF)).toThrow();
    expect(isWafChallenge(403, WAF)).toBe(true);
    expect(isWafChallenge(202, "", "challenge")).toBe(true);
    expect(isWafChallenge(403, "Forbidden")).toBe(false);
    expect(isWafChallenge(200, GYMSHARK)).toBe(false);
    expect(challengeScriptUrl(WAF)).toMatch(
      /^https:\/\/[a-z0-9.]+\.awswaf\.com\/.+\/challenge\.js$/,
    );
  });
});

describe("record", () => {
  it("maps a review with a company reply", () => {
    const withReply =
      gym.kind === "reviews" && gym.reviews.find((r) => r.reply);
    if (!withReply) throw new Error("fixture has no reply");
    const r = toRecord(withReply, BU);
    expect(r).toMatchObject({
      companyDomain: "gymshark.com",
      companyName: "Gymshark",
      trustScore: BU.trustScore,
      totalReviews: BU.numberOfReviews,
      reviewId: withReply.id,
      rating: withReply.rating,
      companyReply: withReply.reply!.message!.trim(),
      companyReplyDate: withReply.reply!.publishedDate,
      url: `https://www.trustpilot.com/reviews/${withReply.id}`,
    });
    expect(r.experienceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof r.verified).toBe("boolean");
    expect(r.author).toBeTruthy();
    expect(r.authorCountry).toMatch(/^[A-Z]{2}$/);
    expect(r.company).toBeUndefined();
  });

  it("builds company info", () => {
    const c = toCompanyInfo(BU, { total: 3, one: 1, five: 2 });
    expect(c.profileUrl).toBe("https://www.trustpilot.com/review/gymshark.com");
    expect(c.ratingDistribution).toEqual({ "1": 1, "5": 2 });
    expect(c.categories.length).toBeGreaterThan(0);
    expect(c.trustpilotId).toBe(BU.id);
  });
});

describe("client", () => {
  const res = (
    status: number,
    body: string,
    headers: Record<string, string> = {},
  ) => ({
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    text: async () => body,
  });
  const make = (fetch: FetchLike, solve = vi.fn(async () => "TOKEN")) => ({
    solve,
    client: new TrustpilotClient({
      fetch,
      solveToken: solve,
      userAgent: "UA",
      sleep: async () => {},
      minIntervalMs: 0,
    }),
  });

  it("solves the WAF challenge once and reuses the token", async () => {
    const fetch = vi.fn<FetchLike>(async (_u, init) =>
      init.headers.cookie === "aws-waf-token=TOKEN"
        ? res(200, GYMSHARK)
        : res(403, WAF),
    );
    const { client, solve } = make(fetch);
    expect((await client.get("https://x/1")).status).toBe(200);
    expect((await client.get("https://x/2")).status).toBe(200);
    expect(solve).toHaveBeenCalledTimes(1);
    expect(solve.mock.calls[0]).toEqual([challengeScriptUrl(WAF)]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("reports solver failures without calling them blocking", async () => {
    const { client, solve } = make(
      async () => res(403, WAF),
      vi.fn(async () => {
        throw new Error("Could not launch a browser");
      }),
    );
    await expect(client.get("https://x")).rejects.toThrow(SolverError);
    await expect(client.get("https://x")).rejects.toThrow(/launch a browser/);
    expect(solve).toHaveBeenCalledTimes(2);
  });

  it("gives up when the token keeps being rejected", async () => {
    const { client } = make(async () => res(403, WAF));
    await expect(client.get("https://x")).rejects.toThrow(BlockedError);
  });

  it("retries 429 using Retry-After, returns 404 pages, fails on 400", async () => {
    let n = 0;
    const { client } = make(async () =>
      ++n === 1
        ? res(429, "slow down", { "retry-after": "1" })
        : res(200, "ok"),
    );
    expect((await client.get("https://x")).body).toBe("ok");
    expect(n).toBe(2);
    const nf = make(async () => res(404, NOT_FOUND)).client;
    expect((await nf.get("https://x")).status).toBe(404);
    const bad = make(async () => res(400, "bad")).client;
    await expect(bad.get("https://x")).rejects.toThrow(HttpError);
  });
});

describe("run", () => {
  it("paginates up to maxReviewsPerCompany and attaches company info", async () => {
    const { client, urls } = fakeClient((_c, page) =>
      makePage({ page, totalPages: 50, ids: ids(`p${page}`, 20) }),
    );
    const { out, stats } = await collect(
      { companies: ["gymshark.com"], maxReviewsPerCompany: 45 },
      client,
    );
    expect(out).toHaveLength(45);
    expect(urls).toHaveLength(3);
    expect(stats.companies["gymshark.com"]).toMatchObject({
      status: "ok",
      emitted: 45,
      pages: 3,
    });
    expect(out[0]!.company?.ratingDistribution).toEqual({ "1": 1, "5": 2 });
    expect(out[44]!.reviewId).toBe("p3-4");
  });

  it("stops at the last page and at the login wall", async () => {
    const short = fakeClient((_c, page) =>
      makePage({
        page,
        totalPages: 2,
        ids: ids(`p${page}`, page === 2 ? 5 : 20),
      }),
    );
    expect(
      (await collect({ maxReviewsPerCompany: 200 }, short.client)).out,
    ).toHaveLength(25);
    expect(short.urls).toHaveLength(2);

    const wall = fakeClient((_c, page) =>
      page > 1
        ? LOGIN_WALL
        : makePage({ page, totalPages: 99, ids: ids("a", 20) }),
    );
    expect(
      (await collect({ maxReviewsPerCompany: 100 }, wall.client)).out,
    ).toHaveLength(20);
  });

  it("onlyNew: forces recency, emits only unseen reviews, stops at watermark - grace", async () => {
    expect(normalizeInput({ sort: "relevance", onlyNew: true }).sort).toBe(
      "recency",
    );
    let pages: { ids: string[]; dates: string[] }[] = [
      {
        ids: ["b", "a"],
        dates: ["2026-09-20T10:00:00Z", "2026-09-19T10:00:00Z"],
      },
    ];
    const { client, urls } = fakeClient((_c, page) =>
      makePage({ page, totalPages: pages.length, ...pages[page - 1]! }),
    );
    const run = async (state: unknown) => {
      const monitor = new Monitor(state);
      const out: ReviewRecord[] = [];
      const afterCompany = vi.fn(async () => {});
      await runScrape(
        normalizeInput({ onlyNew: true, maxReviewsPerCompany: 100 }),
        {
          client,
          monitor,
          afterCompany,
          emit: async (r) => (out.push(r), true),
        },
      );
      expect(afterCompany).toHaveBeenCalledTimes(1);
      return { out: out.map((r) => r.reviewId), state: monitor.toJSON() };
    };

    const r1 = await run(undefined);
    expect(r1.out).toEqual(["b", "a"]);

    // New review "c"; "y" predates watermark - grace, so page 2 is never read.
    pages = [
      {
        ids: ["c", "b", "a", "y"],
        dates: [
          "2026-09-21T10:00:00Z",
          "2026-09-20T10:00:00Z",
          "2026-09-19T10:00:00Z",
          "2026-09-01T10:00:00Z",
        ],
      },
      { ids: ["z"], dates: ["2026-01-01T00:00:00Z"] },
    ];
    urls.length = 0;
    const r2 = await run(r1.state);
    expect(r2.out).toEqual(["c"]);
    expect(urls).toHaveLength(1);

    const r3 = await run(r2.state);
    expect(r3.out).toEqual([]);
  });

  it("delta mode: skips and stops at reviews older than sinceDate", async () => {
    const { client, urls } = fakeClient((_c, page) =>
      makePage({
        page,
        totalPages: 5,
        ids: ids(`p${page}`, 3),
        dates: [
          "2026-09-20T10:00:00Z",
          "2026-08-31T23:00:00Z",
          "2026-09-01T01:00:00Z",
        ],
      }),
    );
    const { out } = await collect(
      { maxReviewsPerCompany: 100, sinceDate: "2026-09-01" },
      client,
    );
    expect(out.map((r) => r.reviewId)).toEqual(["p1-0", "p1-2"]);
    expect(urls).toHaveLength(1);
  });

  it("dedupes reviews and companies that resolve to the same profile", async () => {
    const { client } = fakeClient((_c, page) =>
      makePage({ page, totalPages: 1, ids: ["x", "y", "x"] }),
    );
    const { out, stats, log } = await collect(
      {
        companies: ["gymshark.com", "www.gymshark.com"],
        includeCompanyInfo: false,
      },
      client,
    );
    expect(out.map((r) => r.reviewId)).toEqual(["x", "y"]);
    expect(out[0]!.company).toBeUndefined();
    expect(stats.companies["gymshark.com"]!.skippedDuplicate).toBe(1);
    expect(stats.companies["www.gymshark.com"]!.emitted).toBe(0);
    expect(log.mock.calls.flat().join()).toMatch(/same Trustpilot profile/);
  });

  it("reports unknown companies and continues", async () => {
    const { client } = fakeClient((c, page) =>
      c === "nope.com"
        ? NOT_FOUND
        : makePage({ page, totalPages: 1, ids: ids("a", 3) }),
    );
    const { out, stats } = await collect(
      { companies: ["nope.com", "gymshark.com"] },
      client,
    );
    expect(stats.companies["nope.com"]!.status).toBe("notFound");
    expect(out).toHaveLength(3);
  });

  it("fails only when every company fails", async () => {
    const boom: PageClient = {
      get: async () => {
        throw new Error("boom");
      },
    };
    await expect(
      collect({ companies: ["a.com", "b.com"] }, boom),
    ).rejects.toThrow(/All companies failed/);
    const { client } = fakeClient((c, page) => {
      if (c === "a.com") throw new Error("boom");
      return makePage({ page, totalPages: 1, ids: ids("b", 2) });
    });
    const { stats } = await collect({ companies: ["a.com", "b.com"] }, client);
    expect(stats.companies["a.com"]!.status).toBe("failed");
    expect(stats.emitted).toBe(2);
  });

  it("stops when the charge limit is reached", async () => {
    const { client } = fakeClient((_c, page) =>
      makePage({ page, totalPages: 9, ids: ids(`p${page}`, 20) }),
    );
    const { out, stats } = await collect(
      { companies: ["a.com", "b.com"], maxReviewsPerCompany: 100 },
      client,
      (n) => n < 7,
    );
    expect(out).toHaveLength(7);
    expect(stats.stopReason).toBe("budget");
  });

  it("splits by star rating past 200 and merges newest first", async () => {
    expect(planFilters(normalizeInput({}))).toEqual([[]]);
    expect(planFilters(normalizeInput({ maxReviewsPerCompany: 201 }))).toEqual([
      [5],
      [4],
      [3],
      [2],
      [1],
    ]);
    expect(
      planFilters(normalizeInput({ maxReviewsPerCompany: 500, stars: [1, 2] })),
    ).toEqual([[2], [1]]);
    expect(
      planFilters(normalizeInput({ maxReviewsPerCompany: 500, stars: [3] })),
    ).toEqual([[3]]);

    const { client } = fakeClient((_c, page, stars) => {
      const s = Number(stars[0]);
      // Interleaved timestamps: star s gets hours s, s+5, s+10, ...
      const dates = Array.from({ length: 20 }, (_, i) =>
        new Date(
          Date.UTC(2026, 8, 29) - ((page - 1) * 100 + i * 5 + s) * 3600_000,
        ).toISOString(),
      );
      return makePage({
        page,
        totalPages: 20,
        ids: ids(`s${s}p${page}`, 20),
        dates,
        rating: s,
      });
    });
    const { out } = await collect(
      { companies: ["a.com"], maxReviewsPerCompany: 250, stars: [1, 2] },
      client,
    );
    expect(out).toHaveLength(250);
    expect(out.slice(0, 4).map((r) => r.rating)).toEqual([1, 2, 1, 2]);
    const dates = out.map((r) => r.date!);
    expect([...dates].sort().reverse()).toEqual(dates);
  });
});

describe("proxy", () => {
  it("continues without a proxy when it can't be set up", async () => {
    const logs: string[] = [];
    const url = await proxyUrlOrDirect(
      async () => {
        throw new Error("You don't have access to proxy group RESIDENTIAL");
      },
      (m) => logs.push(m),
    );
    expect(url).toBeUndefined();
    expect(logs[0]).toMatch(/continuing without: .*RESIDENTIAL/);
    expect(
      await proxyUrlOrDirect(
        async () => "http://p:1",
        () => {},
      ),
    ).toBe("http://p:1");
  });
});
