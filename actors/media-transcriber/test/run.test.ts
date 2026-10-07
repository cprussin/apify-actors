import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { MediaError, type Downloaded } from "../src/download.js";
import { normalizeInput, type RawInput } from "../src/input.js";
import {
  billableMinutes,
  runTranscriptions,
  seenId,
  type Job,
  type OutputItem,
  type RunDeps,
} from "../src/run.js";
import { Seen } from "../src/state.js";
import type { TranscribeRequest, TranscribeResult } from "../src/worker.js";

const FEED = `<rss><channel><title>Pod</title>
<item><title>New</title><guid>g2</guid><pubDate>Wed, 01 Oct 2026 00:00:00 GMT</pubDate><enclosure url="https://x.org/ep2.mp3" type="audio/mpeg"/></item>
<item><title>Old</title><guid>g1</guid><pubDate>Mon, 01 Sep 2026 00:00:00 GMT</pubDate><enclosure url="https://x.org/ep1.mp3" type="audio/mpeg"/></item>
<item><title>Long</title><guid>g0</guid><pubDate>Fri, 01 Aug 2026 00:00:00 GMT</pubDate><enclosure url="https://x.org/ep0.mp3" type="audio/mpeg"/><itunes:duration>5:00:00</itunes:duration></item>
</channel></rss>`;

/** Fake media: the body says how long it is and what it says. */
const media: Record<string, string | Error> = {
  "https://x.org/a.mp3": "ID3 65|Hello there. General Kenobi.",
  "https://x.org/b.mp4": "ftyp 30|Second file.",
  "https://x.org/silent.wav": "RIFF 10|",
  "https://x.org/page": "<!doctype html><html>",
  "https://x.org/404.mp3": new MediaError("Download failed: HTTP 404."),
  "https://x.org/ep2.mp3": "ID3 120|Episode two.",
  "https://x.org/ep1.mp3": "ID3 59|Episode one.",
  "https://x.org/huge.mp3": "ID3 600|Too long for the budget.",
  "abc/rec.wav": "RIFF 5|From a record.",
};

function harness(raw: RawInput, opts: { budget?: number; seen?: Seen } = {}) {
  const items: OutputItem[] = [];
  const charges: number[] = [];
  const requests: TranscribeRequest[] = [];
  const files: Record<string, string> = {};
  let budget = opts.budget ?? Infinity;
  let saves = 0;
  const deps: RunDeps = {
    fetchFeed: async (url) => {
      if (url.includes("bad"))
        throw new MediaError("Fetching the feed failed: HTTP 500.");
      if (url.includes("page")) return "<html><body>not a feed";
      return FEED;
    },
    download: async (job: Job, path) => {
      const m = media[job.kind === "kv" ? job.input : job.url];
      if (m === undefined) throw new Error("no such file");
      if (m instanceof Error) throw m;
      await writeFile(path, m);
      return {
        path,
        bytes: m.length,
        head: Buffer.from(m),
        contentType: null,
        fileName: job.kind === "kv" ? job.key : job.url.split("/").pop()!,
      } satisfies Downloaded;
    },
    transcribe: async (req): Promise<TranscribeResult> => {
      requests.push(req);
      const { readFile } = await import("node:fs/promises");
      const [head, text] = (await readFile(req.path, "utf8")).split("|");
      const duration = Number(head!.split(" ")[1]);
      if (duration > req.maxSeconds)
        return { ok: false, error: "too long", code: "too_long", duration };
      if (
        req.budgetMinutes !== null &&
        billableMinutes(duration) > req.budgetMinutes
      )
        return {
          ok: false,
          error: "Not transcribed: budget",
          code: "budget",
          duration,
        };
      const words = text!.split(". ").filter(Boolean);
      return {
        ok: true,
        language: text ? "en" : null,
        languageProbability: text ? 0.9 : null,
        duration,
        segments: words.map((w, i) => ({
          start: i * 2,
          end: i * 2 + 2,
          text: w.endsWith(".") ? w : `${w}.`,
        })),
        warnings: [],
      };
    },
    budgetMinutes: () => budget,
    emit: async (batch, minutes) => {
      if (minutes > 0) {
        if (budget < minutes) return { pushed: false, more: false };
        budget -= minutes;
        charges.push(minutes);
      }
      items.push(...batch);
      return { pushed: true, more: budget >= 1 };
    },
    saveFile: async (key, text) => {
      files[key] = text;
      return `https://kv/${key}`;
    },
    seen: opts.seen,
    saveState: async () => {
      saves += 1;
    },
    threads: 1,
    now: () => new Date("2026-10-07T00:00:00Z"),
  };
  return {
    deps,
    items,
    charges,
    requests,
    files,
    saves: () => saves,
    input: normalizeInput(raw),
  };
}

