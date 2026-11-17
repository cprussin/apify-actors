import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  authHeaders,
  downloadToFile,
  isPrivateAddress,
} from "../src/download.js";

const dir = mkdtempSync(join(tmpdir(), "media-dl-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const opts = {
  maxBytes: 1e8,
  timeoutMs: 5000,
  sleep: async () => {},
  allowPrivate: true,
};

describe("downloadToFile over HTTP", () => {
  let server: Server;
  let base: string;
  const body = Buffer.alloc(2 * 1024 * 1024, 7);

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
    const path = join(dir, "h");
    const res = await downloadToFile(`${base}/old`, path, opts);
    expect(res).toMatchObject({
      bytes: body.length,
      contentType: "video/mp4",
      fileName: "clip 1.mp4",
    });
    expect(res.head).toHaveLength(4096);
    expect(readFileSync(path).equals(body)).toBe(true);
  });

  it("enforces the size limit", async () => {
    await expect(
      downloadToFile(`${base}/big`, join(dir, "b"), {
        ...opts,
        maxBytes: 1000,
      }),
    ).rejects.toThrow(/over the 0 MB limit \(maxFileSizeMb\)/);
  });

  it("reports HTTP errors and timeouts", async () => {
    await expect(
      downloadToFile(`${base}/missing`, join(dir, "m"), opts),
    ).rejects.toThrow("Download failed: HTTP 404 Not Found.");
    await expect(
      downloadToFile(`${base}/slow`, join(dir, "s"), {
        ...opts,
        timeoutMs: 200,
        attempts: 1,
      }),
    ).rejects.toThrow("Download timed out after 0.2 s.");
  });

  it("refuses private addresses without retrying", async () => {
    let slept = 0;
    await expect(
      downloadToFile(`${base}/old`, join(dir, "p"), {
        maxBytes: 1e8,
        timeoutMs: 5000,
        sleep: async () => void slept++,
      }),
    ).rejects.toThrow(/127\.0\.0\.1 is a private or internal address/);
    expect(slept).toBe(0);
    await expect(
      downloadToFile("http://localhost:1/x.mp4", join(dir, "l"), {
        maxBytes: 1e8,
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(/private or internal/);
  });
});

describe("isPrivateAddress", () => {
  it("flags loopback, private, link-local and mapped addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:10.0.0.1",
    ])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "93.184.216.34", "2606:4700::1111"])
      expect(isPrivateAddress(ip), ip).toBe(false);
  });
});

describe("authHeaders", () => {
  it("adds the token only to Apify key-value store record URLs", () => {
    expect(
      authHeaders(
        "https://api.apify.com/v2/key-value-stores/abc/records/x.mp4",
        "t",
      ),
    ).toEqual({ Authorization: "Bearer t" });
    expect(authHeaders("https://example.com/x.mp4", "t")).toEqual({});
    expect(
      authHeaders(
        "https://api.apify.com/v2/key-value-stores/abc/records/x.mp4",
        undefined,
      ),
    ).toEqual({});
  });
});
