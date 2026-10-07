/**
 * End-to-end transcription through the real Python worker (FFmpeg +
 * faster-whisper) on tiny generated fixtures. Skipped when the Python side
 * isn't installed; set MEDIA_PYTHON to a venv with requirements.txt and
 * faster-whisper to run it (FFmpeg on PATH, or MEDIA_FFMPEG/MEDIA_FFPROBE).
 * The speech tests also need espeak-ng (or espeak) to synthesize speech.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalizeInput } from "../src/input.js";
import { runTranscriptions, type OutputItem } from "../src/run.js";
import { PythonWorker, type TranscribeRequest } from "../src/worker.js";

const python = process.env.MEDIA_PYTHON ?? "python3";
const ffmpeg = process.env.MEDIA_FFMPEG ?? "ffmpeg";
const ok = (cmd: string, args: string[]) =>
  spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
const hasWorker =
  ok(python, [
    "-c",
    "import ctranslate2, onnxruntime, importlib.util as u; assert u.find_spec('faster_whisper')",
  ]) &&
  ok(ffmpeg, ["-version"]) &&
  ok(process.env.MEDIA_FFPROBE ?? "ffprobe", ["-version"]);
const espeak = ["espeak-ng", "espeak"].find((c) => ok(c, ["--version"]));

/** 16 kHz mono 16-bit WAV of `seconds` of silence or a quiet tone. */
function wav(seconds: number, tone = false): Buffer {
  const n = Math.round(seconds * 16000);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(16000, 24);
  buf.writeUInt32LE(32000, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  if (tone)
    for (let i = 0; i < n; i++)
      buf.writeInt16LE(
        Math.round(2000 * Math.sin((2 * Math.PI * 440 * i) / 16000)),
        44 + i * 2,
      );
  return buf;
}

const SPEECH =
  "Hello world. This is a short test of the media transcriber. The quick brown fox jumps over the lazy dog.";

describe.skipIf(!hasWorker)("Python transcriber", () => {
  let dir: string;
  let worker: PythonWorker;
  const req = (
    name: string,
    extra: Partial<TranscribeRequest> = {},
  ): TranscribeRequest => ({
    path: join(dir, name),
    model: "base",
    language: null,
    threads: 2,
    maxSeconds: 600,
    budgetMinutes: null,
    ...extra,
  });

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "media-fixtures-"));
    writeFileSync(join(dir, "silence.wav"), wav(70));
    writeFileSync(join(dir, "tone.wav"), wav(3, true));
    writeFileSync(join(dir, "junk.mp3"), Buffer.from("not audio at all"));
    if (espeak) {
      spawnSync(espeak, ["-w", join(dir, "speech.wav"), SPEECH]);
      // A video with the speech as its audio track (skipped if this FFmpeg
      // can't encode one).
      spawnSync(ffmpeg, [
        "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=8",
        "-i", join(dir, "speech.wav"), "-c:v", "mpeg4", "-c:a", "aac",
        "-shortest", join(dir, "speech.mp4"),
      ]); // prettier-ignore
    }
    worker = new PythonWorker(python);
  }, 60_000);

  afterAll(() => {
    worker?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it.skipIf(!espeak)(
    "transcribes speech with language detection and timestamps",
    async () => {
      const res = await worker.transcribe(req("speech.wav"), 300_000);
      if (!res.ok) throw new Error(res.error);
      expect(res.language).toBe("en");
      expect(res.languageProbability).toBeGreaterThan(0.5);
      expect(res.duration).toBeGreaterThan(4);
      const text = res.segments.map((s) => s.text).join(" ");
      expect(text).toMatch(/quick brown fox/i);
      for (const s of res.segments) {
        expect(s.end).toBeGreaterThan(s.start);
        expect(s.end).toBeLessThanOrEqual(res.duration + 0.01);
      }
    },
    300_000,
  );

  it.skipIf(!espeak)(
    "reads the audio track of a video",
    async () => {
      let video: Buffer;
      try {
        video = readFileSync(join(dir, "speech.mp4"));
      } catch {
        return; // This FFmpeg can't make the fixture.
      }
      expect(video.length).toBeGreaterThan(0);
      const res = await worker.transcribe(
        req("speech.mp4", { language: "en" }),
        300_000,
      );
      if (!res.ok) throw new Error(res.error);
      expect(res.segments.map((s) => s.text).join(" ")).toMatch(/brown fox/i);
    },
    300_000,
  );

  it("enforces duration and budget limits before transcribing", async () => {
    expect(
      await worker.transcribe(req("silence.wav", { maxSeconds: 60 }), 60_000),
    ).toMatchObject({ ok: false, code: "too_long", duration: 70 });
    expect(
      await worker.transcribe(req("silence.wav", { budgetMinutes: 1 }), 60_000),
    ).toMatchObject({
      ok: false,
      code: "budget",
      error: expect.stringMatching(/2 min of audio/),
    });
  }, 120_000);

  it("reports bad files without crashing the worker", async () => {
    const bad = await worker.transcribe(req("junk.mp3"), 60_000);
    expect(bad).toMatchObject({
      ok: false,
      code: "decode",
      error: expect.stringMatching(/^Not a supported audio or video file/),
    });
    expect(bad.ok || bad.error).not.toContain(dir);
    const tone = await worker.transcribe(req("tone.wav"), 120_000);
    expect(tone).toMatchObject({ ok: true, duration: 3 });
  }, 180_000);

  it("runs a batch end to end", async () => {
    const input = normalizeInput({
      urls: ["https://f.test/silence.wav", "https://f.test/junk.mp3"].concat(
        espeak ? ["https://f.test/speech.wav"] : [],
      ),
      outputFormat: "chunks",
      chunkSize: 200,
      chunkOverlap: 0,
    });
    const items: OutputItem[] = [];
    const files: Record<string, string> = {};
    const stats = await runTranscriptions(input, {
      fetchFeed: async () => "",
      download: async (job, path) => {
        const name = job.kind === "kv" ? job.key : job.url.split("/").pop()!;
        const body = readFileSync(join(dir, name));
        writeFileSync(path, body);
        return {
          path,
          bytes: body.length,
          head: body.subarray(0, 4096),
          contentType: null,
          fileName: name,
        };
      },
      transcribe: worker.transcribe,
      budgetMinutes: () => Infinity,
      emit: async (batch) => {
        items.push(...batch);
        return { pushed: true, more: true };
      },
      saveFile: async (key, text) => {
        files[key] = text;
        return `https://kv/${key}`;
      },
      threads: 2,
    });
    const by = Object.fromEntries(items.map((i) => [i.fileName, i]));
    expect(by["silence.wav"]!.error).toBe("No speech detected.");
    expect(by["junk.mp3"]!.error).toMatch(/Not a supported/);
    if (espeak) {
      expect(stats.transcribed).toBe(1);
      expect(by["speech.wav"]).toMatchObject({
        chunkIndex: 0,
        startTime: expect.any(Number),
        billedMinutes: 1,
        language: "en",
      });
      expect(files["transcript-0003.srt"]).toMatch(/^1\n00:00:0/);
    }
  }, 300_000);
});
