export const SCALES = [2, 3, 4] as const;
export type Scale = (typeof SCALES)[number];

export const OUTPUT_FORMATS = ["png", "jpg", "webp"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

/** Input-size limits offered in the input schema (megapixels). */
export const MAX_INPUT_MEGAPIXELS = ["0.25", "0.5", "1", "2"] as const;

/** Raw actor input, as defined in .actor/input_schema.json. */
export interface RawInput {
  urls?: (string | { url?: string } | null)[] | string;
  startUrls?: (string | { url?: string } | null)[];
  keyValueStoreRecords?: string[] | string;
  scale?: number | string | null;
  outputFormat?: string | null;
  quality?: number | string | null;
  maxInputMegapixels?: number | string | null;
  maxFileSizeMb?: number | string | null;
  timeoutSecs?: number | string | null;
}

/** One image to upscale. */
export type Source =
  | { index: number; kind: "url"; input: string; url: string }
  | {
      index: number;
      kind: "kv";
      input: string;
      store: string;
      key: string;
    }
  | { index: number; kind: "invalid"; input: string; error: string };

export interface NormalizedInput {
  sources: Source[];
  scale: Scale;
  outputFormat: OutputFormat;
  quality: number;
  maxInputPixels: number;
  maxBytes: number;
  timeoutMs: number;
}

export const MAX_SOURCES = 1000;
/** Hard caps: 2 MP in, so at most 32 MP out at 4x. */
export const HARD_MAX_INPUT_PIXELS = 2_000_000;
export const HARD_MAX_OUTPUT_PIXELS = 32_000_000;
/** NASA, public domain: Buzz Aldrin on the Moon (500x503 thumbnail). */
export const SAMPLE_URL =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/9/98/Aldrin_Apollo_11_original.jpg/500px-Aldrin_Apollo_11_original.jpg";

export const DEFAULT_INPUT = {
  scale: 4,
  outputFormat: "png",
  quality: 90,
  maxInputMegapixels: "2",
  maxFileSizeMb: 25,
  timeoutSecs: 60,
} as const;

export class InputError extends Error {
  override name = "InputError";
}

const toInt = (v: unknown, name: string, def: number): number => {
  if (v === undefined || v === null || v === "") return def;
  const n = typeof v === "number" ? v : Number(String(v).trim());
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
  const n = toInt(v, name, def);
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
  if (s === "jpeg") s = "jpg";
  if (!(allowed as readonly string[]).includes(s))
    throw new InputError(
      `${name} "${String(v)}" is not supported. Use one of: ${allowed.join(", ")}.`,
    );
  return s as T;
}

const list = (v: unknown): string[] =>
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

const SOCIAL: [RegExp, string][] = [
  [/(^|\.)(instagram\.com|instagr\.am|cdninstagram\.com)$/, "Instagram"],
  [/(^|\.)(facebook\.com|fb\.com|fbcdn\.net)$/, "Facebook"],
  [/(^|\.)(tiktok\.com|tiktokcdn\.com|tiktokcdn-us\.com)$/, "TikTok"],
  [/(^|\.)(twitter\.com|x\.com|twimg\.com)$/, "X (Twitter)"],
  [/(^|\.)(pinterest\.[a-z.]+|pinimg\.com)$/, "Pinterest"],
  [/(^|\.)(linkedin\.com|licdn\.com)$/, "LinkedIn"],
];

/** Error for social-network links (images there belong to their posters), or null. */
export function socialUrlError(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const hit = SOCIAL.find(([re]) => re.test(host));
  if (!hit) return null;
  return `${hit[1]} links are not supported. Upscale images you have the rights to: a direct link to your own image file or a key-value store record.`;
}

/**
 * "storeId/key" or "username~store-name/key" -> parts. Keys can't contain
 * "/" on Apify.
 */
export function parseRecordRef(
  raw: string,
): { store: string; key: string } | null {
  const m =
    /^([A-Za-z0-9_.-]+(?:~[A-Za-z0-9_.-]+)?)\/([A-Za-z0-9!\-_.'()]+)$/.exec(
      raw.trim(),
    );
  return m ? { store: m[1]!, key: m[2]! } : null;
}

export function normalizeInput(
  raw: RawInput | null | undefined,
): NormalizedInput {
  const r = raw ?? {};
  const urls = [...new Set([...list(r.urls), ...list(r.startUrls)])];
  const records = [...new Set(list(r.keyValueStoreRecords))];
  // Fall back to the sample image only when nothing was given at all.
  if (!urls.length && !records.length) urls.push(SAMPLE_URL);
  const total = urls.length + records.length;
  if (total > MAX_SOURCES)
    throw new InputError(
      `At most ${MAX_SOURCES} images per run; got ${total}.`,
    );

  const sources: Source[] = [];
  const seen = new Set<string>();
  for (const input of urls) {
    const index = sources.length;
    const url = normalizeUrl(input);
    if (url && seen.has(url)) continue;
    if (url) seen.add(url);
    const social = url && socialUrlError(url);
    sources.push(
      !url
        ? {
            index,
            kind: "invalid",
            input,
            error: `Invalid URL "${input}". Use a full http(s) address like https://example.com/photo.jpg.`,
          }
        : social
          ? { index, kind: "invalid", input, error: social }
          : { index, kind: "url", input, url },
    );
  }
  for (const input of records) {
    const index = sources.length;
    const ref = parseRecordRef(input);
    sources.push(
      ref
        ? { index, kind: "kv", input, ...ref }
        : {
            index,
            kind: "invalid",
            input,
            error: `Invalid key-value store record "${input}". Use "storeId/recordKey" or "username~store-name/recordKey".`,
          },
    );
  }

  const scale = ranged(r.scale, "scale", DEFAULT_INPUT.scale, 2, 4) as Scale;
  const mp =
    r.maxInputMegapixels === undefined ||
    r.maxInputMegapixels === null ||
    r.maxInputMegapixels === ""
      ? Number(DEFAULT_INPUT.maxInputMegapixels)
      : Number(String(r.maxInputMegapixels).trim());
  if (!Number.isFinite(mp) || mp <= 0 || mp * 1e6 > HARD_MAX_INPUT_PIXELS)
    throw new InputError(
      `maxInputMegapixels must be more than 0 and at most ${HARD_MAX_INPUT_PIXELS / 1e6}.`,
    );

  return {
    sources,
    scale,
    outputFormat: pick(
      r.outputFormat,
      OUTPUT_FORMATS,
      "outputFormat",
      DEFAULT_INPUT.outputFormat,
    ),
    quality: ranged(r.quality, "quality", DEFAULT_INPUT.quality, 1, 100),
    maxInputPixels: Math.round(mp * 1e6),
    maxBytes:
      ranged(
        r.maxFileSizeMb,
        "maxFileSizeMb",
        DEFAULT_INPUT.maxFileSizeMb,
        1,
        100,
      ) *
      1024 *
      1024,
    timeoutMs:
      ranged(r.timeoutSecs, "timeoutSecs", DEFAULT_INPUT.timeoutSecs, 5, 600) *
      1000,
  };
}
