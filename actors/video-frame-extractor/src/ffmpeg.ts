import { spawn } from "node:child_process";
import { stat, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { AudioFormat, FrameFormat, GifOptions } from "./input.js";
import type { Scene, SheetLayout } from "./plan.js";

/** What FFprobe says about a video. */
export interface VideoInfo {
  durationSecs: number;
  /** Display size (rotation and non-square pixels applied). */
  width: number;
  height: number;
  /** Size as stored in the file. */
  codedWidth: number;
  codedHeight: number;
  fps: number | null;
  videoCodec: string;
  /** FFprobe stream index of the video track. */
  videoStream: number;
  container: string;
  bitRate: number | null;
  rotation: number;
  audioCodec: string | null;
  audioSampleRate: number | null;
  audioChannels: number | null;
}

export type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

export interface FrameOptions {
  format: FrameFormat;
  quality: number;
  /** Output size; null keeps the decoded size. */
  size: { width: number; height: number } | null;
}

/** The media operations run.ts needs (fakes in tests). */
export interface MediaTools {
  probe: (path: string) => Promise<Result<{ info: VideoInfo }>>;
  frame: (
    path: string,
    info: VideoInfo,
    time: number,
    outPath: string,
    opts: FrameOptions,
  ) => Promise<Result<{ bytes: number }>>;
  scenes: (
    path: string,
    info: VideoInfo,
    threshold: number,
  ) => Promise<Result<{ cuts: Scene[] }>>;
  contactSheet: (
    framePaths: string[],
    outPath: string,
    layout: SheetLayout,
    opts: FrameOptions,
  ) => Promise<Result<{ bytes: number }>>;
  gif: (
    path: string,
    info: VideoInfo,
    gif: GifOptions,
    size: { width: number; height: number },
    outPath: string,
  ) => Promise<Result<{ bytes: number; durationSecs: number }>>;
  audio: (
    path: string,
    info: VideoInfo,
    format: AudioFormat,
    outPath: string,
  ) => Promise<Result<{ bytes: number }>>;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  return v !== undefined && v !== null && v !== "" && Number.isFinite(n)
    ? n
    : null;
};

/** "30000/1001" -> 29.97 */
export function parseRate(rate: unknown): number | null {
  const m = /^(\d+)\/(\d+)$/.exec(String(rate ?? ""));
  if (!m || !Number(m[1]) || !Number(m[2])) return num(rate) || null;
  return Math.round((Number(m[1]) / Number(m[2])) * 1000) / 1000;
}

interface ProbeStream {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  sample_aspect_ratio?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  duration?: string;
  sample_rate?: string;
  channels?: number;
  disposition?: { attached_pic?: number };
  tags?: Record<string, string>;
  side_data_list?: { rotation?: number }[];
}

const IMAGE_FORMATS =
  /(^|,)(image2|png_pipe|jpeg_pipe|webp_pipe|bmp_pipe|tiff_pipe|svg_pipe|gif_pipe|jpegxl_pipe|avif)(,|$)/;

/** FFprobe JSON (-show_format -show_streams) -> video info or a user error. */
export function parseProbe(json: string): Result<{ info: VideoInfo }> {
  let data: {
    format?: { format_name?: string; duration?: string; bit_rate?: string };
    streams?: ProbeStream[];
  };
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, error: "Not a supported video file." };
  }
  const streams = data.streams ?? [];
  const container = data.format?.format_name ?? "";
  const video = streams.find(
    (s) =>
      s.codec_type === "video" &&
      !s.disposition?.attached_pic &&
      (s.width ?? 0) > 0,
  );
  const audio = streams.find((s) => s.codec_type === "audio");
  if (!video)
    return {
      ok: false,
      error: audio
        ? "The file has no video track (it is audio only). For transcripts of audio files, use the media-transcriber actor."
        : "Not a supported video file (no video track found).",
    };
  const duration =
    num(data.format?.duration) ?? num(video.duration) ?? num(audio?.duration);
  if (IMAGE_FORMATS.test(container) || (duration === null && !audio))
    return {
      ok: false,
      error:
        "This is an image, not a video. Use a direct link to a video file (e.g. ending in .mp4, .mov or .webm).",
    };
  if (duration === null || duration <= 0)
    return {
      ok: false,
      error: "Could not read the video's duration; the file may be damaged.",
    };

  const rotation =
    num(
      video.side_data_list?.find((d) => d.rotation !== undefined)?.rotation,
    ) ??
    num(video.tags?.rotate) ??
    0;
  const sar = /^(\d+):(\d+)$/.exec(video.sample_aspect_ratio ?? "");
  const sarRatio =
    sar && Number(sar[1]) && Number(sar[2])
      ? Number(sar[1]) / Number(sar[2])
      : 1;
  const w = video.width!;
  const h = video.height ?? 0;
  const pw = Math.round(w * sarRatio);
  const quarter = Math.abs(Math.round(rotation / 90)) % 2 === 1;
  const bitRate = num(data.format?.bit_rate);
  return {
    ok: true,
    info: {
      durationSecs: Math.round(duration * 1000) / 1000,
      width: quarter ? h : pw,
      height: quarter ? pw : h,
      codedWidth: w,
      codedHeight: h,
      fps: parseRate(video.avg_frame_rate) ?? parseRate(video.r_frame_rate),
      videoCodec: video.codec_name ?? "unknown",
      videoStream: video.index ?? 0,
      container,
      bitRate: bitRate !== null ? Math.round(bitRate) : null,
      rotation: ((Math.round(rotation) % 360) + 360) % 360,
      audioCodec: audio?.codec_name ?? null,
      audioSampleRate: num(audio?.sample_rate),
      audioChannels: audio?.channels ?? null,
    },
  };
}

