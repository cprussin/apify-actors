import { Actor, log } from "apify";
import type { Browser } from "playwright";
import { capturePage, launchBrowser } from "./browser.js";
import { InputError, normalizeInput, type RawInput } from "./input.js";
import { runScreenshots } from "./run.js";

export const CHARGE_EVENT = "screenshot";

await Actor.init();

let browser: Promise<Browser> | undefined;
try {
  const raw = await Actor.getInput<RawInput>();
  let input;
  try {
    input = normalizeInput(raw);
  } catch (e) {
    if (e instanceof InputError) {
      await Actor.fail(`Invalid input: ${e.message}`);
    }
    throw e;
  }
  const { profile: p } = input;
  log.info(
    `${input.targets.length} URL(s): ${input.format}${input.fullPage ? " full page" : ""}, ` +
      `${input.device} ${p.width}x${p.height}@${p.deviceScaleFactor}x, waitUntil ${input.waitUntil}, ` +
      `timeout ${input.timeoutMs / 1000}s, concurrency ${input.maxConcurrency}.`,
  );

  const charging = Actor.getChargingManager();
  const ppe = charging.getPricingInfo().isPayPerEvent;
  if (ppe) {
    const budget =
      charging.calculateMaxEventChargeCountWithinLimit(CHARGE_EVENT);
    if (budget <= 0) {
      log.warning("Max charge per run is too low for a single screenshot.");
      await Actor.exit();
    }
    if (budget < input.targets.length) {
      log.info(`Budget allows ${budget} screenshots.`);
      // Don't capture pages in parallel that could never be charged.
      input.maxConcurrency = Math.max(
        1,
        Math.min(input.maxConcurrency, budget),
      );
    }
  }

  let proxyUrl: string | undefined;
  if (raw?.proxyConfiguration) {
    try {
      const proxy = await Actor.createProxyConfiguration(
        raw.proxyConfiguration,
      );
      proxyUrl = await proxy?.newUrl();
    } catch (e) {
      // e.g. local runs without an Apify token.
      log.warning(`Proxy unavailable, continuing without: ${String(e)}`);
    }
  }
  if (proxyUrl) log.info("Using Apify Proxy.");

  // One shared browser, relaunched if it crashes; a fresh context per URL.
  browser = launchBrowser(proxyUrl);
  await browser;
  const getBrowser = async (): Promise<Browser> => {
    const pending = browser!;
    const current = await pending.catch(() => undefined);
    if (current?.isConnected()) return current;
    // Only the first caller to notice the crash relaunches.
    if (browser === pending) {
      log.warning("Browser disconnected; relaunching.");
      browser = launchBrowser(proxyUrl);
    }
    return browser!;
  };

  const store = await Actor.openKeyValueStore();
  const stats = await runScreenshots(input, {
    capture: async (url, waitUntil) =>
      capturePage(await getBrowser(), url, waitUntil, input, (m) =>
        log.warning(m),
      ),
    save: async (key, body, contentType) => {
      await store.setValue(key, body, { contentType });
      return store.getPublicUrl(key);
    },
    // Charge first, then save, so a screenshot is never delivered unpaid and
    // the run stops exactly at ACTOR_MAX_TOTAL_CHARGE_USD. Failed URLs are
    // recorded for free.
    emit: async (item, charge) => {
      if (!charge || !ppe) {
        await Actor.pushData(item);
        return { pushed: true, more: true };
      }
      // With parallel pages, another page may have used the last of the
      // budget; don't let the SDK overcharge by one.
      const left = () =>
        charging.calculateMaxEventChargeCountWithinLimit(CHARGE_EVENT);
      const stop = { pushed: false, more: false };
      if (left() < 1) return stop;
      const res = await Actor.charge({ eventName: CHARGE_EVENT });
      if (res.chargedCount < 1) return stop;
      await Actor.pushData(item);
      return {
        pushed: true,
        more: !res.eventChargeLimitReached && left() >= 1,
      };
    },
    log: (m) => log.warning(m),
  });

  log.info(`Done: ${JSON.stringify(stats)}`);
  await Actor.setStatusMessage(
    `Captured ${stats.captured} of ${input.targets.length} URL(s)` +
      (stats.failed ? `, ${stats.failed} failed` : "") +
      (stats.stopReason === "budget" ? " (stopped at max charge)" : ""),
    { isStatusMessageTerminal: true },
  );
  await (await browser)?.close().catch(() => {});
  await Actor.exit();
} catch (e) {
  log.exception(e as Error, "Run failed");
  await (await browser?.catch(() => undefined))?.close().catch(() => {});
  await Actor.fail((e as Error).message);
}
