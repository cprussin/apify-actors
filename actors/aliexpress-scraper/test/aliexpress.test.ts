import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { Budget } from "../src/budget.js";
import { BlockedError, isChallenge, ParseError } from "../src/challenge.js";
import { aliexpressDeps, browserHeaders } from "../src/client.js";
import { PoliteFetcher, type Route } from "../src/fetcher.js";
import {
  InputError,
  localeCookie,
  normalizeInput,
  parseProductId,
  parseSearchUrl,
} from "../src/input.js";
import {
  parseReviewDate,
  parseReviewPage,
  reviewsUrl,
  type Review,
  type ReviewPage,
} from "../src/reviews.js";
import { ONLY_NEW_STALE_PAGES, runScraper, type RunDeps } from "../src/run.js";
import { Seen } from "../src/state.js";
import {
  canonicalProductId,
  extractInitData,
  keywordUrl,
  pageUrl,
  parseSearchPage,
  parseSoldCount,
  type Product,
  type SearchPage,
} from "../src/search.js";

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const noSleep = async () => {};

describe("search URLs", () => {
  it("builds keyword URLs", () => {
    expect(keywordUrl("phone case")).toBe(
      "https://www.aliexpress.com/w/wholesale-phone-case.html",
    );
    expect(keywordUrl("  usb c / hub ")).toBe(
      "https://www.aliexpress.com/w/wholesale-usb-c-hub.html",
    );
    expect(keywordUrl("écouteurs")).toBe(
      "https://www.aliexpress.com/w/wholesale-%C3%A9couteurs.html",
    );
  });

  it("sets page and sort, keeping an explicit SortType", () => {
    expect(
      pageUrl("https://www.aliexpress.com/w/wholesale-x.html", 3, "orders"),
    ).toBe(
      "https://www.aliexpress.com/w/wholesale-x.html?page=3&SortType=total_tranpro_desc",
    );
    expect(
      pageUrl(
        "https://www.aliexpress.com/w/wholesale-x.html?SortType=price_asc&page=9",
        2,
        "orders",
      ),
    ).toBe(
      "https://www.aliexpress.com/w/wholesale-x.html?SortType=price_asc&page=2",
    );
    expect(
      pageUrl("https://www.aliexpress.com/w/wholesale-x.html", 1, "default"),
    ).toBe("https://www.aliexpress.com/w/wholesale-x.html?page=1");
  });

  it("normalizes pasted search URLs", () => {
    expect(
      parseSearchUrl(
        "https://de.aliexpress.com/wholesale?SearchText=led+strip&SortType=price_asc",
      ),
    ).toBe(
      "https://www.aliexpress.com/w/wholesale-led-strip.html?SortType=price_asc",
    );
    expect(parseSearchUrl("http://aliexpress.us/w/wholesale-x.html")).toBe(
      "https://www.aliexpress.com/w/wholesale-x.html",
    );
    expect(() => parseSearchUrl("https://example.com/w/x.html")).toThrow(
      InputError,
    );
    expect(() =>
      parseSearchUrl("https://www.aliexpress.com/item/1005007502032342.html"),
    ).toThrow(/productIds/);
  });
});

describe("product IDs", () => {
  it("maps redirected IDs to canonical ones", () => {
    expect(canonicalProductId("3256807315717590")).toBe("1005007502032342");
    expect(canonicalProductId("2251832802683590")).toBe("32988998342");
    expect(canonicalProductId("1005007502032342")).toBe("1005007502032342");
    expect(canonicalProductId("32988998342")).toBe("32988998342");
  });

  it.each([
    ["1005007502032342", "1005007502032342"],
    [
      "https://www.aliexpress.com/item/1005007502032342.html?spm=a2g0o",
      "1005007502032342",
    ],
    [
      "https://www.aliexpress.us/item/3256807315717590.html",
      "1005007502032342",
    ],
    ["https://m.aliexpress.com/item/32988998342.html", "32988998342"],
    [
      "https://feedback.aliexpress.com/x?productId=1005007502032342",
      "1005007502032342",
    ],
  ])("parses %s", (s, id) => {
    expect(parseProductId(s)).toBe(id);
  });

  it("rejects garbage", () => {
    expect(() => parseProductId("hello")).toThrow(InputError);
  });
});

