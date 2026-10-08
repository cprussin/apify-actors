import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  authHeaders,
  dispositionName,
  downloadToFile,
  urlFileName,
  VideoError,
} from "../src/download.js";

const dir = mkdtempSync(join(tmpdir(), "frames-dl-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const respond =
  (...responses: (Response | Error)[]): typeof fetch =>
  async () => {
    const r = responses.shift()!;
    if (r instanceof Error) throw r;
    return r;
  };
const opts = (fetchImpl?: typeof fetch, maxBytes = 1000) => ({
  maxBytes,
  timeoutMs: 5000,
  fetchImpl,
  sleep: async () => {},
});

describe("downloadToFile", () => {
  it("enforces the size limit from the header and the stream", async () => {
    await expect(
      downloadToFile(
        "https://x.org/a",
        join(dir, "b"),
        opts(
          respond(
            new Response("x", { headers: { "content-length": "5000000" } }),
          ),
        ),
      ),
    ).rejects.toThrow(/4.8 MB, over the 0 MB limit/);
    await expect(
      downloadToFile(
        "https://x.org/a",
        join(dir, "c"),
        opts(respond(new Response("x".repeat(2000))), 1000),
      ),
    ).rejects.toThrow(VideoError);
  });

  it("retries transient errors, not 404", async () => {
    const res = await downloadToFile(
      "https://x.org/a",
      join(dir, "d"),
      opts(
        respond(
          new Response("busy", { status: 503 }),
          new Response("ok", { status: 200 }),
        ),
      ),
    );
    expect(res.bytes).toBe(2);
    await expect(
      downloadToFile(
        "https://x.org/a",
        join(dir, "e"),
        opts(respond(new Response("no", { status: 404 }))),
      ),
    ).rejects.toThrow("Download failed: HTTP 404.");
  });
});

// A server that closes the connection after each response, like Python's
// http.server: Node 22.23's built-in fetch crashes the process on these.
describe("downloadToFile over HTTP", () => {
  let server: Server;
  let base: string;
  const body = Buffer.alloc(8 * 1024 * 1024, 7);

  beforeAll(async () => {
    server = createServer((req, res) => {
      res.shouldKeepAlive = false;
      if (req.url === "/old")
        return res.writeHead(302, { location: "/files/clip%201.mp4" }).end();
      if (req.url === "/missing") return res.writeHead(404).end();
      if (req.url === "/slow") return void setTimeout(() => res.end(), 2000);
      res.writeHead(200, {
        "content-type": "video/mp4",
        "content-length": body.length,
        connection: "close",
      });
      res.end(body);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => server?.close());

  it("follows redirects and streams the body to disk", async () => {
    // The crash is timing-dependent; several downloads make it near-certain.
    const path = join(dir, "h");
    for (let i = 0; i < 10; i++) {
      const res = await downloadToFile(
        `${base}/old`,
        path,
        opts(undefined, 1e8),
      );
      expect(res).toMatchObject({
        bytes: body.length,
        contentType: "video/mp4",
        fileName: "clip 1.mp4",
      });
      expect(res.head).toHaveLength(4096);
      expect(readFileSync(path).equals(body)).toBe(true);
    }
  });

  it("reports HTTP errors and timeouts", async () => {
    await expect(
      downloadToFile(`${base}/missing`, join(dir, "m"), opts(undefined, 1e8)),
    ).rejects.toThrow("Download failed: HTTP 404 Not Found.");
    await expect(
      downloadToFile(`${base}/slow`, join(dir, "s"), {
        maxBytes: 1e8,
        timeoutMs: 200,
        attempts: 1,
      }),
    ).rejects.toThrow("Download timed out after 0.2 s.");
  });
});

describe("helpers", () => {
  it("reads file names", () => {
    expect(dispositionName("attachment; filename*=UTF-8''a%20b.mp4")).toBe(
      "a b.mp4",
    );
    expect(dispositionName('inline; filename="c.mov"')).toBe("c.mov");
    expect(urlFileName("https://x.org/")).toBeNull();
  });

  it("adds the token only to Apify record URLs", () => {
    expect(
      authHeaders(
        "https://api.apify.com/v2/key-value-stores/abc/records/a.mp4",
        "t",
      ),
    ).toEqual({ Authorization: "Bearer t" });
    expect(authHeaders("https://x.org/a.mp4", "t")).toEqual({});
  });
});
