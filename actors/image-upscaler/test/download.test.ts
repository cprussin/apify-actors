import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { downloadToFile } from "../src/download.js";

const dir = mkdtempSync(join(tmpdir(), "upscale-dl-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const opts = { maxBytes: 1e8, timeoutMs: 5000, sleep: async () => {} };

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
        return res.writeHead(302, { location: "/files/photo%201.png" }).end();
      if (req.url === "/missing") return res.writeHead(404).end();
      if (req.url === "/slow") return void setTimeout(() => res.end(), 2000);
      res.writeHead(200, {
        "content-type": "image/png",
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
      const res = await downloadToFile(`${base}/old`, path, opts);
      expect(res).toMatchObject({
        bytes: body.length,
        contentType: "image/png",
        fileName: "photo 1.png",
      });
      expect(res.head).toHaveLength(4096);
      expect(readFileSync(path).equals(body)).toBe(true);
    }
  });

  it("reports HTTP errors and timeouts", async () => {
    await expect(
      downloadToFile(`${base}/missing`, join(dir, "m"), opts),
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
