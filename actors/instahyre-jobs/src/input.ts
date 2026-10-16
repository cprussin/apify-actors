import type { CompanySize, JobType } from "./instahyre.js";

/** Raw actor input, as defined in .actor/input_schema.json. */
export interface RawInput {
  skills?: (string | null)[] | string;
  locations?: (string | null)[] | string;
  years?: number | string | null;
  jobFunctions?: (string | null)[] | string;
  companySize?: string | null;
  jobType?: string | null;
  maxItems?: number | string;
  monitorMode?: boolean;
  proxyConfiguration?: Record<string, unknown>;
}

export interface NormalizedInput {
  skills: string[];
  locations: string[];
  /** Years of experience; null = any. */
  years: number | null;
  /** Job function names, slugs or IDs (resolved to IDs at run time). */
  jobFunctions: string[];
  companySize: CompanySize | null;
  jobType: JobType | null;
  /** Total items to output. */
  maxItems: number;
  /** Flag jobs as new/updated/removed since the previous run; skip unchanged. */
  monitorMode: boolean;
}

export const MAX_ITEMS = 10_000;
const MAX_LIST = 50;
const MAX_LENGTH = 100;

export const DEFAULT_INPUT = {
  skills: ["Python"],
  maxItems: 20,
} satisfies RawInput;

export class InputError extends Error {}

const list = (v: unknown, name: string): string[] => {
  const raw = (
    Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\n,]/) : []
  )
    .map((x) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim() : ""))
    .filter(Boolean);
  const seen = new Set<string>();
  const out = raw.filter((x) => {
    const k = x.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  for (const x of out)
    if (x.length > MAX_LENGTH)
      throw new InputError(`${name}: "${x.slice(0, 40)}..." is too long.`);
  if (out.length > MAX_LIST)
    throw new InputError(`${name}: at most ${MAX_LIST} entries.`);
  return out;
};

const blank = (v: unknown) =>
  v === undefined || v === null || (typeof v === "string" && !v.trim());

function choice<T extends string>(
  v: unknown,
  name: string,
  options: Record<string, T | null>,
): T | null {
  if (blank(v)) return null;
  const k = String(v)
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  if (!(k in options))
    throw new InputError(
      `${name} must be one of: ${Object.keys(options).join(", ")}.`,
    );
  return options[k]!;
}

export function normalizeInput(
  raw: RawInput | null | undefined,
): NormalizedInput {
  const given = raw ?? {};
  const r: RawInput = { ...DEFAULT_INPUT, ...given };
  const skills = list(r.skills, "skills");
  const locations = list(r.locations, "locations");
  const jobFunctions = list(r.jobFunctions, "jobFunctions");

  let years: number | null = null;
  if (!blank(r.years)) {
    const n = Number(r.years);
    if (!Number.isInteger(n) || n < 0 || n > 40)
      throw new InputError("years must be a whole number from 0 to 40.");
    years = n;
  }

  const maxItems = blank(r.maxItems)
    ? DEFAULT_INPUT.maxItems
    : Math.floor(Number(r.maxItems));
  if (!Number.isFinite(maxItems) || maxItems < 1 || maxItems > MAX_ITEMS)
    throw new InputError(`maxItems must be between 1 and ${MAX_ITEMS}.`);

  return {
    skills,
    locations,
    years,
    jobFunctions,
    companySize: choice<CompanySize>(r.companySize, "companySize", {
      any: null,
      small: "small",
      medium: "medium",
      large: "large",
    }),
    jobType: choice<JobType>(r.jobType, "jobType", {
      any: null,
      "full-time": "full-time",
      fulltime: "full-time",
      internship: "internship",
    }),
    maxItems,
    monitorMode: r.monitorMode === true,
  };
}
