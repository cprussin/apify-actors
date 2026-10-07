import { describe, expect, it } from "vitest";
import {
  formatTimestamp,
  segmentsToText,
  toSrt,
  toVtt,
  wordCount,
} from "../src/captions.js";
import { chunkSegments, splitSegment } from "../src/chunk.js";

const segments = [
  { start: 0, end: 2.5, text: "Hello world." },
  { start: 2.5, end: 3661.042, text: "Second line." },
];

describe("captions", () => {
  it("formats timestamps", () => {
    expect(formatTimestamp(3661.042, ",")).toBe("01:01:01,042");
    expect(formatTimestamp(0.9996, ".")).toBe("00:00:01.000");
    expect(formatTimestamp(-1, ".")).toBe("00:00:00.000");
  });

  it("writes SRT and VTT", () => {
    expect(toSrt(segments)).toBe(
      "1\n00:00:00,000 --> 00:00:02,500\nHello world.\n\n2\n00:00:02,500 --> 01:01:01,042\nSecond line.\n",
    );
    expect(toVtt(segments)).toBe(
      "WEBVTT\n\n00:00:00.000 --> 00:00:02.500\nHello world.\n\n00:00:02.500 --> 01:01:01.042\nSecond line.\n",
    );
    expect(toSrt([{ start: 5, end: 5, text: "x" }])).toContain(
      "00:00:05,000 --> 00:00:05,001",
    );
  });

  it("joins text and counts words", () => {
    expect(segmentsToText(segments)).toBe("Hello world. Second line.");
    expect(wordCount(" a  b\nc ")).toBe(3);
  });
});

describe("chunkSegments", () => {
  const segs = Array.from({ length: 10 }, (_, i) => ({
    start: i * 10,
    end: i * 10 + 9,
    text: `Segment number ${i}.`, // 18 chars
  }));

  it("packs whole segments with their time range", () => {
    const chunks = chunkSegments(segs, { size: 60, overlap: 0 });
    expect(chunks.map((c) => [c.start, c.end])).toEqual([
      [0, 29],
      [30, 59],
      [60, 89],
      [90, 99],
    ]);
    expect(chunks[0]!.text).toBe(
      "Segment number 0. Segment number 1. Segment number 2.",
    );
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(60);
  });

  it("repeats trailing segments as overlap", () => {
    const chunks = chunkSegments(segs, { size: 80, overlap: 20 });
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(80);
    expect(chunks[1]!.text.startsWith("Segment number 2. Segment number 3."));
    expect(chunks[1]!.start).toBe(20);
    expect(chunks.at(-1)!.end).toBe(99);
  });

  it("splits oversized segments with interpolated times", () => {
    const parts = splitSegment(
      { start: 10, end: 20, text: "aaaa bbbb cccc dddd" },
      10,
    );
    expect(parts.map((p) => p.text)).toEqual(["aaaa bbbb", "cccc dddd"]);
    expect(parts[0]!.start).toBe(10);
    expect(parts[1]!.end).toBe(20);
    expect(parts[1]!.start).toBeGreaterThan(14);
    expect(
      chunkSegments([{ start: 0, end: 1, text: "x".repeat(450) }], {
        size: 200,
        overlap: 0,
      }).map((c) => c.text.length),
    ).toEqual([200, 200, 50]);
  });

  it("returns nothing for empty transcripts", () => {
    expect(chunkSegments([], { size: 100, overlap: 10 })).toEqual([]);
  });
});
