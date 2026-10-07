import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  authHeaders,
  dispositionName,
  downloadToFile,
  fetchText,
  MediaError,
  urlFileName,
} from "../src/download.js";

const dir = mkdtempSync(join(tmpdir(), "media-dl-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const respond =
  (...responses: (Response | Error)[]): typeof fetch =>
  async () => {
    const r = responses.shift()!;
    if (r instanceof Error) throw r;
    return r;
  };
const opts = (fetchImpl: typeof fetch, maxBytes = 1000) => ({
  maxBytes,
  timeoutMs: 5000,
  fetchImpl,
  sleep: async () => {},
});

describe("downloadToFile", () => {
  it("streams the body to disk with its name and head", async () => {
    const path = join(dir, "a");
    const res = await downloadToFile(
      "https://x.org/files/ep%201.mp3?x=1",
      path,
      opts(
        respond(
          new Response("ID3 audio bytes", {
            headers: { "content-type": "audio/mpeg" },
          }),
        ),
      ),
    );
    expect(res).toMatchObject({
      bytes: 15,
      contentType: "audio/mpeg",
      fileName: "ep 1.mp3",
    });
    expect(res.head.toString()).toBe("ID3 audio bytes");
    expect(readFileSync(path, "utf8")).toBe("ID3 audio bytes");
  });

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
    ).rejects.toThrow(MediaError);
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

  it("fetches feeds as text", async () => {
    expect(
      await fetchText("https://x.org/f", opts(respond(new Response("<rss>")))),
    ).toBe("<rss>");
    await expect(
      fetchText(
        "https://x.org/f",
        opts(respond(new TypeError("fetch failed"), new TypeError("x"))),
      ),
    ).rejects.toThrow(/Fetching the feed failed/);
  });
});

describe("helpers", () => {
  it("reads file names", () => {
    expect(dispositionName("attachment; filename*=UTF-8''a%20b.mp3")).toBe(
      "a b.mp3",
    );
    expect(dispositionName('inline; filename="c.wav"')).toBe("c.wav");
    expect(urlFileName("https://x.org/")).toBeNull();
  });

  it("adds the token only to Apify record URLs", () => {
    expect(
      authHeaders(
        "https://api.apify.com/v2/key-value-stores/abc/records/a.mp3",
        "t",
      ),
    ).toEqual({ Authorization: "Bearer t" });
    expect(authHeaders("https://x.org/a.mp3", "t")).toEqual({});
  });
});
