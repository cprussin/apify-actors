export const OUTPUT_FORMATS = ["markdown", "text", "chunks"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

/** Tesseract language packs installed in the Docker image. */
export const OCR_LANGUAGES = [
  "eng",
  "deu",
  "fra",
  "spa",
  "ita",
  "por",
  "nld",
] as const;
export type OcrLanguage = (typeof OCR_LANGUAGES)[number];

/** Raw actor input, as defined in .actor/input_schema.json. */
export interface RawInput {
  urls?: (string | { url?: string } | null)[] | string;
  startUrls?: (string | { url?: string } | null)[];
  keyValueStoreRecords?: string[] | string;
  outputFormat?: string | null;
  chunkSize?: number | string | null;
  chunkOverlap?: number | string | null;
  ocr?: boolean;
  ocrLanguage?: string | null;
  maxOcrPagesPerDocument?: number | string | null;
  maxFileSizeMb?: number | string | null;
  maxPagesPerDocument?: number | string | null;
  timeoutSecs?: number | string | null;
  maxConcurrency?: number | string | null;
}

/** One document to convert. */
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
  outputFormat: OutputFormat;
  /** Max characters per chunk (chunks format). */
  chunkSize: number;
  /** Characters repeated from the previous chunk. */
  chunkOverlap: number;
  ocr: boolean;
  ocrLanguage: OcrLanguage;
  maxOcrPagesPerDocument: number;
  maxBytes: number;
  maxPagesPerDocument: number;
  timeoutMs: number;
  maxConcurrency: number;
}

export const MAX_SOURCES = 10_000;
export const SAMPLE_URL = "https://arxiv.org/pdf/1706.03762";

export const DEFAULT_INPUT = {
  outputFormat: "markdown",
  chunkSize: 2000,
  chunkOverlap: 200,
  ocrLanguage: "eng",
  maxOcrPagesPerDocument: 50,
  maxFileSizeMb: 50,
  maxPagesPerDocument: 1000,
  timeoutSecs: 60,
  maxConcurrency: 3,
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
  const s = String(v).trim().toLowerCase();
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
  // Fall back to the sample document only when nothing was given at all.
  if (!urls.length && !records.length) urls.push(SAMPLE_URL);
  if (urls.length + records.length > MAX_SOURCES)
    throw new InputError(
      `At most ${MAX_SOURCES} documents per run; got ${urls.length + records.length}.`,
    );

  const sources: Source[] = [];
  for (const input of urls) {
    const index = sources.length;
    const url = normalizeUrl(input);
    sources.push(
      url
        ? { index, kind: "url", input, url }
        : {
            index,
            kind: "invalid",
            input,
            error: `Invalid URL "${input}". Use a full http(s) address like https://example.com/file.pdf.`,
          },
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

  const chunkSize = ranged(
    r.chunkSize,
    "chunkSize",
    DEFAULT_INPUT.chunkSize,
    200,
    20_000,
  );
  const chunkOverlap = ranged(
    r.chunkOverlap,
    "chunkOverlap",
    DEFAULT_INPUT.chunkOverlap,
    0,
    10_000,
  );
  if (chunkOverlap * 2 > chunkSize)
    throw new InputError("chunkOverlap must be at most half of chunkSize.");

  return {
    sources,
    outputFormat: pick(
      r.outputFormat,
      OUTPUT_FORMATS,
      "outputFormat",
      DEFAULT_INPUT.outputFormat,
    ),
    chunkSize,
    chunkOverlap,
    ocr: r.ocr !== false,
    ocrLanguage: pick(
      r.ocrLanguage,
      OCR_LANGUAGES,
      "ocrLanguage",
      DEFAULT_INPUT.ocrLanguage,
    ),
    maxOcrPagesPerDocument: ranged(
      r.maxOcrPagesPerDocument,
      "maxOcrPagesPerDocument",
      DEFAULT_INPUT.maxOcrPagesPerDocument,
      0,
      2000,
    ),
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
    maxPagesPerDocument: ranged(
      r.maxPagesPerDocument,
      "maxPagesPerDocument",
      DEFAULT_INPUT.maxPagesPerDocument,
      1,
      5000,
    ),
    timeoutMs:
      ranged(r.timeoutSecs, "timeoutSecs", DEFAULT_INPUT.timeoutSecs, 5, 600) *
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