describe("parseSoldCount", () => {
  it.each([
    ["50,000+ sold", 50000],
    ["100K+ sold", 100000],
    ["1.2K sold", 1200],
    ["10.000+  vendido(s)", 10000],
    ["6 sold", 6],
    ["418 sold", 418],
    [null, null],
    ["sold out", null],
  ])("%s → %s", (s, n) => {
    expect(parseSoldCount(s)).toBe(n);
  });
});

describe("parseSearchPage", () => {
  it("parses the full US card format", () => {
    const page = parseSearchPage(fixture("search-us.html"));
    expect(page.currency).toBe("USD");
    expect(page.shipTo).toBe("US");
    expect(page.totalResults).toBe(84285);
    expect(page.finished).toBe(false);
    expect(page.products).toHaveLength(4);
    const [a, b, c] = page.products;
    expect(a).toMatchObject({
      type: "product",
      productId: "1005010439419248",
      url: "https://www.aliexpress.com/item/1005010439419248.html",
      price: 0.33,
      originalPrice: 3.23,
      discountPercent: 89,
      currency: "USD",
      formattedPrice: "US $0.33",
      soldCount: 58903,
      soldText: "50,000+ sold",
      rating: 4.9,
      storeName: "Shop1105328474 Store",
      isAd: false,
      isChoice: true,
      delivery: "Delivery: Oct 05 - 12",
      listedAt: "2025-11-25",
      shipTo: "US",
    });
    expect(a!.title).toMatch(/^Magnetic Original Clear Case/);
    expect(a!.imageUrl).toMatch(
      /^https:\/\/ae-pic-a1\.aliexpress-media\.com\//,
    );
    expect(a!.images.length).toBeGreaterThan(1);
    expect(a!.categoryIds).toEqual(["202192403", "202228401", "202229005"]);
    // No price block: falls back to the tracking amounts (cents).
    expect(b).toMatchObject({
      productId: "1005007502032342",
      price: 1.09,
      originalPrice: 2.84,
      currency: "USD",
      soldCount: 134896,
      rating: 4.7,
    });
    expect(c).toMatchObject({ isAd: true, rating: null, price: 4.52 });
  });

  it("parses the lean EU card format", () => {
    const page = parseSearchPage(fixture("search-de.html"));
    expect(page.currency).toBe("EUR");
    expect(page.shipTo).toBe("DE");
    expect(page.products).toHaveLength(3);
    expect(page.products[0]).toMatchObject({
      productId: "1005010018401645",
      price: 2.33,
      currency: "EUR",
      formattedPrice: "2,33€",
      rating: null,
      soldCount: null,
    });
  });

  it("reads the last page flag", () => {
    const page = parseSearchPage(fixture("search-few.html"));
    expect(page.finished).toBe(true);
    expect(page.products.length).toBeGreaterThan(0);
  });

  it("detects bot checks", () => {
    const html = fixture("challenge.html");
    expect(isChallenge(html)).toBe(true);
    expect(() => parseSearchPage(html)).toThrow(BlockedError);
    expect(isChallenge(fixture("search-us.html"))).toBe(false);
  });

  it("raises ParseError for large pages without data", () => {
    expect(() => parseSearchPage(`<html>${"x".repeat(60_000)}</html>`)).toThrow(
      ParseError,
    );
  });

  it("extracts init data", () => {
    expect(extractInitData("nothing")).toBeNull();
    expect(
      extractInitData(
        'x._init_data_= { data: {"a":1} }/*!-->init-data-end--*/',
      ),
    ).toEqual({ a: 1 });
  });
});

