import { Actor, log } from "apify";
import {
  computeWindow,
  inputHash,
  InputError,
  normalizeInput,
  type RawInput,
} from "./input.js";
import { runFeed } from "./run.js";
import { SocrataClient } from "./socrata.js";
import { PersistentSeenStore, STATE_STORE_NAME } from "./state.js";

export const CHARGE_EVENT = "business-record";
const SAVE_EVERY = 100;

await Actor.init();

try {
  let input;
  try {
    input = normalizeInput(await Actor.getInput<RawInput>());
  } catch (e) {
    if (e instanceof InputError) {
      await Actor.fail(`Invalid input: ${e.message}`);
    }
    throw e;
  }

  const window = computeWindow(input, new Date());
  log.info(
    `Businesses formed ${window.from} .. ${window.to} in ${input.states.join(", ")} (max ${input.maxResults}).`,
  );

  const charging = Actor.getChargingManager();
  if (charging.getPricingInfo().isPayPerEvent) {
    const affordable =
      charging.calculateMaxEventChargeCountWithinLimit(CHARGE_EVENT);
    if (affordable <= 0) {
      log.warning("Max charge per run is too low for a single result.");
      await Actor.exit();
    }
    if (affordable < input.maxResults) {
      log.info(`Budget allows ${affordable} results; limiting to that.`);
      input.maxResults = affordable;
    }
  }

  let seen: PersistentSeenStore | undefined;
  if (input.onlyNew) {
    const kv = await Actor.openKeyValueStore(STATE_STORE_NAME);
    seen = await PersistentSeenStore.open(kv, inputHash(input));
    log.info(`Delta mode: ${seen.size} businesses already reported.`);
    const persist = async () => seen?.save();
    Actor.on("migrating", persist);
    Actor.on("aborting", persist);
    Actor.on("persistState", persist);
  }

  const client = new SocrataClient({
    appToken: process.env.SOCRATA_APP_TOKEN,
    log: (m) => log.warning(m),
  });
  let sinceSave = 0;

  const stats = await runFeed(input, window, {
    client,
    seen,
    log: (m) => log.warning(m),
    emit: async (item) => {
      const res = await Actor.pushData(item, CHARGE_EVENT);
      if (seen && ++sinceSave >= SAVE_EVERY) {
        sinceSave = 0;
        await seen.save();
      }
      return !res.eventChargeLimitReached;
    },
  });

  await seen?.save();
  log.info(`Done: ${JSON.stringify(stats)}`);
  const perState = Object.entries(stats.states)
    .map(
      ([c, s]) =>
        `${c} ${s.status === "ok" || s.status === "exhausted" ? s.emitted : s.status}`,
    )
    .join(", ");
  await Actor.setStatusMessage(
    `Found ${stats.emitted} businesses formed ${window.from} .. ${window.to} (${perState})` +
      (stats.stopReason === "budget" ? " (stopped at max charge)" : ""),
    { isStatusMessageTerminal: true },
  );
  await Actor.exit();
} catch (e) {
  log.exception(e as Error, "Run failed");
  await Actor.fail((e as Error).message);
}
