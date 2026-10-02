import { Actor, log } from "apify";
import { BiliClient } from "./bili.js";
import { HttpClient } from "./http.js";
import { InputError, normalizeInput, type RawInput } from "./input.js";
import { videoRefKey } from "./parse.js";
import { proxiedFetch } from "./proxy-fetch.js";
import { runScrape } from "./run.js";
import { BiliSource } from "./source.js";
import { Seen, stateKey } from "./state.js";

export const VIDEO_EVENT = "video";
export const COMMENT_EVENT = "comment";
/** Named (persistent) key-value store holding onlyNew state. */
export const STATE_STORE = "bilibili-scraper-state";

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

  const what =
    input.mode === "search"
      ? `search ${JSON.stringify(input.keywords)} (${input.searchOrder})`
      : input.mode === "videos"
        ? `${input.videos.length} video(s)`
        : input.mode === "user"
          ? `${input.users.length} channel(s)`
          : "trending";
  log.info(
    `Mode ${input.mode}: ${what}, up to ${input.maxItems} videos each` +
      (input.includeComments
        ? `, up to ${input.maxCommentsPerVideo} comments per video.`
        : ", no comments.") +
      (input.onlyNew ? " Only new videos." : ""),
  );

  // onlyNew: state is keyed by the query, so each distinct input (e.g. each
  // scheduled task) tracks its own "already returned" videos.
  let seen: Seen | undefined;
  let saveState: (() => Promise<void>) | undefined;
  if (input.onlyNew) {
    const store = await Actor.openKeyValueStore(STATE_STORE);
    const key = stateKey({
      mode: input.mode,
      keywords: [...input.keywords].sort(),
      searchOrder: input.searchOrder,
      videos: input.videos.map(videoRefKey).sort(),
      users: input.users.map((u) => ("mid" in u ? u.mid : u.name)).sort(),
    });
    const s = new Seen(await store.getValue(key));
    seen = s;
    saveState = () => store.setValue(key, s.toJSON());
    Actor.on("persistState", saveState);
    log.info(
      `Only new videos: state "${key}" in store "${STATE_STORE}" (${s.size} known).`,
    );
  }

  const charging = Actor.getChargingManager();
  const ppe = charging.getPricingInfo().isPayPerEvent;
  if (
    ppe &&
    charging.calculateMaxEventChargeCountWithinLimit(VIDEO_EVENT) < 1
  ) {
    log.warning("Max charge per run is too low for a single video.");
    await Actor.exit();
  }

  const proxy = raw?.proxyConfiguration
    ? await Actor.createProxyConfiguration(raw.proxyConfiguration)
    : undefined;
  if (proxy) log.info("Using proxy.");
  const warn = (m: string) => log.warning(m);
  const http = new HttpClient({
    fetch: proxy ? proxiedFetch(() => proxy.newUrl()) : undefined,
    log: warn,
  });
  const client = new BiliClient(http, { log: warn });
  const source = new BiliSource(client, warn);

  let comments = 0;
  const stats = await runScrape(input, {
    source,
    log: warn,
    seen,
    // Charge first, then save, so nothing is delivered unpaid and the run
    // stops at ACTOR_MAX_TOTAL_CHARGE_USD. Only fully built videos are
    // charged, so failed lookups are never billed.
    emit: async (item) => {
      if (!ppe) {
        await Actor.pushData(item);
        comments += item.comments?.length ?? 0;
        return true;
      }
      if (charging.calculateMaxEventChargeCountWithinLimit(VIDEO_EVENT) < 1)
        return false;
      const v = await Actor.charge({ eventName: VIDEO_EVENT });
      if (v.chargedCount < 1) return false;
      let more = !v.eventChargeLimitReached;
      if (item.comments?.length) {
        const affordable = Math.min(
          item.comments.length,
          charging.calculateMaxEventChargeCountWithinLimit(COMMENT_EVENT),
        );
        const c =
          affordable > 0
            ? await Actor.charge({
                eventName: COMMENT_EVENT,
                count: affordable,
              })
            : { chargedCount: 0, eventChargeLimitReached: true };
        if (c.chargedCount < item.comments.length) more = false;
        item.comments = item.comments.slice(0, c.chargedCount);
        more &&= !c.eventChargeLimitReached;
      }
      comments += item.comments?.length ?? 0;
      await Actor.pushData(item);
      return (
        more &&
        charging.calculateMaxEventChargeCountWithinLimit(VIDEO_EVENT) >= 1
      );
    },
  }).finally(() => saveState?.());

  log.info(
    `Done: ${JSON.stringify({ ...stats, comments, requests: http.requests, sessions: client.sessions, riskHits: client.riskHits })}`,
  );
  const per = Object.entries(stats.groups)
    .map(([k, s]) => `${k}: ${s.status === "failed" ? "failed" : s.emitted}`)
    .join(", ");
  await Actor.setStatusMessage(
    `Scraped ${stats.emitted} videos` +
      (input.includeComments ? ` and ${comments} comments` : "") +
      ` (${per})` +
      (seen
        ? `, skipped ${Object.values(stats.groups).reduce((n, s) => n + s.skippedSeen, 0)} seen before`
        : "") +
      (stats.stopReason === "budget" ? " (stopped at max charge)" : ""),
    { isStatusMessageTerminal: true },
  );
  await Actor.exit();
} catch (e) {
  log.exception(e as Error, "Run failed");
  await Actor.fail((e as Error).message);
}
