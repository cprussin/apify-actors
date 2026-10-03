import { chromium, errors, type Browser, type Page } from "playwright";
import { cookieBannerCss } from "./cookies.js";
import { chromeUserAgent } from "./devices.js";
import type { NormalizedInput, WaitUntil } from "./input.js";
import { imageSize } from "./keys.js";
import { NavigationTimeoutError, type Shot } from "./run.js";

export type CaptureOptions = Omit<NormalizedInput, "targets">;

/** WebP's maximum width/height in pixels. */
export const WEBP_MAX_PX = 16_383;

/** Playwright proxy settings from a URL like http://user:pass@host:port. */
export function playwrightProxy(url: string | undefined) {
  if (!url) return undefined;
  const u = new URL(url);
  return {
    server: `${u.protocol}//${u.host}`,
    ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
  };
}

/**
 * Launches headless Chromium. Apify's Playwright images ship full Chromium
 * but not always the separate `chromium-headless-shell` binary that plain
 * `headless: true` expects, so try the full "chromium" channel first.
 */
export async function launchBrowser(proxyUrl?: string): Promise<Browser> {
  const errs: string[] = [];
  for (const channel of ["chromium", undefined, "chrome"]) {
    try {
      return await chromium.launch({
        headless: true,
        channel,
        proxy: playwrightProxy(proxyUrl),
        args: ["--disable-dev-shm-usage", "--hide-scrollbars"],
      });
    } catch (e) {
      errs.push(
        `${channel ?? "headless-shell"}: ${(e as Error).message.split("\n")[0]}`,
      );
    }
  }
  throw new Error(`Could not launch a browser (${errs.join("; ")})`);
}

/** Scrolls down in viewport steps so lazy content loads, then back to top. */
async function scrollToBottom(page: Page, maxMs: number): Promise<void> {
  // No named inner functions: dev runners (tsx) wrap them in a helper that
  // doesn't exist in the page.
  await page.evaluate(async (maxMs) => {
    const end = Date.now() + maxMs;
    let last = -1;
    while (Date.now() < end) {
      window.scrollBy(0, window.innerHeight);
      await new Promise((r) => setTimeout(r, 150));
      const y = window.scrollY + window.innerHeight;
      const h = document.documentElement.scrollHeight;
      if (y >= h - 2 && h === last) break;
      last = h;
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 200));
  }, maxMs);
}

/** Re-encodes a PNG as WebP with the browser's own encoder (no native deps). */
async function pngToWebp(
  page: Page,
  png: Buffer,
  quality: number,
): Promise<Buffer> {
  const b64 = await page.evaluate(
    async ({ b64, quality }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(
        new Blob([bin], { type: "image/png" }),
      );
      const canvas = new OffscreenCanvas(bmp.width, bmp.height);
      canvas.getContext("2d")!.drawImage(bmp, 0, 0);
      const blob = await canvas.convertToBlob({
        type: "image/webp",
        quality: quality / 100,
      });
      if (blob.type !== "image/webp") throw new Error("WebP encoding failed.");
      const out = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (let i = 0; i < out.length; i += 0x8000)
        s += String.fromCharCode(...out.subarray(i, i + 0x8000));
      return btoa(s);
    },
    { b64: png.toString("base64"), quality },
  );
  return Buffer.from(b64, "base64");
}

/**
 * Loads one URL in a fresh browser context and captures it. Throws
 * NavigationTimeoutError when only the navigation timed out.
 */
export async function capturePage(
  browser: Browser,
  url: string,
  waitUntil: WaitUntil,
  o: CaptureOptions,
  log: (msg: string) => void = () => {},
): Promise<Shot> {
  const p = o.profile;
  const ctx = await browser.newContext({
    viewport: { width: p.width, height: p.height },
    deviceScaleFactor: p.deviceScaleFactor,
    isMobile: p.isMobile,
    hasTouch: p.hasTouch,
    userAgent: p.userAgent ?? chromeUserAgent(browser.version()),
    locale: "en-US",
    // Lets the cookie-banner style tag load on sites with a strict CSP.
    bypassCSP: true,
  });
  // Hard stop per URL so one hanging page can't stall the run.
  const hardMs = o.timeoutMs * 2 + o.delayMs + 15_000;
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Capture did not finish within ${hardMs / 1000}s.`));
      void ctx.close().catch(() => {});
    }, hardMs);
  });
  try {
    return await Promise.race([guard, shoot()]);
  } finally {
    clearTimeout(timer);
    await ctx.close().catch(() => {});
  }

  async function shoot(): Promise<Shot> {
    const page = await ctx.newPage();
    page.setDefaultTimeout(o.timeoutMs);
    let status: number | null;
    try {
      const res = await page.goto(url, { waitUntil, timeout: o.timeoutMs });
      status = res?.status() ?? null;
    } catch (e) {
      if (e instanceof errors.TimeoutError)
        throw new NavigationTimeoutError(
          `Page did not finish loading (waitUntil "${waitUntil}") within ${o.timeoutMs / 1000}s.`,
        );
      throw e;
    }
    if (o.hideCookieBanners)
      await page.addStyleTag({ content: cookieBannerCss() }).catch(() => {});
    if (o.waitForSelector)
      await page
        .waitForSelector(o.waitForSelector, { state: "visible" })
        .catch(() => {
          throw new Error(
            `Selector "${o.waitForSelector}" did not appear within ${o.timeoutMs / 1000}s.`,
          );
        });
    const element = o.selector ? page.locator(o.selector).first() : null;
    if (element)
      await element.waitFor({ state: "visible" }).catch(() => {
        throw new Error(
          `Element "${o.selector}" not found or not visible within ${o.timeoutMs / 1000}s.`,
        );
      });
    if (o.scrollToBottom)
      await scrollToBottom(page, Math.min(15_000, o.timeoutMs / 2)).catch((e) =>
        log(`${url}: scrolling failed: ${(e as Error).message}`),
      );
    if (o.delayMs) await page.waitForTimeout(o.delayMs);
    const title = (await page.title().catch(() => "")) || null;
    const base = { finalUrl: page.url() || null, status, title };

    if (o.format === "pdf") {
      await page.emulateMedia({ media: "screen" });
      const height = o.fullPage
        ? await page.evaluate(() =>
            Math.max(
              document.documentElement.scrollHeight,
              document.body?.scrollHeight ?? 0,
            ),
          )
        : p.height;
      const body = await page.pdf({
        width: `${p.width}px`,
        height: `${height}px`,
        printBackground: true,
      });
      return { ...base, body, format: "pdf", width: p.width, height };
    }

    const type = o.format === "jpeg" ? "jpeg" : "png";
    const opts = {
      type,
      animations: "disabled",
      caret: "hide",
      ...(type === "jpeg" ? { quality: o.quality } : {}),
    } as const;
    const body = element
      ? await element.screenshot(opts)
      : await page.screenshot({ ...opts, fullPage: o.fullPage });
    if (o.format !== "webp")
      return { ...base, body, format: o.format, width: null, height: null };

    const size = imageSize(body);
    const tall = !!size && Math.max(size.width, size.height) > WEBP_MAX_PX;
    if (tall) {
      log(
        `${url}: page is too large for WebP (${WEBP_MAX_PX}px); saved as PNG.`,
      );
      return { ...base, body, format: "png", width: null, height: null };
    }
    const blank = await ctx.newPage();
    const webp = await pngToWebp(blank, body, o.quality);
    return { ...base, body: webp, format: "webp", width: null, height: null };
  }
}
