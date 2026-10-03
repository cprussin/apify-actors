import { describe, expect, it } from "vitest";
import { COOKIE_BANNER_SELECTORS, cookieBannerCss } from "../src/cookies.js";
import { DEVICE_PRESETS, deviceProfile } from "../src/devices.js";
import {
  InputError,
  lighterWaitUntil,
  normalizeInput,
  normalizeUrl,
  type WaitUntil,
} from "../src/input.js";
import { CONTENT_TYPES, imageSize, recordKey, urlSlug } from "../src/keys.js";
import {
  forEachLimit,
  NavigationTimeoutError,
  runScreenshots,
  type RunDeps,
  type ScreenshotResult,
  type Shot,
} from "../src/run.js";

// 1x1 images.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);
const WEBP_LOSSY = Buffer.from(
  "UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=",
  "base64",
);

describe("normalizeInput", () => {
  it("defaults to one URL so the daily test is fast", () => {
    const n = normalizeInput({});
    expect(n.targets).toEqual([
      { index: 0, input: "https://apify.com", url: "https://apify.com/" },
    ]);
    expect(n).toMatchObject({
      format: "png",
      fullPage: false,
      device: "desktop",
      waitUntil: "load",
      delayMs: 0,
      hideCookieBanners: true,
      scrollToBottom: false,
      timeoutMs: 30_000,
      maxConcurrency: 3,
      quality: 80,
    });
    expect(normalizeInput(null).targets).toHaveLength(1);
  });

  it("merges urls and startUrls, dedupes and flags invalid URLs", () => {
    const n = normalizeInput({
      urls: ["example.com", "https://a.org/x?y=1,2", "example.com", ""],
      startUrls: [{ url: "http://b.net" }, "ftp://c.com", null],
    });
    expect(n.targets.map((t) => t.url)).toEqual([
      "https://example.com/",
      "https://a.org/x?y=1,2",
      "http://b.net/",
      null,
    ]);
    expect(n.targets[3]).toMatchObject({ index: 3, input: "ftp://c.com" });
    expect(n.targets[3]!.error).toMatch(/Invalid URL/);
  });

  it("accepts a newline-separated string", () => {
    expect(
      normalizeInput({ urls: "a.com\nb.com" }).targets.map((t) => t.url),
    ).toEqual(["https://a.com/", "https://b.com/"]);
  });

  it("parses options", () => {
    const n = normalizeInput({
      format: "JPG",
      fullPage: true,
      device: "mobile",
      width: "500",
      waitUntil: "networkidle",
      delayMs: 1500,
      selector: " header ",
      waitForSelector: "",
      hideCookieBanners: false,
      scrollToBottom: true,
      timeoutSecs: 60,
      maxConcurrency: 5,
    });
    expect(n).toMatchObject({
      format: "jpeg",
      fullPage: true,
      device: "mobile",
      waitUntil: "networkidle",
      delayMs: 1500,
      selector: "header",
      waitForSelector: null,
      hideCookieBanners: false,
      scrollToBottom: true,
      timeoutMs: 60_000,
      maxConcurrency: 5,
    });
    expect(n.profile).toMatchObject({
      width: 500,
      height: 844,
      isMobile: true,
    });
  });

  it("rejects bad options", () => {
    expect(() => normalizeInput({ format: "gif" })).toThrow(InputError);
    expect(() => normalizeInput({ device: "watch" })).toThrow(/device/);
    expect(() => normalizeInput({ waitUntil: "commit" })).toThrow(InputError);
    expect(() => normalizeInput({ timeoutSecs: 1 })).toThrow(/timeoutSecs/);
    expect(() => normalizeInput({ maxConcurrency: 50 })).toThrow(InputError);
    expect(() => normalizeInput({ width: 50 })).toThrow(/width/);
    expect(() => normalizeInput({ delayMs: "soon" })).toThrow(/number/);
  });

  it("normalizes URLs", () => {
    expect(normalizeUrl("Example.com/Path")).toBe("https://example.com/Path");
    expect(normalizeUrl("http://localhost:3000")).toBe(
      "http://localhost:3000/",
    );
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("not a url")).toBeNull();
    expect(normalizeUrl("foo")).toBeNull();
  });

  it("steps waitUntil down on retry", () => {
    expect(lighterWaitUntil("networkidle")).toBe("load");
    expect(lighterWaitUntil("load")).toBe("domcontentloaded");
    expect(lighterWaitUntil("domcontentloaded")).toBe("commit");
    expect(lighterWaitUntil("commit")).toBeNull();
  });
});

