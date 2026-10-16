import { Actor, log } from "apify";
import { DeviantArtClient } from "./deviantart.js";
import { HttpClient } from "./http.js";
import { InputError, normalizeInput, type RawInput } from "./input.js";
import { proxiedFetch } from "./proxy-fetch.js";
import { EVENT_DEVIATION, EVENT_PROFILE, runScrape } from "./run.js";

await Actor.init();

try {
  let input;
  const raw = await Actor.getInput<RawInput>();
  try {
    input = normalizeInput(raw);
  } catch (e) {
    if (e instanceof InputError) {
      await Actor.fail(`Invalid input: ${e.message}`);
    }
    throw e;
  }

  log.info(
    `Mode ${input.mode}: ` +
      (input.mode === "search"
        ? `"${input.query}"`
        : input.mode === "deviationUrls"
          ? `${input.deviations.length} URL(s)`
          : `${input.usernames.length} user(s)`) +
      `, up to ${input.maxItems} per query/user` +
      (input.since !== null
        ? `, since ${new Date(input.since).toISOString()}`
        : "") +
      ".",
  );

  const charging = Actor.getChargingManager();
  if (charging.getPricingInfo().isPayPerEvent) {
    const event =
      input.mode === "userProfile" ? EVENT_PROFILE : EVENT_DEVIATION;
    const remaining = charging.calculateMaxEventChargeCountWithinLimit(event);
    if (remaining <= 0) {
      log.warning("Max charge per run is too low for a single item.");
      await Actor.exit();
    }
    log.info(`Budget allows up to ${remaining} items.`);
  }

  const proxy = raw?.proxyConfiguration
    ? await Actor.createProxyConfiguration(raw.proxyConfiguration)
    : undefined;
  if (proxy) log.info("Using proxy.");
  const http = new HttpClient({
    fetch: proxy ? proxiedFetch(() => proxy.newUrl()) : undefined,
    log: (m) => log.warning(m),
  });

  const stats = await runScrape(input, {
    client: new DeviantArtClient(http),
    log: (m) => log.warning(m),
    emit: async (item, event) => {
      const res = await Actor.pushData(item, event);
      return !res.eventChargeLimitReached;
    },
  });

  log.info(`Done after ${http.requests} requests: ${JSON.stringify(stats)}`);
  await Actor.setStatusMessage(
    `Scraped ${stats.deviations} deviations` +
      (stats.profiles ? ` and ${stats.profiles} profiles` : "") +
      (stats.skippedMature ? `, ${stats.skippedMature} mature skipped` : "") +
      (stats.skippedOld ? `, ${stats.skippedOld} older than sinceDate` : "") +
      (stats.notFound ? `, ${stats.notFound} not found` : "") +
      (stats.failed ? `, ${stats.failed} failed` : "") +
      (stats.stopReason === "budget" ? " (stopped at max charge)" : ""),
    { isStatusMessageTerminal: true },
  );
  await Actor.exit();
} catch (e) {
  log.exception(e as Error, "Run failed");
  await Actor.fail((e as Error).message);
}
