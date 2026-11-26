import { describe, expect, it } from "vitest";
import {
  DEFAULT_INPUT,
  InputError,
  LANGUAGES,
  normalizeInput,
  normalizeUrl,
  parseRecordRef,
  SAMPLE_URL,
  socialUrlError,
} from "../src/input.js";

describe("normalizeInput", () => {
  it("falls back to the sample clip with defaults", () => {
    const n = normalizeInput(undefined);
    expect(n.sources).toEqual([
      { index: 0, kind: "url", input: SAMPLE_URL, url: SAMPLE_URL },
    ]);
    expect(n).toMatchObject({
      model: "base",
      language: null,
      outputFormat: "transcript",
      maxEpisodes: DEFAULT_INPUT.maxEpisodes,
      onlyNewEpisodes: false,
      preferPublishedTranscripts: true,
      publishedOnly: false,
      maxDurationSecs: 180 * 60,
      maxBytes: 1000 * 1024 * 1024,
      timeoutMs: 600_000,
    });
  });

  it("combines URLs, start URLs, records and feeds, deduped", () => {
    const n = normalizeInput({
      urls: ["https://x.org/a.mp3", "x.org/b.mp4", "https://x.org/a.mp3"],
      startUrls: [{ url: "https://x.org/c.m4a" }],
      keyValueStoreRecords: ["abc123/episode.mp3", "me~store/talk.wav", "bad"],
      rssFeeds: "https://feeds.x.org/pod.xml",
    });
    expect(n.sources.map((s) => [s.kind, s.input])).toEqual([
      ["url", "https://x.org/a.mp3"],
      ["url", "x.org/b.mp4"],
      ["url", "https://x.org/c.m4a"],
      ["kv", "abc123/episode.mp3"],
      ["kv", "me~store/talk.wav"],
      ["invalid", "bad"],
      ["feed", "https://feeds.x.org/pod.xml"],
    ]);
    expect(n.sources[1]).toMatchObject({ url: "https://x.org/b.mp4" });
    expect(n.sources.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("rejects YouTube, TikTok and Instagram links per item", () => {
    const n = normalizeInput({
      urls: [
        "https://www.youtube.com/watch?v=abc",
        "https://youtu.be/abc",
        "https://www.tiktok.com/@a/video/1",
        "https://instagram.com/reel/x",
        "not a url",
      ],
    });
    expect(n.sources.every((s) => s.kind === "invalid")).toBe(true);
    const errors = n.sources.map((s) => (s.kind === "invalid" ? s.error : ""));
    expect(errors[0]).toMatch(
      /YouTube links are not supported.*youtube-transcripts/,
    );
    expect(errors[2]).toMatch(/TikTok links are not supported/);
    expect(errors[3]).toMatch(/Instagram links are not supported/);
    expect(errors[4]).toMatch(/Invalid URL/);
  });

  it("validates options", () => {
    expect(normalizeInput({ model: "SMALL", language: "de" })).toMatchObject({
      model: "small",
      language: "de",
    });
    expect(normalizeInput({ language: "auto" }).language).toBeNull();
    expect(() => normalizeInput({ model: "large" })).toThrow(InputError);
    expect(() => normalizeInput({ language: "xx" })).toThrow(/language/);
    expect(() => normalizeInput({ maxDurationMinutes: 301 })).toThrow(
      /between 1 and 300/,
    );
    expect(() => normalizeInput({ chunkSize: 400, chunkOverlap: 300 })).toThrow(
      /half/,
    );
    expect(() => normalizeInput({ maxEpisodes: "lots" })).toThrow(/number/);
    expect(
      normalizeInput({ maxDurationMinutes: "30", onlyNewEpisodes: true }),
    ).toMatchObject({ maxDurationSecs: 1800, onlyNewEpisodes: true });
    expect(normalizeInput({ preferPublishedTranscripts: false })).toMatchObject(
      { preferPublishedTranscripts: false, publishedOnly: false },
    );
    // publishedOnly implies using published transcripts.
    expect(
      normalizeInput({
        preferPublishedTranscripts: false,
        publishedOnly: true,
      }),
    ).toMatchObject({ preferPublishedTranscripts: true, publishedOnly: true });
  });

  it("reads the Whisper options and feed filters", () => {
    expect(normalizeInput({})).toMatchObject({
      dataset: null,
      wordTimestamps: false,
      task: "transcribe",
      vocabulary: null,
      publishedAfter: null,
      titleContains: [],
      titleExcludes: [],
    });
    expect(
      normalizeInput({
        wordTimestamps: true,
        translateToEnglish: true,
        vocabulary: "Apify,  Crawlee",
        publishedAfter: "2026-01-31",
        titleContains: ["Interview", " interview ", ""],
        titleExcludes: "Trailer\nBonus",
      }),
    ).toMatchObject({
      wordTimestamps: true,
      task: "translate",
      vocabulary: "Apify, Crawlee",
      publishedAfter: "2026-01-31T00:00:00.000Z",
      titleContains: ["interview"],
      titleExcludes: ["trailer", "bonus"],
    });
    expect(() => normalizeInput({ publishedAfter: "last week" })).toThrow(
      /not a date/,
    );
    expect(() => normalizeInput({ vocabulary: "x".repeat(1001) })).toThrow(
      /at most 1000/,
    );
  });

  it("reads dataset inputs", () => {
    const n = normalizeInput({ datasetId: "me~podcast-scrape" });
    expect(n.sources).toEqual([]);
    expect(n.dataset).toEqual({
      id: "me~podcast-scrape",
      field: null,
      maxItems: 100,
    });
    const pasted = normalizeInput({
      urls: ["https://x.org/a.mp3"],
      datasetItems: [
        { episode: { audio: "https://x.org/a.mp3" } },
        { episode: { audio: [{ url: "https://x.org/b.mp3" }] } },
      ],
      datasetField: "episode.audio",
    });
    expect(pasted.sources).toEqual([
      { index: 0, kind: "url", input: "https://x.org/a.mp3", url: "https://x.org/a.mp3" },
      { index: 1, kind: "url", input: "https://x.org/b.mp3", url: "https://x.org/b.mp3", origin: { datasetId: null, itemIndex: 1 } },
    ]); // prettier-ignore
    for (const bad of [
      { datasetId: "has space" },
      { datasetField: "a..b" },
      { datasetItems: "nope" as never },
      { maxDatasetItems: 0 },
    ])
      expect(() => normalizeInput(bad)).toThrow(InputError);
  });

  it("knows Whisper's 100 languages", () => {
    expect(LANGUAGES).toHaveLength(100);
    expect(new Set(LANGUAGES).size).toBe(100);
  });
});

describe("helpers", () => {
  it("normalizes URLs", () => {
    expect(normalizeUrl("example.com/a.mp3")).toBe("https://example.com/a.mp3");
    expect(normalizeUrl("ftp://example.com/a.mp3")).toBeNull();
    expect(normalizeUrl("hello")).toBeNull();
  });

  it("parses record refs", () => {
    expect(parseRecordRef("me~store/a.mp3")).toEqual({
      store: "me~store",
      key: "a.mp3",
    });
    expect(parseRecordRef("a/b/c")).toBeNull();
  });

  it("only flags social hosts", () => {
    expect(socialUrlError("https://m.youtube.com/watch?v=1")).toBeTruthy();
    expect(socialUrlError("https://notyoutube.com/a.mp3")).toBeNull();
    expect(socialUrlError("https://cdn.example.com/a.mp3")).toBeNull();
  });
});
