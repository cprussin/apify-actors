import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  authHeaders,
  dispositionName,
  download,
  DocumentError,
  urlFileName,
} from "../src/download.js";

let server: Server;
let base: string;
let flaky = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    switch (req.url) {
      case "/doc.pdf":
        res.writeHead(200, {
          "Content-Type": "application/pdf",
          "Content-Disposition":
            "attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf",
        });
        res.end("%PDF-1.4 tiny");
        return;
      case "/missing":
        res.writeHead(404);
        res.end();
        return;
      case "/big-declared":
        res.writeHead(200, { "Content-Length": String(5 * 1024 * 1024) });
        res.end();
        return;
      case "/big-streamed":
        // Chunked, no Content-Length.
        res.writeHead(200);
        for (let i = 0; i < 40; i++) res.write(Buffer.alloc(64 * 1024));
        res.end();
        return;
      case "/flaky":
        flaky += 1;
        if (flaky === 1) {
          res.writeHead(503);
          res.end();
        } else {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("ok");
        }
        return;
      case "/slow":
        setTimeout(() => res.end("late"), 2000);
        return;
      default:
        res.writeHead(500);
        res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

const opts = {
  maxBytes: 1024 * 1024,
  timeoutMs: 5000,
  sleep: async () => {},
};

describe("download", () => {
  it("returns the body, content type and file name", async () => {
    const f = await download(`${base}/doc.pdf`, opts);
    expect(f.body.toString()).toBe("%PDF-1.4 tiny");
    expect(f.contentType).toBe("application/pdf");
    expect(f.fileName).toBe("résumé.pdf");
  });

  it("reports HTTP errors without retrying 4xx", async () => {
    await expect(download(`${base}/missing`, opts)).rejects.toThrow(/HTTP 404/);
  });

  it("enforces the size limit from Content-Length and while streaming", async () => {
    await expect(download(`${base}/big-declared`, opts)).rejects.toThrow(
      /5 MB, over the 1 MB limit/,
    );
    await expect(download(`${base}/big-streamed`, opts)).rejects.toThrow(
      DocumentError,
    );
  });

  it("retries 5xx once", async () => {
    const f = await download(`${base}/flaky`, opts);
    expect(f.body.toString()).toBe("ok");
    expect(flaky).toBe(2);
  });

  it("times out", async () => {
    await expect(
      download(`${base}/slow`, { ...opts, timeoutMs: 200, attempts: 1 }),
    ).rejects.toThrow(/timed out/);
  });
});

describe("helpers", () => {
  it("parses file names", () => {
    expect(dispositionName('inline; filename="a b.docx"')).toBe("a b.docx");
    expect(dispositionName(null)).toBeNull();
    expect(urlFileName("https://x.org/files/My%20Deck.pptx?dl=1")).toBe(
      "My Deck.pptx",
    );
    expect(urlFileName("https://x.org/")).toBeNull();
  });

  it("sends the token only to Apify key-value store record URLs", () => {
    const rec =
      "https://api.apify.com/v2/key-value-stores/abc/records/file.pdf";
    expect(authHeaders(rec, "t")).toEqual({ Authorization: "Bearer t" });
    expect(authHeaders(rec, undefined)).toEqual({});
    expect(authHeaders("https://api.apify.com/v2/acts", "t")).toEqual({});
    expect(
      authHeaders("https://evil.example/v2/key-value-stores/a/records/b", "t"),
    ).toEqual({});
  });
});
