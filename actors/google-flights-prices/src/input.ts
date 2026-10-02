import { CABINS, type Cabin, type Search } from "./flights.js";

/** One route as entered in the `routes` input field. */
export interface RawRoute {
  origin?: string;
  destination?: string;
  date?: string;
  returnDate?: string;
  dateFrom?: string;
  dateTo?: string;
  stayDays?: number | string;
}

/** Raw actor input, as defined in .actor/input_schema.json. */
export interface RawInput {
  routes?: (RawRoute | string | null)[];
  adults?: number | string;
  cabinClass?: string;
  maxStops?: string | number;
  currency?: string;
  country?: string;
  language?: string;
  maxItineraries?: number | string;
  onlyNew?: boolean;
  proxyConfiguration?: Record<string, unknown>;
}

export interface NormalizedInput {
  searches: Search[];
  maxItineraries: number;
  /** Skip itineraries returned by earlier runs at the same price (monitoring). */
  onlyNew: boolean;
}

export const DEFAULT_DAYS_AHEAD = 30;
export const MAX_SEARCHES = 500;
export const MAX_RANGE_DAYS = 180;
export const MAX_ITINERARIES = 100;

export const DEFAULT_INPUT = {
  routes: [{ origin: "JFK", destination: "LHR", date: "+30" }],
  adults: 1,
  cabinClass: "economy",
  currency: "USD",
  country: "US",
  language: "en",
  maxItineraries: 10,
} satisfies RawInput;

export class InputError extends Error {}

const DAY_MS = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (ymd: string, n: number) =>
  isoDay(new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY_MS));

/**
 * "YYYY-MM-DD", or "+N" / "N" (N days from today, UTC). Empty = `fallback`
 * days from today.
 */
export function parseDate(
  v: unknown,
  name: string,
  now: Date,
  fallback?: number,
): string | null {
  const s = String(v ?? "").trim();
  const today = isoDay(now);
  if (!s) return fallback === undefined ? null : addDays(today, fallback);
  const rel = /^\+?(\d{1,3})$/.exec(s);
  if (rel) return addDays(today, Number(rel[1]));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s)))
    throw new InputError(
      `${name} "${s}" must be YYYY-MM-DD or +N (days from today).`,
    );
  if (isoDay(new Date(Date.parse(s))) !== s)
    throw new InputError(`${name} "${s}" is not a valid date.`);
  return s;
}

const IATA = /^[A-Z]{3}$/;

export function normalizeAirport(v: unknown, name: string): string {
  const s = String(v ?? "")
    .trim()
    .toUpperCase();
  if (!IATA.test(s))
    throw new InputError(
      `${name} "${String(v ?? "")}" must be a 3-letter IATA airport or city code, e.g. JFK, LHR or NYC.`,
    );
  return s;
}

/** Accept "JFK-LHR", "JFK-LHR 2026-11-15" or "JFK LHR 2026-11-15 2026-11-22". */
export function parseRouteString(s: string): RawRoute {
  const parts = s
    .trim()
    .split(/[\s,]+/)
    .flatMap((p) =>
      /^[A-Za-z]{3}[-–>]+[A-Za-z]{3}$/.test(p) ? p.split(/[-–>]+/) : [p],
    );
  const dates = parts.filter((p) => /^(\d{4}-\d{2}-\d{2}|\+\d+)$/.test(p));
  const codes = parts.filter((p) => /^[A-Za-z]{3}$/.test(p));
  if (codes.length !== 2)
    throw new InputError(
      `Route "${s}" must look like "JFK-LHR" or "JFK-LHR 2026-11-15".`,
    );
  return {
    origin: codes[0],
    destination: codes[1],
    date: dates[0],
    returnDate: dates[1],
  };
}

const toInt = (v: unknown, name: string, def: number): number => {
  if (v === undefined || v === null || v === "") return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new InputError(`${name} must be a number.`);
  return Math.floor(n);
};

const CABIN_ALIASES: Record<string, Cabin> = {
  economy: "economy",
  premiumeconomy: "premiumEconomy",
  premium: "premiumEconomy",
  business: "business",
  first: "first",
};

