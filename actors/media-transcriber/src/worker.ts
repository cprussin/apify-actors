import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { Segment } from "./captions.js";
import type { Model } from "./input.js";

export interface TranscribeRequest {
  path: string;
  model: Model;
  /** null: detect. */
  language: string | null;
  threads: number;
  maxSeconds: number;
  /** Max billable minutes; null when unlimited. */
  budgetMinutes: number | null;
}

export type ErrorCode =
  "too_long" | "budget" | "no_audio" | "decode" | "internal";

export type TranscribeResult =
  | {
      ok: true;
      language: string | null;
      languageProbability: number | null;
      /** Seconds of decoded audio. */
      duration: number;
      segments: Segment[];
      warnings: string[];
    }
  | { ok: false; error: string; code: ErrorCode; duration?: number | null };

export type Transcribe = (
  req: TranscribeRequest,
  timeoutMs: number,
) => Promise<TranscribeResult>;

/** python/transcribe.py, next to src/ and dist/. */
export const WORKER_SCRIPT = fileURLToPath(
  new URL("../python/transcribe.py", import.meta.url),
);

interface Pending {
  resolve: (r: TranscribeResult) => void;
  timer: NodeJS.Timeout;
}

/**
 * A long-lived Python worker (keeps the Whisper model loaded between files).
 * Requests are answered in order. If the worker dies (e.g. out of memory)
 * or times out, pending requests fail and the next request starts a fresh
 * worker.
 */
export class PythonWorker {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private stderrTail: string[] = [];

  constructor(
    private readonly python = process.env.MEDIA_PYTHON ?? "python3",
    private readonly script = WORKER_SCRIPT,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  private start(): ChildProcessWithoutNullStreams {
    const proc = spawn(this.python, ["-u", this.script], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    this.stderrTail = [];
    createInterface({ input: proc.stdout }).on("line", (line) => {
      let msg: { id: number } & TranscribeResult;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      const { id: _id, ...result } = msg;
      p.resolve(result as TranscribeResult);
    });
    createInterface({ input: proc.stderr }).on("line", (line) => {
      this.stderrTail.push(line);
      if (this.stderrTail.length > 20) this.stderrTail.shift();
    });
    const onGone = (why: string) => {
      if (this.proc !== proc) return;
      this.proc = null;
      const detail = this.stderrTail.filter(Boolean).at(-1);
      this.failAll(
        `The transcriber crashed (${why}${detail ? `: ${detail}` : ""}). The file may be too long for the run's memory.`,
      );
    };
    proc.on("exit", (code, signal) =>
      onGone(signal ? `signal ${signal}` : `exit code ${code}`),
    );
    proc.on("error", (e) => onGone(e.message));
    proc.stdin.on("error", () => {});
    return proc;
  }

  private failAll(error: string) {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, error, code: "internal" });
      this.pending.delete(id);
    }
  }

  transcribe: Transcribe = (req, timeoutMs) => {
    if (!this.proc) this.proc = this.start();
    const proc = this.proc;
    const id = this.nextId++;
    return new Promise<TranscribeResult>((resolve) => {
      const timer = setTimeout(() => {
        this.log(
          `Transcription timed out after ${timeoutMs / 1000} s; restarting the transcriber.`,
        );
        this.pending.delete(id);
        resolve({
          ok: false,
          error: `Transcription timed out after ${Math.round(timeoutMs / 1000)} s.`,
          code: "internal",
        });
        // The worker is stuck on this file: restart it.
        if (this.proc === proc) {
          this.proc = null;
          proc.kill("SIGKILL");
          this.failAll("The transcriber was restarted after a timeout.");
        }
      }, timeoutMs);
      this.pending.set(id, { resolve, timer });
      proc.stdin.write(JSON.stringify({ id, ...req }) + "\n");
    });
  };

  close() {
    const proc = this.proc;
    this.proc = null;
    if (proc) {
      proc.stdin.end();
      proc.kill();
    }
    this.failAll("The transcriber was closed.");
  }
}
