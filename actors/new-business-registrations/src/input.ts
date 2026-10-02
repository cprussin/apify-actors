import { createHash } from "node:crypto";
import { addDays, isoDate, type DateWindow } from "./dates.js";
import { STATE_CODES, type StateCode } from "./adapters/index.js";
import { ENTITY_CATEGORIES, type EntityCategory } from "./record.js";

/** Raw actor input, as defined in .actor/input_schema.json. */
export interface RawInput {
  states?: string[];
  formedWithinDays?: number;
  formedAfter?: string;
  formedBefore?: string;
  entityTypes?: string[];
  cities?: string[];
  zipCodes?: string[];
  counties?: string[];
  nameKeywords?: string[];
  maxResults?: number;
  onlyNew?: boolean;
}

export interface NormalizedInput {
  states: StateCode[];
  formedWithinDays: number;
  formedAfter?: string;
  formedBefore?: string;
  entityTypes: EntityCategory[];
  cities: string[];
  zipCodes: string[];
  counties: string[];
  nameKeywords: string[];
  maxResults: number;
  onlyNew: boolean;
}

export const DEFAULT_INPUT = {
  formedWithinDays: 30,
  maxResults: 100,
  onlyNew: false,
} satisfies RawInput;

export const MAX_RESULTS_CAP = 50_000;
export const MAX_WITHIN_DAYS = 3650;

export type { DateWindow };

export class InputError extends Error {}

const cleanList = (values: unknown, name: string, upper = false): string[] => {
  if (values === undefined || values === null) return [];
  if (!Array.isArray(values)) throw new InputError(`${name} must be an array.`);
  const out = new Set<string>();
  for (const v of values) {
    if (typeof v !== "string" && typeof v !== "number") continue;
    const s = String(v).trim().replace(/\s+/g, " ");
    if (s) out.add(upper ? s.toUpperCase() : s);
  }
  return [...out];
};

const optionalNumber = (v: unknown, name: string): number | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0)
    throw new InputError(`${name} must be a non-negative number.`);
  return n;
};

const optionalDate = (v: unknown, name: string): string | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const s = String(v).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) {
    throw new InputError(`${name} must be a date in YYYY-MM-DD format.`);
  }
  return s;
};

export function normalizeInput(
  raw: RawInput | null | undefined,
): NormalizedInput {
  const r: RawInput = { ...DEFAULT_INPUT, ...(raw ?? {}) };

  const states = cleanList(r.states, "states", true);
  for (const s of states) {
    if (!(STATE_CODES as readonly string[]).includes(s)) {
      throw new InputError(
        `Unsupported state "${s}". Supported: ${STATE_CODES.join(", ")}.`,
      );
    }
  }

  const entityTypes = cleanList(r.entityTypes, "entityTypes").map((t) =>
    t.toLowerCase(),
  );
  for (const t of entityTypes) {
    if (!(ENTITY_CATEGORIES as readonly string[]).includes(t)) {
      throw new InputError(
        `Unknown entity type "${t}". Use: ${ENTITY_CATEGORIES.join(", ")}.`,
      );
    }
  }

  const formedWithinDays = Math.floor(
    optionalNumber(r.formedWithinDays, "formedWithinDays") ??
      DEFAULT_INPUT.formedWithinDays,
  );
  if (formedWithinDays < 1 || formedWithinDays > MAX_WITHIN_DAYS) {
    throw new InputError(
      `formedWithinDays must be between 1 and ${MAX_WITHIN_DAYS}.`,
    );
  }
  const formedAfter = optionalDate(r.formedAfter, "formedAfter");
  const formedBefore = optionalDate(r.formedBefore, "formedBefore");
  if (formedAfter && formedBefore && formedBefore < formedAfter) {
    throw new InputError("formedBefore must be on or after formedAfter.");
  }

  const zipCodes = cleanList(r.zipCodes, "zipCodes");
  for (const z of zipCodes) {
    if (!/^\d{3,5}$/.test(z)) {
      throw new InputError(
        `ZIP code "${z}" must be 3 to 5 digits (a prefix is allowed).`,
      );
    }
  }

  const maxResults = Math.floor(
    optionalNumber(r.maxResults, "maxResults") ?? DEFAULT_INPUT.maxResults,
  );
  if (maxResults < 1) throw new InputError("maxResults must be >= 1.");

  return {
    states: (states.length ? states : [...STATE_CODES]) as StateCode[],
    formedWithinDays,
    formedAfter,
    formedBefore,
    entityTypes: entityTypes as EntityCategory[],
    cities: cleanList(r.cities, "cities", true),
    zipCodes,
    counties: cleanList(r.counties, "counties", true).map((c) =>
      c.replace(/\s+COUNTY$/, ""),
    ),
    nameKeywords: cleanList(r.nameKeywords, "nameKeywords", true),
    maxResults: Math.min(maxResults, MAX_RESULTS_CAP),
    onlyNew: r.onlyNew === true,
  };
}

/** Stable hash of the search-defining parts of the input (for delta mode). */
export function inputHash(input: NormalizedInput): string {
  const { maxResults: _m, onlyNew: _o, ...search } = input;
  const sorted = Object.fromEntries(
    Object.entries(search)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, Array.isArray(v) ? [...v].sort() : v])
      .sort(([a], [b]) => String(a).localeCompare(String(b))),
  );
  return createHash("sha256")
    .update(JSON.stringify(sorted))
    .digest("hex")
    .slice(0, 16);
}

export function computeWindow(input: NormalizedInput, now: Date): DateWindow {
  const today = isoDate(now);
  return {
    from: input.formedAfter ?? addDays(today, -input.formedWithinDays),
    to: input.formedBefore ?? today,
  };
}
