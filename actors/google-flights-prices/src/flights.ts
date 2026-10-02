/**
 * Pure Google Flights helpers: build search URLs (the `tfs` protobuf the
 * website uses) and parse itineraries from the AF_initDataCallback JSON blobs
 * embedded in the server-rendered results page.
 */

export const CABINS = {
  economy: 1,
  premiumEconomy: 2,
  business: 3,
  first: 4,
} as const;
export type Cabin = keyof typeof CABINS;

export interface Search {
  origin: string;
  destination: string;
  /** YYYY-MM-DD */
  date: string;
  /** YYYY-MM-DD for round trips, else null. */
  returnDate: string | null;
  adults: number;
  cabin: Cabin;
  /** null = any number of stops. */
  maxStops: number | null;
  currency: string;
  /** Country (gl), lower case. */
  gl: string;
  /** Language (hl). */
  hl: string;
}

// --- tfs protobuf -----------------------------------------------------------

const varint = (n: number): number[] => {
  const out: number[] = [];
  while (n > 127) {
    out.push((n & 127) | 128);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return out;
};
const tag = (field: number, wire: number) => varint((field << 3) | wire);
const bytesField = (field: number, bytes: number[]) => [
  ...tag(field, 2),
  ...varint(bytes.length),
  ...bytes,
];
const strField = (field: number, s: string) =>
  bytesField(field, [...Buffer.from(s, "utf8")]);
const intField = (field: number, n: number) => [...tag(field, 0), ...varint(n)];

/**
 * The `tfs` query parameter: base64 of Google Flights' search protobuf
 * (legs = field 3 with date 2, max stops 5, from 13, to 14; passengers 8;
 * cabin 9; trip type 19 = 1 round trip / 2 one way).
 */
export function buildTfs(s: Search): string {
  const legs = [[s.date, s.origin, s.destination]];
  if (s.returnDate) legs.push([s.returnDate, s.destination, s.origin]);
  const out: number[] = [];
  for (const [date, from, to] of legs) {
    out.push(
      ...bytesField(3, [
        ...strField(2, date!),
        ...(s.maxStops === null ? [] : intField(5, s.maxStops)),
        ...bytesField(13, strField(2, from!)),
        ...bytesField(14, strField(2, to!)),
      ]),
    );
  }
  for (let i = 0; i < s.adults; i++) out.push(...intField(8, 1));
  out.push(...intField(9, CABINS[s.cabin]));
  out.push(...intField(19, s.returnDate ? 1 : 2));
  return Buffer.from(out).toString("base64");
}

export function searchUrl(s: Search): string {
  const q = new URLSearchParams({
    tfs: buildTfs(s),
    hl: s.hl,
    gl: s.gl,
    curr: s.currency,
  });
  return `https://www.google.com/travel/flights/search?${q.toString()}`;
}

// --- embedded JSON ----------------------------------------------------------

/** Index just past the JSON value starting at `start` (an array or object). */
function jsonEnd(s: string, start: number): number {
  let depth = 0;
  let inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** All `AF_initDataCallback({key: 'ds:N', ..., data: <json>})` blobs by key. */
export function extractBlobs(html: string): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const re = /AF_initDataCallback\(\{key:\s*'([^']+)'[^]*?data:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const start = re.lastIndex;
    if (html[start] !== "[" && html[start] !== "{") continue;
    const end = jsonEnd(html, start);
    if (end < 0) continue;
    try {
      out.set(m[1]!, JSON.parse(html.slice(start, end)));
    } catch {
      // Not JSON (e.g. a function); ignore.
    }
    re.lastIndex = end;
  }
  return out;
}

type J = unknown;
const arr = (v: J): J[] | null => (Array.isArray(v) ? v : null);
const at = (v: J, ...path: number[]): J => {
  let cur = v;
  for (const i of path) {
    const a = arr(cur);
    if (!a) return undefined;
    cur = a[i];
  }
  return cur;
};
const str = (v: J): string | null => (typeof v === "string" && v ? v : null);
const num = (v: J): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** One raw itinerary looks like [[airline, [names], [legs...], ...], [[null, price], token], ...]. */
function isItinerary(v: J): boolean {
  const legs = arr(at(v, 0, 2));
  return !!legs?.length && typeof at(v, 0, 3) === "string" && !!arr(at(v, 1));
}

/** Sections of itineraries: [2] = Google's "best"/top flights, [3] = other flights. */
function sections(blob: J): { best: J[]; other: J[] } | null {
  const a = arr(blob);
  if (!a) return null;
  const list = (i: number) => (arr(at(a, i, 0)) ?? []).filter(isItinerary);
  const best = list(2);
  const other = list(3);
  return best.length || other.length ? { best, other } : null;
}

/** Search context from the page header blob: [[..], [status, [.., trip type, ..]]]. */
export interface PageInfo {
  /** Blob keys differ between pages; the results blob is found by shape. */
  results: { best: J[]; other: J[] } | null;
  /** Total number of "other flights" Google says it has (more than rendered). */
  totalOther: number | null;
}

export function parsePage(html: string): PageInfo {
  const blobs = extractBlobs(html);
  for (const blob of blobs.values()) {
    const s = sections(blob);
    if (s) return { results: s, totalOther: num(at(blob, 3, 1)) };
  }
  return { results: null, totalOther: null };
}

// --- itineraries ------------------------------------------------------------