/**
 * Reads `metadata=print` log lines: "frame:3 pts:4608 pts_time:1.2" then
 * "lavfi.scene_score=0.58".
 */
export class SceneParser {
  readonly cuts: Scene[] = [];
  private time: number | null = null;

  push(line: string) {
    const t = /\bpts_time:(-?[\d.]+)/.exec(line);
    if (t) {
      this.time = Number(t[1]);
      return;
    }
    const s = /lavfi\.scene_score=([\d.]+)/.exec(line);
    if (s && this.time !== null) {
      this.cuts.push({ time: this.time, score: Number(s[1]) });
      this.time = null;
    }
  }
}

export interface RunResult {
  code: number | null;
  timedOut: boolean;
  stdout: string;
  /** Last stderr lines. */
  tail: string[];
}

/** Runs a program with a timeout, streaming stderr lines to `onLine`. */
export function runProcess(
  cmd: string,
  args: string[],
  timeoutMs: number,
  onLine?: (line: string) => void,
): Promise<RunResult> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const tail: string[] = [];
    const out: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, timeoutMs);
    proc.stdout.on("data", (c: Buffer) => out.push(c));
    createInterface({ input: proc.stderr }).on("line", (line) => {
      onLine?.(line);
      tail.push(line);
      if (tail.length > 20) tail.shift();
    });
    const done = (code: number | null) => {
      clearTimeout(timer);
      resolve({
        code,
        timedOut,
        stdout: Buffer.concat(out).toString("utf8"),
        tail,
      });
    };
    proc.on("error", (e) => {
      tail.push(e.message);
      done(-1);
    });
    proc.on("close", (code) => done(code));
  });
}

/** JPEG qscale (2 best .. 31 worst) for a 1-100 quality. */
export const jpegQscale = (quality: number) =>
  Math.round(2 + ((100 - quality) * 29) / 99);

function encoderArgs(format: FrameFormat, quality: number): string[] {
  if (format === "jpg")
    return ["-c:v", "mjpeg", "-q:v", String(jpegQscale(quality))];
  if (format === "webp")
    return ["-c:v", "libwebp", "-quality", String(quality), "-lossless", "0"];
  return ["-c:v", "png"];
}

type AudioOut = Exclude<AudioFormat, "none">;

