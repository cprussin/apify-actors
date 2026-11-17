import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { SAMPLE, type OutputFormat } from "./input.js";
import { vp9Crf } from "./plan.js";

/** What FFprobe says about a media file. */
export interface MediaInfo {
  durationSecs: number;
  container: string;
  /** Overall bitrate in bit/s. */
  bitRate: number | null;
  video: {
    codec: string;
    /** FFprobe stream index. */
    stream: number;
    /** Display size (rotation and non-square pixels applied). */
    width: number;
    height: number;
    /** Non-square pixels: the stored size differs from the display size. */
    anamorphic: boolean;
    fps: number | null;
  } | null;
  audio: {
    codec: string;
    channels: number | null;
    sampleRate: number | null;
  } | null;
}

export type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

/** Everything FFmpeg needs to make one output file. */
export interface ConvertPlan {
  format: OutputFormat;
  startSecs: number;
  /** Output length in seconds; null for the rest of the file. */
  durationSecs: number | null;
  /** Video output: the FFprobe stream and the output size; null for audio. */
  video: {
    stream: number;
    width: number;
    height: number;
    /** Resize (or fix odd sizes / non-square pixels). */
    scale: boolean;
    /** Source frame rate, capped at 60 fps in the output. */
    fps: number | null;
  } | null;
  /** Include audio (the first audio track); false when muted or absent. */
  audio: boolean;
  /** Source channels: more than 2 are downmixed to stereo. */
  audioChannels: number | null;
  /** H.264-scale CRF, used when videoKbps is null. */
  crf: number;
  /** Target-size mode: bitrates in kbit/s. */
  videoKbps: number | null;
  audioKbps: number | null;
  threads: number;
}

/** The media operations run.ts needs (fakes in tests). */
export interface MediaTools {
  probe: (path: string) => Promise<Result<{ info: MediaInfo }>>;
  convert: (
    path: string,
    plan: ConvertPlan,
    outPath: string,
    timeoutMs: number,
  ) => Promise<Result<{ bytes: number }>>;
  /** Writes the generated self-test clip to `outPath`. */
  sample: (outPath: string) => Promise<Result<{ bytes: number }>>;
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

/** FFprobe JSON (-show_format -show_streams) -> media info or a user error. */
export function parseProbe(json: string): Result<{ info: MediaInfo }> {
  let data: {
    format?: { format_name?: string; duration?: string; bit_rate?: string };
    streams?: ProbeStream[];
  };
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, error: "Not a supported video or audio file." };
  }
  const streams = data.streams ?? [];
  const container = data.format?.format_name ?? "";
  // Cover art in MP3/M4A files is a still "video" stream: not a video.
  const video = streams.find(
    (s) =>
      s.codec_type === "video" &&
      !s.disposition?.attached_pic &&
      (s.width ?? 0) > 0,
  );
  const audio = streams.find((s) => s.codec_type === "audio");
  if (!video && !audio)
    return {
      ok: false,
      error: "Not a supported video or audio file (no video or audio track).",
    };
  const duration =
    num(data.format?.duration) ?? num(video?.duration) ?? num(audio?.duration);
  if (IMAGE_FORMATS.test(container) || (duration === null && !audio))
    return {
      ok: false,
      error:
        "This is an image, not a video or audio file. Use a direct link to a media file (e.g. ending in .mp4, .mov, .webm or .mp3).",
    };
  if (duration === null || duration <= 0)
    return {
      ok: false,
      error: "Could not read the file's duration; it may be damaged.",
    };

  let videoInfo: MediaInfo["video"] = null;
  if (video) {
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
    const w = Math.round(video.width! * sarRatio);
    const h = video.height ?? 0;
    const quarter = Math.abs(Math.round(rotation / 90)) % 2 === 1;
    videoInfo = {
      codec: video.codec_name ?? "unknown",
      stream: video.index ?? 0,
      width: quarter ? h : w,
      height: quarter ? w : h,
      anamorphic: w !== video.width,
      fps: parseRate(video.avg_frame_rate) ?? parseRate(video.r_frame_rate),
    };
  }
  const bitRate = num(data.format?.bit_rate);
  return {
    ok: true,
    info: {
      durationSecs: Math.round(duration * 1000) / 1000,
      container,
      bitRate: bitRate !== null ? Math.round(bitRate) : null,
      video: videoInfo,
      audio: audio
        ? {
            codec: audio.codec_name ?? "unknown",
            channels: audio.channels ?? null,
            sampleRate: num(audio.sample_rate),
          }
        : null,
    },
  };
}

/** Codec names FFprobe reports for each output, for the dataset item. */
export const OUTPUT_CODECS: Record<
  OutputFormat,
  { video: string | null; audio: string }
> = {
  mp4: { video: "h264", audio: "aac" },
  webm: { video: "vp9", audio: "opus" },
  mp3: { video: null, audio: "mp3" },
  m4a: { video: null, audio: "aac" },
  wav: { video: null, audio: "pcm_s16le" },
};

/** Default audio bitrates (kbit/s) in CRF mode. MP3 uses VBR -q:a 2. */
const AUDIO_KBPS = { mp4: 128, webm: 96, m4a: 160 } as const;

const MUXERS: Record<OutputFormat, string[]> = {
  mp4: ["-movflags", "+faststart", "-f", "mp4"],
  webm: ["-f", "webm"],
  mp3: ["-f", "mp3"],
  m4a: ["-movflags", "+faststart", "-f", "ipod"],
  wav: ["-f", "wav"],
};

