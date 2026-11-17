export const OUTPUT_FORMATS = ["webp", "avif", "jpeg", "png"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export const FITS = ["inside", "cover", "contain", "fill", "outside"] as const;
export type Fit = (typeof FITS)[number];

/** Raw actor input, as defined in .actor/input_schema.json. */
export interface RawInput {
  urls?: (string | { url?: string } | null)[] | string;
  startUrls?: (string | { url?: string } | null)[];
  keyValueStoreRecords?: string[] | string;
  datasetId?: string | null;
  imageField?: string | null;
  outputFormat?: string | null;
  quality?: number | string | null;
  targetKb?: number | string | null;
  maxWidth?: number | string | null;
  maxHeight?: number | string | null;
  fit?: string | null;
  stripMetadata?: boolean | null;
  maxFileSizeMb?: number | string | null;
  maxInputMegapixels?: number | string | null;
  timeoutSecs?: number | string | null;
}

/** One image to convert. */
export type Source =
  | {
      index: number;
      kind: "url";
      input: string;
      url: string;
      /** Read from the input dataset's imageField. */
      fromDataset?: boolean;
    }
  | {
      index: number;
      kind: "kv";
      input: string;
      store: string;
      key: string;
    }
  | { index: number; kind: "sample"; input: string }
  | { index: number; kind: "invalid"; input: string; error: string };

export interface NormalizedInput {
  sources: Source[];
  /** Dataset to read more image URLs from (resolved in main.ts). */
  dataset: { id: string; field: string } | null;
  outputFormat: OutputFormat;
  quality: number;
  /** Target output size in bytes, or null for fixed quality. */
  targetBytes: number | null;
  maxWidth: number | null;
  maxHeight: number | null;
  fit: Fit;
  stripMetadata: boolean;
  maxInputPixels: number;
  maxBytes: number;
  timeoutMs: number;
}

export const MAX_SOURCES = 1000;
export const HARD_MAX_INPUT_MEGAPIXELS = 100;
/** Pixel count above which an image is billed as image-converted-large. */
export const LARGE_PIXELS = 12_000_000;
/** The self-test image, generated in memory when no source is given. */
export const SAMPLE = { width: 640, height: 480 } as const;
export const SAMPLE_NAME = `sample-${SAMPLE.width}x${SAMPLE.height}.png`;

export const DEFAULT_INPUT = {
  imageField: "url",
  outputFormat: "webp",
  quality: 80,
  fit: "inside",
  stripMetadata: true,
  maxInputMegapixels: 50,
  maxFileSizeMb: 50,
  timeoutSecs: 60,
} as const;

export class InputError extends Error {
  override name = "InputError";
}

const blank = (v: unknown) => v === undefined || v === null || v === "";

const toInt = (v: unknown, name: string, def: number): number => {
  if (blank(v)) return def;
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

/** An optional ranged integer; blank or 0 means "not set". */
const optional = (
  v: unknown,
  name: string,
  min: number,
  max: number,
): number | null => {
  if (blank(v) || Number(v) === 0) return null;
  return ranged(v, name, min, min, max);
};

function pick<T extends string>(
  v: unknown,
  allowed: readonly T[],
  name: string,
  def: T,
  alias: Record<string, T> = {},
): T {
  if (blank(v)) return def;
  let s = String(v).trim().toLowerCase();
  s = alias[s] ?? s;
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
  if (!u.hostname.includes(".") && !u.hostname.includes(":")) return null;
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
  return `${hit[1]} links are not supported. Convert images you have the rights to: a direct link to your own image file or a key-value store record.`;
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

/** Dataset ID or "username~dataset-name". */
const DATASET_ID = /^[A-Za-z0-9_.-]+(?:~[A-Za-z0-9_.-]+)?$/;

/**
 * Image URLs in one dataset item's `field` (a dot path such as
 * "images" or "product.image"): a string, an array of strings, or objects
 * with a url/src field.
 */
export function imageUrlsFromItem(item: unknown, field: string): string[] {
  let v: unknown = item;
  for (const part of field.split(".")) {
    if (v === null || typeof v !== "object") return [];
    v = (v as Record<string, unknown>)[part];
  }
  const one = (x: unknown): string | null => {
    if (typeof x === "string") return x.trim() || null;
    if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      for (const k of ["url", "src", "href"])
        if (typeof o[k] === "string") return (o[k] as string).trim() || null;
    }
    return null;
  };
  return (Array.isArray(v) ? v : [v]).map(one).filter((x): x is string => !!x);
}

/** Turns URL and record strings into sources, deduped, in order. */
export function buildSources(
  urls: string[],
  records: string[],
  start = 0,
  fromDataset = false,
): Source[] {
  const sources: Source[] = [];
  const seen = new Set<string>();
  for (const input of urls) {
    const index = start + sources.length;
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
          : fromDataset
            ? { index, kind: "url", input, url, fromDataset }
            : { index, kind: "url", input, url },
    );
  }
  for (const input of [...new Set(records)]) {
    const index = start + sources.length;
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
  return sources;
}

export function normalizeInput(
  raw: RawInput | null | undefined,
): NormalizedInput {
  const r = raw ?? {};
  const urls = [...new Set([...list(r.urls), ...list(r.startUrls)])];
  const records = list(r.keyValueStoreRecords);
  const datasetId = blank(r.datasetId) ? "" : String(r.datasetId).trim();
  if (datasetId && !DATASET_ID.test(datasetId))
    throw new InputError(
      `datasetId "${datasetId}" is not a dataset ID or "username~dataset-name".`,
    );
  const field = blank(r.imageField)
    ? DEFAULT_INPUT.imageField
    : String(r.imageField).trim();
  if (!/^[A-Za-z0-9_$-]+(\.[A-Za-z0-9_$-]+)*$/.test(field))
    throw new InputError(
      `imageField "${field}" must be a field name or dot path, like "imageUrl" or "product.images".`,
    );
  const total = urls.length + records.length;
  if (total > MAX_SOURCES)
    throw new InputError(
      `At most ${MAX_SOURCES} images per run; got ${total}.`,
    );

  const sources = buildSources(urls, records);
  // With no source at all, convert a generated test image (the Store's
  // example run and the daily health check need no network).
  if (!sources.length && !datasetId)
    sources.push({ index: 0, kind: "sample", input: SAMPLE_NAME });

  const outputFormat = pick(
    r.outputFormat,
    OUTPUT_FORMATS,
    "outputFormat",
    DEFAULT_INPUT.outputFormat,
    { jpg: "jpeg" },
  );
  const targetKb = optional(r.targetKb, "targetKb", 1, 100_000);
  const mp = ranged(
    r.maxInputMegapixels,
    "maxInputMegapixels",
    DEFAULT_INPUT.maxInputMegapixels,
    1,
    HARD_MAX_INPUT_MEGAPIXELS,
  );

  return {
    sources,
    dataset: datasetId ? { id: datasetId, field } : null,
    outputFormat,
    quality: ranged(r.quality, "quality", DEFAULT_INPUT.quality, 1, 100),
    targetBytes: targetKb === null ? null : targetKb * 1024,
    maxWidth: optional(r.maxWidth, "maxWidth", 1, 16383),
    maxHeight: optional(r.maxHeight, "maxHeight", 1, 16383),
    fit: pick(r.fit, FITS, "fit", DEFAULT_INPUT.fit),
    stripMetadata:
      typeof r.stripMetadata === "boolean"
        ? r.stripMetadata
        : DEFAULT_INPUT.stripMetadata,
    maxInputPixels: mp * 1_000_000,
    maxBytes:
      ranged(
        r.maxFileSizeMb,
        "maxFileSizeMb",
        DEFAULT_INPUT.maxFileSizeMb,
        1,
        200,
      ) *
      1024 *
      1024,
    timeoutMs:
      ranged(r.timeoutSecs, "timeoutSecs", DEFAULT_INPUT.timeoutSecs, 5, 600) *
      1000,
  };
}
