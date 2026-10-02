import { chromium, type Browser, type Route } from "playwright";
import type { RawFetch } from "./http.js";
import { BASE_URL } from "./page.js";

export interface SolverOptions {
  userAgent: string;
  /** Every browser request is sent through this (same exit IP as the HTTP client). */
  rawFetch: RawFetch;
  attempts?: number;
  timeoutMs?: number;
  log?: (msg: string) => void;
}

const DROP_RESPONSE_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
]);

/**
 * Launches headless Chromium. Apify's Playwright images ship full Chromium
 * (and Chrome) but not always the separate `chromium-headless-shell` binary
 * that Playwright's plain `headless: true` launch expects, so fall back to
 * the full-browser channels.
 */
export async function launchBrowser(
  log: (msg: string) => void = () => {},
): Promise<Browser> {
  const errors: string[] = [];
  for (const channel of [undefined, "chromium", "chrome"]) {
    try {
      return await chromium.launch({ headless: true, channel });
    } catch (e) {
      errors.push(
        `${channel ?? "headless-shell"}: ${(e as Error).message.split("\n")[0]}`,
      );
    }
  }
  log(`Browser launch failed: ${errors.join("; ")}`);
  throw new Error(`Could not launch a browser (${errors.join("; ")})`);
}

/**
 * Gets an AWS WAF token the way a real visitor does. Headless Chromium opens
 * a tiny same-origin page, loads the site's WAF challenge script and lets it
 * compute the token. The token is then sent as a cookie by the plain HTTP
 * client, so the browser runs for a few seconds per run, not per page.
 *
 * The browser does no networking itself: requests are intercepted and sent
 * through `rawFetch`, so the token is issued to the same IP (and proxy
 * session) that fetches the review pages.
 */
export function browserTokenSolver(opts: SolverOptions) {
  const log = opts.log ?? (() => {});
  const attempts = opts.attempts ?? 3;
  const timeoutMs = opts.timeoutMs ?? 30_000;

  const forward = async (route: Route) => {
    const req = route.request();
    try {
      const res = await opts.rawFetch(req.url(), {
        method: req.method(),
        headers: await req.allHeaders(),
        body: req.postDataBuffer(),
      });
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.headers)) {
        if (!DROP_RESPONSE_HEADERS.has(k)) headers[k] = v;
      }
      await route.fulfill({ status: res.status, headers, body: res.body });
    } catch {
      await route.abort("failed").catch(() => {});
    }
  };

  return async (challengeUrl: string): Promise<string> => {
    let lastError: Error | undefined;
    for (let i = 1; i <= attempts; i++) {
      const started = Date.now();
      const browser = await launchBrowser(log);
      try {
        const ctx = await browser.newContext({
          userAgent: opts.userAgent,
          locale: "en-US",
        });
        await ctx.route("**/*", forward);
        const page = await ctx.newPage();
        page.setDefaultTimeout(timeoutMs);
        await page.goto(`${BASE_URL}/robots.txt`, {
          waitUntil: "domcontentloaded",
        });
        await page.addScriptTag({ url: challengeUrl });
        const token = await page.evaluate(async () => {
          const waf = (
            globalThis as unknown as {
              AwsWafIntegration?: {
                getToken(): Promise<string>;
                forceRefreshToken(): Promise<string>;
              };
            }
          ).AwsWafIntegration;
          if (!waf) return "";
          for (let k = 0; k < 3; k++) {
            try {
              const t =
                k === 0 ? await waf.getToken() : await waf.forceRefreshToken();
              if (typeof t === "string" && t.trim()) return t;
            } catch {
              // try a forced refresh
            }
          }
          return "";
        });
        if (!token) throw new Error("WAF challenge returned no token");
        log(`Verification token obtained in ${Date.now() - started}ms.`);
        return token;
      } catch (e) {
        lastError = e as Error;
        log(
          `Verification attempt ${i}/${attempts} failed: ${lastError.message.split("\n")[0]}`,
        );
      } finally {
        await browser.close().catch(() => {});
      }
    }
    throw new Error(
      `Could not pass Trustpilot bot verification: ${lastError?.message.split("\n")[0]}`,
    );
  };
}
