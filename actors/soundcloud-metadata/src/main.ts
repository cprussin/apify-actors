import { Actor, log } from "apify";
import { ClientIdProvider } from "./client-id.js";
import { HttpClient } from "./http.js";
import { InputError, normalizeInput, type RawInput } from "./input.js";
import { proxiedFetch } from "./proxy-fetch.js";
import { EVENT_ITEM, runScrape } from "./run.js";
import { SoundCloudClient } from "./soundcloud.js";

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
    `${input.targets.length} URL(s) to resolve` +
      (input.search
        ? `, search "${input.search}" (${input.searchType}, up to ${input.maxItems})`
        : "") +
      ".",
  );

  const charging = Actor.getChargingManager();
  let remaining = Infinity;
  if (charging.getPricingInfo().isPayPerEvent) {
    remaining = charging.calculateMaxEventChargeCountWithinLimit(EVENT_ITEM);
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
  const clientId = new ClientIdProvider(http, process.env.SOUNDCLOUD_CLIENT_ID);

  const stats = await runScrape(input, {
    client: new SoundCloudClient(http, clientId),
    concurrency: input.maxConcurrency,
    log: (m) => log.warning(m),
    emit: async (item) => {
      const res = await Actor.pushData(item, EVENT_ITEM);
      remaining -= 1;
      return !res.eventChargeLimitReached && remaining > 0;
    },
  });

  log.info(`Done after ${http.requests} requests: ${JSON.stringify(stats)}`);
  await Actor.setStatusMessage(
    `Scraped ${stats.emitted} items ` +
      `(${stats.resolved} resolved, ${stats.searchResults} from search` +
      (stats.notFound ? `, ${stats.notFound} not found` : "") +
      (stats.failed ? `, ${stats.failed} failed` : "") +
      ")" +
      (stats.stopReason === "budget" ? " (stopped at max charge)" : ""),
    { isStatusMessageTerminal: true },
  );
  await Actor.exit();
} catch (e) {
  log.exception(e as Error, "Run failed");
  await Actor.fail((e as Error).message);
}
