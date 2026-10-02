import { Actor, log, type ProxyConfigurationOptions } from "apify";
import { Budget } from "./budget.js";
import { aliexpressDeps, HttpRoute } from "./client.js";
import { PoliteFetcher, type Route } from "./fetcher.js";
import { HttpClient } from "./http.js";
import { InputError, normalizeInput, type RawInput } from "./input.js";
import { proxiedFetch } from "./proxy-fetch.js";
import { runScraper } from "./run.js";
import { Seen, stateKey } from "./state.js";

export const PRODUCT_EVENT = "product";
export const REVIEW_EVENT = "review";
/** Named (persistent) key-value store holding onlyNew state. */
export const STATE_STORE = "aliexpress-scraper-state";

type ProxyConfig = NonNullable<
  Awaited<ReturnType<typeof Actor.createProxyConfiguration>>
>;

function route(name: string, proxy?: ProxyConfig): Route {
  let r: HttpRoute | undefined = undefined;
  const http = new HttpClient({
    fetch: proxy ? proxiedFetch(() => proxy.newUrl(r!.session)) : undefined,
    maxRetries: 2,
    baseDelayMs: 1500,
    timeoutMs: 30_000,
    log: (m) => log.warning(m),
  });
  r = new HttpRoute(name, http);
  return r;
}

async function buildRoutes(
  cfg: Record<string, unknown> | undefined,
): Promise<Route[]> {
  const wantsProxy =
    !!cfg && (cfg.useApifyProxy === true || Array.isArray(cfg.proxyUrls));
  if (wantsProxy) {
    const proxy = await Actor.createProxyConfiguration(
      cfg as ProxyConfigurationOptions,
    );
    if (proxy) return [route("your proxy", proxy)];
  }
  // Default: direct, falling back to Apify datacenter proxy if blocked.
  const routes = [route("direct")];
  try {
    const dc = await Actor.createProxyConfiguration({});
    if (dc) routes.push(route("Apify datacenter proxy", dc));
  } catch (e) {
    log.info(`No proxy fallback: ${(e as Error).message.split("\n")[0]}`);
  }
  return routes;
}

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
    `${input.searches.length} search(es), up to ${input.maxPages} page(s) each, sort ${input.sort}; ` +
      `ship to ${input.shipTo}, ${input.currency}, ${input.language}; ` +
      (input.includeReviews
        ? `reviews for the top ${input.reviewsForTopProducts || "all"} product(s) per search`
        : "no search-product reviews") +
      (input.productIds.length
        ? ` + ${input.productIds.length} product ID(s)`
        : "") +
      `, up to ${input.maxReviewsPerProduct} reviews each` +
      (input.onlyNew ? ", only new" : "") +
      ".",
  );

  // onlyNew: state is keyed by the query, so each distinct input (e.g. each
  // scheduled task) tracks its own "already returned" items.
  let seen: Seen | undefined;
  let saveState: (() => Promise<void>) | undefined;
  if (input.onlyNew) {
    const store = await Actor.openKeyValueStore(STATE_STORE);
    const key = stateKey({
      searches: input.searches.map((s) => s.url).sort(),
      sort: input.sort,
      productIds: [...input.productIds].sort(),
      includeReviews: input.includeReviews,
      shipTo: input.shipTo,
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
  const pricing = charging.getPricingInfo();
  const budget = pricing.isPayPerEvent
    ? new Budget(pricing.maxTotalChargeUsd, pricing.perEventPrices)
    : null;
  // Include what's already charged (e.g. the synthetic actor-start event).
  if (budget)
    for (const [e, price] of Object.entries(pricing.perEventPrices))
      budget.spent += charging.getChargedEventCount(e) * (price ?? 0);
  const firstEvent = input.searches.length ? PRODUCT_EVENT : REVIEW_EVENT;
  if (budget && !budget.canAfford(firstEvent)) {
    await Actor.fail(
      "Max cost per run is too low for a single result. Raise it and try again.",
    );
  }

  const routes = await buildRoutes(raw?.proxyConfiguration);
  log.info(`Fetching via ${routes.map((r) => r.name).join(" → ")}.`);
  const fetcher = new PoliteFetcher(routes, { log: (m) => log.warning(m) });

  const stats = await runScraper(input, {
    ...aliexpressDeps(fetcher, input),
    log: (m) => log.warning(m),
    seen,
    emit: async (item) => {
      const event = item.type === "product" ? PRODUCT_EVENT : REVIEW_EVENT;
      const res = await Actor.pushData(item, event);
      const fits = budget ? budget.charge(event) : true;
      return fits && !res.eventChargeLimitReached;
    },
  }).finally(() => saveState?.());

  log.info(
    `Done after ${fetcher.requests} requests (${fetcher.blocks} blocked, last via ${fetcher.routeName}).`,
  );
  for (const s of stats.searches)
    log.info(
      `"${s.query}": ${s.products} products from ${s.pages} page(s), ${s.status}` +
        (s.totalResults !== null
          ? ` (${s.totalResults} results on AliExpress)`
          : ""),
    );
  await Actor.setValue("SUMMARY", {
    generatedAt: new Date().toISOString(),
    ...stats,
  });
  const failed =
    stats.searches.filter((s) => s.status === "failed").length +
    stats.reviewTargets.filter((s) => s.status === "failed").length;
  await Actor.setStatusMessage(
    `Scraped ${stats.products} products and ${stats.reviews} reviews` +
      (failed ? `, ${failed} target(s) failed` : "") +
      (stats.skippedSeen ? `, skipped ${stats.skippedSeen} seen before` : "") +
      (stats.stopReason === "budget" ? " (stopped at max charge)" : "") +
      (stats.stopReason === "blocked"
        ? " (stopped: AliExpress blocked requests)"
        : "") +
      ".",
    { isStatusMessageTerminal: true },
  );
  await Actor.exit();
} catch (e) {
  log.exception(e as Error, "Run failed");
  await Actor.fail((e as Error).message);
}
