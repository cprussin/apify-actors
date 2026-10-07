export const MODELS = ["base", "small"] as const;
export type Model = (typeof MODELS)[number];

export const OUTPUT_FORMATS = ["transcript", "chunks"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

/** Whisper's language codes (faster_whisper.tokenizer._LANGUAGE_CODES). */
// prettier-ignore
export const LANGUAGES = [
  "af", "am", "ar", "as", "az", "ba", "be", "bg", "bn", "bo", "br", "bs",
  "ca", "cs", "cy", "da", "de", "el", "en", "es", "et", "eu", "fa", "fi",
  "fo", "fr", "gl", "gu", "ha", "haw", "he", "hi", "hr", "ht", "hu", "hy",
  "id", "is", "it", "ja", "jw", "ka", "kk", "km", "kn", "ko", "la", "lb",
  "ln", "lo", "lt", "lv", "mg", "mi", "mk", "ml", "mn", "mr", "ms", "mt",
  "my", "ne", "nl", "nn", "no", "oc", "pa", "pl", "ps", "pt", "ro", "ru",
  "sa", "sd", "si", "sk", "sl", "sn", "so", "sq", "sr", "su", "sv", "sw",
  "ta", "te", "tg", "th", "tk", "tl", "tr", "tt", "uk", "ur", "uz", "vi",
  "yi", "yo", "zh", "yue",
] as const;

/** Raw actor input, as defined in .actor/input_schema.json. */
export interface RawInput {
  urls?: (string | { url?: string } | null)[] | string;
  startUrls?: (string | { url?: string } | null)[];
  keyValueStoreRecords?: string[] | string;
  rssFeeds?: (string | { url?: string } | null)[] | string;
  maxEpisodes?: number | string | null;
  onlyNewEpisodes?: boolean;
  model?: string | null;
  language?: string | null;
  outputFormat?: string | null;
  chunkSize?: number | string | null;
  chunkOverlap?: number | string | null;
  maxDurationMinutes?: number | string | null;
  maxFileSizeMb?: number | string | null;
  timeoutSecs?: number | string | null;
}

/** One media file to transcribe, or a podcast feed to expand. */
export type Source =
  | { index: number; kind: "url"; input: string; url: string }
  | {
      index: number;
      kind: "kv";
      input: string;
      store: string;
      key: string;
    }
  | { index: number; kind: "feed"; input: string; url: string }
  | { index: number; kind: "invalid"; input: string; error: string };

export interface NormalizedInput {
  sources: Source[];
  maxEpisodes: number;
  onlyNewEpisodes: boolean;
  model: Model;
  /** null: detect. */
  language: string | null;
  outputFormat: OutputFormat;
  chunkSize: number;
  chunkOverlap: number;
  maxDurationSecs: number;
  maxBytes: number;
  timeoutMs: number;
}

export const MAX_SOURCES = 1000;
/** NASA, public domain: 20 s of "We choose to go to the Moon". */
export const SAMPLE_URL =
  "https://www.nasa.gov/wp-content/uploads/2015/01/590325main_ringtone_kennedy_WeChoose.mp3";
/** Hard cap: decoded audio is kept in memory (1.9 MB per minute). */
export const MAX_DURATION_MINUTES = 300;

export const DEFAULT_INPUT = {
  maxEpisodes: 5,
  model: "base",
  language: "auto",
  outputFormat: "transcript",
  chunkSize: 1500,
  chunkOverlap: 150,
  maxDurationMinutes: 180,
  maxFileSizeMb: 1000,
  timeoutSecs: 600,
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

const SOCIAL: [RegExp, string][] = [
  [/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/, "YouTube"],
  [/(^|\.)tiktok\.com$/, "TikTok"],
  [/(^|\.)(instagram\.com|instagr\.am)$/, "Instagram"],
];

/** Error for YouTube/TikTok/Instagram page links (not supported), or null. */
export function socialUrlError(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const hit = SOCIAL.find(([re]) => re.test(host));
  if (!hit) return null;
  return (
    `${hit[1]} links are not supported. Use a direct link to an audio or video file, a key-value store record or a podcast RSS feed.` +
    (hit[1] === "YouTube"
      ? " For YouTube captions, use the youtube-transcripts actor."
      : "")
  );
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
  const feeds = [...new Set(list(r.rssFeeds))];
  // Fall back to the sample clip only when nothing was given at all.
  if (!urls.length && !records.length && !feeds.length) urls.push(SAMPLE_URL);
  const total = urls.length + records.length + feeds.length;
  if (total > MAX_SOURCES)
    throw new InputError(
      `At most ${MAX_SOURCES} files and feeds per run; got ${total}.`,
    );

  const sources: Source[] = [];
  const addUrl = (input: string, kind: "url" | "feed") => {
    const index = sources.length;
    const url = normalizeUrl(input);
    const social = url && socialUrlError(url);
    sources.push(
      !url
        ? {
            index,
            kind: "invalid",
            input,
            error: `Invalid URL "${input}". Use a full http(s) address like https://example.com/${kind === "feed" ? "feed.xml" : "episode.mp3"}.`,
          }
        : social
          ? { index, kind: "invalid", input, error: social }
          : { index, kind, input, url },
    );
  };
  for (const input of urls) addUrl(input, "url");
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
  for (const input of feeds) addUrl(input, "feed");

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

  const language =
    r.language === undefined ||
    r.language === null ||
    String(r.language).trim().toLowerCase() === "auto"
      ? DEFAULT_INPUT.language
      : pick(r.language, LANGUAGES, "language", "en");

  return {
    sources,
    maxEpisodes: ranged(
      r.maxEpisodes,
      "maxEpisodes",
      DEFAULT_INPUT.maxEpisodes,
      1,
      500,
    ),
    onlyNewEpisodes: r.onlyNewEpisodes === true,
    model: pick(r.model, MODELS, "model", DEFAULT_INPUT.model),
    language: language === "auto" ? null : language,
    outputFormat: pick(
      r.outputFormat,
      OUTPUT_FORMATS,
      "outputFormat",
      DEFAULT_INPUT.outputFormat,
    ),
    chunkSize,
    chunkOverlap,
    maxDurationSecs:
      ranged(
        r.maxDurationMinutes,
        "maxDurationMinutes",
        DEFAULT_INPUT.maxDurationMinutes,
        1,
        MAX_DURATION_MINUTES,
      ) * 60,
    maxBytes:
      ranged(
        r.maxFileSizeMb,
        "maxFileSizeMb",
        DEFAULT_INPUT.maxFileSizeMb,
        1,
        2000,
      ) *
      1024 *
      1024,
    timeoutMs:
      ranged(
        r.timeoutSecs,
        "timeoutSecs",
        DEFAULT_INPUT.timeoutSecs,
        10,
        3600,
      ) * 1000,
  };
}