describe("devices", () => {
  it("has desktop, tablet and mobile presets", () => {
    expect(DEVICE_PRESETS.desktop).toMatchObject({
      width: 1920,
      height: 1080,
      isMobile: false,
      userAgent: null,
    });
    expect(DEVICE_PRESETS.tablet.userAgent).toMatch(/iPad/);
    expect(DEVICE_PRESETS.mobile.userAgent).toMatch(/iPhone/);
    expect(DEVICE_PRESETS.mobile).toMatchObject({
      isMobile: true,
      hasTouch: true,
    });
  });

  it("overrides width and height", () => {
    expect(deviceProfile("tablet", null, 600)).toMatchObject({
      width: 820,
      height: 600,
      deviceScaleFactor: 2,
    });
    expect(DEVICE_PRESETS.tablet.height).toBe(1180);
  });
});

describe("keys", () => {
  it("builds readable, unique, valid keys", () => {
    expect(recordKey(0, "https://www.apify.com/", "png")).toBe(
      "screenshot-0001-apify-com.png",
    );
    expect(recordKey(41, "https://example.com/docs/Intro?x=1", "jpeg")).toBe(
      "screenshot-0042-example-com-docs-intro-x-1.jpg",
    );
    expect(recordKey(2, "https://a.com", "pdf")).toMatch(/\.pdf$/);
    const long = recordKey(9999, `https://a.com/${"x-".repeat(300)}`, "webp");
    expect(long.length).toBeLessThanOrEqual(256);
    expect(long).toMatch(/^[a-zA-Z0-9!\-_.'()]+$/);
    expect(long).not.toMatch(/--|-\.webp$/);
  });

  it("slugs odd input", () => {
    expect(urlSlug("https://例え.jp/")).toBe("xn-r8jz45g-jp");
    expect(urlSlug("???")).toBe("page");
  });

  it("maps content types", () => {
    expect(CONTENT_TYPES).toEqual({
      png: "image/png",
      jpeg: "image/jpeg",
      webp: "image/webp",
      pdf: "application/pdf",
    });
  });

  it("reads image sizes", () => {
    expect(imageSize(PNG)).toEqual({ width: 1, height: 1 });
    expect(imageSize(JPEG)).toEqual({ width: 1, height: 1 });
    expect(imageSize(WEBP_LOSSY)).toEqual({ width: 1, height: 1 });
    expect(imageSize(Buffer.from("%PDF-1.7"))).toBeNull();
  });
});

describe("cookies", () => {
  it("hides known banners with CSS", () => {
    const css = cookieBannerCss();
    expect(css).toContain("#onetrust-consent-sdk");
    expect(css).toContain("#CybotCookiebotDialog");
    expect(css).toContain("display: none !important");
    expect(new Set(COOKIE_BANNER_SELECTORS).size).toBe(
      COOKIE_BANNER_SELECTORS.length,
    );
  });
});

describe("forEachLimit", () => {
  it("respects the limit and stops early", async () => {
    let active = 0;
    let peak = 0;
    const seen: number[] = [];
    const left = await forEachLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 1));
      seen.push(n);
      active -= 1;
      return n !== 3;
    });
    expect(peak).toBe(2);
    expect(seen).toContain(3);
    expect(seen.length).toBeLessThan(6);
    expect(left).toBe(6 - seen.length);
  });
});

