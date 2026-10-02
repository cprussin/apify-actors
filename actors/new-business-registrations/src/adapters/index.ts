import { colorado } from "./colorado.js";
import { connecticut } from "./connecticut.js";
import { newYork } from "./new-york.js";
import { oregon } from "./oregon.js";
import { pennsylvania } from "./pennsylvania.js";
import { texas } from "./texas.js";
import type { StateAdapter } from "./types.js";

/** Registry of supported states. Add a state: write an adapter, list it here. */
export const ADAPTERS = {
  CO: colorado,
  CT: connecticut,
  NY: newYork,
  OR: oregon,
  PA: pennsylvania,
  TX: texas,
} as const satisfies Record<string, StateAdapter>;

export type StateCode = keyof typeof ADAPTERS;
export const STATE_CODES = Object.keys(ADAPTERS) as StateCode[];