function audioCodecArgs(plan: ConvertPlan): string[] {
  const kbps = (def: number) => `${plan.audioKbps ?? def}k`;
  switch (plan.format) {
    case "mp4":
      return ["-c:a", "aac", "-b:a", kbps(AUDIO_KBPS.mp4)];
    case "m4a":
      return ["-c:a", "aac", "-b:a", kbps(AUDIO_KBPS.m4a)];
    case "webm":
      return ["-c:a", "libopus", "-b:a", kbps(AUDIO_KBPS.webm)];
    case "mp3":
      return plan.audioKbps
        ? ["-c:a", "libmp3lame", "-b:a", `${plan.audioKbps}k`]
        : ["-c:a", "libmp3lame", "-q:a", "2"];
    case "wav":
      return ["-c:a", "pcm_s16le"];
  }
}

function videoCodecArgs(plan: ConvertPlan): string[] {
  const kbps = plan.videoKbps;
  if (plan.format === "webm")
    // Realtime mode: ~6x faster than "good" at speed 5 (same SSIM as x264
    // veryfast at CRF 23 with crf + 10, at ~2x the bits).
    return [
      "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8",
      "-row-mt", "1",
      ...(kbps
        ? ["-b:v", `${kbps}k`]
        : ["-crf", String(vp9Crf(plan.crf)), "-b:v", "0"]),
    ]; // prettier-ignore
  return [
    "-c:v", "libx264", "-preset", "veryfast",
    ...(kbps
      ? ["-b:v", `${kbps}k`, "-maxrate", `${Math.round(kbps * 1.5)}k`,
         "-bufsize", `${kbps * 2}k`]
      : ["-crf", String(plan.crf)]),
  ]; // prettier-ignore
}

/** FFmpeg arguments for one conversion. */
export function convertArgs(
  path: string,
  plan: ConvertPlan,
  outPath: string,
): string[] {
  const input = [
    ...(plan.startSecs > 0 ? ["-ss", String(plan.startSecs)] : []),
    ...(plan.durationSecs !== null ? ["-t", String(plan.durationSecs)] : []),
    "-i",
    path,
  ];
  const audio = plan.audio
    ? [
        "-map", "0:a:0",
        ...((plan.audioChannels ?? 2) > 2 ? ["-ac", "2"] : []),
        ...audioCodecArgs(plan),
      ]
    : ["-an"]; // prettier-ignore
  let video: string[] = ["-vn"];
  if (plan.video) {
    const v = plan.video;
    const filters = [
      ...(v.scale
        ? [`scale=${v.width}:${v.height}:flags=bilinear`, "setsar=1"]
        : []),
      ...(v.fps && v.fps > 60 ? ["fps=60"] : []),
    ];
    video = [
      "-map", `0:${v.stream}`,
      ...(filters.length ? ["-vf", filters.join(",")] : []),
      ...videoCodecArgs(plan), "-pix_fmt", "yuv420p",
    ]; // prettier-ignore
  }
  return [
    "-hide_banner", "-nostdin", "-nostats", "-y", "-v", "error",
    "-threads", String(plan.threads), ...input,
    ...video, ...audio, "-sn", "-dn", "-map_chapters", "-1",
    ...MUXERS[plan.format], outPath,
  ]; // prettier-ignore
}

export interface RunResult {
  code: number | null;
  timedOut: boolean;
  stdout: string;
  /** Last stderr lines. */
  tail: string[];
}

/** Runs a program with a timeout. */
export function runProcess(
  cmd: string,
  args: string[],
  timeoutMs: number,
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

/** FFmpeg/FFprobe programs run as separate processes. */
export class Ffmpeg implements MediaTools {
  constructor(
    private readonly ffmpeg = process.env.MEDIA_FFMPEG ?? "ffmpeg",
    private readonly ffprobe = process.env.MEDIA_FFPROBE ?? "ffprobe",
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
      60_000,
    );
    if (res.code !== 0)
      return {
        ok: false,
        error: `Not a supported video or audio file (${this.reason(res, [path])}).`,
      };
    return parseProbe(res.stdout);
  };

  convert: MediaTools["convert"] = async (path, plan, outPath, timeoutMs) => {
    const res = await runProcess(
      this.ffmpeg,
      convertArgs(path, plan, outPath),
      timeoutMs,
    );
    return this.output(res, outPath, "Conversion", [path, outPath]);
  };

  /**
   * A 3 s colour-bar clip with a 440 Hz tone, made by FFmpeg's own test
   * source filters (no network): MPEG-4 Part 2 video and AAC audio, about
   * what an old phone or camera writes.
   */
  sample: MediaTools["sample"] = async (outPath) => {
    const { width, height, seconds } = SAMPLE;
    const res = await runProcess(
      this.ffmpeg,
      [
        "-hide_banner", "-nostdin", "-nostats", "-y", "-v", "error",
        "-filter_complex",
        `testsrc=size=${width}x${height}:rate=25:duration=${seconds}[v];` +
          `sine=frequency=440:sample_rate=44100:duration=${seconds}[a]`,
        "-map", "[v]", "-map", "[a]",
        "-c:v", "mpeg4", "-q:v", "2", "-c:a", "aac", "-b:a", "192k",
        "-f", "mp4", outPath,
      ], // prettier-ignore
      60_000,
    );
    return this.output(res, outPath, "Generating the test clip", [outPath]);
  };
}
