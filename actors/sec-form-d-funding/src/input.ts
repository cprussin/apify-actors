import { INDUSTRY_CATEGORIES } from "./formd.js";

export const FILING_TYPES = ["new", "amendment", "both"] as const;
export type FilingType = (typeof FILING_TYPES)[number];

/** Raw actor input, as defined in .actor/input_schema.json. */
export interface RawInput {
  lastNDays?: number;
  startDate?: string;
  endDate?: string;
  states?: string[];
  industryGroups?: string[];
  excludeInvestmentFunds?: boolean;
  minOfferingAmount?: number;
  maxOfferingAmount?: number;
  filingType?: string;
  maxResults?: number;
  onlyNew?: boolean;
}

export interface NormalizedInput {
  lastNDays: number;
  startDate?: string;
  endDate?: string;
  states: string[];
  /** Lower-cased industry groups and/or categories. */
  industryGroups: string[];
  excludeInvestmentFunds: boolean;
  minOfferingAmount?: number;
  maxOfferingAmount?: number;
  filingType: FilingType;
  maxResults: number;
  onlyNew: boolean;
}

export const DEFAULT_INPUT = {
  lastNDays: 7,
  filingType: "both",
  excludeInvestmentFunds: false,
  maxResults: 100,
  onlyNew: false,
} satisfies RawInput;

export const MAX_RESULTS_CAP = 100_000;
export const MAX_DAYS = 3660;
/** Full-text search covers 2001 onward. */
export const EARLIEST_DATE = "2001-01-01";

const KNOWN_INDUSTRIES = new Set(
  Object.entries(INDUSTRY_CATEGORIES)
    .flatMap(([cat, groups]) => [cat, ...groups])
    .map((s) => s.toLowerCase()),
);

export class InputError extends Error {}

const cleanList = (values: unknown, name: string): string[] => {
  if (values === undefined || values === null) return [];
  if (!Array.isArray(values)) throw new InputError(`${name} must be a list.`);
  const out = new Set<string>();
  for (const v of values) {
    if (typeof v !== "string") continue;
    const s = v.trim();
    if (s) out.add(s);
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s)))
    throw new InputError(`${name} must be a date (YYYY-MM-DD).`);
  return s;
};

export function normalizeInput(
  raw: RawInput | null | undefined,
): NormalizedInput {
  const r: RawInput = { ...DEFAULT_INPUT, ...(raw ?? {}) };

  const lastNDays = Math.floor(
    optionalNumber(r.lastNDays, "lastNDays") ?? DEFAULT_INPUT.lastNDays,
  );
  if (lastNDays < 1 || lastNDays > MAX_DAYS)
    throw new InputError(`lastNDays must be between 1 and ${MAX_DAYS}.`);

  const startDate = optionalDate(r.startDate, "startDate");
  const endDate = optionalDate(r.endDate, "endDate");
  if (startDate && endDate && endDate < startDate)
    throw new InputError("endDate must be on or after startDate.");
  if (startDate && startDate < EARLIEST_DATE)
    throw new InputError(`startDate must be ${EARLIEST_DATE} or later.`);

  const states = cleanList(r.states, "states").map((s) => s.toUpperCase());
  for (const s of states) {
    if (!/^[A-Z0-9]{2}$/.test(s))
      throw new InputError(
        `State "${s}" must be a two-letter code, e.g. CA or NY.`,
      );
  }

  const industryGroups = cleanList(r.industryGroups, "industryGroups").map(
    (s) => s.toLowerCase(),
  );
  for (const g of industryGroups) {
    if (!KNOWN_INDUSTRIES.has(g))
      throw new InputError(`Unknown industry group "${g}".`);
  }

  const minOfferingAmount = optionalNumber(
    r.minOfferingAmount,
    "minOfferingAmount",
  );
  const maxOfferingAmount = optionalNumber(
    r.maxOfferingAmount,
    "maxOfferingAmount",
  );
  if (
    minOfferingAmount !== undefined &&
    maxOfferingAmount !== undefined &&
    maxOfferingAmount < minOfferingAmount
  )
    throw new InputError("maxOfferingAmount must be >= minOfferingAmount.");

  const filingType = (r.filingType ?? "both").toLowerCase() as FilingType;
  if (!FILING_TYPES.includes(filingType))
    throw new InputError(`filingType must be one of ${FILING_TYPES}.`);

  const maxResults = Math.floor(
    optionalNumber(r.maxResults, "maxResults") ?? DEFAULT_INPUT.maxResults,
  );
  if (maxResults < 1) throw new InputError("maxResults must be >= 1.");

  return {
    lastNDays,
    startDate,
    endDate,
    states,
    industryGroups,
    excludeInvestmentFunds: r.excludeInvestmentFunds === true,
    minOfferingAmount,
    maxOfferingAmount,
    filingType,
    maxResults: Math.min(maxResults, MAX_RESULTS_CAP),
    onlyNew: r.onlyNew === true,
  };
}

/** YYYY-MM-DD in UTC. */
export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

export const addDays = (iso: string, days: number): string =>
  isoDate(new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000));

/** Filing-date window, both ends inclusive (YYYY-MM-DD). */
export interface DateWindow {
  from: string;
  to: string;
}

/**
 * startDate/endDate when given; otherwise the last N calendar days including
 * today (UTC). EDGAR only accepts filings on business days.
 */
export function computeWindow(input: NormalizedInput, now: Date): DateWindow {
  const today = isoDate(now);
  const to = input.endDate && input.endDate < today ? input.endDate : today;
  const from = input.startDate ?? addDays(to, -(input.lastNDays - 1));
  if (from > to) throw new InputError("startDate is in the future.");
  if (Date.parse(to) - Date.parse(from) > MAX_DAYS * 86_400_000)
    throw new InputError(`Date range must be at most ${MAX_DAYS} days.`);
  return { from, to };
}

/** Delta-mode state key parameters: the search, minus dates and limits. */
export const stateParams = (input: NormalizedInput) => ({
  states: [...input.states].sort(),
  industryGroups: [...input.industryGroups].sort(),
  excludeInvestmentFunds: input.excludeInvestmentFunds,
  minOfferingAmount: input.minOfferingAmount,
  maxOfferingAmount: input.maxOfferingAmount,
  filingType: input.filingType,
});
