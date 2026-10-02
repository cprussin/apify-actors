import { Actor, log, type ProxyConfigurationOptions } from "apify";
import { makeFetch, type ProxyUrlSource } from "./http.js";
import { InputError, normalizeInput, type RawInput } from "./input.js";
import { runTranscripts } from "./run.js";
import { Seen, stateKey } from "./state.js";
import { YouTubeClient } from "./youtube.js";

export const CHARGE_EVENT = "transcript";
/** Named (persistent) key-value store holding onlyNew state. */
export const STATE_STORE = "youtube-transcripts-state";

await Actor.init();

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

  let proxy: ProxyUrlSource | undefined;
  const proxyInput = raw?.proxyConfiguration as
    (ProxyConfigurationOptions & { useApifyProxy?: boolean }) | undefined;
  if (
    proxyInput &&
    (proxyInput.useApifyProxy || proxyInput.proxyUrls?.length)
  ) {
    try {
      proxy = await Actor.createProxyConfiguration(proxyInput);
    } catch (e) {
      log.warning(
        `Proxy unavailable, continuing without it: ${(e as Error).message}`,
      );
    }
  }
  if (!proxy && Actor.isAtHome())
    log.warning(
      "No proxy: YouTube often blocks datacenter IPs. Use the RESIDENTIAL proxy group if videos fail with errorCode 'blocked'.",
    );

  const charging = Actor.getChargingManager();
  if (charging.getPricingInfo().isPayPerEvent) {
    const affordable =
      charging.calculateMaxEventChargeCountWithinLimit(CHARGE_EVENT);
    if (affordable <= 0) {
      log.warning("Max charge per run is too low for a single transcript.");
      await Actor.exit();
    }
    log.info(`Budget allows up to ${affordable} transcripts.`);
  }

  log.info(
    `Sources: ${input.sources.length}, languages: ${input.languages.join(", ") || "any"}${input.translateTo ? `, translate to ${input.translateTo}` : ""}, proxy: ${proxy ? "on" : "off"}${input.onlyNew ? ", only new" : ""}.`,
  );

  // onlyNew: state is keyed by the sources, so each distinct input (e.g.
  // each scheduled task) tracks its own "already returned" videos.
  let seen: Seen | undefined;
  let saveState: (() => Promise<void>) | undefined;
  if (input.onlyNew) {
    const store = await Actor.openKeyValueStore(STATE_STORE);
    const key = stateKey({
      sources: input.sources.map((s) => s.input).sort(),
      languages: input.languages,
      translateTo: input.translateTo,
    });
    const s = new Seen(await store.getValue(key));
    seen = s;
    saveState = () => store.setValue(key, s.toJSON());
    Actor.on("persistState", saveState);
    log.info(
      `Only new videos: state "${key}" in store "${STATE_STORE}" (${s.size} known).`,
    );
  }

  const fetchFn = makeFetch(proxy);
  const stats = await runTranscripts(input, {
    newClient: () =>
      new YouTubeClient({ fetch: fetchFn, log: (m) => log.debug(m) }),
    log: (m) => log.info(m),
    seen,
    emit: async (item, charge) => {
      if (!charge) {
        await Actor.pushData(item);
        return true;
      }
      const res = await Actor.pushData(item, CHARGE_EVENT);
      return !res.eventChargeLimitReached;
    },
  }).finally(() => saveState?.());

  log.info(`Done: ${JSON.stringify(stats)}`);
  const failures = Object.entries(stats.failures)
    .map(([c, n]) => `${n} ${c}`)
    .join(", ");
  const msg =
    `Transcripts: ${stats.succeeded}/${stats.videos} videos` +
    (failures ? ` (failed: ${failures})` : "") +
    (stats.skippedSeen ? `; skipped ${stats.skippedSeen} seen before` : "") +
    (stats.sourceErrors.length
      ? `; ${stats.sourceErrors.length} source(s) failed`
      : "") +
    (stats.stopReason === "budget" ? " (stopped at max charge)" : "");

  const blocked = stats.failures.blocked ?? 0;
  if (stats.videos > 0 && stats.succeeded === 0 && blocked === stats.failed) {
    await Actor.fail(
      `${msg}. YouTube blocked every request; use a RESIDENTIAL proxy.`,
    );
  }
  if (stats.videos === 0 && stats.sourceErrors.length) {
    await Actor.fail(`No videos found. ${stats.sourceErrors.join("; ")}`);
  }
  await Actor.setStatusMessage(msg, { isStatusMessageTerminal: true });
  await Actor.exit();
} catch (e) {
  log.exception(e as Error, "Run failed");
  await Actor.fail((e as Error).message);
}
