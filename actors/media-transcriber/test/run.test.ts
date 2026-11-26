import { readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  MediaError,
  RobotsBlockedError,
  type Downloaded,
} from "../src/download.js";
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

const dataset = JSON.parse(
  await readFile(new URL("fixtures/dataset.json", import.meta.url), "utf8"),
) as unknown[];

const FEED = `<rss><channel><title>Pod</title>
<item><title>New</title><guid>g2</guid><pubDate>Wed, 01 Oct 2026 00:00:00 GMT</pubDate><enclosure url="https://x.org/ep2.mp3" type="audio/mpeg"/></item>
<item><title>Old</title><guid>g1</guid><pubDate>Mon, 01 Sep 2026 00:00:00 GMT</pubDate><enclosure url="https://x.org/ep1.mp3" type="audio/mpeg"/></item>
<item><title>Long</title><guid>g0</guid><pubDate>Fri, 01 Aug 2026 00:00:00 GMT</pubDate><enclosure url="https://x.org/ep0.mp3" type="audio/mpeg"/><itunes:duration>5:00:00</itunes:duration></item>
</channel></rss>`;

/** Episodes with <podcast:transcript> links (best first after parsing). */
const PUB_FEED = `<rss xmlns:podcast="https://podcastindex.org/namespace/1.0"><channel><title>Pub</title><language>en-us</language>
<item><title>Vtt</title><guid>p3</guid><pubDate>Wed, 01 Oct 2026 00:00:00 GMT</pubDate><enclosure url="https://x.org/p3.mp3" type="audio/mpeg"/><itunes:duration>5:00:00</itunes:duration>
<podcast:transcript url="https://t.org/p3.txt" type="text/plain"/>
<podcast:transcript url="https://t.org/p3.vtt" type="text/vtt" language="de"/></item>
<item><title>Broken</title><guid>p2</guid><pubDate>Mon, 01 Sep 2026 00:00:00 GMT</pubDate><enclosure url="https://x.org/ep1.mp3" type="audio/mpeg"/>
<podcast:transcript url="https://t.org/missing.vtt" type="text/vtt"/>
<podcast:transcript url="https://blocked.org/p2.srt" type="application/srt"/></item>
<item><title>Plain</title><guid>p1</guid><pubDate>Fri, 01 Aug 2026 00:00:00 GMT</pubDate><enclosure url="https://x.org/ep2.mp3" type="audio/mpeg"/>
<podcast:transcript url="https://t.org/p1.html" type="text/html"/></item>
<item><title>None</title><guid>p0</guid><pubDate>Thu, 01 Jan 2026 00:00:00 GMT</pubDate><enclosure url="https://megaphone.org/ep.mp3" type="audio/mpeg"/></item>
</channel></rss>`;

const transcripts: Record<string, string | Error> = {
  "https://t.org/p3.vtt":
    "WEBVTT\n\n00:00:00.000 --> 00:00:04.000\n<v Ann>Hallo zusammen.\n\n00:00:04.000 --> 00:09:30.500\nWillkommen.\n",
  "https://t.org/p3.txt": "should not be used",
  "https://t.org/missing.vtt": new MediaError(
    "Fetching the transcript failed: HTTP 404.",
  ),
  "https://blocked.org/p2.srt": new RobotsBlockedError(
    "Skipped (robots.txt): blocked.org: robots.txt disallows /p2.srt.",
  ),
  "https://t.org/p1.html":
    "<html><body><p>First paragraph.</p><p>Second one.</p></body></html>",
};

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
  "https://megaphone.org/ep.mp3": new RobotsBlockedError(
    "Skipped (robots.txt): megaphone.org: robots.txt has a group for a Claude crawler (anthropic-ai).",
  ),
};

