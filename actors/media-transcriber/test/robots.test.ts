import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  downloadToFile,
  fetchText,
  RobotsBlockedError,
} from "../src/download.js";
import { RobotsGate, robotsFromResponse } from "../src/robots-gate.js";

/** feeds.megaphone.fm's robots.txt (2026-11): open `*`, AI bots named. */
const MEGAPHONE = `User-agent: CCBot
Disallow: /

User-agent: GPTBot
Disallow: /

User-agent: anthropic-ai
Disallow: /

User-agent: Claude-Web
Disallow: /

User-agent: *
Disallow:
`;

type Robots = { status: number; body?: string; type?: string } | Error;

/** A fetch that serves robots.txt per origin and counts requests. */
function robotsFetch(byOrigin: Record<string, Robots>) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL) => {
    const url = new URL(String(input));
    calls.push(url.href);
    const r = byOrigin[url.origin];
    if (!r || r instanceof Error) throw r ?? new Error("ENOTFOUND");
    return new Response(r.body ?? "", {
      status: r.status,
      headers: { "content-type": r.type ?? "text/plain" },
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("robotsFromResponse", () => {
  it("skips Claude groups, unverifiable files; 404 allows all", () => {
    expect(robotsFromResponse(200, "text/plain", MEGAPHONE)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(
        /Claude crawler \(anthropic-ai, claude-web\)/,
      ),
    });
    expect(
      robotsFromResponse(200, "text/plain", "User-agent: ClaudeBot\nAllow: /"),
    ).toMatchObject({ ok: false });
    expect(
      robotsFromResponse(
        200,
        "text/plain",
        "User-agent: Claude-User\nDisallow:",
      ),
    ).toMatchObject({ ok: false });
    expect(robotsFromResponse(403, "text/plain", "")).toMatchObject({
      ok: false,
      reason: "robots.txt returned HTTP 403",
    });
    expect(
      robotsFromResponse(200, "text/html", "<html>Just a moment</html>"),
    ).toMatchObject({ ok: false });
    expect(robotsFromResponse(404, "text/html", "<html>")).toMatchObject({
      ok: true,
    });
  });
});

describe("RobotsGate", () => {
  const { fetchImpl, calls } = robotsFetch({
    "https://feeds.megaphone.fm": { status: 200, body: MEGAPHONE },
    "https://star.example": {
      status: 200,
      body: "User-agent: *\nDisallow: /private/\nAllow: /private/ok$\n",
    },
    "https://open.example": { status: 200, body: "User-agent: *\nAllow: /\n" },
    "https://none.example": { status: 404 },
    "https://waf.example": { status: 403 },
    "https://html.example": {
      status: 200,
      type: "text/html",
      body: "<!doctype html><html>",
    },
    "https://down.example": new Error("ECONNREFUSED"),
  });
  const gate = new RobotsGate({ fetch: fetchImpl });

  it("skips hosts whose robots.txt names a Claude bot (megaphone)", async () => {
    expect(
      await gate.check("https://feeds.megaphone.fm/the-show"),
    ).toMatchObject({ allowed: false, reason: /anthropic-ai/ });
  });

  it("skips paths the * group disallows", async () => {
    expect(await gate.check("https://star.example/private/x")).toMatchObject({
      allowed: false,
      reason: "star.example: robots.txt disallows /private/x",
    });
    expect(await gate.check("https://star.example/private/ok")).toEqual({
      allowed: true,
    });
  });

  it("skips hosts whose robots.txt can't be verified", async () => {
    for (const host of ["waf", "html", "down"])
      expect(await gate.check(`https://${host}.example/a.mp3`)).toMatchObject({
        allowed: false,
      });
    await expect(gate.assert("https://waf.example/a.mp3")).rejects.toThrow(
      RobotsBlockedError,
    );
  });

  it("allows open hosts and a clean 404; caches per origin", async () => {
    expect(await gate.check("https://open.example/feed.xml")).toEqual({
      allowed: true,
    });
    expect(await gate.check("https://open.example/ep1.mp3?x=1")).toEqual({
      allowed: true,
    });
    expect(await gate.check("https://none.example/ep.mp3")).toEqual({
      allowed: true,
    });
    expect(
      calls.filter((c) => c === "https://open.example/robots.txt"),
    ).toHaveLength(1);
  });

  it("follows robots.txt redirects, across hosts too", async () => {
    const f = (async (input: string | URL) => {
      const u = new URL(String(input));
      if (u.href === "http://a.example/robots.txt")
        return new Response(null, {
          status: 301,
          headers: { location: "https://www.a.example/robots.txt" },
        });
      if (u.href === "https://www.a.example/robots.txt")
        return new Response("User-agent: *\nDisallow: /x", { status: 200 });
      if (u.href === "https://b.example/robots.txt")
        return new Response(null, {
          status: 302,
          headers: { location: "https://elsewhere.example/robots.txt" },
        });
      // Like podtrac.com -> analytics.podtrac.com (a file naming ClaudeBot).
      if (u.href === "https://elsewhere.example/robots.txt")
        return new Response("User-agent: ClaudeBot\nDisallow: /\n", {
          status: 200,
        });
      if (u.hostname === "loop.example")
        return new Response(null, {
          status: 301,
          headers: { location: `https://loop.example/r${Math.random()}` },
        });
      throw new Error(`unexpected ${u.href}`);
    }) as typeof fetch;
    const g = new RobotsGate({ fetch: f });
    expect(await g.check("http://a.example/ok")).toEqual({ allowed: true });
    expect(await g.check("http://a.example/x")).toMatchObject({
      allowed: false,
    });
    expect(await g.check("https://b.example/ok")).toMatchObject({
      allowed: false,
      reason: /claudebot/,
    });
    expect(await g.check("https://loop.example/ok")).toMatchObject({
      allowed: false,
      reason: /too often/,
    });
  });
});

/** Two local origins: `open` serves files, `claude` names ClaudeBot. */
describe("downloads behind the robots gate", () => {
  const dir = mkdtempSync(join(tmpdir(), "media-robots-"));
  const servers: Server[] = [];
  const hits: string[] = [];
  let open = "";
  let claude = "";
  const listen = (
    handler: (path: string) => {
      status: number;
      body?: string;
      location?: string;
    },
  ) =>
    new Promise<string>((resolve) => {
      const s = createServer((req, res) => {
        hits.push(`${(s.address() as AddressInfo).port}${req.url}`);
        const r = handler(req.url ?? "/");
        res.writeHead(r.status, r.location ? { location: r.location } : {});
        res.end(r.body ?? "");
      });
      servers.push(s);
      s.listen(0, "127.0.0.1", () =>
        resolve(`http://127.0.0.1:${(s.address() as AddressInfo).port}`),
      );
    });

  beforeAll(async () => {
    claude = await listen((p) =>
      p === "/robots.txt"
        ? { status: 200, body: "User-agent: ClaudeBot\nDisallow: /\n" }
        : { status: 200, body: "ID3 secret audio" },
    );
    open = await listen((p) => {
      if (p === "/robots.txt")
        return { status: 200, body: "User-agent: *\nDisallow: /private\n" };
      if (p === "/hop.mp3")
        return { status: 302, location: `${claude}/audio.mp3` };
      if (p === "/feed.xml") return { status: 200, body: "<rss></rss>" };
      return { status: 200, body: "ID3 audio" };
    });
  });
  afterAll(() => {
    for (const s of servers) s.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const opts = () => ({
    maxBytes: 1000,
    timeoutMs: 5000,
    sleep: async () => {},
    checkUrl: new RobotsGate().assert,
  });

  it("fetches allowed URLs", async () => {
    const res = await downloadToFile(`${open}/ep.mp3`, join(dir, "a"), opts());
    expect(res.bytes).toBe(9);
    expect(await fetchText(`${open}/feed.xml`, opts())).toBe("<rss></rss>");
  });

  it("refuses a disallowed path without requesting it", async () => {
    await expect(
      downloadToFile(`${open}/private/ep.mp3`, join(dir, "b"), opts()),
    ).rejects.toThrow(RobotsBlockedError);
    expect(hits).not.toContain(`${new URL(open).port}/private/ep.mp3`);
  });

  it("checks every redirect hop's host", async () => {
    await expect(
      downloadToFile(`${open}/hop.mp3`, join(dir, "c"), opts()),
    ).rejects.toThrow(/ClaudeBot|claudebot/);
    expect(hits).toContain(`${new URL(claude).port}/robots.txt`);
    expect(hits).not.toContain(`${new URL(claude).port}/audio.mp3`);
  });
});