/** Muxer per audio format, and the source codec that is copied as is. */
const AUDIO_OUT: Record<AudioOut, { muxer: string[]; same: string }> = {
  m4a: { muxer: ["-movflags", "+faststart", "-f", "ipod"], same: "aac" },
  mp3: { muxer: ["-f", "mp3"], same: "mp3" },
  opus: { muxer: ["-f", "opus"], same: "opus" },
};

/** Encoder settings, tuned for speed (the audio is billed per file). */
const AUDIO_ENCODE: Record<AudioOut, string[]> = {
  m4a: ["-c:a", "aac", "-aac_coder", "fast", "-b:a", "128k"],
  mp3: ["-c:a", "libmp3lame", "-q:a", "2", "-compression_level", "7"],
  opus: ["-c:a", "libopus", "-b:a", "96k", "-compression_level", "5"],
};

/**
 * FFmpeg arguments for the audio track in `format`: copied when it is
 * already in that codec (e.g. AAC from an MP4 to M4A), encoded otherwise.
 */
export function audioArgs(
  format: AudioOut,
  codec: string | null,
  channels: number | null,
): string[] {
  const out = AUDIO_OUT[format];
  if (codec === out.same) return ["-c:a", "copy", ...out.muxer];
  // MP3 and Opus are stereo at most here (LAME can't do more channels).
  const downmix = format !== "m4a" && (channels ?? 2) > 2 ? ["-ac", "2"] : [];
  return [...downmix, ...AUDIO_ENCODE[format], ...out.muxer];
}

const BASE = ["-hide_banner", "-nostdin", "-nostats", "-y"];

/** Timeouts: generous backstops, scaled by the video's length. */
const timeouts = {
  probe: 60_000,
  frame: 120_000,
  sheet: 120_000,
  scenes: (secs: number, threads: number) =>
    Math.round(120 + (secs * 1.5) / threads) * 1000,
  gif: 300_000,
  audio: (secs: number) => Math.round(120 + secs * 0.5) * 1000,
};

/** FFmpeg/FFprobe programs run as separate processes. */
export class Ffmpeg implements MediaTools {
  constructor(
    private readonly threads = 1,
    private readonly ffmpeg = process.env.FRAMES_FFMPEG ?? "ffmpeg",
    private readonly ffprobe = process.env.FRAMES_FFPROBE ?? "ffprobe",
  ) {}