describe("runScreenshots", () => {
  const shot = (over: Partial<Shot> = {}): Shot => ({
    body: PNG,
    format: "png",
    finalUrl: "https://example.com/",
    status: 200,
    title: "Example",
    width: null,
    height: null,
    ...over,
  });

  const setup = (
    capture: RunDeps["capture"],
    opts: { budget?: number } = {},
  ) => {
    const items: { item: ScreenshotResult; charge: boolean }[] = [];
    const saved: string[] = [];
    let budget = opts.budget ?? Infinity;
    let t = 0;
    const deps: RunDeps = {
      capture,
      save: async (key) => {
        saved.push(key);
        return `https://store/${key}`;
      },
      emit: async (item, charge) => {
        if (charge && budget <= 0) return { pushed: false, more: false };
        items.push({ item, charge });
        if (charge) budget -= 1;
        return { pushed: true, more: budget > 0 };
      },
      now: () => new Date("2026-10-02T00:00:00Z"),
      clock: () => (t += 100),
    };
    return { deps, items, saved };
  };

  it("saves, charges successes and records failures for free", async () => {
    const input = normalizeInput({
      urls: ["https://example.com", "https://down.test", "bad url"],
      maxConcurrency: 1,
    });
    const { deps, items, saved } = setup(async (url) => {
      if (url.includes("down"))
        throw new Error("net::ERR_NAME_NOT_RESOLVED\nstack");
      return shot();
    });
    const stats = await runScreenshots(input, deps);
    expect(stats).toEqual({
      captured: 1,
      failed: 2,
      retried: 0,
      skipped: 0,
      stopReason: "done",
    });
    expect(saved).toEqual(["screenshot-0001-example-com.png"]);
    expect(items.map((i) => i.charge)).toEqual([true, false, false]);
    expect(items[0]!.item).toEqual({
      url: "https://example.com/",
      finalUrl: "https://example.com/",
      status: 200,
      screenshotKey: "screenshot-0001-example-com.png",
      screenshotUrl: "https://store/screenshot-0001-example-com.png",
      format: "png",
      device: "desktop",
      width: 1,
      height: 1,
      bytes: PNG.length,
      title: "Example",
      loadTimeMs: 100,
      waitUntil: "load",
      error: null,
      capturedAt: "2026-10-02T00:00:00.000Z",
    });
    expect(items[1]!.item).toMatchObject({
      url: "https://down.test/",
      screenshotUrl: null,
      error: "net::ERR_NAME_NOT_RESOLVED",
    });
    expect(items[2]!.item.error).toMatch(/Invalid URL/);
  });

  it("retries once with a lighter waitUntil on navigation timeout", async () => {
    const input = normalizeInput({
      urls: ["https://slow.test", "https://never.test"],
      waitUntil: "networkidle",
      maxConcurrency: 1,
    });
    const calls: [string, WaitUntil][] = [];
    const { deps, items } = setup(async (url, w) => {
      calls.push([url, w]);
      if (url.includes("never") || w === "networkidle")
        throw new NavigationTimeoutError("timeout");
      return shot();
    });
    const stats = await runScreenshots(input, deps);
    expect(calls).toEqual([
      ["https://slow.test/", "networkidle"],
      ["https://slow.test/", "load"],
      ["https://never.test/", "networkidle"],
      ["https://never.test/", "load"],
    ]);
    expect(stats).toMatchObject({ captured: 1, failed: 1, retried: 2 });
    expect(items[0]!.item.waitUntil).toBe("load");
    expect(items[1]).toMatchObject({
      charge: false,
      item: { error: "timeout" },
    });
  });

  it("does not retry other errors", async () => {
    const input = normalizeInput({ urls: ["https://x.test"] });
    let n = 0;
    const { deps } = setup(async () => {
      n += 1;
      throw new Error("Element not found");
    });
    await runScreenshots(input, deps);
    expect(n).toBe(1);
  });

  it("uses the shot's format and PDF page size", async () => {
    const input = normalizeInput({
      urls: ["https://example.com"],
      format: "pdf",
    });
    const { deps, items, saved } = setup(async () =>
      shot({
        body: Buffer.from("%PDF-1.7"),
        format: "pdf",
        width: 1920,
        height: 5000,
      }),
    );
    await runScreenshots(input, deps);
    expect(saved).toEqual(["screenshot-0001-example-com.pdf"]);
    expect(items[0]!.item).toMatchObject({
      format: "pdf",
      width: 1920,
      height: 5000,
    });
  });

  it("stops at the charge limit", async () => {
    const input = normalizeInput({
      urls: ["a.com", "b.com", "c.com", "d.com"],
      maxConcurrency: 1,
    });
    const { deps, items } = setup(async () => shot(), { budget: 2 });
    const stats = await runScreenshots(input, deps);
    expect(items).toHaveLength(2);
    expect(stats).toMatchObject({
      captured: 2,
      skipped: 2,
      stopReason: "budget",
    });
  });

  it("doesn't count parallel screenshots past the charge limit", async () => {
    const input = normalizeInput({
      urls: ["a.com", "b.com", "c.com"],
      maxConcurrency: 3,
    });
    const { deps, items } = setup(async () => shot(), { budget: 1 });
    const stats = await runScreenshots(input, deps);
    expect(items).toHaveLength(1);
    expect(stats).toMatchObject({ captured: 1, stopReason: "budget" });
  });

  it("records a failed save as an unbilled error", async () => {
    const input = normalizeInput({ urls: ["https://example.com"] });
    const { deps, items } = setup(async () => shot());
    deps.save = async () => {
      throw new Error("store down");
    };
    await runScreenshots(input, deps);
    expect(items[0]).toMatchObject({
      charge: false,
      item: { error: "Saving the screenshot failed: store down" },
    });
  });
});
