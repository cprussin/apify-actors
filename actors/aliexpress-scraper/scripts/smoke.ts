/**
 * Live smoke test against AliExpress (direct connection).
 * 1. Runs the input-schema default input (what Apify's daily test runs) and
 *    checks it finishes well under 60 s with valid products and reviews.
 * 2. Checks pagination, sorting, a search URL, other ship-to/currency,
 *    reviews-only product IDs with translation, and a no-results search.
 * Usage: npm run smoke -w actors/aliexpress-scraper
 */
import { readFileSync } from "node:fs";
import { aliexpressDeps, HttpRoute } from "../src/client.js";
import { PoliteFetcher } from "../src/fetcher.js";
import { HttpClient } from "../src/http.js";
import { normalizeInput, type RawInput } from "../src/input.js";
import type { Review } from "../src/reviews.js";
import { runScraper } from "../src/run.js";
import type { Product } from "../src/search.js";

const schema = JSON.parse(
  readFileSync(new URL("../.actor/input_schema.json", import.meta.url), "utf8"),
) as { properties: Record<string, { default?: unknown; prefill?: unknown }> };
const defaults = Object.fromEntries(
  Object.entries(schema.properties)
    .filter(([, p]) => p.prefill !== undefined || p.default !== undefined)
    .map(([k, p]) => [k, p.prefill ?? p.default]),
) as RawInput;

const problems: string[] = [];
const route = new HttpRoute(
  "direct",
  new HttpClient({ log: console.warn, maxRetries: 2 }),
);
const fetcher = new PoliteFetcher([route], { log: console.warn });

async function run(name: string, raw: RawInput) {
  const input = normalizeInput(raw);
  const products: Product[] = [];
  const reviews: Review[] = [];
  const started = Date.now();
  let error: string | undefined;
  let stats;
  try {
    stats = await runScraper(input, {
      ...aliexpressDeps(fetcher, input),
      log: (m) => console.warn(`${name}: ${m}`),
      emit: async (x) => {
        if (x.type === "product") products.push(x);
        else reviews.push(x);
        return true;
      },
    });
  } catch (e) {
    error = (e as Error).message;
  }
  const seconds = (Date.now() - started) / 1000;
  console.log(
    `\n== ${name}: ${products.length} products, ${reviews.length} reviews in ${seconds}s` +
      (error ? ` (error: ${error})` : ""),
  );
  if (stats)
    console.log(
      JSON.stringify(stats.searches),
      JSON.stringify(stats.reviewTargets),
    );
  for (const p of products)
    if (
      !/^\d{8,17}$/.test(p.productId) ||
      !p.title ||
      !p.url.startsWith("https://www.aliexpress.com/item/") ||
      (p.price !== null && !(p.price > 0)) ||
      (p.rating !== null && !(p.rating >= 1 && p.rating <= 5))
    )
      problems.push(`${name}: bad product ${JSON.stringify(p)}`);
  for (const r of reviews)
    if (
      !r.reviewId ||
      !(r.rating! >= 1 && r.rating! <= 5) ||
      typeof r.text !== "string" ||
      (r.dateText && !r.translatedText && !r.date)
    )
      problems.push(`${name}: bad review ${JSON.stringify(r)}`);
  if (new Set(products.map((p) => p.productId)).size !== products.length)
    problems.push(`${name}: duplicate products`);
  return { products, reviews, stats, seconds, error };
}

// 1. Default input.
console.log("Default input:", JSON.stringify(defaults));
const d = await run("default", defaults);
console.log(JSON.stringify(d.products[0], null, 2));
console.log(JSON.stringify(d.reviews[0], null, 2));
if (d.error) problems.push(`default: ${d.error}`);
if (d.products.length < 40)
  problems.push(`default: ${d.products.length} products`);
const withPrice = d.products.filter((p) => p.price !== null).length;
if (withPrice < d.products.length * 0.9)
  problems.push(`default: only ${withPrice} products have a price`);
if (d.products.filter((p) => p.rating !== null).length < d.products.length / 2)
  problems.push("default: few ratings");
if (
  d.products.filter((p) => p.soldCount !== null).length <
  d.products.length / 2
)
  problems.push("default: few sold counts");
const expectReviews =
  Number(defaults.reviewsForTopProducts) *
  Number(defaults.maxReviewsPerProduct);
if (d.reviews.length < Math.min(expectReviews, 10))
  problems.push(`default: ${d.reviews.length}/${expectReviews} reviews`);
if (d.seconds > 40) problems.push(`default: took ${d.seconds}s`);

// 2. Pagination + sort by orders.
const p = await run("pagination", {
  keywords: ["usb c cable"],
  maxPagesPerKeyword: 3,
  sort: "orders",
  includeReviews: false,
});
if (p.products.length < 120) problems.push(`pagination: ${p.products.length}`);
if (p.stats?.searches[0]?.pages !== 3) problems.push("pagination: pages != 3");

// 3. Search URL, ship to Germany in EUR (GDPR regions return lean cards).
const u = await run("url-de", {
  searchUrls: ["https://www.aliexpress.com/wholesale?SearchText=led+strip"],
  shipTo: "DE",
  currency: "EUR",
  includeReviews: false,
});
if (!u.products.length || u.products.some((x) => x.currency !== "EUR"))
  problems.push("url-de: expected EUR products");

// 4. Reviews only, deep pagination and translation.
const r = await run("reviews", {
  productIds: ["https://www.aliexpress.com/item/1005007502032342.html"],
  maxReviewsPerProduct: 65,
  translateReviews: true,
  language: "en",
});
if (r.reviews.length !== 65) problems.push(`reviews: ${r.reviews.length}/65`);
if (new Set(r.reviews.map((x) => x.reviewId)).size !== r.reviews.length)
  problems.push("reviews: duplicates");
if (!r.reviews.some((x) => x.images.length))
  console.warn("reviews: no review images (warning)");

// 5. Nonexistent product → error, not success.
const n = await run("no-reviews", { productIds: ["1005000000000001"] });
if (!n.error) problems.push("no-reviews: expected an error for zero results");

console.log(`\n${fetcher.requests} requests total, ${fetcher.blocks} blocked`);
if (problems.length) {
  console.error("SMOKE FAILED", problems);
  process.exit(1);
}
console.log("SMOKE OK");
