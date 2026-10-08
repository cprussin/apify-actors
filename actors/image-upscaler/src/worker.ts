import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { OutputFormat, Scale } from "./input.js";

export type ErrorCode = "decode" | "too_large" | "internal";
export type Failure = { ok: false; error: string; code: ErrorCode };

export type ProbeResult =
  | {
      ok: true;
      format: string | null;
      /** After EXIF orientation. */
      width: number;
      height: number;
      frames: number;
    }
  | Failure;

export interface UpscaleRequest {
  path: string;
  outPath: string;
  scale: Scale;
  format: OutputFormat;
  quality: number;
  threads: number;
  maxPixels: number;
}

export type UpscaleResult =
  | {
      ok: true;
      inputWidth: number;
      inputHeight: number;
      outputWidth: number;
      outputHeight: number;
      outputBytes: number;
      hasAlpha: boolean;
      seconds: number;
      cpuSeconds: number;
      warnings: string[];
    }
  | Failure;

export type Probe = (path: string) => Promise<ProbeResult>;
export type Upscale = (
  req: UpscaleRequest,
  timeoutMs: number,
) => Promise<UpscaleResult>;

/** python/upscale.py, next to src/ and dist/. */
export const WORKER_SCRIPT = fileURLToPath(
  new URL("../python/upscale.py", import.meta.url),
);

const PROBE_TIMEOUT_MS = 60_000;

interface Pending {
  resolve: (r: ProbeResult | UpscaleResult) => void;
  timer: NodeJS.Timeout;
}

/**
 * A long-lived Python worker (keeps the model loaded between images).
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
    private readonly python = process.env.UPSCALER_PYTHON ?? "python3",
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
      let msg: { id: number } & (ProbeResult | UpscaleResult);
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
      p.resolve(result as ProbeResult | UpscaleResult);
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
        `The upscaler crashed (${why}${detail ? `: ${detail}` : ""}). The image may be too large for the run's memory.`,
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

  private call<T extends ProbeResult | UpscaleResult>(
    req: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<T> {
    if (!this.proc) this.proc = this.start();
    const proc = this.proc;
    const id = this.nextId++;
    return new Promise<T>((resolve) => {
      const timer = setTimeout(() => {
        this.log(
          `Upscaling timed out after ${timeoutMs / 1000} s; restarting the upscaler.`,
        );
        this.pending.delete(id);
        resolve({
          ok: false,
          error: `Upscaling timed out after ${Math.round(timeoutMs / 1000)} s.`,
          code: "internal",
        } as T);
        // The worker is stuck on this image: restart it.
        if (this.proc === proc) {
          this.proc = null;
          proc.kill("SIGKILL");
          this.failAll("The upscaler was restarted after a timeout.");
        }
      }, timeoutMs);
      this.pending.set(id, {
        resolve: resolve as (r: ProbeResult | UpscaleResult) => void,
        timer,
      });
      proc.stdin.write(JSON.stringify({ id, ...req }) + "\n");
    });
  }

  probe: Probe = (path) => this.call({ op: "probe", path }, PROBE_TIMEOUT_MS);

  upscale: Upscale = (req, timeoutMs) =>
    this.call({ op: "upscale", ...req }, timeoutMs);

  close() {
    const proc = this.proc;
    this.proc = null;
    if (proc) {
      proc.stdin.end();
      proc.kill();
    }
    this.failAll("The upscaler was closed.");
  }
}