describe("reviews", () => {
  it("builds review URLs", () => {
    expect(reviewsUrl("1005007502032342", 2)).toBe(
      "https://feedback.aliexpress.com/pc/searchEvaluation.do?productId=1005007502032342&page=2&pageSize=20&filter=all",
    );
    expect(reviewsUrl("1", 1, { translateTo: "de" })).toContain(
      "&lang=de_DE&translate=Y",
    );
  });

  it("parses dates", () => {
    expect(parseReviewDate("28 Oct 2025")).toBe("2025-10-28");
    expect(parseReviewDate("05 Dec 2025")).toBe("2025-12-05");
    expect(parseReviewDate("28 Okt. 2025")).toBeNull();
    expect(parseReviewDate(null)).toBeNull();
  });

  it("parses a review page", () => {
    const page = parseReviewPage(
      fixture("reviews-page1.json"),
      "1005007502032342",
    );
    expect(page).toMatchObject({
      page: 1,
      totalPages: 652,
      totalReviews: 13029,
      averageRating: 4.7,
    });
    expect(page.reviews).toHaveLength(3);
    expect(page.reviews[0]).toMatchObject({
      type: "review",
      productId: "1005007502032342",
      reviewId: "30095293965319341",
      rating: 5,
      date: "2025-10-28",
      dateText: "28 Oct 2025",
      buyerName: "Z***c",
      buyerCountry: "HR",
      skuInfo: "Color:Black Material:For iPhone 13 Pro",
      translatedText: null,
      productUrl: "https://www.aliexpress.com/item/1005007502032342.html",
    });
    expect(page.reviews[0]!.images).toHaveLength(3);
    expect(page.reviews[0]!.text).toMatch(/^Very good case/);
  });

  it("reads follow-up feedback and helpful votes", () => {
    const page = parseReviewPage(fixture("reviews-additional.json"), "1");
    expect(page.reviews[0]).toMatchObject({
      reviewId: "60095694216083489",
      helpfulCount: 4,
      additionalFeedbackDate: "2026-02-25",
      buyerName: "AliExpress Shopper",
    });
    expect(page.reviews[0]!.additionalFeedback).toMatch(/^Olvide/);
    expect(page.reviews[0]!.additionalImages).toHaveLength(1);
  });

  it("keeps translations only when they differ", () => {
    const page = parseReviewPage(fixture("reviews-translated.json"), "1");
    expect(page.reviews[0]!.translatedText).toBeNull();
    expect(page.reviews[1]!.translatedText).toBe(
      "Great, also has camera protection.",
    );
  });

  it("handles products without reviews", () => {
    const page = parseReviewPage(fixture("reviews-empty.json"), "1");
    expect(page).toMatchObject({ reviews: [], totalPages: 0, totalReviews: 0 });
  });

  it("detects bot checks", () => {
    expect(() => parseReviewPage(fixture("challenge.html"), "1")).toThrow(
      BlockedError,
    );
    const json = JSON.stringify({
      ret: ["FAIL_SYS_USER_VALIDATE", "RGV587_ERROR::SM"],
      data: {
        url: "https://feedback.aliexpress.com/_____tmd_____/punish?x5secdata=x",
      },
    });
    expect(() => parseReviewPage(json, "1")).toThrow(BlockedError);
    expect(() => parseReviewPage('{"foo":1}', "1")).toThrow(ParseError);
  });
});

describe("normalizeInput", () => {
  it("applies defaults", () => {
    const i = normalizeInput({ keywords: ["phone case", " ", "phone case"] });
    expect(i).toMatchObject({
      maxPages: 1,
      sort: "default",
      includeReviews: true,
      reviewsForTopProducts: 3,
      maxReviewsPerProduct: 10,
      shipTo: "US",
      currency: "USD",
      language: "en",
      productIds: [],
    });
    expect(i.searches).toEqual([
      {
        keyword: "phone case",
        url: "https://www.aliexpress.com/w/wholesale-phone-case.html",
      },
    ]);
  });

  it("accepts product IDs only", () => {
    const i = normalizeInput({
      keywords: [],
      productIds: [
        "3256807315717590",
        { url: "https://www.aliexpress.com/item/1005007502032342.html" },
      ],
    });
    expect(i.searches).toEqual([]);
    expect(i.productIds).toEqual(["1005007502032342"]);
  });

  it("validates", () => {
    expect(() => normalizeInput({ keywords: [] })).toThrow(/at least one/);
    expect(() => normalizeInput({ keywords: ["x"], sort: "bogus" })).toThrow(
      InputError,
    );
    expect(() => normalizeInput({ keywords: ["x"], shipTo: "USA" })).toThrow(
      InputError,
    );
    expect(() => normalizeInput({ keywords: ["x"], currency: "US" })).toThrow(
      InputError,
    );
    expect(() =>
      normalizeInput({ keywords: ["x"], maxPagesPerKeyword: 0 }),
    ).toThrow(InputError);
    expect(
      normalizeInput({ keywords: ["x"], maxPagesPerKeyword: 500 }).maxPages,
    ).toBe(60);
    expect(normalizeInput({ keywords: ["x"], shipTo: "uk" }).shipTo).toBe("GB");
  });

  it("builds the locale cookie and headers", () => {
    const i = normalizeInput({
      keywords: ["x"],
      shipTo: "de",
      currency: "eur",
      language: "de",
    });
    expect(localeCookie(i, "de_DE")).toBe(
      "aep_usuc_f=site=glo&c_tp=EUR&region=DE&b_locale=de_DE",
    );
    expect(browserHeaders(i, "json")).toMatchObject({
      cookie: "aep_usuc_f=site=glo&c_tp=EUR&region=DE&b_locale=de_DE",
      "accept-language": "de-DE,de;q=0.9,en;q=0.8",
      referer: "https://www.aliexpress.com/",
    });
  });
});

