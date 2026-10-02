import { Actor, log } from "apify";
import { HttpClient } from "./http.js";
import { InputError, normalizeInput, type RawInput } from "./input.js";
import { proxiedFetch } from "./proxy-fetch.js";
import { runChannels } from "./run.js";
import { Seen, stateKey } from "./state.js";

/** Named (persistent) key-value store holding onlyNew state. */
export const STATE_STORE = "telegram-channel-scraper-state";

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
    `${input.channels.length} channel(s), up to ${input.maxPostsPerChannel} posts each` +
      (input.since ? `, since ${input.since}` : "") +
      (input.includeChannelInfo ? ", with channel info" : "") +
      (input.onlyNew ? ", only new" : "") +
      ".",
  );

  // onlyNew: state is keyed by the channel list, so each distinct input (e.g.
  // each scheduled task) tracks its own "already returned" posts.
  let seen: Seen | undefined;
  let saveState: (() => Promise<void>) | undefined;
  if (input.onlyNew) {
    const store = await Actor.openKeyValueStore(STATE_STORE);
    const key = stateKey({
      channels: input.channels.map((c) => c.username ?? c.input).sort(),
    });
    const s = new Seen(await store.getValue(key));
    seen = s;
    saveState = () => store.setValue(key, s.toJSON());
    Actor.on("persistState", saveState);
    log.info(
      `Only new posts: state "${key}" in store "${STATE_STORE}" (${s.size} known).`,
    );
  }

  const charging = Actor.getChargingManager();
  const ppe = charging.getPricingInfo().isPayPerEvent;
  if (ppe && charging.calculateMaxEventChargeCountWithinLimit("post") <= 0) {
    log.warning("Max charge per run is too low for a single post.");
    await Actor.exit();
  }

  const proxy = raw?.proxyConfiguration
    ? await Actor.createProxyConfiguration(raw.proxyConfiguration)
    : undefined;
  if (proxy) log.info("Using proxy.");
  const http = new HttpClient({
    fetch: proxy ? proxiedFetch(() => proxy.newUrl()) : undefined,
    log: (m) => log.warning(m),
  });

  const stats = await runChannels(input, {
    fetchHtml: async (url) =>
      (
        await http.request({
          url,
          headers: { "accept-language": "en-US,en;q=0.9" },
        })
      ).text,
    log: (m) => log.warning(m),
    seen,
    emit: async (item, event) => {
      if (!event) {
        // Errors are free.
        await Actor.pushData(item);
        return true;
      }
      if (ppe && charging.calculateMaxEventChargeCountWithinLimit(event) <= 0) {
        return false;
      }
      await Actor.pushData(item);
      const res = await Actor.charge({ eventName: event, count: 1 });
      return !res.eventChargeLimitReached;
    },
  }).finally(() => saveState?.());

  log.info(`Done after ${http.requests} requests: ${JSON.stringify(stats)}`);
  const perChannel = Object.entries(stats.channels)
    .map(([c, s]) => `${c}: ${s.error ? s.status : s.posts}`)
    .join(", ");
  await Actor.setStatusMessage(
    `Scraped ${stats.posts} posts (${perChannel})` +
      (stats.stopReason === "budget" ? " (stopped at max charge)" : ""),
    { isStatusMessageTerminal: true },
  );
  await Actor.exit();
} catch (e) {
  log.exception(e as Error, "Run failed");
  await Actor.fail((e as Error).message);
}