function harness(
  raw: RawInput,
  opts: { budget?: number; seen?: Seen; slow?: string } = {},
) {
  const items: OutputItem[] = [];
  const charges: number[] = [];
  const published: string[] = [];
  const transcriptFetches: string[] = [];
  const requests: TranscribeRequest[] = [];
  const files: Record<string, string> = {};
  let budget = opts.budget ?? Infinity;
  let saves = 0;
  const deps: RunDeps = {
    fetchFeed: async (url) => {
      if (url.includes("megaphone"))
        throw new RobotsBlockedError(
          "Skipped (robots.txt): feeds.megaphone.fm: robots.txt has a group for a Claude crawler (anthropic-ai, claude-web).",
        );
      if (url.includes("pub")) return PUB_FEED;
      if (url.includes("bad"))
        throw new MediaError("Fetching the feed failed: HTTP 500.");
      if (url.includes("page")) return "<html><body>not a feed";
      return FEED;
    },
    fetchTranscript: async (url) => {
      transcriptFetches.push(url);
      const t = transcripts[url];
      if (t === undefined) throw new Error("no such transcript");
      if (t instanceof Error) throw t;
      return { text: t, contentType: null };
    },
    download: async (job: Job, path) => {
      const m = media[job.kind === "kv" ? job.input : job.url];
      if (m === undefined) throw new Error("no such file");
      if (m instanceof Error) throw m;
      if (job.kind !== "kv" && job.url === opts.slow)
        await new Promise((r) => setTimeout(r, 50));
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
    emit: async (batch, minutes, pub) => {
      if (pub) {
        if (budget < 1) return { pushed: false, more: false };
        published.push(batch[0]!.title ?? "");
      }
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
    published,
    transcriptFetches,
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

  it("transcribes in input order when a later download finishes first", async () => {
    const h = harness(
      {
        urls: [
          "https://x.org/huge.mp3",
          "https://x.org/a.mp3",
          "https://x.org/b.mp4",
        ],
      },
      { budget: 3, slow: "https://x.org/huge.mp3" },
    );
    await runTranscriptions(h.input, h.deps);
    expect(h.requests.map((r) => r.budgetMinutes)).toEqual([3, 3, 1]);
    expect(h.items.map((i) => i.url)).toEqual([
      "https://x.org/huge.mp3",
      "https://x.org/a.mp3",
      "https://x.org/b.mp4",
    ]);
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

  it("skips robots-blocked feeds and files, free", async () => {
    const h = harness({
      rssFeeds: ["https://feeds.megaphone.fm/show"],
      urls: ["https://megaphone.org/ep.mp3", "https://x.org/a.mp3"],
    });
    const stats = await runTranscriptions(h.input, h.deps);
    expect(stats).toMatchObject({
      transcribed: 1,
      failed: 0,
      skippedRobots: 2,
    });
    expect(h.charges).toEqual([2]);
    const by = Object.fromEntries(h.items.map((i) => [i.url, i]));
    expect(by["https://feeds.megaphone.fm/show"]).toMatchObject({
      status: "skipped_robots",
      sourceType: "rss",
      billedMinutes: 0,
      error: expect.stringMatching(/anthropic-ai/),
    });
    expect(by["https://megaphone.org/ep.mp3"]).toMatchObject({
      status: "skipped_robots",
      billedMinutes: 0,
    });
    expect(by["https://x.org/a.mp3"]).toMatchObject({
      status: "transcribed",
      transcriptSource: "whisper",
      publishedTranscriptUrl: null,
    });
  });

  it("uses published transcripts first, falls back to Whisper", async () => {
    const h = harness({ rssFeeds: ["https://feeds.x.org/pub.xml"] });
    const stats = await runTranscriptions(h.input, h.deps);
    expect(stats).toMatchObject({
      transcribed: 3,
      published: 2,
      skippedRobots: 1,
      billedMinutes: 1,
    });
    // One published-transcript event each; Whisper minutes only for p2.
    expect(h.published.sort()).toEqual(["Plain", "Vtt"]);
    expect(h.charges).toEqual([1]);
    expect(h.requests).toHaveLength(1);
    const by = Object.fromEntries(h.items.map((i) => [i.title, i]));
    // Long episode (5 h): no Whisper, so maxDurationMinutes doesn't apply.
    expect(by["Vtt"]).toMatchObject({
      status: "transcribed",
      transcriptSource: "published",
      publishedTranscriptUrl: "https://t.org/p3.vtt",
      language: "de",
      durationSeconds: 18000,
      billedMinutes: 0,
      text: "Hallo zusammen. Willkommen.",
      segmentCount: 2,
      srtUrl: "https://kv/transcript-0001.srt",
      error: null,
    });
    expect(by["Vtt"]!.segments![0]).toEqual({
      start: 0,
      end: 4,
      text: "Hallo zusammen.",
      speaker: "Ann",
    });
    expect(h.files["transcript-0001.vtt"]).toContain("<v Ann>Hallo zusammen.");
    expect(h.transcriptFetches).not.toContain("https://t.org/p3.txt");
    expect(by["Broken"]).toMatchObject({
      status: "transcribed",
      transcriptSource: "whisper",
      publishedTranscriptUrl: null,
      billedMinutes: 1,
      warning: expect.stringMatching(/Published transcript unavailable.*404/),
    });
    expect(by["Plain"]).toMatchObject({
      transcriptSource: "published",
      language: "en",
      text: "First paragraph.\n\nSecond one.",
      segments: null,
      segmentCount: null,
      srtUrl: null,
      vttUrl: null,
    });
    expect(by["None"]).toMatchObject({ status: "skipped_robots" });
  });

  it("publishedOnly: never runs Whisper", async () => {
    const h = harness({
      rssFeeds: ["https://feeds.x.org/pub.xml"],
      publishedOnly: true,
      outputFormat: "chunks",
    });
    const stats = await runTranscriptions(h.input, h.deps);
    expect(h.requests).toHaveLength(0);
    expect(h.charges).toEqual([]);
    expect(stats).toMatchObject({ published: 2, transcribed: 2 });
    const by = Object.fromEntries(h.items.map((i) => [i.title, i]));
    expect(by["Broken"]).toMatchObject({
      status: "no_published_transcript",
      error: expect.stringMatching(/unavailable/),
    });
    expect(by["None"]).toMatchObject({
      status: "no_published_transcript",
      error: expect.stringMatching(/no published transcript/),
    });
    expect(by["Plain"]).toMatchObject({ startTime: null, endTime: null });
    expect(by["Vtt"]).toMatchObject({ startTime: 0, endTime: 570.5 });
  });

  it("preferPublishedTranscripts: false always uses Whisper", async () => {
    const h = harness({
      rssFeeds: ["https://feeds.x.org/pub.xml"],
      preferPublishedTranscripts: false,
    });
    await runTranscriptions(h.input, h.deps);
    expect(h.transcriptFetches).toEqual([]);
    expect(h.published).toEqual([]);
    expect(
      h.items
        .filter((i) => i.status === "transcribed")
        .map((i) => i.transcriptSource),
    ).toEqual(["whisper", "whisper"]);
  });

  it("transcribes pasted dataset rows, tagging each item with its row", async () => {
    const h = harness({ datasetItems: dataset });
    const stats = await runTranscriptions(h.input, h.deps);
    expect(stats).toMatchObject({ transcribed: 3, failed: 2 });
    expect(
      h.items
        .map((i) => [i.sourceItemIndex, i.url, i.status])
        .sort((a, b) => Number(a[0]) - Number(b[0])),
    ).toEqual([
      [0, "https://x.org/a.mp3", "transcribed"],
      [1, "https://x.org/b.mp4", "transcribed"],
      [2, "datasetItems", "failed"],
      [3, "https://www.tiktok.com/@a/video/1", "failed"],
      [5, "https://x.org/ep1.mp3", "transcribed"],
    ]);
    expect(h.items.every((i) => i.sourceDatasetId === null)).toBe(true);
    expect(h.charges).toHaveLength(3);
  });

  it("filters feed episodes by date and title before maxEpisodes", async () => {
    const h = harness({
      rssFeeds: ["https://feeds.x.org/pod.xml"],
      maxEpisodes: 1,
      publishedAfter: "2026-08-15",
      titleExcludes: ["NEW"],
    });
    await runTranscriptions(h.input, h.deps);
    expect(h.items.map((i) => i.title)).toEqual(["Old"]);

    const none = harness({
      rssFeeds: ["https://feeds.x.org/pod.xml"],
      titleContains: ["bonus", "special"],
    });
    await runTranscriptions(none.input, none.deps);
    expect(none.items).toHaveLength(1);
    expect(none.items[0]!.error).toMatch(
      /None of the feed's 3 episode\(s\) match/,
    );
  });

  it("passes word timestamps, translation and vocabulary to Whisper", async () => {
    const h = harness({
      urls: ["https://x.org/a.mp3"],
      wordTimestamps: true,
      translateToEnglish: true,
      vocabulary: "  Kenobi,\n Grievous ",
    });
    await runTranscriptions(h.input, h.deps);
    expect(h.requests[0]).toMatchObject({
      wordTimestamps: true,
      task: "translate",
      vocabulary: "Kenobi, Grievous",
    });
    expect(h.items[0]).toMatchObject({
      task: "translate",
      vocabularyUsed: "Kenobi, Grievous",
      sourceDatasetId: null,
      sourceItemIndex: null,
    });

    const plain = harness({ urls: ["https://x.org/a.mp3"] });
    await runTranscriptions(plain.input, plain.deps);
    expect(plain.requests[0]).toMatchObject({
      wordTimestamps: false,
      task: "transcribe",
      vocabulary: null,
    });
    expect(plain.items[0]).toMatchObject({
      task: "transcribe",
      vocabularyUsed: null,
    });
  });

  it("translateToEnglish skips published transcripts in other languages", async () => {
    const h = harness({
      rssFeeds: ["https://feeds.x.org/pub.xml"],
      translateToEnglish: true,
    });
    await runTranscriptions(h.input, h.deps);
    const by = Object.fromEntries(h.items.map((i) => [i.title, i]));
    // Vtt is German: Whisper translates it instead (but it is 5 h long).
    expect(by["Vtt"]).toMatchObject({
      transcriptSource: null,
      error: expect.stringMatching(/300.0 min long/),
    });
    // Plain is in the feed's language, English: still used.
    expect(by["Plain"]).toMatchObject({
      transcriptSource: "published",
      task: "transcribe",
    });
  });

  it("bills started minutes", () => {
    expect(billableMinutes(0.5)).toBe(1);
    expect(billableMinutes(60)).toBe(1);
    expect(billableMinutes(60.001)).toBe(2);
  });
});
