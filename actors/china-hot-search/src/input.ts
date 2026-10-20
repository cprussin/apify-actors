import { PLATFORMS, type Platform } from "./boards.js";

/** Raw actor input, as defined in .actor/input_schema.json. */
export interface RawInput {
  platforms?: string[] | string | null;
  maxItemsPerPlatform?: number | string | null;
}

export interface NormalizedInput {
  platforms: Platform[];
  /** Rows per board; 0 = all (each board has 10–51). */
  maxItemsPerPlatform: number;
}

export const MAX_ITEMS = 100;

export class InputError extends Error {}

export function normalizeInput(
  raw: RawInput | null | undefined,
): NormalizedInput {
  const given = raw ?? {};
  const list = Array.isArray(given.platforms)
    ? given.platforms
    : typeof given.platforms === "string"
      ? given.platforms.split(/[\s,]+/)
      : [];
  const wanted = list
    .map((p) => String(p).trim().toLowerCase())
    .filter(Boolean);
  const unknown = wanted.filter((p) => !PLATFORMS.includes(p as Platform));
  if (unknown.length)
    throw new InputError(
      `Unknown platform(s): ${unknown.join(", ")}. Use ${PLATFORMS.join(", ")}.`,
    );
  // Keep the board order fixed; empty means all.
  const platforms = wanted.length
    ? PLATFORMS.filter((p) => wanted.includes(p))
    : [...PLATFORMS];

  let maxItemsPerPlatform = 0;
  const m = given.maxItemsPerPlatform;
  if (m !== undefined && m !== null && m !== "") {
    const n = Number(m);
    if (!Number.isFinite(n) || n < 0)
      throw new InputError(
        "maxItemsPerPlatform must be 0 or a positive number.",
      );
    maxItemsPerPlatform = Math.min(Math.floor(n), MAX_ITEMS);
  }
  return { platforms, maxItemsPerPlatform };
}
