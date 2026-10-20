import { Actor, log } from "apify";
import { gotFetch } from "./got-fetch.js";
import { HttpClient } from "./http.js";
import { InputError, normalizeInput, type RawInput } from "./input.js";
import { CHARGE_EVENT, runBoards } from "./run.js";

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
  log.info(
    `Boards: ${input.platforms.join(", ")}` +
      (input.maxItemsPerPlatform
        ? `, up to ${input.maxItemsPerPlatform} rows each.`
        : ", all rows."),
  );

  const charging = Actor.getChargingManager();
  if (charging.getPricingInfo().isPayPerEvent) {
    const affordable =
      charging.calculateMaxEventChargeCountWithinLimit(CHARGE_EVENT);
    if (affordable <= 0) {
      log.warning("Max charge per run is too low for a single trend.");
      await Actor.exit();
    }
  }

  // Plain HTTP, no proxy: four public JSON endpoints, ~5 requests per run.
  const client = new HttpClient({
    fetch: gotFetch(),
    timeoutMs: 20_000,
    maxRetries: 1,
    log: (m) => log.debug(m),
  });

  const stats = await runBoards(input, {
    get: (url, headers) => client.get(url, headers),
    log: (m) => log.warning(m),
    emit: async (item) => {
      const res = await Actor.pushData(item, CHARGE_EVENT);
      return !res?.eventChargeLimitReached;
    },
  });

  log.info(
    `Done after ${client.requests} requests: ${JSON.stringify(stats.platforms)}`,
  );
  const ok = stats.platforms.filter((p) => p.items > 0);
  const bad = stats.platforms.filter(
    (p) => p.status !== "ok" && p.status !== "skipped",
  );
  const message =
    `${stats.items} trend(s) from ${ok.map((p) => `${p.platform} ${p.items}`).join(", ") || "no board"}` +
    (bad.length
      ? `; failed: ${bad.map((p) => `${p.platform} (${p.status})`).join(", ")}`
      : "") +
    (stats.stopReason === "budget" ? " (stopped at max charge)" : "");
  // Fail only when every board failed: one board down is a partial result.
  if (!stats.items && bad.length === stats.platforms.length) {
    await Actor.fail(message);
  } else {
    await Actor.setStatusMessage(message, { isStatusMessageTerminal: true });
    await Actor.exit();
  }
} catch (e) {
  log.exception(e as Error, "Run failed");
  await Actor.fail((e as Error).message);
}
