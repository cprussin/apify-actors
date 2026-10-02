import { createHash } from "node:crypto";

export const CONTRACT_AWARD_TYPES = ["A", "B", "C", "D"] as const;
export type ContractAwardType = (typeof CONTRACT_AWARD_TYPES)[number];

/** Raw actor input, as defined in .actor/input_schema.json. */
export interface RawInput {
  endsInMonthsMin?: number;
  endsInMonthsMax?: number;
  naicsCodes?: string[];
  pscCodes?: string[];
  awardingAgencies?: string[];
  awardingSubAgencies?: string[];
  placeOfPerformanceStates?: string[];
  setAsideTypes?: string[];
  awardTypes?: string[];
  minAwardValue?: number;
  maxAwardValue?: number;
  minPotentialValue?: number;
  keywords?: string[];
  includeDetails?: boolean;
  maxResults?: number;
  onlyNew?: boolean;
}

export interface NormalizedInput {
  endsInMonthsMin: number;
  endsInMonthsMax: number;
  naicsCodes: string[];
  pscCodes: string[];
  awardingAgencies: string[];
  awardingSubAgencies: string[];
  placeOfPerformanceStates: string[];
  setAsideTypes: string[];
  awardTypes: ContractAwardType[];
  minAwardValue?: number;
  maxAwardValue?: number;
  minPotentialValue?: number;
  keywords: string[];
  includeDetails: boolean;
  maxResults: number;
  onlyNew: boolean;
}

export const DEFAULT_INPUT = {
  endsInMonthsMin: 6,
  endsInMonthsMax: 18,
  includeDetails: true,
  maxResults: 25,
  onlyNew: false,
} satisfies RawInput;

export const MAX_RESULTS_CAP = 10_000;

export class InputError extends Error {}

const cleanList = (values: unknown, upper = false): string[] => {
  if (values === undefined || values === null) return [];
  if (!Array.isArray(values)) throw new InputError("Expected an array.");
  const out = new Set<string>();
  for (const v of values) {
    if (typeof v !== "string" && typeof v !== "number") continue;
    const s = String(v).trim();
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

export function normalizeInput(
  raw: RawInput | null | undefined,
): NormalizedInput {
  const r: RawInput = { ...DEFAULT_INPUT, ...(raw ?? {}) };

  const endsInMonthsMin =
    optionalNumber(r.endsInMonthsMin, "endsInMonthsMin") ?? 0;
  const endsInMonthsMax =
    optionalNumber(r.endsInMonthsMax, "endsInMonthsMax") ?? 18;
  if (endsInMonthsMax < endsInMonthsMin) {
    throw new InputError("endsInMonthsMax must be >= endsInMonthsMin.");
  }
  if (endsInMonthsMax > 120) {
    throw new InputError("endsInMonthsMax must be <= 120.");
  }

  const awardTypes = cleanList(r.awardTypes, true);
  for (const t of awardTypes) {
    if (!(CONTRACT_AWARD_TYPES as readonly string[]).includes(t)) {
      throw new InputError(`Unknown award type "${t}". Use A, B, C or D.`);
    }
  }

  const minAwardValue = optionalNumber(r.minAwardValue, "minAwardValue");
  const maxAwardValue = optionalNumber(r.maxAwardValue, "maxAwardValue");
  if (
    minAwardValue !== undefined &&
    maxAwardValue !== undefined &&
    maxAwardValue < minAwardValue
  ) {
    throw new InputError("maxAwardValue must be >= minAwardValue.");
  }

  const maxResults = Math.floor(
    optionalNumber(r.maxResults, "maxResults") ?? DEFAULT_INPUT.maxResults,
  );
  if (maxResults < 1) throw new InputError("maxResults must be >= 1.");

  const naicsCodes = cleanList(r.naicsCodes);
  for (const c of naicsCodes) {
    if (!/^(\d{2}|\d{4}|\d{6})$/.test(c)) {
      throw new InputError(`NAICS code "${c}" must have 2, 4 or 6 digits.`);
    }
  }

  return {
    endsInMonthsMin,
    endsInMonthsMax,
    naicsCodes,
    pscCodes: cleanList(r.pscCodes, true),
    awardingAgencies: cleanList(r.awardingAgencies),
    awardingSubAgencies: cleanList(r.awardingSubAgencies),
    placeOfPerformanceStates: cleanList(r.placeOfPerformanceStates, true),
    setAsideTypes: cleanList(r.setAsideTypes, true),
    awardTypes: (awardTypes.length
      ? awardTypes
      : [...CONTRACT_AWARD_TYPES]) as ContractAwardType[],
    minAwardValue,
    maxAwardValue,
    minPotentialValue: optionalNumber(r.minPotentialValue, "minPotentialValue"),
    keywords: cleanList(r.keywords),
    includeDetails:
      r.includeDetails !== false || r.minPotentialValue !== undefined,
    maxResults: Math.min(maxResults, MAX_RESULTS_CAP),
    onlyNew: r.onlyNew === true,
  };
}

/** Stable hash of the search-defining parts of the input (for delta mode). */
export function inputHash(input: NormalizedInput): string {
  const { maxResults: _m, onlyNew: _o, includeDetails: _d, ...search } = input;
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

/** YYYY-MM-DD in UTC. */
export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

/** Add (possibly fractional) months to a UTC date. Fractions are ~30.44 days. */
export function addMonths(d: Date, months: number): Date {
  const whole = Math.trunc(months);
  const out = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + whole, d.getUTCDate()),
  );
  // Clamp overflow (e.g. Jan 31 + 1 month -> Feb 28/29).
  if (out.getUTCDate() !== d.getUTCDate()) out.setUTCDate(0);
  const frac = months - whole;
  if (frac) out.setUTCDate(out.getUTCDate() + Math.round(frac * 30.44));
  return out;
}

export interface DateWindow {
  today: string;
  start: string;
  end: string;
}

export function computeWindow(input: NormalizedInput, now: Date): DateWindow {
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  return {
    today: isoDate(today),
    start: isoDate(addMonths(today, input.endsInMonthsMin)),
    end: isoDate(addMonths(today, input.endsInMonthsMax)),
  };
}