export interface Leg {
  flightNumber: string | null;
  airline: string | null;
  airlineCode: string | null;
  from: string | null;
  fromName: string | null;
  to: string | null;
  toName: string | null;
  departureTime: string | null;
  arrivalTime: string | null;
  durationMinutes: number | null;
  aircraft: string | null;
  legroom: string | null;
}

export interface Layover {
  airport: string | null;
  airportName: string | null;
  city: string | null;
  durationMinutes: number | null;
}

export interface Itinerary {
  price: number | null;
  currency: string | null;
  isBest: boolean;
  airlines: string[];
  flightNumbers: string[];
  departureAirport: string | null;
  arrivalAirport: string | null;
  departureTime: string | null;
  arrivalTime: string | null;
  durationMinutes: number | null;
  stops: number;
  layovers: Layover[];
  legs: Leg[];
  emissionsKg: number | null;
  typicalEmissionsKg: number | null;
  emissionsDiffPercent: number | null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** [2026,11,15] + [8] / [8,45] / [null,20] -> "2026-11-15T08:00" (local airport time). */
export function localTime(date: J, time: J): string | null {
  const d = arr(date);
  const y = num(d?.[0]);
  const mo = num(d?.[1]);
  const day = num(d?.[2]);
  if (y === null || mo === null || day === null) return null;
  const t = arr(time);
  const ymd = `${y}-${pad(mo)}-${pad(day)}`;
  if (!t) return ymd;
  return `${ymd}T${pad(num(t[0]) ?? 0)}:${pad(num(t[1]) ?? 0)}`;
}

export function formatDuration(minutes: number | null): string | null {
  if (minutes === null) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

/**
 * The booking token (base64 protobuf) carries the price currency as a
 * 3-byte string in field 3: bytes 0x1a 0x03 "USD".
 */
export function tokenCurrency(token: J): string | null {
  const t = str(token);
  if (!t) return null;
  const b = Buffer.from(t, "base64");
  for (let i = 0; i + 5 <= b.length; i++) {
    if (b[i] !== 0x1a || b[i + 1] !== 3) continue;
    const code = b.subarray(i + 2, i + 5).toString("latin1");
    if (/^[A-Z]{3}$/.test(code)) return code;
  }
  return null;
}

const grams2kg = (g: J) => {
  const n = num(g);
  return n === null || n <= 0 ? null : Math.round(n / 1000);
};

function parseLeg(l: J): Leg {
  const fn = arr(at(l, 22));
  const code = str(fn?.[0]);
  const number = str(fn?.[1]);
  return {
    flightNumber: code && number ? `${code}${number}` : null,
    airline: str(fn?.[3]),
    airlineCode: code,
    from: str(at(l, 3)),
    fromName: str(at(l, 4)),
    to: str(at(l, 6)),
    toName: str(at(l, 5)),
    departureTime: localTime(at(l, 20), at(l, 8)),
    arrivalTime: localTime(at(l, 21), at(l, 10)),
    durationMinutes: num(at(l, 11)),
    aircraft: str(at(l, 17)),
    legroom: str(at(l, 14)),
  };
}

export function parseItinerary(raw: J, isBest: boolean): Itinerary {
  const f = at(raw, 0);
  const legs = (arr(at(f, 2)) ?? []).map(parseLeg);
  const layovers = (arr(at(f, 13)) ?? []).map((x) => ({
    airport: str(at(x, 1)),
    airportName: str(at(x, 4)),
    city: str(at(x, 5)),
    durationMinutes: num(at(x, 0)),
  }));
  const names = (arr(at(f, 1)) ?? []).map(str).filter((x) => x !== null);
  const fromLegs = legs.map((l) => l.airline).filter((x) => x !== null);
  const emissions = at(f, 22);
  const kg = grams2kg(at(emissions, 7));
  return {
    price: num(at(raw, 1, 0, 1)),
    currency: tokenCurrency(at(raw, 1, 1)),
    isBest,
    airlines: [...new Set(names.length ? names : fromLegs)],
    flightNumbers: legs.map((l) => l.flightNumber).filter((x) => x !== null),
    departureAirport: str(at(f, 3)),
    arrivalAirport: str(at(f, 6)),
    departureTime: localTime(at(f, 4), at(f, 5)),
    arrivalTime: localTime(at(f, 7), at(f, 8)),
    durationMinutes: num(at(f, 9)),
    stops: Math.max(layovers.length, legs.length - 1, 0),
    layovers,
    legs,
    emissionsKg: kg,
    typicalEmissionsKg: grams2kg(at(emissions, 8)),
    emissionsDiffPercent: kg === null ? null : num(at(emissions, 3)),
  };
}

/** Best flights first, then other flights, de-duplicated, in Google's order. */
export function parseItineraries(html: string): {
  itineraries: Itinerary[];
  totalOther: number | null;
} {
  const page = parsePage(html);
  if (!page.results) return { itineraries: [], totalOther: null };
  const seen = new Set<string>();
  const out: Itinerary[] = [];
  const add = (raw: J, best: boolean) => {
    const it = parseItinerary(raw, best);
    const key = `${it.flightNumbers.join(",")}|${it.departureTime}|${it.price}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(it);
  };
  for (const r of page.results.best) add(r, true);
  for (const r of page.results.other) add(r, false);
  return { itineraries: out, totalOther: page.totalOther };
}

/** True for Google's "no results"/unknown airport pages (no results blob at all). */
export function hasFlightsPage(html: string): boolean {
  return /AF_initDataCallback/.test(html);
}
