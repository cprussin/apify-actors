import {
  formatDuration,
  hasFlightsPage,
  parseItineraries,
  searchUrl,
  type Cabin,
  type Itinerary,
  type Layover,
  type Leg,
  type Search,
} from "./flights.js";
import type { NormalizedInput } from "./input.js";
import type { Seen } from "./state.js";

export interface FlightResult {
  route: string;
  origin: string;
  destination: string;
  tripType: "oneWay" | "roundTrip";
  departureDate: string;
  returnDate: string | null;
  adults: number;
  cabinClass: Cabin;
  price: number;
  currency: string;
  isBest: boolean;
  isCheapest: boolean;
  rank: number;
  airlines: string[];
  flightNumbers: string[];
  departureAirport: string | null;
  arrivalAirport: string | null;
  departureTime: string | null;
  arrivalTime: string | null;
  durationMinutes: number | null;
  duration: string | null;
  stops: number;
  layoverAirports: string[];
  layovers: Layover[];
  legs: Leg[];
  emissionsKg: number | null;
  typicalEmissionsKg: number | null;
  emissionsDiffPercent: number | null;
  searchUrl: string;
  scrapedAt: string;
}

export interface RunDeps {
  /** GET a URL, returning the HTML body (throws on HTTP errors/blocks). */
  get: (url: string) => Promise<string>;
  /** Push one item and charge for it. Return `false` to stop (budget). */
  emit: (item: FlightResult) => Promise<boolean>;
  log?: (msg: string) => void;
  now?: () => Date;
  /**
   * onlyNew mode: skip itineraries returned before at the same price, record
   * new ones and price changes.
   */
  seen?: Seen;
}

export interface RunStats {
  searches: number;
  emitted: number;
  /** onlyNew: itineraries returned before at the same price (not charged). */
  skippedSeen: number;
  empty: string[];
  failed: { search: string; error: string }[];
  stopReason: "done" | "budget";
}

const errMsg = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).slice(0, 300);

/** Identity of an itinerary across runs (onlyNew): route, dates, cabin, flights. */
export const itineraryKey = (r: FlightResult): string =>
  [
    r.origin,
    r.destination,
    r.departureDate,
    r.returnDate ?? "",
    r.adults,
    r.cabinClass,
    r.flightNumbers.join(","),
    r.departureTime ?? "",
  ].join("|");

/** onlyNew fingerprint: an itinerary is returned again when this changes. */
export const priceKey = (r: FlightResult): string => `${r.price} ${r.currency}`;

export const describeSearch = (s: Search) =>
  `${s.origin}-${s.destination} ${s.date}${s.returnDate ? `/${s.returnDate}` : ""}`;

export function toResults(
  s: Search,
  itineraries: Itinerary[],
  max: number,
  scrapedAt: string,
): FlightResult[] {
  const priced = itineraries.filter(
    (i): i is Itinerary & { price: number } => i.price !== null && i.price > 0,
  );
  const cheapest = Math.min(...priced.map((i) => i.price));
  const url = searchUrl(s);
  return priced.slice(0, max).map((i, n) => ({
    route: `${s.origin}-${s.destination}`,
    origin: s.origin,
    destination: s.destination,
    tripType: s.returnDate ? "roundTrip" : "oneWay",
    departureDate: s.date,
    returnDate: s.returnDate,
    adults: s.adults,
    cabinClass: s.cabin,
    price: i.price,
    currency: i.currency ?? s.currency,
    isBest: i.isBest,
    isCheapest: i.price === cheapest,
    rank: n + 1,
    airlines: i.airlines,
    flightNumbers: i.flightNumbers,
    departureAirport: i.departureAirport,
    arrivalAirport: i.arrivalAirport,
    departureTime: i.departureTime,
    arrivalTime: i.arrivalTime,
    durationMinutes: i.durationMinutes,
    duration: formatDuration(i.durationMinutes),
    stops: i.stops,
    layoverAirports: i.layovers
      .map((l) => l.airport)
      .filter((x): x is string => x !== null),
    layovers: i.layovers,
    legs: i.legs,
    emissionsKg: i.emissionsKg,
    typicalEmissionsKg: i.typicalEmissionsKg,
    emissionsDiffPercent: i.emissionsDiffPercent,
    searchUrl: url,
    scrapedAt,
  }));
}

export async function runFlights(
  input: NormalizedInput,
  deps: RunDeps,
): Promise<RunStats> {
  const log = deps.log ?? (() => {});
  const now = deps.now ?? (() => new Date());
  const stats: RunStats = {
    searches: 0,
    emitted: 0,
    skippedSeen: 0,
    empty: [],
    failed: [],
    stopReason: "done",
  };
  for (const s of input.searches) {
    const name = describeSearch(s);
    let results: FlightResult[];
    try {
      const html = await deps.get(searchUrl(s));
      stats.searches += 1;
      if (!hasFlightsPage(html))
        throw new Error("Unexpected page: no Google Flights data.");
      const { itineraries } = parseItineraries(html);
      results = toResults(
        s,
        itineraries,
        input.maxItineraries,
        now().toISOString(),
      );
    } catch (e) {
      const error = errMsg(e);
      stats.failed.push({ search: name, error });
      log(`${name}: ${error}`);
      continue;
    }
    if (!results.length) {
      stats.empty.push(name);
      log(`${name}: no priced flights found (check airport codes and date).`);
      continue;
    }
    for (const item of results) {
      const key = itineraryKey(item);
      if (deps.seen?.has(key, priceKey(item))) {
        deps.seen.add(key, priceKey(item));
        stats.skippedSeen += 1;
        continue;
      }
      const more = await deps.emit(item);
      deps.seen?.add(key, priceKey(item));
      stats.emitted += 1;
      if (!more) {
        stats.stopReason = "budget";
        return stats;
      }
    }
  }
  // Partial results are fine, but never report success when every search failed.
  if (
    stats.failed.length > 0 &&
    stats.emitted === 0 &&
    stats.skippedSeen === 0
  ) {
    throw new Error(
      `All searches failed: ${[...new Set(stats.failed.map((f) => f.error))].join("; ")}`,
    );
  }
  return stats;
}
