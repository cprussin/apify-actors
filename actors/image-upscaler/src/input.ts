import {
  DATASET_FIELD,
  DATASET_ID,
  datasetRows,
  type DatasetOrigin,
  type DatasetRow,
} from "./dataset.js";

export const SCALES = [2, 3, 4] as const;
export type Scale = (typeof SCALES)[number];

export const OUTPUT_FORMATS = ["png", "jpg", "webp"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

/** Input-size limits offered in the input schema (megapixels). */
export const MAX_INPUT_MEGAPIXELS = ["0.25", "0.5", "1", "2"] as const;

/** Output-size targets offered in the input schema (megapixels). */
export const OUTPUT_MEGAPIXELS = ["1", "2", "3", "4", "6", "8"] as const;

/** Raw actor input, as defined in .actor/input_schema.json. */
export interface RawInput {
  urls?: (string | { url?: string } | null)[] | string;
  /** One image URL (for agents); added to urls. */
  imageUrl?: string | null;
  startUrls?: (string | { url?: string } | null)[];
  keyValueStoreRecords?: string[] | string;
  datasetId?: string | null;
  datasetField?: string | null;
  datasetItems?: unknown[] | null;
  maxDatasetItems?: number | string | null;
  scale?: number | string | null;
  outputMegapixels?: number | string | null;
  colorFix?: boolean | null;
  outputFormat?: string | null;
  quality?: number | string | null;
  maxInputMegapixels?: number | string | null;
  maxFileSizeMb?: number | string | null;
  timeoutSecs?: number | string | null;
}

/** One image to upscale. */
export type Source =
  | {
      index: number;
      kind: "url";
      input: string;
      url: string;
      /** Set for URLs read from a dataset row. */
      origin?: DatasetOrigin;
    }
  | {
      index: number;
      kind: "kv";
      input: string;
      store: string;
      key: string;
    }
  | {
      index: number;
      kind: "invalid";
      input: string;
      error: string;
      origin?: DatasetOrigin;
    };

export interface NormalizedInput {
  sources: Source[];
  /** Dataset to read more image URLs from (read in main.ts). */
  dataset: { id: string; field: string | null; maxItems: number } | null;
  scale: Scale;
  /** Output size target in pixels (overrides scale); null: use scale. */
  targetPixels: number | null;
  /** Match the output's colours to a bicubic resize of the input. */
  colorFix: boolean;
  outputFormat: OutputFormat;
  quality: number;
  maxInputPixels: number;
  maxBytes: number;
  timeoutMs: number;
}

export const MAX_SOURCES = 1000;
export const MAX_DATASET_ITEMS = 1000;
/** Hard caps: 2 MP in, so at most 32 MP out at 4x. */
export const HARD_MAX_INPUT_PIXELS = 2_000_000;
export const HARD_MAX_OUTPUT_PIXELS = 32_000_000;
/** NASA, public domain: Buzz Aldrin on the Moon (500x503 thumbnail). */
export const SAMPLE_URL =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/9/98/Aldrin_Apollo_11_original.jpg/500px-Aldrin_Apollo_11_original.jpg";

export const DEFAULT_INPUT = {
  maxDatasetItems: 100,
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

/** URL or invalid source for one input string. */
function urlSource(
  index: number,
  input: string,
  origin?: DatasetOrigin,
): { url: string | null; source: Source } {
  const url = normalizeUrl(input);
  const social = url && socialUrlError(url);
  const extra = origin ? { origin } : {};
  const source: Source = !url
    ? {
        index,
        kind: "invalid",
        input,
        error: `Invalid URL "${input}". Use a full http(s) address like https://example.com/photo.jpg.`,
        ...extra,
      }
    : social
      ? { index, kind: "invalid", input, error: social, ...extra }
      : { index, kind: "url", input, url, ...extra };
  return { url, source };
}

/**
 * Appends dataset rows to `sources`: URLs already listed are skipped and
 * rows without a URL become free errors. Returns how many rows were left
 * out over MAX_SOURCES.
 */
export function addDatasetSources(
  sources: Source[],
  rows: DatasetRow[],
): number {
  const seen = new Set(
    sources.flatMap((s) => (s.kind === "url" ? [s.url] : [])),
  );
  let dropped = 0;
  for (const row of rows) {
    if (sources.length >= MAX_SOURCES) {
      dropped += 1;
      continue;
    }
    const index = sources.length;
    if ("error" in row) {
      sources.push({
        index,
        kind: "invalid",
        input: row.origin.datasetId ?? "datasetItems",
        error: row.error,
        origin: row.origin,
      });
      continue;
    }
    const { url, source } = urlSource(index, row.url, row.origin);
    if (url && seen.has(url)) continue;
    if (url) seen.add(url);
    sources.push(source);
  }
  return dropped;
}

export function normalizeInput(
  raw: RawInput | null | undefined,
): NormalizedInput {
  const r = raw ?? {};
  const urls = [
    ...new Set([...list(r.urls), ...list(r.imageUrl), ...list(r.startUrls)]),
  ];
  const records = [...new Set(list(r.keyValueStoreRecords))];
  const datasetId =
    r.datasetId === undefined || r.datasetId === null
      ? ""
      : String(r.datasetId).trim();
  if (datasetId && !DATASET_ID.test(datasetId))
    throw new InputError(
      `datasetId "${datasetId}" is not a dataset ID or "username~dataset-name".`,
    );
  const field =
    r.datasetField === undefined || r.datasetField === null
      ? ""
      : String(r.datasetField).trim();
  if (field && !DATASET_FIELD.test(field))
    throw new InputError(
      `datasetField "${field}" must be a field name or dot path, like "imageUrl" or "product.image".`,
    );
  if (
    r.datasetItems !== undefined &&
    r.datasetItems !== null &&
    !Array.isArray(r.datasetItems)
  )
    throw new InputError("datasetItems must be an array of dataset rows.");
  const pasted = r.datasetItems ?? [];
  const maxDatasetItems = ranged(
    r.maxDatasetItems,
    "maxDatasetItems",
    DEFAULT_INPUT.maxDatasetItems,
    1,
    MAX_DATASET_ITEMS,
  );
  // Fall back to the sample image only when nothing was given at all.
  if (!urls.length && !records.length && !datasetId && !pasted.length)
    urls.push(SAMPLE_URL);
  const total = urls.length + records.length;
  if (total > MAX_SOURCES)
    throw new InputError(
      `At most ${MAX_SOURCES} images per run; got ${total}.`,
    );

  const sources: Source[] = [];
  const seen = new Set<string>();
  for (const input of urls) {
    const { url, source } = urlSource(sources.length, input);
    if (url && seen.has(url)) continue;
    if (url) seen.add(url);
    sources.push(source);
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

  addDatasetSources(
    sources,
    datasetRows(pasted.slice(0, maxDatasetItems), null, field || null),
  );

  const scale = ranged(r.scale, "scale", DEFAULT_INPUT.scale, 2, 4) as Scale;
  let targetPixels: number | null = null;
  if (
    r.outputMegapixels !== undefined &&
    r.outputMegapixels !== null &&
    String(r.outputMegapixels).trim() !== ""
  ) {
    const s = String(Number(String(r.outputMegapixels).trim()));
    if (!(OUTPUT_MEGAPIXELS as readonly string[]).includes(s))
      throw new InputError(
        `outputMegapixels must be one of ${OUTPUT_MEGAPIXELS.join(", ")}.`,
      );
    targetPixels = Number(s) * 1_000_000;
  }
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
    dataset: datasetId
      ? { id: datasetId, field: field || null, maxItems: maxDatasetItems }
      : null,
    scale,
    targetPixels,
    colorFix: r.colorFix === true,
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
