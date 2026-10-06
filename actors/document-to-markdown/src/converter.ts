import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { DocType } from "./detect.js";

export interface ConvertRequest {
  path: string;
  type: DocType;
  charset?: string | null;
  ocr: boolean;
  ocrLanguage: string;
  maxOcrPages: number;
  maxPages: number;
}

export interface PdfPage {
  text: string;
  ocr: boolean;
}

export type ConvertResult =
  | { ok: true; title: string | null; markdown: string }
  | {
      ok: true;
      title: string | null;
      pages: PdfPage[];
      pageCount: number;
      ocrSkipped: number;
    }
  | { ok: false; error: string };

export type Convert = (
  req: ConvertRequest,
  timeoutMs: number,
) => Promise<ConvertResult>;

/** python/convert.py, next to src/ and dist/. */
export const WORKER_SCRIPT = fileURLToPath(
  new URL("../python/convert.py", import.meta.url),
);

interface Pending {
  resolve: (r: ConvertResult) => void;
  timer: NodeJS.Timeout;
}

/**
 * A long-lived Python worker (markitdown, magika and pdfplumber take a few
 * seconds to import). Requests are answered in order. If the worker dies
 * (e.g. out of memory on a huge file) or times out, pending requests fail
 * and the next request starts a fresh worker.
 */
export class PythonWorker {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private stderrTail: string[] = [];

  constructor(
    private readonly python = process.env.DOC2MD_PYTHON ?? "python3",
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
      let msg: { id: number } & ConvertResult;
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
      p.resolve(result as ConvertResult);
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
        `The converter crashed (${why}${detail ? `: ${detail}` : ""}). The file may be too large for the run's memory.`,
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
      p.resolve({ ok: false, error });
      this.pending.delete(id);
    }
  }

  convert: Convert = (req, timeoutMs) => {
    if (!this.proc) this.proc = this.start();
    const proc = this.proc;
    const id = this.nextId++;
    return new Promise<ConvertResult>((resolve) => {
      const timer = setTimeout(() => {
        this.log(
          `Conversion timed out after ${timeoutMs / 1000} s; restarting the converter.`,
        );
        this.pending.delete(id);
        resolve({
          ok: false,
          error: `Conversion timed out after ${Math.round(timeoutMs / 1000)} s.`,
        });
        // The worker is stuck on this file: restart it.
        if (this.proc === proc) {
          this.proc = null;
          proc.kill("SIGKILL");
          this.failAll("The converter was restarted after a timeout.");
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
    this.failAll("The converter was closed.");
  }
}
