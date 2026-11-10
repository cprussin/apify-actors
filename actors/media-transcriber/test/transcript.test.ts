import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toSrt, toVtt } from "../src/captions.js";
import {
  parseCueTime,
  parsePublishedTranscript,
  transcriptKind,
} from "../src/transcript.js";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("published transcripts", () => {
  it("maps MIME types", () => {
    expect(transcriptKind("text/vtt")).toBe("vtt");
    expect(transcriptKind("application/x-subrip")).toBe("srt");
    expect(transcriptKind("application/srt")).toBe("srt");
    expect(transcriptKind("application/json; charset=utf-8")).toBe("json");
    expect(transcriptKind("text/plain")).toBe("text");
    expect(transcriptKind("text/html")).toBe("html");
    expect(transcriptKind("application/pdf")).toBeNull();
    expect(transcriptKind(undefined)).toBeNull();
  });

  it("parses cue times", () => {
    expect(parseCueTime("0:00:01.490")).toBe(1.49);
    expect(parseCueTime("01:02:03,004")).toBe(3723.004);
    expect(parseCueTime("02:03.5")).toBe(123.5);
    expect(parseCueTime("soon")).toBeNull();
  });

  it("parses WebVTT with voices, entities and settings", () => {
    const t = parsePublishedTranscript(fixture("transcript.vtt"), "vtt");
    expect(t).toEqual({
      timed: true,
      segments: [
        {
          start: 1.49,
          end: 5.07,
          text: "Welcome to the show & thanks for listening.",
          speaker: "Speaker 1",
        },
        { start: 5.5, end: 8, text: "Glad to be here.", speaker: "Speaker 2" },
      ],
    });
    expect(toVtt(t.segments)).toContain(
      "00:00:05.500 --> 00:00:08.000\n<v Speaker 2>Glad to be here.",
    );
  });

  it("parses SRT (CRLF too)", () => {
    const srt = fixture("transcript.srt");
    for (const body of [srt, srt.replace(/\n/g, "\r\n")]) {
      const t = parsePublishedTranscript(body, "srt");
      expect(t.segments).toEqual([
        { start: 1.49, end: 5.07, text: "Welcome to the show." },
        { start: 5.5, end: 8, text: "Glad to be here." },
      ]);
      expect(toSrt(t.segments)).toContain("00:00:01,490 --> 00:00:05,070");
    }
  });

  it("merges word-level JSON segments into sentences per speaker", () => {
    const t = parsePublishedTranscript(fixture("transcript.json"), "json");
    expect(t).toEqual({
      timed: true,
      segments: [
        { start: 0.5, end: 2.1, text: "Welcome to the show.", speaker: "Host" },
        { start: 2.4, end: 3.6, text: "Today we talk.", speaker: "Host" },
        { start: 4, end: 5, text: "Thanks everyone!", speaker: "Guest" },
      ],
    });
  });

  it("parses timestamped plain text as timed", () => {
    const t = parsePublishedTranscript(
      fixture("transcript-stamped.txt"),
      "text",
    );
    expect(t).toEqual({
      timed: true,
      segments: [
        { start: 1, end: 11, text: "Speaker 1: Welcome to the show." },
        {
          start: 11,
          end: 64,
          text: "Speaker 2: Glad to be here. It has been a while.",
        },
        { start: 64, end: 64, text: "Speaker 1: Let's start." },
      ],
    });
  });

  it("parses plain text as untimed paragraphs", () => {
    const t = parsePublishedTranscript(fixture("transcript-plain.txt"), "text");
    expect(t).toEqual({
      timed: false,
      segments: [
        {
          start: 0,
          end: 0,
          text: "Welcome to the show. This is the first paragraph.",
        },
        { start: 0, end: 0, text: "Second paragraph here." },
      ],
    });
  });

  it("parses HTML paragraphs, dropping scripts and navigation", () => {
    const t = parsePublishedTranscript(fixture("transcript.html"), "html");
    expect(t.timed).toBe(false);
    expect(t.segments.map((s) => s.text)).toEqual([
      "Host: Welcome to the show.",
      "Second paragraph continues here.",
    ]);
  });

  it("rejects error pages and empty or broken bodies", () => {
    const page = "<!DOCTYPE html><html><body>Not found</body></html>";
    expect(() => parsePublishedTranscript(page, "vtt")).toThrow(/web page/);
    expect(() => parsePublishedTranscript(page, "text")).toThrow(/web page/);
    expect(() => parsePublishedTranscript("WEBVTT\n\n", "vtt")).toThrow(
      /no text/,
    );
    expect(() => parsePublishedTranscript("{oops", "json")).toThrow();
    expect(() => parsePublishedTranscript('{"a":1}', "json")).toThrow(
      /segments/,
    );
  });
});