describe("runTranscriptions", () => {
  it("transcribes files and records free failures", async () => {
    const h = harness({
      urls: [
        "https://x.org/a.mp3",
        "https://x.org/404.mp3",
        "https://x.org/page",
        "https://x.org/silent.wav",
        "https://youtube.com/watch?v=1",
      ],
      keyValueStoreRecords: ["abc/rec.wav"],
      language: "en",
    });
    const stats = await runTranscriptions(h.input, h.deps);
    expect(stats).toMatchObject({
      transcribed: 2,
      failed: 4,
      billedMinutes: 3,
      stopReason: "done",
    });
    expect(h.charges.sort()).toEqual([1, 2]);
    const by = Object.fromEntries(h.items.map((i) => [i.url, i]));
    expect(by["https://x.org/a.mp3"]).toMatchObject({
      sourceType: "url",
      title: "a.mp3",
      language: "en",
      durationSeconds: 65,
      billedMinutes: 2,
      text: "Hello there. General Kenobi.",
      segmentCount: 2,
      wordCount: 4,
      srtUrl: "https://kv/transcript-0001.srt",
      vttUrl: "https://kv/transcript-0001.vtt",
      error: null,
    });
    expect(by["https://x.org/a.mp3"]!.segments).toHaveLength(2);
    expect(h.files["transcript-0001.srt"]).toContain(
      "00:00:00,000 --> 00:00:02,000\nHello there.",
    );
    expect(h.files["transcript-0001.vtt"]).toMatch(/^WEBVTT/);
    expect(by["abc/rec.wav"]).toMatchObject({
      sourceType: "kv",
      billedMinutes: 1,
    });
    expect(by["https://x.org/404.mp3"]!.error).toBe(
      "Download failed: HTTP 404.",
    );
    expect(by["https://x.org/page"]!.error).toMatch(/web page/);
    expect(by["https://x.org/silent.wav"]).toMatchObject({
      error: "No speech detected.",
      billedMinutes: 0,
      durationSeconds: 10,
    });
    expect(by["https://youtube.com/watch?v=1"]!.error).toMatch(/YouTube/);
    expect(h.requests[0]).toMatchObject({
      model: "base",
      language: "en",
      threads: 1,
      maxSeconds: 10800,
      budgetMinutes: null,
    });
  });

  it("expands feeds, newest first, capped and pre-checked", async () => {
    const h = harness({
      rssFeeds: [
        "https://feeds.x.org/pod.xml",
        "https://feeds.x.org/bad.xml",
        "https://feeds.x.org/page",
      ],
      maxEpisodes: 3,
    });
    const stats = await runTranscriptions(h.input, h.deps);
    expect(stats).toMatchObject({ feeds: 3, episodes: 3, transcribed: 2 });
    const ok = h.items.filter((i) => !i.error);
    expect(ok.map((i) => i.title).sort()).toEqual(["New", "Old"]);
    expect(ok[0]).toMatchObject({
      sourceType: "rss",
      feedUrl: "https://feeds.x.org/pod.xml",
      podcastTitle: "Pod",
    });
    const errors = Object.fromEntries(
      h.items.filter((i) => i.error).map((i) => [i.title ?? i.url, i.error]),
    );
    expect(errors["Long"]).toMatch(/300.0 min long \(per the feed\)/);
    expect(errors["https://feeds.x.org/bad.xml"]).toMatch(/HTTP 500/);
    expect(errors["https://feeds.x.org/page"]).toMatch(/web page/);
  });

  it("only new episodes: skips seen ones and records new ones", async () => {
    const seen = new Seen();
    seen.add(seenId("https://feeds.x.org/pod.xml", "g1"));
    const h = harness(
      {
        rssFeeds: ["https://feeds.x.org/pod.xml"],
        maxEpisodes: 2,
        onlyNewEpisodes: true,
      },
      { seen },
    );
    const stats = await runTranscriptions(h.input, h.deps);
    expect(stats).toMatchObject({ transcribed: 1, skippedSeen: 1 });
    expect(h.items.map((i) => i.title)).toEqual(["New"]);
    expect(seen.has(seenId("https://feeds.x.org/pod.xml", "g2"))).toBe(true);
    expect(h.saves()).toBe(1);
  });

  it("emits RAG chunks with times, billing the first chunk", async () => {
    const h = harness({
      urls: ["https://x.org/a.mp3"],
      outputFormat: "chunks",
      chunkSize: 200,
      chunkOverlap: 0,
    });
    await runTranscriptions(h.input, h.deps);
    expect(h.items).toHaveLength(1);
    expect(h.items[0]).toMatchObject({
      chunkIndex: 0,
      chunkCount: 1,
      startTime: 0,
      endTime: 4,
      segments: null,
      billedMinutes: 2,
      srtUrl: "https://kv/transcript-0001.srt",
    });
  });

  it("skips files the budget can't pay for, then stops", async () => {
    const h = harness(
      {
        urls: [
          "https://x.org/huge.mp3",
          "https://x.org/a.mp3",
          "https://x.org/b.mp4",
        ],
      },
      { budget: 3 },
    );
    const stats = await runTranscriptions(h.input, h.deps);
    expect(stats).toMatchObject({
      transcribed: 2,
      skippedBudget: 1,
      billedMinutes: 3,
      stopReason: "budget",
    });
    expect(h.charges).toEqual([2, 1]);
    expect(h.items[0]).toMatchObject({
      url: "https://x.org/huge.mp3",
      billedMinutes: 0,
      error: "Not transcribed: budget",
    });
  });

  it("stops before downloading when the budget is gone", async () => {
    const h = harness(
      { urls: ["https://x.org/a.mp3", "https://x.org/b.mp4"] },
      { budget: 0 },
    );
    const stats = await runTranscriptions(h.input, h.deps);
    expect(stats).toMatchObject({ transcribed: 0, stopReason: "budget" });
    expect(h.requests).toHaveLength(0);
  });

  it("bills started minutes", () => {
    expect(billableMinutes(0.5)).toBe(1);
    expect(billableMinutes(60)).toBe(1);
    expect(billableMinutes(60.001)).toBe(2);
  });
});