// normalizeInput(null) must fail: no keywords after defaults are merged.
it("normalizeInput(null) without schema defaults has no searches", () => {
  expect(() => normalizeInput({})).toThrow(InputError);
});

describe("PoliteFetcher", () => {
  const route = (
    name: string,
    responses: { status: number; text: string }[],
  ): Route & { resets: number; calls: number } => {
    let i = 0;
    return {
      name,
      resets: 0,
      calls: 0,
      get requests() {
        return this.calls;
      },
      async get() {
        this.calls += 1;
        return responses[Math.min(i++, responses.length - 1)]!;
      },
      reset() {
        this.resets += 1;
      },
    };
  };
  const ok = { status: 200, text: "OK" };
  const captcha = { status: 200, text: fixture("challenge.html") };
  const parse = (t: string) => {
    if (isChallenge(t)) throw new BlockedError("captcha");
    return t;
  };

  it("paces requests with jittered delays", async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const f = new PoliteFetcher([route("direct", [ok])], {
      sleep,
      minDelayMs: 1000,
      maxDelayMs: 1000,
    });
    await f.fetch("u", {}, parse);
    await f.fetch("u", {}, parse);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls[0]![0]).toBeGreaterThan(900);
  });

  it("rotates the session after a captcha, then succeeds", async () => {
    const r = route("direct", [captcha, ok]);
    const f = new PoliteFetcher([r], { sleep: noSleep });
    expect(await f.fetch("u", {}, parse)).toBe("OK");
    expect(r.resets).toBe(1);
    expect(f.blocks).toBe(1);
  });

  it("switches to the next route when one stays blocked", async () => {
    const direct = route("direct", [{ status: 403, text: "" }]);
    const proxy = route("proxy", [ok]);
    const log = vi.fn();
    const f = new PoliteFetcher([direct, proxy], {
      sleep: noSleep,
      blockedRetries: 2,
      log,
    });
    expect(await f.fetch("u", {}, parse)).toBe("OK");
    expect(direct.calls).toBe(3);
    expect(f.routeName).toBe("proxy");
    expect(log.mock.calls.at(-1)![0]).toMatch(/switching to proxy/);
    // Later requests stay on the proxy.
    await f.fetch("u", {}, parse);
    expect(direct.calls).toBe(3);
  });

  it("throws BlockedError when every route is blocked", async () => {
    const f = new PoliteFetcher(
      [route("a", [captcha]), route("b", [captcha])],
      {
        sleep: noSleep,
        blockedRetries: 1,
      },
    );
    await expect(f.fetch("u", {}, parse)).rejects.toThrow(BlockedError);
    expect(f.blocks).toBe(4);
  });

  it("does not retry parse errors", async () => {
    const r = route("a", [ok]);
    const f = new PoliteFetcher([r], { sleep: noSleep });
    await expect(
      f.fetch("u", {}, () => {
        throw new ParseError("bad");
      }),
    ).rejects.toThrow(ParseError);
    expect(r.calls).toBe(1);
  });

  it("wires AliExpress requests with headers and parsers", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const r: Route = {
      name: "fake",
      requests: 0,
      async get(url, headers) {
        seen.push({ url, headers });
        return {
          status: 200,
          text: url.includes("feedback")
            ? fixture("reviews-page1.json")
            : fixture("search-us.html"),
        };
      },
      reset() {},
    };
    const input = normalizeInput({
      keywords: ["x"],
      translateReviews: true,
      language: "fr",
    });
    const deps = aliexpressDeps(
      new PoliteFetcher([r], { sleep: noSleep }),
      input,
    );
    expect(
      (
        await deps.fetchSearch(
          "https://www.aliexpress.com/w/wholesale-x.html?page=1",
        )
      ).products,
    ).toHaveLength(4);
    expect((await deps.fetchReviews("123", 2)).reviews).toHaveLength(3);
    expect(seen[0]!.headers.accept).toMatch(/text\/html/);
    expect(seen[1]!.url).toContain("productId=123&page=2");
    expect(seen[1]!.url).toContain("lang=fr_FR&translate=Y");
  });
});

