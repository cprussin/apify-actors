/**
 * Real FFmpeg on tiny videos generated at test time. Skipped when FFmpeg
 * isn't installed. The actor's tools use FRAMES_FFMPEG/FRAMES_FFPROBE (e.g.
 * the LGPL build copied out of the Docker image) or ffmpeg/ffprobe on PATH;
 * fixtures are made with FIXTURE_FFMPEG or ffmpeg on PATH (any build with
 * the mpeg4 and aac encoders).
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  audioArgs,
  copiesAudio,
  Ffmpeg,
  parseProbe,
  SceneParser,
  type VideoInfo,
} from "../src/ffmpeg.js";
import { sheetLayout } from "../src/plan.js";

describe("audioArgs", () => {
  it("copies a track already in the format, encodes others", () => {
    expect(audioArgs("m4a", "aac", 6)).toEqual([
      "-c:a", "copy", "-movflags", "+faststart", "-f", "ipod",
    ]); // prettier-ignore
    expect(audioArgs("mp3", "aac", 6)).toEqual([
      "-ac", "2", "-c:a", "libmp3lame", "-q:a", "2", "-compression_level", "7", "-f", "mp3",
    ]); // prettier-ignore
    expect(audioArgs("opus", "opus", 2)).toEqual([
      "-c:a",
      "copy",
      "-f",
      "opus",
    ]);
    expect(audioArgs("m4a", "mp3", 2).slice(0, 2)).toEqual(["-c:a", "aac"]);
    expect(copiesAudio("m4a", "aac")).toBe(true);
    expect(copiesAudio("opus", "aac")).toBe(false);
    expect(copiesAudio("none", "aac")).toBe(false);
  });
});

const fixtureFfmpeg = process.env.FIXTURE_FFMPEG ?? "ffmpeg";
const ok = (cmd: string, args: string[]) =>
  spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
const hasTools =
  ok(process.env.FRAMES_FFMPEG ?? "ffmpeg", ["-version"]) &&
  ok(process.env.FRAMES_FFPROBE ?? "ffprobe", ["-version"]) &&
  ok(fixtureFfmpeg, ["-version"]);

const PROBE = {
  format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "12.5", bit_rate: "812345.6" },
  streams: [
    { index: 0, codec_type: "video", codec_name: "mjpeg", width: 300, height: 300, disposition: { attached_pic: 1 } },
    { index: 1, codec_type: "video", codec_name: "h264", width: 1920, height: 1080, sample_aspect_ratio: "1:1", avg_frame_rate: "30000/1001", side_data_list: [{ rotation: -90 }] },
    { index: 2, codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 2 },
  ],
}; // prettier-ignore

describe("parseProbe", () => {
  it("reads the video track, rotation and audio", () => {
    expect(parseProbe(JSON.stringify(PROBE))).toEqual({
      ok: true,
      info: {
        durationSecs: 12.5,
        width: 1080,
        height: 1920,
        codedWidth: 1920,
        codedHeight: 1080,
        fps: 29.97,
        videoCodec: "h264",
        videoStream: 1,
        container: "mov,mp4,m4a,3gp,3g2,mj2",
        bitRate: 812346,
        rotation: 270,
        audioCodec: "aac",
        audioSampleRate: 48000,
        audioChannels: 2,
      },
    });
  });

  it("applies non-square pixels to the display size", () => {
    const res = parseProbe(
      JSON.stringify({
        format: { format_name: "mpeg", duration: "5" },
        streams: [
          { index: 0, codec_type: "video", codec_name: "mpeg2video", width: 720, height: 576, sample_aspect_ratio: "64:45", r_frame_rate: "25/1", avg_frame_rate: "0/0" },
        ],
      }), // prettier-ignore
    );
    expect(res).toMatchObject({
      ok: true,
      info: { width: 1024, height: 576, fps: 25, audioCodec: null },
    });
  });

  it("rejects audio-only files, images and garbage", () => {
    const audioOnly = {
      format: { format_name: "mp3", duration: "100" },
      streams: [PROBE.streams[0], PROBE.streams[2]],
    };
    expect(parseProbe(JSON.stringify(audioOnly))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/no video track \(it is audio only\)/),
    });
    const image = {
      format: { format_name: "png_pipe" },
      streams: [{ index: 0, codec_type: "video", width: 10, height: 10 }],
    };
    expect(parseProbe(JSON.stringify(image))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/image, not a video/),
    });
    expect(parseProbe("nope")).toMatchObject({ ok: false });
  });
});

describe("SceneParser", () => {
  it("pairs timestamps with scene scores", () => {
    const p = new SceneParser();
    for (const line of [
      "[Parsed_metadata_2 @ 0x1] frame:0    pts:4608    pts_time:0.3",
      "[Parsed_metadata_2 @ 0x1] lavfi.scene_score=0.583109",
      "[out#0/null @ 0x2] video:1kB audio:0kB",
      "[Parsed_metadata_2 @ 0x1] frame:1    pts:18432   pts_time:12.2",
      "[Parsed_metadata_2 @ 0x1] lavfi.scene_score=1.000000",
    ])
      p.push(line);
    expect(p.cuts).toEqual([
      { time: 0.3, score: 0.583109 },
      { time: 12.2, score: 1 },
    ]);
  });
});

describe.skipIf(!hasTools)("FFmpeg tools", () => {
  let dir: string;
  let info: VideoInfo;
  const ff = new Ffmpeg(2);
  const video = () => join(dir, "scenes.mp4");

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "frames-fixtures-"));
    // 6 s, 320x240, three solid-color scenes (cuts at 2 s and 4 s) and a
    // 6-channel tone; B-frames, which scene detection skips.
    const make = spawnSync(fixtureFfmpeg, [
      "-v", "error", "-y",
      "-f", "lavfi", "-i", "color=c=red:s=320x240:r=25:d=2",
      "-f", "lavfi", "-i", "color=c=blue:s=320x240:r=25:d=2",
      "-f", "lavfi", "-i", "testsrc2=s=320x240:r=25:d=2",
      "-f", "lavfi", "-i", "sine=f=440:d=6,aformat=channel_layouts=5.1",
      "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=yuv420p[v]",
      "-map", "[v]", "-map", "3:a", "-c:v", "mpeg4", "-q:v", "3", "-bf", "2",
      "-c:a", "aac", video(),
    ]); // prettier-ignore
    if (make.status !== 0)
      throw new Error(`Fixture failed: ${make.stderr?.toString()}`);
    spawnSync(fixtureFfmpeg, [
      "-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=440:d=2",
      "-c:a", "aac", join(dir, "tone.m4a"),
    ]); // prettier-ignore
    writeFileSync(join(dir, "junk.mp4"), "not a video at all");
  }, 60_000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("probes the video", async () => {
    const res = await ff.probe(video());
    if (!res.ok) throw new Error(res.error);
    info = res.info;
    expect(info).toMatchObject({
      width: 320,
      height: 240,
      fps: 25,
      videoCodec: "mpeg4",
      audioCodec: "aac",
      audioChannels: 6,
      rotation: 0,
    });
    expect(info.durationSecs).toBeCloseTo(6, 0);
  });

  it("reports unreadable and audio-only files", async () => {
    const junk = await ff.probe(join(dir, "junk.mp4"));
    expect(junk).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^Not a supported video file/),
    });
    expect(junk.ok || junk.error).not.toContain(dir);
    expect(await ff.probe(join(dir, "tone.m4a"))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/no video track/),
    });
  });

  it.each([
    ["jpg", [0xff, 0xd8, 0xff]],
    ["png", [0x89, 0x50, 0x4e, 0x47]],
    ["webp", [0x52, 0x49, 0x46, 0x46]],
  ] as const)("extracts a %s frame at a time", async (format, magic) => {
    const out = join(dir, `frame.${format}`);
    const res = await ff.frame(video(), info, 3, out, {
      format,
      quality: 80,
      size: { width: 160, height: 120 },
    });
    if (!res.ok) throw new Error(res.error);
    const buf = readFileSync(out);
    expect([...buf.subarray(0, magic.length)]).toEqual(magic);
    expect(res.bytes).toBe(buf.length);
    // A blue frame (the second scene).
    const probe = spawnSync(process.env.FRAMES_FFPROBE ?? "ffprobe", [
      "-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", out,
    ]); // prettier-ignore
    expect(probe.stdout.toString().trim()).toBe("160,120");
  });

  it("finds the scene cuts", async () => {
    const res = await ff.scenes(video(), info, 0.3);
    if (!res.ok) throw new Error(res.error);
    expect(res.cuts.map((c) => Math.round(c.time))).toEqual([2, 4]);
    for (const c of res.cuts) expect(c.score).toBeGreaterThan(0.3);
  });

  it("tiles a contact sheet", async () => {
    const frames: string[] = [];
    for (const t of [0.5, 2.5, 4.5]) {
      const out = join(dir, `t${t}.jpg`);
      const r = await ff.frame(video(), info, t, out, {
        format: "jpg",
        quality: 80,
        size: null,
      });
      if (!r.ok) throw new Error(r.error);
      frames.push(out);
    }
    const layout = sheetLayout(3, 2, 320, 240);
    const out = join(dir, "sheet.png");
    const res = await ff.contactSheet(frames, out, layout, {
      format: "png",
      quality: 80,
      size: null,
    });
    if (!res.ok) throw new Error(res.error);
    const probe = spawnSync(process.env.FRAMES_FFPROBE ?? "ffprobe", [
      "-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", out,
    ]); // prettier-ignore
    expect(probe.stdout.toString().trim()).toBe(
      `${layout.width},${layout.height}`,
    );
  });

  it("makes a GIF clip", async () => {
    const out = join(dir, "clip.gif");
    const res = await ff.gif(
      video(),
      info,
      { startSecs: 4, durationSecs: 5, width: 160, fps: 10 },
      { width: 160, height: 120 },
      out,
    );
    if (!res.ok) throw new Error(res.error);
    expect(res.durationSecs).toBeCloseTo(2, 0);
    expect(readFileSync(out).subarray(0, 6).toString()).toBe("GIF89a");
  });

  it.each([
    ["m4a", "aac", 6],
    ["mp3", "mp3", 2],
    ["opus", "opus", 2],
  ] as const)("extracts the audio track as %s", async (format, codec, ch) => {
    const out = join(dir, `audio.${format}`);
    const res = await ff.audio(video(), info, format, out);
    if (!res.ok) throw new Error(res.error);
    const probe = spawnSync(process.env.FRAMES_FFPROBE ?? "ffprobe", [
      "-v", "error", "-show_entries", "stream=codec_name,channels", "-of", "csv=p=0", out,
    ]); // prettier-ignore
    expect(probe.stdout.toString().trim()).toBe(`${codec},${ch}`);
  });

  // Skipped per codec when the fixture FFmpeg can't encode it.
  it.each([
    ["av1", "libsvtav1", [], "mp4"],
    ["av1", "libaom-av1", ["-cpu-used", "8"], "webm"],
    ["vp9", "libvpx-vp9", [], "webm"],
    ["hevc", "libx265", [], "mkv"],
  ] as const)("decodes %s (%s)", async (codec, encoder, args, ext) => {
    const path = join(dir, `codec-${encoder}.${ext}`);
    const made = spawnSync(fixtureFfmpeg, [
      "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=128x96:r=10:d=1",
      "-pix_fmt", "yuv420p", "-c:v", encoder, ...args, path,
    ]); // prettier-ignore
    if (made.status !== 0) return;
    const probed = await ff.probe(path);
    if (!probed.ok) throw new Error(probed.error);
    expect(probed.info.videoCodec).toBe(codec);
    const out = join(dir, `codec-${encoder}.png`);
    const res = await ff.frame(path, probed.info, 0.5, out, {
      format: "png",
      quality: 80,
      size: null,
    });
    if (!res.ok) throw new Error(res.error);
  });

  it("fails a frame past the end without crashing", async () => {
    const res = await ff.frame(video(), info, 60, join(dir, "none.jpg"), {
      format: "jpg",
      quality: 80,
      size: null,
    });
    expect(res).toMatchObject({ ok: false });
  });
});
