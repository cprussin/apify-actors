import {
  CATEGORIES,
  parseCoordinates,
  parseSlug,
  type Category,
  type Coordinates,
} from "./luma.js";

/** Raw actor input, as defined in .actor/input_schema.json. */
export interface RawInput {
  cities?: (string | null)[] | string;
  startUrls?: (string | { url?: string } | null)[];
  category?: string | null;
  keyword?: string | null;
  calendarPeriod?: string | null;
  maxEvents?: number | string;
  includeDetails?: boolean;
  onlyNew?: boolean;
  proxyConfiguration?: Record<string, unknown>;
}

/**
 * What to list. `city` and `page` slugs are resolved through Luma's URL
 * resolver at run time; `coords` searches around a point.
 */
export type Target =
  | { type: "city"; slug: string }
  | { type: "coords"; coordinates: Coordinates }
  | { type: "page"; slug: string };

export interface NormalizedInput {
  targets: Target[];
  category: Category | null;
  keyword: string | null;
  calendarPeriod: "future" | "past";
  /** Total events to output across all targets. */
  maxEvents: number;
  includeDetails: boolean;
  /** Skip events returned by earlier runs with the same input (monitoring). */
  onlyNew: boolean;
}

export const MAX_EVENTS = 10_000;
export const MAX_TARGETS = 200;

export const DEFAULT_INPUT = {
  cities: ["nyc"],
  maxEvents: 20,
  includeDetails: true,
} satisfies RawInput;

export class InputError extends Error {}

const toInt = (v: unknown, name: string, def: number): number => {
  if (v === undefined || v === null || v === "") return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new InputError(`${name} must be a number.`);
  return Math.floor(n);
};

const list = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(/\n/) : [])
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean);

export const targetKey = (t: Target): string =>
  t.type === "coords"
    ? `coords:${t.coordinates.latitude},${t.coordinates.longitude}`
    : `${t.type}:${t.slug.toLowerCase()}`;

export function normalizeInput(
  raw: RawInput | null | undefined,
): NormalizedInput {
  const given = raw ?? {};
  const startUrls = list(
    (Array.isArray(given.startUrls) ? given.startUrls : []).map((u) =>
      typeof u === "string" ? u : (u?.url ?? ""),
    ),
  );
  const hasOwn = list(given.cities).length > 0 || startUrls.length > 0;
  // Fall back to the default city only when nothing was given.
  const r: RawInput = hasOwn
    ? { ...DEFAULT_INPUT, cities: [], ...given }
    : { ...DEFAULT_INPUT, ...given };

  let category: Category | null = null;
  if (r.category && r.category !== "any") {
    const c = String(r.category).trim().toLowerCase();
    if (!(CATEGORIES as readonly string[]).includes(c))
      throw new InputError(
        `category "${r.category}" is not supported. Use one of: ${CATEGORIES.join(", ")}.`,
      );
    category = c as Category;
  }
  const keyword = typeof r.keyword === "string" ? r.keyword.trim() : "";
  if (keyword && !/[\p{L}\p{N}]/u.test(keyword))
    throw new InputError(`keyword "${keyword}" has no letters or digits.`);
  const period = r.calendarPeriod ?? "future";
  if (period !== "future" && period !== "past")
    throw new InputError('calendarPeriod must be "future" or "past".');

  const targets: Target[] = [];
  const seen = new Set<string>();
  const add = (t: Target) => {
    const k = targetKey(t);
    if (seen.has(k)) return;
    seen.add(k);
    targets.push(t);
  };

  for (const c of list(r.cities)) {
    const coordinates = parseCoordinates(c);
    if (coordinates) {
      add({ type: "coords", coordinates });
      continue;
    }
    const slug = parseSlug(c);
    if (!slug)
      throw new InputError(
        `City "${c}" is not a Luma city slug (e.g. nyc, sf, london) or "latitude,longitude".`,
      );
    add({ type: "city", slug });
  }
  for (const u of startUrls) {
    const slug = parseSlug(u);
    if (!slug)
      throw new InputError(
        `Start URL "${u}" is not a Luma page. Use URLs like https://luma.com/nyc (city), https://luma.com/genai-sf (calendar) or https://luma.com/<event>.`,
      );
    add({ type: "page", slug });
  }

  if (!targets.length)
    throw new InputError(
      'Add at least one city or start URL, e.g. cities: ["nyc"].',
    );
  if (targets.length > MAX_TARGETS)
    throw new InputError(
      `At most ${MAX_TARGETS} cities + start URLs per run; got ${targets.length}.`,
    );

  const maxEvents = toInt(r.maxEvents, "maxEvents", DEFAULT_INPUT.maxEvents);
  if (maxEvents < 1 || maxEvents > MAX_EVENTS)
    throw new InputError(`maxEvents must be between 1 and ${MAX_EVENTS}.`);

  return {
    targets,
    category,
    keyword: keyword || null,
    calendarPeriod: period,
    maxEvents,
    includeDetails: r.includeDetails !== false,
    onlyNew: r.onlyNew === true,
  };
}
