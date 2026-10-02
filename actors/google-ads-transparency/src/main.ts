import { Actor, log, type ProxyConfiguration } from "apify";
import { RpcClient } from "./http.js";
import { InputError, normalizeInput, type RawInput } from "./input.js";
import { runScraper } from "./run.js";
import { Seen, stateKey } from "./state.js";
import { tlsFetch } from "./tls-fetch.js";
import { Transparency } from "./transparency.js";

/** Named (persistent) key-value store holding onlyNew state. */
export const STATE_STORE = "google-ads-transparency-state";

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

  const event = input.mode === "advertisers" ? "advertiser" : "ad";
  log.info(
    input.mode === "advertisers"
      ? `Advertiser search for ${input.targets.length} name(s), up to ${input.maxAdvertisersPerQuery} each.`
      : `${input.targets.length} advertiser(s), region ${input.region ?? "anywhere"}, up to ${input.maxAdsPerAdvertiser} ads each` +
          (input.formats.length ? `, formats ${input.formats.join("/")}` : "") +
          (input.platform ? `, platform ${input.platform}` : "") +
          (input.startDate
            ? `, shown ${input.startDate}-${input.endDate}`
            : "") +
          ".",
  );

  // onlyNew: state is keyed by the query (not the date window, which moves
  // with relative dates), so each scheduled task tracks its own items.
  let seen: Seen | undefined;
  let saveState: (() => Promise<void>) | undefined;
  if (input.onlyNew) {
    const store = await Actor.openKeyValueStore(STATE_STORE);
    const key = stateKey({
      mode: input.mode,
      targets: input.targets.map((t) => t.query).sort(),
      region: input.region,
      formats: [...input.formats].sort(),
      platform: input.platform,
    });
    const s = new Seen(await store.getValue(key));
    seen = s;
    saveState = () => store.setValue(key, s.toJSON());
    Actor.on("persistState", saveState);
    log.info(
      `Only new items: state "${key}" in store "${STATE_STORE}" (${s.size} known).`,
    );
  }

  const charging = Actor.getChargingManager();
  if (charging.getPricingInfo().isPayPerEvent) {
    const affordable = charging.calculateMaxEventChargeCountWithinLimit(event);
    if (affordable <= 0) {
      log.warning("Max charge per run is too low for a single result.");
      await Actor.exit();
    }
    log.info(`Budget allows up to ${affordable} results.`);
  }

  // Proxy: the user's choice; by default direct, falling back to Apify's
  // datacenter proxy (new IP per block) if Google starts blocking.
  let proxy: ProxyConfiguration | undefined;
  let fallbackTried = false;
  if (
    raw?.proxyConfiguration?.useApifyProxy ||
    raw?.proxyConfiguration?.proxyUrls
  ) {
    try {
      proxy = await Actor.createProxyConfiguration(raw.proxyConfiguration);
    } catch (e) {
      log.warning(`Proxy unavailable, continuing without: ${String(e)}`);
    }
  }
  if (proxy) log.info("Using proxy.");
  const prefix = `ads${Math.floor(Math.random() * 1e8)}`;
  let session = 0;
  const client = new RpcClient({
    fetch: tlsFetch(async () =>
      proxy ? proxy.newUrl(`${prefix}_${session}`) : undefined,
    ),
    rotate: async () => {
      session += 1;
      if (!proxy && !fallbackTried) {
        fallbackTried = true;
        try {
          proxy = await Actor.createProxyConfiguration({
            useApifyProxy: true,
          });
          if (proxy) log.info("Blocked by Google; switching to Apify Proxy.");
        } catch (e) {
          log.warning(`Blocked by Google and Apify Proxy unavailable: ${e}`);
        }
      }
    },
    rotatedDelayMs: 1000,
    maxRetries: 6,
    log: (m) => log.warning(m),
  });

  const stats = await runScraper(input, {
    api: new Transparency(client),
    log: (m) => log.info(m),
    seen,
    emit: async (item, ev) => {
      const res = await Actor.pushData(item, ev);
      return !res.eventChargeLimitReached;
    },
  }).finally(() => saveState?.());

  log.info(
    `Done after ${client.requests} requests (${client.blocks} blocked): ${JSON.stringify(stats)}`,
  );
  const failed = Object.values(stats.targets).filter(
    (t) => t.status === "failed" || t.status === "notFound",
  ).length;
  await Actor.setStatusMessage(
    `${stats.emitted} ${input.mode === "advertisers" ? "advertisers" : "ads"}` +
      (failed ? `, ${failed} advertiser(s) not found or failed` : "") +
      (stats.skippedSeen ? `, skipped ${stats.skippedSeen} seen before` : "") +
      (stats.stopReason === "budget" ? " (stopped at max charge)" : ""),
    { isStatusMessageTerminal: true },
  );
  await Actor.exit();
} catch (e) {
  log.exception(e as Error, "Run failed");
  await Actor.fail((e as Error).message);
}
