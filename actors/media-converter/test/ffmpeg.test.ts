/**
 * FFmpeg argument building and FFprobe parsing, plus real FFmpeg runs on the
 * generated test clip (skipped when FFmpeg isn't installed). Set
 * MEDIA_FFMPEG/MEDIA_FFPROBE to test the build from the Docker image.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  convertArgs,
  Ffmpeg,
  parseProbe,
  parseRate,
  type ConvertPlan,
} from "../src/ffmpeg.js";
import { OUTPUT_FORMATS } from "../src/input.js";

const plan = (over: Partial<ConvertPlan> = {}): ConvertPlan => ({
  format: "mp4",
  startSecs: 0,
  durationSecs: null,
  video: { stream: 0, width: 1280, height: 720, scale: true, fps: 30 },
  audio: true,
  audioChannels: 2,
  crf: 23,
  videoKbps: null,
  audioKbps: null,
  threads: 1,
  ...over,
});

describe("convertArgs", () => {
  it("encodes MP4 with x264 veryfast at a CRF, scaled, with AAC", () => {
    const a = convertArgs("in", plan(), "out").join(" ");
    expect(a).toContain("-threads 1 -i in -map 0:0");
    expect(a).toContain(
      "-vf scale=1280:720:flags=bilinear,setsar=1 -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p",
    );
    expect(a).toContain("-map 0:a:0 -c:a aac -b:a 128k");
    expect(a).toMatch(/-movflags \+faststart -f mp4 out$/);
  });

  it("uses bitrates in target mode, trims and caps the frame rate", () => {
    const a = convertArgs(
      "in",
      plan({
        startSecs: 5,
        durationSecs: 10,
        videoKbps: 1000,
        audioKbps: 64,
        audioChannels: 6,
        video: { stream: 1, width: 640, height: 360, scale: false, fps: 120 },
      }),
      "out",
    ).join(" ");
    expect(a).toContain("-ss 5 -t 10 -i in -map 0:1 -vf fps=60");
    expect(a).toContain("-b:v 1000k -maxrate 1500k -bufsize 2000k");
    expect(a).toContain("-ac 2 -c:a aac -b:a 64k");
  });

  it("encodes WebM with realtime VP9 and Opus; mutes with -an", () => {
    const a = convertArgs(
      "in",
      plan({ format: "webm", audio: false }),
      "out",
    ).join(" ");
    expect(a).toContain(
      "-c:v libvpx-vp9 -deadline realtime -cpu-used 8 -row-mt 1 -crf 33 -b:v 0",
    );
    expect(a).toContain("-an");
    expect(a).not.toContain("libopus");
    expect(a).toMatch(/-f webm out$/);
  });

  it("drops the video for audio outputs", () => {
    const mp3 = convertArgs(
      "in",
      plan({ format: "mp3", video: null }),
      "out",
    ).join(" ");
    expect(mp3).toContain("-vn -map 0:a:0 -c:a libmp3lame -q:a 2");
    expect(
      convertArgs(
        "in",
        plan({ format: "mp3", video: null, audioKbps: 96 }),
        "o",
      ),
    ).toContain("96k");
    expect(
      convertArgs("in", plan({ format: "m4a", video: null }), "o").join(" "),
    ).toContain(
      "-c:a aac -b:a 160k -sn -dn -map_chapters -1 -movflags +faststart -f ipod",
    );
    expect(
      convertArgs("in", plan({ format: "wav", video: null }), "o").join(" "),
    ).toContain("-c:a pcm_s16le -sn -dn -map_chapters -1 -f wav");
  });
});

describe("parseProbe", () => {
  const probe = (streams: object[], format: object = {}) =>
    parseProbe(
      JSON.stringify({
        format: {
          format_name: "mov,mp4",
          duration: "10.5",
          bit_rate: "800000",
          ...format,
        },
        streams,
      }),
    );

  it("reads video and audio, with rotation and non-square pixels", () => {
    const r = probe([
      {
        index: 0,
        codec_type: "video",
        codec_name: "h264",
        width: 1920,
        height: 1080,
        avg_frame_rate: "30000/1001",
        side_data_list: [{ rotation: -90 }],
      },
      { index: 1, codec_type: "audio", codec_name: "aac", channels: 2, sample_rate: "48000" },
    ]); // prettier-ignore
    expect(r).toEqual({
      ok: true,
      info: {
        durationSecs: 10.5,
        container: "mov,mp4",
        bitRate: 800000,
        video: {
          codec: "h264",
          stream: 0,
          width: 1080,
          height: 1920,
          anamorphic: false,
          fps: 29.97,
        },
        audio: { codec: "aac", channels: 2, sampleRate: 48000 },
      },
    });
    const sar = probe([
      { codec_type: "video", width: 720, height: 576, sample_aspect_ratio: "16:11" },
    ]); // prettier-ignore
    expect(sar.ok && sar.info.video).toMatchObject({
      width: 1047,
      height: 576,
      anamorphic: true,
    });
  });

  it("treats cover art as no video", () => {
    const r = probe(
      [
        { codec_type: "audio", codec_name: "mp3", channels: 2 },
        { codec_type: "video", codec_name: "mjpeg", width: 500, height: 500, disposition: { attached_pic: 1 } },
      ], // prettier-ignore
      { format_name: "mp3" },
    );
    expect(r.ok && r.info.video).toBeNull();
    expect(r.ok && r.info.audio?.codec).toBe("mp3");
  });

  it("rejects images, empty and broken files", () => {
    expect(
      probe([{ codec_type: "video", width: 10, height: 10 }], {
        format_name: "png_pipe",
        duration: undefined,
      }),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/image/) });
    expect(probe([])).toMatchObject({ ok: false });
    expect(parseProbe("nope")).toMatchObject({ ok: false });
    expect(parseRate("25/1")).toBe(25);
    expect(parseRate("0/0")).toBeNull();
  });
});

const ffmpegBin = process.env.MEDIA_FFMPEG ?? "ffmpeg";
const hasTools =
  spawnSync(ffmpegBin, ["-hide_banner", "-encoders"], {
    encoding: "utf8",
  }).stdout?.includes("libx264") ?? false;

describe.skipIf(!hasTools)("FFmpeg tools", () => {
  const dir = mkdtempSync(join(tmpdir(), "media-ff-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const tools = new Ffmpeg();

  it("generates the sample clip and converts it to every format", async () => {
    const sample = join(dir, "sample.mp4");
    expect(await tools.sample(sample)).toMatchObject({ ok: true });
    const probed = await tools.probe(sample);
    expect(probed).toMatchObject({
      ok: true,
      info: {
        video: { codec: "mpeg4", width: 320, height: 240 },
        audio: { codec: "aac" },
      },
    });
    if (!probed.ok) return;
    expect(probed.info.durationSecs).toBeCloseTo(3, 0);
    for (const format of OUTPUT_FORMATS) {
      const video = format === "mp4" || format === "webm";
      const out = join(dir, `out.${format}`);
      const res = await tools.convert(
        sample,
        plan({
          format,
          video: video
            ? { stream: 0, width: 160, height: 120, scale: true, fps: 25 }
            : null,
          durationSecs: 2,
        }),
        out,
        60_000,
      );
      expect(res, format).toMatchObject({ ok: true });
      const info = await tools.probe(out);
      expect(info, format).toMatchObject({ ok: true });
      if (!info.ok) continue;
      expect(info.info.durationSecs, format).toBeCloseTo(2, 0);
      if (video)
        expect(info.info.video).toMatchObject({ width: 160, height: 120 });
      else expect(info.info.video).toBeNull();
    }
  }, 60_000);

  it("reports a broken file without paths", async () => {
    const bad = join(dir, "bad.mp4");
    const res = await tools.probe(bad);
    expect(res).toMatchObject({ ok: false });
    if (!res.ok) expect(res.error).not.toContain(dir);
  });
});
