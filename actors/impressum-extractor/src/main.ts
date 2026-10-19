import { Actor, log } from "apify";
import { gotFetch } from "./got-fetch.js";
import { HttpClient } from "./http.js";
import { InputError, normalizeInput, type RawInput } from "./input.js";
import { CHARGE_EVENT, runImprints } from "./run.js";

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
    `${input.targets.length} domain(s)` +
      (input.invalid.length ? ` (+${input.invalid.length} invalid)` : "") +
      `, concurrency ${input.maxConcurrency}.`,
  );

  const charging = Actor.getChargingManager();
  if (charging.getPricingInfo().isPayPerEvent) {
    const affordable =
      charging.calculateMaxEventChargeCountWithinLimit(CHARGE_EVENT);
    if (affordable <= 0) {
      log.warning("Max charge per run is too low for a single imprint.");
      await Actor.exit();
    }
    if (affordable < input.targets.length)
      log.info(
        `Budget allows at most ${affordable} imprints with a register number or VAT ID.`,
      );
  }

  // Plain HTTP, no proxy: company websites are many independent hosts.
  const client = new HttpClient({
    fetch: gotFetch(),
    timeoutMs: 20_000,
    maxRetries: 1,
    log: (m) => log.debug(m),
  });

  const stats = await runImprints(input, {
    get: (url) => client.get(url),
    log: (m) => log.warning(m),
    // Rows with a register number or VAT ID are charged; all others are free.
    emit: async (item, charge) => {
      const res = charge
        ? await Actor.pushData(item, CHARGE_EVENT)
        : await Actor.pushData(item);
      return !res?.eventChargeLimitReached;
    },
  });

  log.info(
    `Done after ${client.requests} requests (${client.blocks} blocked, ${client.errors} errors): ${JSON.stringify(stats)}`,
  );
  const notOk =
    stats.blocked + stats.unreachable + stats.robotsDisallowed + stats.errors;
  await Actor.setStatusMessage(
    `${stats.charged} of ${stats.domains} domain(s) with register number or VAT ID, ${stats.found} Impressum page(s) found` +
      (stats.notFound ? `, ${stats.notFound} not found` : "") +
      (notOk ? `, ${notOk} blocked/unreachable/disallowed` : "") +
      (stats.invalid ? `, ${stats.invalid} invalid` : "") +
      (stats.stopReason === "budget" ? " (stopped at max charge)" : ""),
    { isStatusMessageTerminal: true },
  );
  await Actor.exit();
} catch (e) {
  log.exception(e as Error, "Run failed");
  await Actor.fail((e as Error).message);
}