describe("Budget", () => {
  it("stops when the next event no longer fits", () => {
    const b = new Budget(0.01, { product: 0.004, review: 0.002 });
    expect(b.canAfford("product")).toBe(true);
    expect(b.charge("product")).toBe(true); // 0.004
    expect(b.charge("product")).toBe(false); // 0.008, next would be 0.012
    expect(b.canAfford("review")).toBe(true);
    expect(b.charge("review")).toBe(false); // 0.010
  });
});

describe("runScraper", () => {
  const product = (id: string): SearchPage["products"][number] => ({
    ...parseSearchPage(fixture("search-us.html")).products[0]!,
    productId: id,
    title: `Product ${id}`,
  });
  const review = (pid: string, id: string): ReviewPage["reviews"][number] => ({
    ...parseReviewPage(fixture("reviews-page1.json"), pid).reviews[0]!,
    reviewId: id,
  });
  const searchPage = (
    ids: string[],
    extra: Partial<SearchPage> = {},
  ): SearchPage => ({
    products: ids.map(product),
    totalResults: 1000,
    finished: false,
    currency: "USD",
    shipTo: "US",
    ...extra,
  });
  const setup = (over: Partial<RunDeps> = {}) => {
    const out: (Product | Review)[] = [];
    const deps: RunDeps = {
      fetchSearch: vi.fn(async (url: string) => {
        const page = Number(new URL(url).searchParams.get("page"));
        return searchPage([`${page}1`, `${page}2`, "dup"]);
      }),
      fetchReviews: vi.fn(async (pid: string, page: number) => ({
        reviews: [review(pid, `${page}a`), review(pid, `${page}b`)],
        page,
        totalPages: 3,
        totalReviews: 6,
        averageRating: 4.5,
      })),
      emit: async (x) => (out.push(x), true),
      now: () => new Date("2026-09-30T00:00:00Z"),
      ...over,
    };
    return { out, deps };
  };

  it("scrapes pages, dedupes, and fetches reviews for the top products", async () => {
    const { out, deps } = setup();
    const stats = await runScraper(
      normalizeInput({
        keywords: ["a"],
        maxPagesPerKeyword: 2,
        reviewsForTopProducts: 2,
        maxReviewsPerProduct: 3,
        productIds: ["999999999"],
      }),
      deps,
    );
    const products = out.filter((x) => x.type === "product") as Product[];
    expect(products.map((p) => p.productId)).toEqual([
      "11",
      "12",
      "dup",
      "21",
      "22",
    ]);
    expect(products[3]).toMatchObject({
      searchKeyword: "a",
      searchPage: 2,
      position: 61,
      scrapedAt: "2026-09-30T00:00:00.000Z",
    });
    const reviews = out.filter((x) => x.type === "review") as Review[];
    // 3 targets (explicit ID first) × 3 reviews each.
    expect(reviews).toHaveLength(9);
    expect(reviews[0]).toMatchObject({
      productId: "999999999",
      productTitle: null,
    });
    expect(reviews[3]).toMatchObject({
      productId: "11",
      productTitle: "Product 11",
    });
    expect(stats.searches[0]).toMatchObject({
      pages: 2,
      products: 5,
      status: "maxPages",
    });
    expect(stats.reviewTargets.map((t) => t.status)).toEqual([
      "maxReviews",
      "maxReviews",
      "maxReviews",
    ]);
  });

  it("stops at the last page", async () => {
    const { deps } = setup({
      fetchSearch: vi.fn(async () => searchPage(["1"], { finished: true })),
    });
    const stats = await runScraper(
      normalizeInput({
        keywords: ["a"],
        maxPagesPerKeyword: 5,
        includeReviews: false,
      }),
      deps,
    );
    expect(deps.fetchSearch).toHaveBeenCalledTimes(1);
    expect(stats.searches[0]!.status).toBe("lastPage");
  });

  it("stops reviews when AliExpress wraps around to page 1", async () => {
    const { out, deps } = setup({
      fetchReviews: vi.fn(async (pid: string, page: number) => ({
        reviews: [review(pid, `r${page === 1 ? 1 : 2}`)],
        page: 1,
        totalPages: 99,
        totalReviews: 99,
        averageRating: null,
      })),
    });
    await runScraper(
      normalizeInput({ keywords: [], productIds: ["123456789"] }),
      deps,
    );
    expect(out).toHaveLength(1);
  });

  it("stops everything when the budget runs out", async () => {
    let n = 0;
    const { deps } = setup({ emit: async () => ++n < 4 });
    const stats = await runScraper(
      normalizeInput({ keywords: ["a", "b"], maxPagesPerKeyword: 3 }),
      deps,
    );
    expect(n).toBe(4);
    expect(stats.stopReason).toBe("budget");
    expect(deps.fetchReviews).not.toHaveBeenCalled();
  });

  it("keeps going when one search fails", async () => {
    const { out, deps } = setup({
      fetchSearch: vi.fn(async (url: string) => {
        if (url.includes("bad")) throw new ParseError("broken");
        return searchPage(["1"], { finished: true });
      }),
    });
    const log = vi.fn();
    const stats = await runScraper(
      normalizeInput({ keywords: ["bad", "good"], includeReviews: false }),
      { ...deps, log },
    );
    expect(out).toHaveLength(1);
    expect(stats.searches.map((s) => s.status)).toEqual(["failed", "lastPage"]);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/broken/));
  });

  it("stops on a block but keeps what it has", async () => {
    const { deps } = setup({
      fetchReviews: vi.fn(async () => {
        throw new BlockedError("captcha");
      }),
    });
    const stats = await runScraper(normalizeInput({ keywords: ["a"] }), deps);
    expect(stats.stopReason).toBe("blocked");
    expect(stats.products).toBe(3);
    expect(deps.fetchReviews).toHaveBeenCalledTimes(1);
  });

  it("onlyNew: skips (and doesn't charge) items returned by earlier runs", async () => {
    const input = normalizeInput({
      keywords: ["a"],
      reviewsForTopProducts: 1,
      maxReviewsPerProduct: 100,
      onlyNew: true,
    });
    const run = async (state: unknown, deps: Partial<RunDeps> = {}) => {
      const seen = new Seen(state);
      const { out, deps: d } = setup({ ...deps, seen });
      const stats = await runScraper(input, d);
      return { out, stats, d, state: seen.toJSON() };
    };
    const ids = (out: (Product | Review)[]) =>
      out.map((x) => (x.type === "product" ? x.productId : x.reviewId));

    const r1 = await run(undefined);
    expect(ids(r1.out)).toEqual([
      "11",
      "12",
      "dup",
      "1a",
      "1b",
      "2a",
      "2b",
      "3a",
      "3b",
    ]);

    // Same results: nothing emitted, no error, review paging stops early.
    const r2 = await run(r1.state);
    expect(r2.out).toEqual([]);
    expect(r2.stats.skippedSeen).toBe(3 + 2 * ONLY_NEW_STALE_PAGES);
    expect(r2.d.fetchReviews).toHaveBeenCalledTimes(ONLY_NEW_STALE_PAGES);

    // A new product and a new review show up.
    const r3 = await run(r2.state, {
      fetchSearch: vi.fn(async () => searchPage(["11", "new", "12"])),
      fetchReviews: vi.fn(async (pid: string, page: number) => ({
        reviews: page === 1 ? [review(pid, "fresh"), review(pid, "1a")] : [],
        page,
        totalPages: 1,
        totalReviews: 7,
        averageRating: 4.5,
      })),
    });
    expect(ids(r3.out)).toEqual(["new", "fresh"]);
    expect(r3.stats).toMatchObject({ products: 1, reviews: 1 });
  });

  it("never reports success with zero results", async () => {
    const blocked = setup({
      fetchSearch: vi.fn(async () => {
        throw new BlockedError("captcha");
      }),
    });
    await expect(
      runScraper(normalizeInput({ keywords: ["a"] }), blocked.deps),
    ).rejects.toThrow(/blocked every request/);

    const empty = setup({
      fetchSearch: vi.fn(async () => searchPage([], { totalResults: 0 })),
    });
    await expect(
      runScraper(normalizeInput({ keywords: ["a"] }), empty.deps),
    ).rejects.toThrow(/No results/);
  });
});