/** Expand one route into one search per departure date. */
function expandRoute(
  raw: RawRoute | string,
  i: number,
  base: Omit<Search, "origin" | "destination" | "date" | "returnDate">,
  now: Date,
): Search[] {
  const r = typeof raw === "string" ? parseRouteString(raw) : raw;
  const label = `routes[${i}]`;
  const origin = normalizeAirport(r.origin, `${label}.origin`);
  const destination = normalizeAirport(r.destination, `${label}.destination`);
  if (origin === destination)
    throw new InputError(`${label}: origin and destination are the same.`);
  const today = isoDay(now);

  const from = parseDate(r.dateFrom, `${label}.dateFrom`, now);
  const to = parseDate(r.dateTo, `${label}.dateTo`, now);
  let dates: string[];
  if (from || to) {
    if (!from || !to)
      throw new InputError(`${label}: set both dateFrom and dateTo.`);
    if (to < from)
      throw new InputError(`${label}: dateTo must not be before dateFrom.`);
    dates = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      dates.push(d);
      if (dates.length > MAX_RANGE_DAYS)
        throw new InputError(
          `${label}: a date range can span at most ${MAX_RANGE_DAYS} days.`,
        );
    }
  } else {
    dates = [parseDate(r.date, `${label}.date`, now, DEFAULT_DAYS_AHEAD)!];
  }

  const stayRaw = r.stayDays;
  const stay =
    stayRaw === undefined || stayRaw === null || stayRaw === ""
      ? null
      : toInt(stayRaw, `${label}.stayDays`, 0);
  if (stay !== null && (stay < 0 || stay > 365))
    throw new InputError(`${label}.stayDays must be between 0 and 365.`);
  const ret =
    stay === null ? parseDate(r.returnDate, `${label}.returnDate`, now) : null;
  if (ret && (from || to))
    throw new InputError(
      `${label}: use stayDays (not returnDate) for round trips with a date range.`,
    );

  return dates.map((date) => {
    if (date < today)
      throw new InputError(`${label}: departure ${date} is in the past.`);
    const returnDate = stay !== null ? addDays(date, stay) : ret;
    if (returnDate && returnDate < date)
      throw new InputError(
        `${label}: returnDate is before the departure date.`,
      );
    return { ...base, origin, destination, date, returnDate };
  });
}

export function normalizeInput(
  raw: RawInput | null | undefined,
  now: Date = new Date(),
): NormalizedInput {
  const r: RawInput = { ...DEFAULT_INPUT, ...(raw ?? {}) };

  const adults = toInt(r.adults, "adults", 1);
  if (adults < 1 || adults > 9)
    throw new InputError("adults must be between 1 and 9.");

  const cabinKey = String(r.cabinClass || "economy")
    .replace(/[\s_-]/g, "")
    .toLowerCase();
  const cabin = CABIN_ALIASES[cabinKey];
  if (!cabin)
    throw new InputError(
      `cabinClass must be one of ${Object.keys(CABINS).join(", ")}.`,
    );

  const stopsRaw = String(r.maxStops ?? "any")
    .trim()
    .toLowerCase();
  let maxStops: number | null = null;
  if (stopsRaw !== "any" && stopsRaw !== "") {
    maxStops = Number(stopsRaw === "nonstop" ? 0 : stopsRaw);
    if (![0, 1, 2].includes(maxStops))
      throw new InputError('maxStops must be "any", 0, 1 or 2.');
  }

  const currency = String(r.currency || "USD")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency))
    throw new InputError(`currency "${currency}" must be a code like USD.`);
  const gl = String(r.country || "US")
    .trim()
    .toLowerCase();
  if (!/^[a-z]{2}$/.test(gl))
    throw new InputError(`country "${gl}" must be a 2-letter code like US.`);
  const hl = String(r.language || "en").trim();
  if (!/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(hl))
    throw new InputError(`language "${hl}" must be a code like en or de.`);

  const maxItineraries = toInt(r.maxItineraries, "maxItineraries", 10);
  if (maxItineraries < 1 || maxItineraries > MAX_ITINERARIES)
    throw new InputError(
      `maxItineraries must be between 1 and ${MAX_ITINERARIES}.`,
    );

  const base = { adults, cabin, maxStops, currency, gl, hl };
  const routes = (Array.isArray(r.routes) ? r.routes : []).filter(
    (x): x is RawRoute | string =>
      x !== null && x !== undefined && x !== "" && typeof x !== "number",
  );
  if (!routes.length)
    throw new InputError(
      'Add at least one route, e.g. {"origin": "JFK", "destination": "LHR", "date": "2026-11-15"}.',
    );
  const searches = routes.flatMap((x, i) => expandRoute(x, i, base, now));
  if (searches.length > MAX_SEARCHES)
    throw new InputError(
      `At most ${MAX_SEARCHES} searches (route x date) per run; got ${searches.length}.`,
    );
  return { searches, maxItineraries, onlyNew: r.onlyNew === true };
}
