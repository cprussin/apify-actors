/** Pure planning: which frames to take, output sizes and prices. */

export interface Scene {
  /** Seconds from the start of the video. */
  time: number;
  /** FFmpeg scene score (0-1); 1 for the first scene. */
  score: number;
}

export interface Planned {
  times: number[];
  warning: string | null;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Interval mode: `count` evenly spaced frames (the middle of each of
 * `count` equal parts), or one every `interval` seconds from the start.
 * More than `maxFrames` are spread evenly over the video instead.
 */
export function intervalTimes(
  duration: number,
  interval: number,
  count: number,
  maxFrames: number,
): Planned {
  const spread = (n: number) =>
    Array.from({ length: n }, (_, i) => round3((duration * (i + 0.5)) / n));
  if (count > 0) {
    const n = Math.min(count, maxFrames);
    return {
      times: spread(n),
      warning:
        count > maxFrames
          ? `${count} frames requested; capped at ${maxFrames} (maxFrames).`
          : null,
    };
  }
  const n = Math.max(1, Math.ceil(duration / interval - 1e-9));
  if (n > maxFrames)
    return {
      times: spread(maxFrames),
      warning: `One frame every ${interval} s would be ${n} frames; took ${maxFrames} evenly spaced frames instead (one every ${round3(duration / maxFrames)} s, maxFrames).`,
    };
  return {
    times: Array.from({ length: n }, (_, i) => round3(i * interval)),
    warning: null,
  };
}

/**
 * Scene mode: the first frame plus each detected cut, dropping cuts closer
 * than `minGap` seconds to the previous kept one. With more than `max`,
 * the strongest cuts are kept.
 */
export function pickScenes(
  cuts: Scene[],
  minGap: number,
  max: number,
): { scenes: Scene[]; detected: number; warning: string | null } {
  const sorted = [...cuts]
    .filter((c) => c.time >= 0)
    .sort((a, b) => a.time - b.time);
  const kept: Scene[] = [{ time: 0, score: 1 }];
  for (const c of sorted) {
    if (c.time - kept.at(-1)!.time < Math.max(minGap, 0.001)) continue;
    kept.push({ time: round3(c.time), score: Math.round(c.score * 1e4) / 1e4 });
  }
  if (kept.length <= max)
    return { scenes: kept, detected: kept.length, warning: null };
  const [first, ...rest] = kept;
  const strongest = rest
    .sort((a, b) => b.score - a.score || a.time - b.time)
    .slice(0, max - 1);
  return {
    scenes: [first!, ...strongest].sort((a, b) => a.time - b.time),
    detected: kept.length,
    warning: `${kept.length} scenes found; kept the ${max} strongest cuts (maxFrames).`,
  };
}

/** Up to `n` items spread evenly over `items`, first and last included. */
export function evenSample<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  if (n <= 1) return items.slice(0, 1);
  return Array.from(
    { length: n },
    (_, i) => items[Math.round((i * (items.length - 1)) / (n - 1))]!,
  );
}

const even = (n: number) => Math.max(2, 2 * Math.round(n / 2));

/**
 * Output size for a display size scaled to at most `maxWidth` wide (0:
 * original), never upscaled. Scaled sizes are even (for encoders).
 */
export function fitWidth(
  width: number,
  height: number,
  maxWidth: number,
): { width: number; height: number; scaled: boolean } {
  if (!maxWidth || width <= maxWidth) return { width, height, scaled: false };
  return {
    width: even(maxWidth),
    height: even((height * maxWidth) / width),
    scaled: true,
  };
}

export const SHEET_TILE_WIDTH = 320;
export const SHEET_PADDING = 4;
/** At most this many rows, so the sheet stays within WebP's 16383 px. */
export const SHEET_MAX_ROWS = 20;

export interface SheetLayout {
  columns: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
  width: number;
  height: number;
  /** Frames on the sheet (an even sample when there are more). */
  tiles: number;
}

export function sheetLayout(
  frames: number,
  columns: number,
  videoWidth: number,
  videoHeight: number,
): SheetLayout {
  const cols = Math.max(1, Math.min(columns, frames));
  const tiles = Math.min(frames, cols * SHEET_MAX_ROWS);
  const rows = Math.ceil(tiles / cols);
  const tileWidth = SHEET_TILE_WIDTH;
  const tileHeight = Math.min(
    even((videoHeight * tileWidth) / videoWidth),
    800,
  );
  const p = SHEET_PADDING;
  return {
    columns: cols,
    rows,
    tileWidth,
    tileHeight,
    width: cols * tileWidth + (cols - 1) * p + 2 * p,
    height: rows * tileHeight + (rows - 1) * p + 2 * p,
    tiles,
  };
}

/** "00:01:05.250" */
export function timecode(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms % 1000, 3)}`;
}

export const startedMinutes = (seconds: number) =>
  Math.max(1, Math.ceil(seconds / 60 - 1e-9));

export const EVENTS = {
  video: "video-processed",
  frame: "frame",
  sceneMinute: "scene-minute",
  extra: "audio-or-gif",
} as const;
export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
export type Charges = Partial<Record<EventName, number>>;
export type Prices = Partial<Record<string, number>>;

/** Price of `charges` in USD, rounded to micro-dollars. */
export function costUsd(charges: Charges, prices: Prices): number {
  let micros = 0;
  for (const [event, count] of Object.entries(charges))
    micros += Math.round((prices[event] ?? 0) * 1e6) * (count ?? 0);
  return micros / 1e6;
}

export const formatUsd = (usd: number) =>
  `$${usd.toFixed(usd < 1 ? 3 : 2).replace(/0$/, "")}`;