  /** A short, path-free reason from FFmpeg's last stderr lines. */
  private reason(res: RunResult, paths: string[]): string {
    if (res.timedOut) return "timed out";
    let line =
      res.tail
        .filter(
          (l) => l.trim() && !/^\s*(Last message repeated|frame=)/.test(l),
        )
        .at(-1) ?? `exit code ${res.code}`;
    for (const p of paths) line = line.split(p).join("file");
    return line.replace(/^\[[^\]]+\]\s*/, "").slice(0, 300);
  }

  private async output(
    res: RunResult,
    outPath: string,
    what: string,
    paths: string[],
  ): Promise<Result<{ bytes: number }>> {
    const bytes = await stat(outPath).then(
      (s) => s.size,
      () => 0,
    );
    if (res.code === 0 && bytes > 0) return { ok: true, bytes };
    return {
      ok: false,
      error: `${what} failed: ${res.code === 0 ? "no output" : this.reason(res, paths)}.`,
    };
  }

  probe: MediaTools["probe"] = async (path) => {
    const res = await runProcess(
      this.ffprobe,
      [
        "-v", "error", "-print_format", "json", "-show_format", "-show_streams",
        path,
      ], // prettier-ignore
      timeouts.probe,
    );
    if (res.code !== 0)
      return {
        ok: false,
        error: `Not a supported video file (${this.reason(res, [path])}).`,
      };
    return parseProbe(res.stdout);
  };

  private scale(size: FrameOptions["size"]): string[] {
    return size
      ? ["-vf", `scale=${size.width}:${size.height}:flags=bicubic,setsar=1`]
      : [];
  }

  frame: MediaTools["frame"] = async (path, info, time, outPath, opts) => {
    const res = await runProcess(
      this.ffmpeg,
      [
        ...BASE, "-v", "error", "-threads", String(this.threads),
        "-ss", time.toFixed(3), "-i", path,
        "-map", `0:${info.videoStream}`, "-an", "-sn", "-dn",
        "-frames:v", "1", ...this.scale(opts.size),
        ...encoderArgs(opts.format, opts.quality),
        "-f", "image2", "-update", "1", outPath,
      ], // prettier-ignore
      timeouts.frame,
    );
    return this.output(res, outPath, "Frame extraction", [path, outPath]);
  };

  scenes: MediaTools["scenes"] = async (path, info, threshold) => {
    const parser = new SceneParser();
    // Skipping frames no other frame references (most B-frames) about
    // halves the decoding; a cut is then found within a frame or two.
    const res = await runProcess(
      this.ffmpeg,
      [
        ...BASE, "-v", "info", "-threads", String(this.threads),
        "-skip_frame", "noref", "-i", path,
        "-map", `0:${info.videoStream}`, "-an", "-sn", "-dn",
        "-vf", `scale=320:-2:flags=fast_bilinear,select='gt(scene,${threshold})',metadata=print`,
        "-f", "null", "-",
      ], // prettier-ignore
      timeouts.scenes(info.durationSecs, this.threads),
      (line) => parser.push(line),
    );
    if (res.code !== 0)
      return {
        ok: false,
        error: `Scene detection failed: ${this.reason(res, [path])}.`,
      };
    return { ok: true, cuts: parser.cuts };
  };

  contactSheet: MediaTools["contactSheet"] = async (
    framePaths,
    outPath,
    layout,
    opts,
  ) => {
    const list = `${outPath}.ffconcat`;
    await writeFile(
      list,
      "ffconcat version 1.0\n" +
        framePaths
          .map((p) => `file '${p.replace(/'/g, "'\\''")}'\nduration 1\n`)
          .join(""),
    );
    const { tileWidth: w, tileHeight: h, columns, rows } = layout;
    const res = await runProcess(
      this.ffmpeg,
      [
        ...BASE, "-v", "error", "-f", "concat", "-safe", "0", "-i", list,
        "-vf",
        `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,` +
          `tile=${columns}x${rows}:padding=4:margin=4`,
        "-frames:v", "1", ...encoderArgs(opts.format, opts.quality),
        "-f", "image2", "-update", "1", outPath,
      ], // prettier-ignore
      timeouts.sheet,
    );
    return this.output(res, outPath, "Contact sheet", [list, outPath]);
  };

  gif: MediaTools["gif"] = async (path, info, gif, size, outPath) => {
    const start = Math.min(gif.startSecs, info.durationSecs);
    const durationSecs =
      Math.round(Math.min(gif.durationSecs, info.durationSecs - start) * 1000) /
      1000;
    const res = await runProcess(
      this.ffmpeg,
      [
        ...BASE, "-v", "error", "-threads", String(this.threads),
        "-ss", start.toFixed(3), "-t", durationSecs.toFixed(3), "-i", path,
        "-map", `0:${info.videoStream}`, "-an", "-sn", "-dn",
        "-vf",
        `fps=${gif.fps},scale=${size.width}:${size.height}:flags=lanczos,setsar=1,` +
          "split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3",
        "-loop", "0", "-f", "gif", outPath,
      ], // prettier-ignore
      timeouts.gif,
    );
    const out = await this.output(res, outPath, "GIF clip", [path, outPath]);
    return out.ok ? { ...out, durationSecs } : out;
  };

  audio: MediaTools["audio"] = async (path, info, format, outPath) => {
    if (format === "none")
      return { ok: false, error: "No audio format given." };
    const res = await runProcess(
      this.ffmpeg,
      [
        ...BASE, "-v", "error", "-threads", String(this.threads), "-i", path,
        "-map", "0:a:0", "-vn", "-sn", "-dn",
        ...audioArgs(format, info.audioCodec, info.audioChannels), outPath,
      ], // prettier-ignore
      timeouts.audio(info.durationSecs),
    );
    return this.output(res, outPath, "Audio extraction", [path, outPath]);
  };
}
