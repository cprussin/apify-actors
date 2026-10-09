import { Actor, log } from "apify";
import { EdgarClient } from "./edgar.js";
import {
  computeWindow,
  InputError,
  normalizeInput,
  stateParams,
  type RawInput,
} from "./input.js";
import { runFeed } from "./run.js";
import { Seen, stateKey } from "./state.js";

export const CHARGE_EVENT = "filing";
/** Named (persistent) key-value store holding onlyNew state. */
export const STATE_STORE = "sec-form-d-funding-state";

await Actor.init();

try {
  let input;
  let window;
  try {
    input = normalizeInput(await Actor.getInput<RawInput>());
    window = computeWindow(input, new Date());
  } catch (e) {
    if (e instanceof InputError) {
      await Actor.fail(`Invalid input: ${e.message}`);
    }
    throw e;
  }

  log.info(
    `Form D filings ${window.from} .. ${window.to}` +
      (input.states.length ? `, states ${input.states.join(", ")}` : "") +
      (input.industryGroups.length
        ? `, industries ${input.industryGroups.join(", ")}`
        : "") +
      `, ${input.filingType} filings, max ${input.maxResults}` +
      (input.onlyNew ? ", only new" : "") +
      ".",
  );

  const charging = Actor.getChargingManager();
  if (charging.getPricingInfo().isPayPerEvent) {
    const affordable =
      charging.calculateMaxEventChargeCountWithinLimit(CHARGE_EVENT);
    if (affordable <= 0) {
      log.warning("Max charge per run is too low for a single filing.");
      await Actor.exit();
    }
    if (affordable < input.maxResults) {
      log.info(`Budget allows ${affordable} filings; limiting to that.`);
      input.maxResults = affordable;
    }
  }

  // onlyNew: state is keyed by the filters (not dates, which move with
  // lastNDays), so each scheduled task tracks its own filings.
  let seen: Seen | undefined;
  let saveState: (() => Promise<void>) | undefined;
  if (input.onlyNew) {
    const store = await Actor.openKeyValueStore(STATE_STORE);
    const key = stateKey(stateParams(input));
    const s = new Seen(await store.getValue(key));
    seen = s;
    saveState = () => store.setValue(key, s.toJSON());
    Actor.on("persistState", saveState);
    log.info(
      `Only new filings: state "${key}" in store "${STATE_STORE}" (${s.size} known).`,
    );
  }

  const client = new EdgarClient({
    userAgent: process.env.SEC_USER_AGENT,
    log: (m) => log.warning(m),
  });

  const stats = await runFeed(input, window, {
    client,
    seen,
    log: (m) => log.warning(m),
    emit: async (item) => {
      const res = await Actor.pushData(item, CHARGE_EVENT);
      return !res.eventChargeLimitReached;
    },
  }).finally(() => saveState?.());

  log.info(`Done: ${JSON.stringify({ ...stats, requests: client.requests })}`);
  await Actor.setStatusMessage(
    `Found ${stats.emitted} Form D filings from ${window.from} to ${window.to}` +
      (stats.skippedSeen ? `, skipped ${stats.skippedSeen} seen before` : "") +
      (stats.stopReason === "budget" ? " (stopped at max charge)" : ""),
    { isStatusMessageTerminal: true },
  );
  await Actor.exit();
} catch (e) {
  log.exception(e as Error, "Run failed");
  await Actor.fail((e as Error).message);
}
