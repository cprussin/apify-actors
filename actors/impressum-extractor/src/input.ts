import { parseDomain, type DomainTarget } from "./impressum.js";

/** Raw actor input, as defined in .actor/input_schema.json. */
export interface RawInput {
  domains?: (string | { url?: string } | null)[] | string;
  maxConcurrency?: number | string;
}

export interface NormalizedInput {
  /** Valid, deduplicated domains (by host without "www."). */
  targets: DomainTarget[];
  /** Input lines that are not domains or URLs (output as invalidInput rows). */
  invalid: string[];
  /** Domains processed in parallel. */
  maxConcurrency: number;
}

export const MAX_DOMAINS = 10_000;
export const MAX_CONCURRENCY = 20;

export const DEFAULT_INPUT = {
  domains: ["heise.de"],
  maxConcurrency: 5,
} satisfies RawInput;

export class InputError extends Error {}

const toInt = (v: unknown, name: string, def: number): number => {
  if (v === undefined || v === null || v === "") return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new InputError(`${name} must be a number.`);
  return Math.floor(n);
};

const list = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\n,]/) : [])
    .map((x) =>
      typeof x === "string"
        ? x
        : x && typeof x === "object" && typeof x.url === "string"
          ? x.url
          : "",
    )
    .map((x) => x.trim())
    .filter(Boolean);

export function normalizeInput(
  raw: RawInput | null | undefined,
): NormalizedInput {
  const given = raw ?? {};
  const lines = list(given.domains);
  const r: RawInput = lines.length
    ? { ...DEFAULT_INPUT, ...given }
    : { ...DEFAULT_INPUT, ...given, domains: DEFAULT_INPUT.domains };

  const targets: DomainTarget[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const line of list(r.domains)) {
    const t = parseDomain(line);
    if (!t) {
      invalid.push(line);
      continue;
    }
    // One row per site; a specific URL wins over a bare domain.
    const key = t.domain;
    if (seen.has(key)) {
      const i = targets.findIndex((x) => x.domain === key);
      if (t.url && i >= 0 && !targets[i]!.url) targets[i] = t;
      continue;
    }
    seen.add(key);
    targets.push(t);
  }

  if (!targets.length)
    throw new InputError(
      `Add at least one company domain or website URL, e.g. domains: ["example.de"]${invalid.length ? `; not domains: ${invalid.slice(0, 3).join(", ")}` : ""}.`,
    );
  if (targets.length > MAX_DOMAINS)
    throw new InputError(
      `At most ${MAX_DOMAINS} domains per run; got ${targets.length}.`,
    );

  const maxConcurrency = toInt(
    r.maxConcurrency,
    "maxConcurrency",
    DEFAULT_INPUT.maxConcurrency,
  );
  if (maxConcurrency < 1 || maxConcurrency > MAX_CONCURRENCY)
    throw new InputError(
      `maxConcurrency must be between 1 and ${MAX_CONCURRENCY}.`,
    );

  return { targets, invalid, maxConcurrency };
}
