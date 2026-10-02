/**
 * Live smoke test against Google Flights (no proxy).
 * 1. Runs the input-schema default input (what Apify's daily test runs) and
 *    checks it finishes quickly with priced itineraries.
 * 2. Checks a round trip in another cabin/currency, a nonstop filter and a
 *    small date range.
 * Usage: npm run smoke -w actors/google-flights-prices
 */
import { readFileSync } from "node:fs";
import { FlightsClient } from "../src/http.js";
import { normalizeInput, type RawInput } from "../src/input.js";
import { runFlights, type FlightResult } from "../src/run.js";

const schema = JSON.parse(
  readFileSync(new URL("../.actor/input_schema.json", import.meta.url), "utf8"),
) as { properties: Record<string, { default?: unknown; prefill?: unknown }> };
const defaults = Object.fromEntries(
  Object.entries(schema.properties)
    .filter(([, p]) => p.prefill !== undefined || p.default !== undefined)
    .map(([k, p]) => [k, p.prefill ?? p.default]),
) as RawInput;

const problems: string[] = [];
const http = new FlightsClient({ log: console.warn });

async function run(name: string, raw: RawInput) {
  const out: FlightResult[] = [];
  const started = Date.now();
  const input = normalizeInput(raw);
  const stats = await runFlights(input, {
    get: (url) => http.get(url),
    log: (m) => problems.push(`${name}: ${m}`),
    emit: async (r) => (out.push(r), true),
  });
  const seconds = (Date.now() - started) / 1000;
  console.log(
    `\n== ${name}: ${out.length} itineraries from ${stats.searches} searches in ${seconds}s (${http.requests} requests, ${http.blocks} blocks)`,
  );
  for (const i of out.slice(0, 4))
    console.log(
      `  ${i.route} ${i.departureDate}${i.returnDate ? "/" + i.returnDate : ""} ${i.price} ${i.currency} ${i.airlines.join("+")} ${i.flightNumbers.join(",")} ${i.departureTime}->${i.arrivalTime} ${i.duration} stops=${i.stops}${i.layoverAirports.length ? ` via ${i.layoverAirports.join(",")}` : ""} co2=${i.emissionsKg}kg${i.isBest ? " best" : ""}${i.isCheapest ? " cheapest" : ""}`,
    );
  for (const i of out) {
    if (!(i.price > 0)) problems.push(`${name}: bad price ${i.price}`);
    if (!i.flightNumbers.length || !i.departureTime || !i.arrivalTime)
      problems.push(`${name}: incomplete item ${JSON.stringify(i)}`);
    if (i.stops !== i.layoverAirports.length)
      problems.push(`${name}: stops/layovers mismatch ${i.flightNumbers}`);
  }
  if (!out.length) problems.push(`${name}: no results`);
  return { out, stats, seconds, input };
}

// 1. Default input.
console.log("Default input:", JSON.stringify(defaults));
const d = await run("default", defaults);
if (d.out.length !== d.input.maxItineraries)
  problems.push(`default: ${d.out.length}/${d.input.maxItineraries} items`);
if (!d.out.some((i) => i.isBest)) problems.push("default: no best flag");
if (d.seconds > 30) problems.push(`default: took ${d.seconds}s`);

// 2. Round trip, business, EUR, 2 adults.
const rt = await run("round trip", {
  routes: [{ origin: "SFO", destination: "CDG", date: "+45", stayDays: 10 }],
  adults: 2,
  cabinClass: "business",
  currency: "EUR",
  country: "DE",
  maxItineraries: 5,
});
if (rt.out.some((i) => i.currency !== "EUR" || i.tripType !== "roundTrip"))
  problems.push("round trip: wrong currency or trip type");

// 3. Nonstop filter.
const ns = await run("nonstop", {
  routes: ["LAX-NRT +60"],
  maxStops: "0",
  maxItineraries: 30,
});
if (ns.out.some((i) => i.stops !== 0)) problems.push("nonstop: got stops");

// 4. Date range (price calendar), cheapest per day.
const range = await run("range", {
  routes: [
    { origin: "LHR", destination: "BCN", dateFrom: "+20", dateTo: "+22" },
  ],
  maxItineraries: 3,
});
const days = new Set(range.out.map((i) => i.departureDate));
if (days.size !== 3) problems.push(`range: ${days.size}/3 days`);
for (const day of days) {
  const cheapest = range.out
    .filter((i) => i.departureDate === day)
    .map((i) => i.price);
  console.log(`  ${day}: from ${Math.min(...cheapest)}`);
}

console.log(`\n${http.requests} requests total, ${http.blocks} blocked`);
if (problems.length) {
  console.error("SMOKE FAILED", problems);
  process.exit(1);
}
console.log("SMOKE OK");
