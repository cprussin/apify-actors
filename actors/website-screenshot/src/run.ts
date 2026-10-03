import {
  lighterWaitUntil,
  type Format,
  type NormalizedInput,
  type Target,
  type WaitUntil,
} from "./input.js";
import { CONTENT_TYPES, imageSize, recordKey } from "./keys.js";

/** Navigation timed out; retried once with a lighter waitUntil. */
export class NavigationTimeoutError extends Error {
  override name = "NavigationTimeoutError";
}

/** One captured page, as returned by the browser layer. */
export interface Shot {
  body: Buffer;
  /** Actual format (WebP falls back to PNG for very tall pages). */
  format: Format;
  finalUrl: string | null;
  status: number | null;
  title: string | null;
  /** Page size in CSS px (used for PDFs; images are measured from the file). */
  width: number | null;
  height: number | null;
}

export interface ScreenshotResult {
  url: string;
  finalUrl: string | null;
  status: number | null;
  screenshotKey: string | null;
  screenshotUrl: string | null;
  format: Format;
  device: string;
  width: number | null;
  height: number | null;
  bytes: number | null;
  title: string | null;
  loadTimeMs: number | null;
  waitUntil: WaitUntil | null;
  error: string | null;
  capturedAt: string;
}

export interface RunDeps {
  /** Load `url` and capture it (throws on failure). */
  capture: (url: string, waitUntil: WaitUntil) => Promise<Shot>;
  /** Store a file; returns its public URL. */
  save: (key: string, body: Buffer, contentType: string) => Promise<string>;
  /**
   * Push one item, charging for it when `charge` is true (successful
   * screenshots only). `pushed: false` when the budget was already used up;
   * `more: false` to stop (charge limit reached).
   */
  emit: (item: ScreenshotResult, charge: boolean) => Promise<EmitResult>;
  log?: (msg: string) => void;
  now?: () => Date;
  clock?: () => number;
}

export interface EmitResult {
  pushed: boolean;
  more: boolean;
}

export interface RunStats {
  captured: number;
  failed: number;
  retried: number;
  skipped: number;
  stopReason: "done" | "budget";
}

const errMsg = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 300);

/** Map with at most `limit` calls in flight. `fn` returning false stops. */
export async function forEachLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<boolean>,
): Promise<number> {
  let next = 0;
  let stopped = false;
  const worker = async () => {
    while (!stopped && next < items.length) {
      const item = items[next++]!;
      if (!(await fn(item))) stopped = true;
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return items.length - next;
}

export async function runScreenshots(
  input: NormalizedInput,
  deps: RunDeps,
): Promise<RunStats> {
  const log = deps.log ?? (() => {});
  const now = deps.now ?? (() => new Date());
  const clock = deps.clock ?? (() => Date.now());
  const stats: RunStats = {
    captured: 0,
    failed: 0,
    retried: 0,
    skipped: 0,
    stopReason: "done",
  };

  const failure = async (
    t: Target,
    error: string,
    loadTimeMs: number | null,
  ) => {
    stats.failed += 1;
    log(`${t.input}: ${error}`);
    const item: ScreenshotResult = {
      url: t.url ?? t.input,
      finalUrl: null,
      status: null,
      screenshotKey: null,
      screenshotUrl: null,
      format: input.format,
      device: input.device,
      width: null,
      height: null,
      bytes: null,
      title: null,
      loadTimeMs,
      waitUntil: null,
      error,
      capturedAt: now().toISOString(),
    };
    return (await deps.emit(item, false)).more;
  };

  const one = async (t: Target): Promise<boolean> => {
    if (!t.url) return failure(t, t.error ?? "Invalid URL.", null);
    let waitUntil: WaitUntil = input.waitUntil;
    let started = clock();
    let shot: Shot;
    try {
      try {
        shot = await deps.capture(t.url, waitUntil);
      } catch (e) {
        const lighter = lighterWaitUntil(waitUntil);
        if (!(e instanceof NavigationTimeoutError) || !lighter) throw e;
        stats.retried += 1;
        log(`${t.url}: ${errMsg(e)}; retrying with waitUntil "${lighter}".`);
        waitUntil = lighter;
        started = clock();
        shot = await deps.capture(t.url, waitUntil);
      }
    } catch (e) {
      return failure(t, errMsg(e), clock() - started);
    }
    const loadTimeMs = clock() - started;
    const key = recordKey(t.index, t.url, shot.format);
    let screenshotUrl: string;
    try {
      screenshotUrl = await deps.save(
        key,
        shot.body,
        CONTENT_TYPES[shot.format],
      );
    } catch (e) {
      return failure(t, `Saving the screenshot failed: ${errMsg(e)}`, null);
    }
    const size = shot.format === "pdf" ? null : imageSize(shot.body);
    const res = await deps.emit(
      {
        url: t.url,
        finalUrl: shot.finalUrl,
        status: shot.status,
        screenshotKey: key,
        screenshotUrl,
        format: shot.format,
        device: input.device,
        width: size?.width ?? shot.width,
        height: size?.height ?? shot.height,
        bytes: shot.body.length,
        title: shot.title,
        loadTimeMs,
        waitUntil,
        error: null,
        capturedAt: now().toISOString(),
      },
      true,
    );
    if (res.pushed) stats.captured += 1;
    return res.more;
  };

  stats.skipped = await forEachLimit(
    input.targets,
    input.maxConcurrency,
    async (t) => {
      const more = await one(t);
      if (!more) stats.stopReason = "budget";
      return more;
    },
  );
  return stats;
}
