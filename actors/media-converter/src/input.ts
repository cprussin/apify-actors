export const OUTPUT_FORMATS = ["mp4", "webm", "mp3", "m4a", "wav"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export const AUDIO_FORMATS: readonly OutputFormat[] = ["mp3", "m4a", "wav"];
export const isAudioFormat = (f: OutputFormat) => AUDIO_FORMATS.includes(f);

/** Raw actor input, as defined in .actor/input_schema.json. */
export interface RawInput {
  urls?: (string | { url?: string } | null)[] | string;
  startUrls?: (string | { url?: string } | null)[];
  keyValueStoreRecords?: string[] | string;
  outputFormat?: string | null;
  crf?: number | string | null;
  targetMb?: number | string | null;
  maxHeight?: number | string | null;
  startSeconds?: number | string | null;
  durationSeconds?: number | string | null;
  mute?: boolean | null;
  maxDurationMinutes?: number | string | null;
  maxFileSizeMb?: number | string | null;
  timeoutSecs?: number | string | null;
}

/** One file to convert. */
export type Source =
  | { index: number; kind: "url"; input: string; url: string }
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
  outputFormat: OutputFormat;
  /** H.264-scale CRF (WebM's VP9 scale is derived from it). */
  crf: number;
  /** Target output size in bytes, or null for CRF (quality) mode. */
  targetBytes: number | null;
  /** Largest output resolution: the shorter side, in pixels (1080p = 1080). */
  maxHeight: number;
  startSecs: number;
  /** Seconds to keep from startSecs; null for the rest of the file. */
  durationSecs: number | null;
  mute: boolean;
  maxDurationSecs: number;
  maxBytes: number;
  timeoutMs: number;
}

export const MAX_SOURCES = 1000;
/** Hard cap on the output length. */
export const MAX_DURATION_MINUTES = 180;
/** The self-test clip, generated with FFmpeg when no source is given. */
export const SAMPLE = { width: 320, height: 240, seconds: 3 } as const;
export const SAMPLE_NAME = `sample-${SAMPLE.width}x${SAMPLE.height}-${SAMPLE.seconds}s.mp4`;

export const DEFAULT_INPUT = {
  outputFormat: "mp4",
  crf: 23,
  maxHeight: 1080,
  startSeconds: 0,
  maxDurationMinutes: 30,
  maxFileSizeMb: 1000,
  timeoutSecs: 600,
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
  let s = String(v).trim().toLowerCase().replace(/^\./, "");
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
  [
    /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com|googlevideo\.com)$/,
    "YouTube",
  ],
  [
    /(^|\.)(tiktok\.com|tiktokcdn\.com|tiktokcdn-us\.com|tiktokv\.com)$/,
    "TikTok",
  ],
  [/(^|\.)(instagram\.com|instagr\.am|cdninstagram\.com)$/, "Instagram"],
  [/(^|\.)(facebook\.com|fb\.com|fb\.watch|fbcdn\.net)$/, "Facebook"],
  [/(^|\.)(twitter\.com|x\.com|twimg\.com)$/, "X (Twitter)"],
  [/(^|\.)(vimeo\.com|vimeocdn\.com)$/, "Vimeo"],
  [/(^|\.)(twitch\.tv|ttvnw\.net)$/, "Twitch"],
  [/(^|\.)(dailymotion\.com|dai\.ly)$/, "Dailymotion"],
  [/(^|\.)(reddit\.com|redd\.it)$/, "Reddit"],
  [/(^|\.)(snapchat\.com)$/, "Snapchat"],
  [/(^|\.)(linkedin\.com|licdn\.com)$/, "LinkedIn"],
  [/(^|\.)(pinterest\.[a-z.]+|pinimg\.com)$/, "Pinterest"],
  [/(^|\.)(threads\.net|threads\.com)$/, "Threads"],
  [/(^|\.)(bilibili\.com|b23\.tv|bilivideo\.com)$/, "Bilibili"],
  [/(^|\.)(douyin\.com|kuaishou\.com|weibo\.com|vk\.com|ok\.ru)$/, "Social"],
  [/(^|\.)(rumble\.com|kick\.com|streamable\.com)$/, "Video platform"],
  [/(^|\.)(soundcloud\.com|sndcdn\.com)$/, "SoundCloud"],
  [/(^|\.)(spotify\.com|scdn\.co)$/, "Spotify"],
];

/** Error for social-network and video-platform links, or null. */
export function socialUrlError(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const hit = SOCIAL.find(([re]) => re.test(host));
  if (!hit) return null;
  return `${hit[1]} links are not supported. Use a direct link to a video or audio file you have the rights to (e.g. ending in .mp4 or .mp3), or upload it to a key-value store.`;
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

/** Turns URL and record strings into sources, deduped, in order. */
export function buildSources(urls: string[], records: string[]): Source[] {
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
            error: `Invalid URL "${input}". Use a full http(s) address like https://example.com/video.mp4.`,
          }
        : social
          ? { index, kind: "invalid", input, error: social }
          : { index, kind: "url", input, url },
    );
  }
  for (const input of [...new Set(records)]) {
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
  return sources;
}

export function normalizeInput(
  raw: RawInput | null | undefined,
): NormalizedInput {
  const r = raw ?? {};
  const urls = [...new Set([...list(r.urls), ...list(r.startUrls)])];
  const records = list(r.keyValueStoreRecords);
  const total = urls.length + records.length;
  if (total > MAX_SOURCES)
    throw new InputError(`At most ${MAX_SOURCES} files per run; got ${total}.`);

  const sources = buildSources(urls, records);
  // With no source at all, convert a generated test clip (the Store's
  // example run and the daily health check need no network).
  if (!sources.length)
    sources.push({ index: 0, kind: "sample", input: SAMPLE_NAME });

  const targetMb = optional(r.targetMb, "targetMb", 1, 4000);
  const duration = optional(
    r.durationSeconds,
    "durationSeconds",
    1,
    MAX_DURATION_MINUTES * 60,
  );
  return {
    sources,
    outputFormat: pick(
      r.outputFormat,
      OUTPUT_FORMATS,
      "outputFormat",
      DEFAULT_INPUT.outputFormat,
      { mov: "mp4", h264: "mp4", aac: "m4a", vp9: "webm" },
    ),
    crf: ranged(r.crf, "crf", DEFAULT_INPUT.crf, 10, 45),
    targetBytes: targetMb === null ? null : targetMb * 1024 * 1024,
    maxHeight: ranged(
      r.maxHeight,
      "maxHeight",
      DEFAULT_INPUT.maxHeight,
      144,
      1080,
    ),
    startSecs: ranged(
      r.startSeconds,
      "startSeconds",
      DEFAULT_INPUT.startSeconds,
      0,
      24 * 3600,
    ),
    durationSecs: duration,
    mute: r.mute === true,
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
        4000,
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
