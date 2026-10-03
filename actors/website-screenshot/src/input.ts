import { DEVICES, deviceProfile, type DeviceProfile } from "./devices.js";

export const FORMATS = ["png", "jpeg", "webp", "pdf"] as const;
export type Format = (typeof FORMATS)[number];

export const WAIT_UNTIL = ["load", "domcontentloaded", "networkidle"] as const;
export type WaitUntil = (typeof WAIT_UNTIL)[number] | "commit";

/** Raw actor input, as defined in .actor/input_schema.json. */
export interface RawInput {
  urls?: (string | { url?: string } | null)[] | string;
  startUrls?: (string | { url?: string } | null)[];
  format?: string | null;
  fullPage?: boolean;
  device?: string | null;
  width?: number | string | null;
  height?: number | string | null;
  quality?: number | string | null;
  waitUntil?: string | null;
  delayMs?: number | string | null;
  waitForSelector?: string | null;
  selector?: string | null;
  hideCookieBanners?: boolean;
  scrollToBottom?: boolean;
  timeoutSecs?: number | string | null;
  maxConcurrency?: number | string | null;
  proxyConfiguration?: Record<string, unknown>;
}

export interface Target {
  /** 0-based position in the input (used for stable record keys). */
  index: number;
  /** URL as given by the user. */
  input: string;
  /** Normalized absolute http(s) URL, or null if invalid. */
  url: string | null;
  error?: string;
}

export interface NormalizedInput {
  targets: Target[];
  format: Format;
  fullPage: boolean;
  device: (typeof DEVICES)[number];
  profile: DeviceProfile;
  /** JPEG/WebP quality, 1-100. */
  quality: number;
  waitUntil: WaitUntil;
  delayMs: number;
  waitForSelector: string | null;
  selector: string | null;
  hideCookieBanners: boolean;
  scrollToBottom: boolean;
  timeoutMs: number;
  maxConcurrency: number;
}

export const MAX_URLS = 10_000;
export const MAX_DELAY_MS = 30_000;

export const DEFAULT_INPUT = {
  urls: ["https://apify.com"],
  format: "png",
  fullPage: false,
  device: "desktop",
  quality: 80,
  waitUntil: "load",
  delayMs: 0,
  hideCookieBanners: true,
  scrollToBottom: false,
  timeoutSecs: 30,
  maxConcurrency: 3,
} satisfies RawInput;

export class InputError extends Error {}

const toInt = (v: unknown, name: string, def: number | null) => {
  if (v === undefined || v === null || v === "") return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new InputError(`${name} must be a number.`);
  return Math.floor(n);
};

const ranged = (
  v: unknown,
  name: string,
  def: number,
  min: number,
  max: number,
): number => {
  const n = toInt(v, name, def)!;
  if (n < min || n > max)
    throw new InputError(`${name} must be between ${min} and ${max}.`);
  return n;
};

function pick<T extends string>(
  v: unknown,
  allowed: readonly T[],
  name: string,
  def: T,
): T {
  if (v === undefined || v === null || v === "") return def;
  let s = String(v).trim().toLowerCase();
  if (name === "format" && s === "jpg") s = "jpeg";
  if (!(allowed as readonly string[]).includes(s))
    throw new InputError(
      `${name} "${String(v)}" is not supported. Use one of: ${allowed.join(", ")}.`,
    );
  return s as T;
}

const urlList = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(/\s+/) : [])
    .map((x) =>
      typeof x === "string"
        ? x.trim()
        : x && typeof x === "object" && typeof x.url === "string"
          ? x.url.trim()
          : "",
    )
    .filter(Boolean);

/** Absolute http(s) URL; adds https:// when the scheme is missing. */
export function normalizeUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!u.hostname.includes(".") && u.hostname !== "localhost") return null;
  return u.href;
}

const text = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

export function normalizeInput(
  raw: RawInput | null | undefined,
): NormalizedInput {
  const given = raw ?? {};
  const listed = [...urlList(given.urls), ...urlList(given.startUrls)];
  // Fall back to the default URL only when no URL was given at all.
  const r: RawInput = { ...DEFAULT_INPUT, ...given };
  const all = listed.length ? listed : DEFAULT_INPUT.urls;
  const unique = [...new Set(all)];
  if (unique.length > MAX_URLS)
    throw new InputError(
      `At most ${MAX_URLS} URLs per run; got ${unique.length}.`,
    );

  const targets: Target[] = unique.map((input, index) => {
    const url = normalizeUrl(input);
    return url
      ? { index, input, url }
      : {
          index,
          input,
          url: null,
          error: `Invalid URL "${input}". Use a full http(s) address like https://example.com.`,
        };
  });

  const device = pick(r.device, DEVICES, "device", "desktop");
  const width = toInt(r.width, "width", null);
  const height = toInt(r.height, "height", null);
  if (width !== null && (width < 200 || width > 3840))
    throw new InputError("width must be between 200 and 3840.");
  if (height !== null && (height < 200 || height > 4320))
    throw new InputError("height must be between 200 and 4320.");

  return {
    targets,
    format: pick(r.format, FORMATS, "format", "png"),
    fullPage: r.fullPage === true,
    device,
    profile: deviceProfile(device, width, height),
    quality: ranged(r.quality, "quality", DEFAULT_INPUT.quality, 1, 100),
    waitUntil: pick(r.waitUntil, WAIT_UNTIL, "waitUntil", "load"),
    delayMs: ranged(r.delayMs, "delayMs", 0, 0, MAX_DELAY_MS),
    waitForSelector: text(r.waitForSelector),
    selector: text(r.selector),
    hideCookieBanners: r.hideCookieBanners !== false,
    scrollToBottom: r.scrollToBottom === true,
    timeoutMs:
      ranged(r.timeoutSecs, "timeoutSecs", DEFAULT_INPUT.timeoutSecs, 5, 180) *
      1000,
    maxConcurrency: ranged(
      r.maxConcurrency,
      "maxConcurrency",
      DEFAULT_INPUT.maxConcurrency,
      1,
      10,
    ),
  };
}

/** The next, lighter waitUntil to retry with after a timeout. */
export function lighterWaitUntil(w: WaitUntil): WaitUntil | null {
  switch (w) {
    case "networkidle":
      return "load";
    case "load":
      return "domcontentloaded";
    case "domcontentloaded":
      return "commit";
    default:
      return null;
  }
}
