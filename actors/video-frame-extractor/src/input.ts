export const MODES = ["interval", "scene", "none"] as const;
export type Mode = (typeof MODES)[number];

export const FRAME_FORMATS = ["jpg", "png", "webp"] as const;
export type FrameFormat = (typeof FRAME_FORMATS)[number];

export const AUDIO_FORMATS = ["none", "m4a", "mp3", "opus"] as const;
export type AudioFormat = (typeof AUDIO_FORMATS)[number];

/** Raw actor input, as defined in .actor/input_schema.json. */
export interface RawInput {
  urls?: (string | { url?: string } | null)[] | string;
  startUrls?: (string | { url?: string } | null)[];
  keyValueStoreRecords?: string[] | string;
  mode?: string | null;
  intervalSeconds?: number | string | null;
  frameCount?: number | string | null;
  sceneThreshold?: number | string | null;
  minSceneSeconds?: number | string | null;
  maxFrames?: number | string | null;
  frameFormat?: string | null;
  frameQuality?: number | string | null;
  maxWidth?: number | string | null;
  contactSheet?: boolean | null;
  contactSheetColumns?: number | string | null;
  gifClip?: boolean | null;
  gifStartSeconds?: number | string | null;
  gifDurationSeconds?: number | string | null;
  gifWidth?: number | string | null;
  gifFps?: number | string | null;
  audioFormat?: string | null;
  maxDurationMinutes?: number | string | null;
  maxFileSizeMb?: number | string | null;
  timeoutSecs?: number | string | null;
}

/** One video to process. */
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

export interface GifOptions {
  startSecs: number;
  durationSecs: number;
  width: number;
  fps: number;
}

export interface NormalizedInput {
  sources: Source[];
  mode: Mode;
  /** Interval mode: seconds between frames (when frameCount is 0). */
  intervalSecs: number;
  /** Interval mode: this many evenly spaced frames; 0 to use intervalSecs. */
  frameCount: number;
  /** Scene mode: FFmpeg scene score threshold, 0-1. */
  sceneThreshold: number;
  minSceneSecs: number;
  maxFrames: number;
  frameFormat: FrameFormat;
  frameQuality: number;
  /** 0: original width. */
  maxWidth: number;
  /** Columns of the contact sheet; 0 for no sheet. */
  contactSheetColumns: number;
  gif: GifOptions | null;
  audioFormat: AudioFormat | null;
  maxDurationSecs: number;
  maxBytes: number;
  timeoutMs: number;
}

export const MAX_SOURCES = 1000;
/** Hard caps: the longest video and most frames per video. */
export const MAX_DURATION_MINUTES = 180;
export const MAX_FRAMES = 1000;
/** NASA, public domain: Apollo 11 launch, 84 s, 480x480 H.264 (15 MB). */
export const SAMPLE_URL =
  "https://images-assets.nasa.gov/video/KSC_69-71212-sRGB/KSC_69-71212-sRGB~small.mp4";

export const DEFAULT_INPUT = {
  mode: "interval",
  intervalSeconds: 10,
  frameCount: 0,
  sceneThreshold: 30,
  minSceneSeconds: 1,
  maxFrames: 50,
  frameFormat: "jpg",
  frameQuality: 85,
  maxWidth: 1280,
  contactSheetColumns: 4,
  gifStartSeconds: 0,
  gifDurationSeconds: 5,
  gifWidth: 480,
  gifFps: 10,
  audioFormat: "none",
  maxDurationMinutes: 60,
  maxFileSizeMb: 1000,
  timeoutSecs: 600,
} as const;

export class InputError extends Error {
  override name = "InputError";
}

const toNum = (v: unknown, name: string, def: number): number => {
  if (v === undefined || v === null || v === "") return def;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n)) throw new InputError(`${name} must be a number.`);
  return n;
};

const ranged = (
  v: unknown,
  name: string,
  def: number,
  min: number,
  max: number,
): number => {
  const n = Math.floor(toNum(v, name, def));
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
  return `${hit[1]} links are not supported. Use a direct link to a video file you have the rights to (e.g. ending in .mp4), or upload it to a key-value store.`;
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
  // Fall back to the sample clip only when nothing was given at all.
  if (!urls.length && !records.length) urls.push(SAMPLE_URL);
  const total = urls.length + records.length;
  if (total > MAX_SOURCES)
    throw new InputError(
      `At most ${MAX_SOURCES} videos per run; got ${total}.`,
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
            error: `Invalid URL "${input}". Use a full http(s) address like https://example.com/video.mp4.`,
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

  const mode = pick(r.mode, MODES, "mode", DEFAULT_INPUT.mode);
  const audio = pick(
    r.audioFormat,
    AUDIO_FORMATS,
    "audioFormat",
    DEFAULT_INPUT.audioFormat,
  );
  const contactSheetColumns = ranged(
    r.contactSheetColumns,
    "contactSheetColumns",
    DEFAULT_INPUT.contactSheetColumns,
    1,
    10,
  );

  return {
    sources,
    mode,
    intervalSecs: ranged(
      r.intervalSeconds,
      "intervalSeconds",
      DEFAULT_INPUT.intervalSeconds,
      1,
      3600,
    ),
    frameCount: ranged(
      r.frameCount,
      "frameCount",
      DEFAULT_INPUT.frameCount,
      0,
      MAX_FRAMES,
    ),
    sceneThreshold:
      ranged(
        r.sceneThreshold,
        "sceneThreshold",
        DEFAULT_INPUT.sceneThreshold,
        1,
        99,
      ) / 100,
    minSceneSecs: ranged(
      r.minSceneSeconds,
      "minSceneSeconds",
      DEFAULT_INPUT.minSceneSeconds,
      0,
      600,
    ),
    maxFrames: ranged(
      r.maxFrames,
      "maxFrames",
      DEFAULT_INPUT.maxFrames,
      1,
      MAX_FRAMES,
    ),
    frameFormat: pick(
      r.frameFormat,
      FRAME_FORMATS,
      "frameFormat",
      DEFAULT_INPUT.frameFormat,
    ),
    frameQuality: ranged(
      r.frameQuality,
      "frameQuality",
      DEFAULT_INPUT.frameQuality,
      1,
      100,
    ),
    maxWidth: ranged(r.maxWidth, "maxWidth", DEFAULT_INPUT.maxWidth, 0, 7680),
    contactSheetColumns:
      r.contactSheet === true && mode !== "none" ? contactSheetColumns : 0,
    gif:
      r.gifClip === true
        ? {
            startSecs: ranged(
              r.gifStartSeconds,
              "gifStartSeconds",
              DEFAULT_INPUT.gifStartSeconds,
              0,
              MAX_DURATION_MINUTES * 60,
            ),
            durationSecs: ranged(
              r.gifDurationSeconds,
              "gifDurationSeconds",
              DEFAULT_INPUT.gifDurationSeconds,
              1,
              15,
            ),
            width: ranged(
              r.gifWidth,
              "gifWidth",
              DEFAULT_INPUT.gifWidth,
              64,
              1080,
            ),
            fps: ranged(r.gifFps, "gifFps", DEFAULT_INPUT.gifFps, 1, 25),
          }
        : null,
    audioFormat: audio === "none" ? null : audio,
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
