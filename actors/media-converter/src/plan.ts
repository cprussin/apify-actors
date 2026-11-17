/** Pure planning: output size, pricing tier, billed minutes and bitrates. */
import type { OutputFormat } from "./input.js";

export const EVENTS = {
  audio: "audio-minute",
  p480: "video-480p-minute",
  p720: "video-720p-minute",
  p1080: "video-1080p-minute",
} as const;
export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

const even = (n: number) => Math.max(2, 2 * Math.round(n / 2));

/** The long side allowed for a resolution: 16:9 (480p -> 854, 720p -> 1280). */
export const longSide = (p: number) => even(Math.ceil((p * 16) / 9));

/**
 * Output size of a `width`x`height` (display size) video fitted to a
 * `p` resolution: the shorter side at most `p`, the longer side at most
 * 16:9 of it, aspect ratio kept, never upscaled. Sizes are even (H.264 and
 * VP9 use 4:2:0 chroma).
 */
export function fitResolution(
  width: number,
  height: number,
  p: number,
): { width: number; height: number; scaled: boolean } {
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  const scale = Math.min(1, p / short, longSide(p) / long);
  if (scale >= 1 && width % 2 === 0 && height % 2 === 0)
    return { width, height, scaled: false };
  return {
    width: even(width * scale),
    height: even(height * scale),
    scaled: true,
  };
}

const FULL_HD = 1920 * 1080;

/** Inputs over 1080p (10% slack) cost much more to decode. */
export const above1080p = (width: number, height: number) =>
  width * height > FULL_HD * 1.1;

/**
 * The one event a file is billed with: audio-minute for audio outputs;
 * for video, the tier of the output resolution (480p, 720p or 1080p).
 * Inputs above 1080p are billed as 1080p whatever the output size, because
 * decoding them costs as much as encoding 1080p.
 */
export function eventFor(
  format: OutputFormat,
  out: { width: number; height: number } | null,
  input: { width: number; height: number } | null,
): EventName {
  if (format === "mp3" || format === "m4a" || format === "wav" || !out)
    return EVENTS.audio;
  if (input && above1080p(input.width, input.height)) return EVENTS.p1080;
  const fits = (p: number) =>
    Math.min(out.width, out.height) <= p &&
    Math.max(out.width, out.height) <= longSide(p);
  if (fits(480)) return EVENTS.p480;
  if (fits(720)) return EVENTS.p720;
  return EVENTS.p1080;
}

/**
 * Started minutes of output, with a 1-second grace: 60.5 s is 1 minute,
 * 61.5 s is 2. At least 1.
 */
export const billedMinutes = (seconds: number) =>
  Math.max(1, Math.ceil((seconds - 1) / 60 - 1e-9));

/** VP9's CRF scale (0-63) for an H.264-scale CRF (23 -> 33). */
export const vp9Crf = (crf: number) => Math.min(63, crf + 10);

export interface Bitrates {
  /** Video bitrate in kbit/s; null for audio outputs. */
  videoKbps: number | null;
  /** Audio bitrate in kbit/s; null when there is no audio. */
  audioKbps: number | null;
  warning: string | null;
}

/** Below this, H.264/VP9 video is a blur at any resolution. */
export const MIN_VIDEO_KBPS = 50;
/** Container overhead kept free of the target size. */
const OVERHEAD = 0.97;

/**
 * Bitrates for a target file size: the audio gets ~10% (48-128 kbit/s) and
 * the video the rest. For MP3/M4A all of it goes to the audio (32-320).
 */
export function targetBitrates(
  targetBytes: number,
  seconds: number,
  video: boolean,
  audio: boolean,
): Bitrates {
  const totalKbps =
    (targetBytes * 8 * OVERHEAD) / Math.max(seconds, 0.1) / 1000;
  const mb = Math.round((targetBytes / 1024 / 1024) * 10) / 10;
  if (!video) {
    const kbps = Math.round(Math.min(320, Math.max(32, totalKbps)));
    return {
      videoKbps: null,
      audioKbps: kbps,
      warning:
        totalKbps < 32
          ? `A ${mb} MB target is too small for this length; used the minimum 32 kbit/s audio, so the file is larger.`
          : null,
    };
  }
  const audioKbps = audio
    ? Math.round(Math.min(128, Math.max(48, totalKbps * 0.1)))
    : null;
  const left = totalKbps - (audioKbps ?? 0);
  const videoKbps = Math.round(Math.max(MIN_VIDEO_KBPS, left));
  return {
    videoKbps,
    audioKbps,
    warning:
      left < MIN_VIDEO_KBPS
        ? `A ${mb} MB target is too small for this length; used the minimum ${MIN_VIDEO_KBPS} kbit/s video, so the file is larger. Lower the resolution, trim the file or mute it.`
        : null,
  };
}

/** Percent smaller than the input (negative when the output is bigger). */
export const savedPercent = (bytesIn: number, bytesOut: number) =>
  bytesIn > 0 ? Math.round((1 - bytesOut / bytesIn) * 1000) / 10 : null;
