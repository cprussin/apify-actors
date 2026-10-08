import { describe, expect, it } from "vitest";
import { notVideoError } from "../src/detect.js";
import {
  costUsd,
  evenSample,
  EVENTS,
  fitWidth,
  formatUsd,
  gifEvents,
  intervalTimes,
  pickScenes,
  sheetLayout,
  sizeFactor,
  startedMinutes,
  timecode,
} from "../src/plan.js";

describe("intervalTimes", () => {
  it("takes one frame every N seconds from the start", () => {
    expect(intervalTimes(95, 30, 0, 50)).toEqual({
      times: [0, 30, 60, 90],
      warning: null,
    });
    expect(intervalTimes(90, 30, 0, 50).times).toEqual([0, 30, 60]);
    expect(intervalTimes(5, 30, 0, 50).times).toEqual([0]);
  });

  it("spreads N frames evenly", () => {
    expect(intervalTimes(60, 10, 4, 50).times).toEqual([7.5, 22.5, 37.5, 52.5]);
  });

  it("caps at maxFrames, spreading them over the whole video", () => {
    const p = intervalTimes(3600, 1, 0, 4);
    expect(p.times).toEqual([450, 1350, 2250, 3150]);
    expect(p.warning).toMatch(/would be 3600 frames; took 4 evenly spaced frames instead \(one every 900 s/);
    expect(intervalTimes(60, 1, 10, 4).warning).toMatch(/10 frames requested; capped at 4/);
  }); // prettier-ignore
});

describe("pickScenes", () => {
  const cuts = [
    { time: 0.04, score: 0.9 },
    { time: 5, score: 0.35 },
    { time: 5.4, score: 0.8 },
    { time: 9, score: 0.6 },
    { time: 20, score: 0.95 },
  ];

  it("starts with the first frame and drops cuts closer than minGap", () => {
    expect(pickScenes(cuts, 1, 50)).toEqual({
      scenes: [
        { time: 0, score: 1 },
        { time: 5, score: 0.35 },
        { time: 9, score: 0.6 },
        { time: 20, score: 0.95 },
      ],
      detected: 4,
      warning: null,
    });
    expect(pickScenes(cuts, 0, 50).scenes).toHaveLength(6);
  });

  it("keeps the strongest cuts, in time order", () => {
    const p = pickScenes(cuts, 0, 3);
    expect(p.scenes.map((s) => s.time)).toEqual([0, 0.04, 20]);
    expect(p.warning).toMatch(/6 scenes found; kept the 3 strongest/);
    expect(pickScenes([], 1, 1).scenes).toEqual([{ time: 0, score: 1 }]);
  });
});

describe("helpers", () => {
  it("evenSample includes both ends", () => {
    expect(evenSample([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([1, 4, 7]);
    expect(evenSample([1, 2], 3)).toEqual([1, 2]);
  });

  it("fitWidth never upscales and keeps sizes even", () => {
    expect(fitWidth(1920, 1080, 1280)).toEqual({ width: 1280, height: 720, scaled: true });
    expect(fitWidth(640, 360, 1280)).toEqual({ width: 640, height: 360, scaled: false });
    expect(fitWidth(1080, 1920, 0)).toEqual({ width: 1080, height: 1920, scaled: false });
    expect(fitWidth(1000, 333, 501)).toEqual({ width: 502, height: 166, scaled: true });
  }); // prettier-ignore

  it("sheetLayout sizes the grid", () => {
    expect(sheetLayout(10, 4, 1920, 1080)).toEqual({
      columns: 4,
      rows: 3,
      tileWidth: 320,
      tileHeight: 180,
      width: 4 * 320 + 3 * 4 + 8,
      height: 3 * 180 + 2 * 4 + 8,
      tiles: 10,
    });
    expect(sheetLayout(2, 4, 1920, 1080).columns).toBe(2);
    expect(sheetLayout(500, 2, 1080, 1920)).toMatchObject({ rows: 20, tiles: 40 });
  }); // prettier-ignore

  it("formats timecodes, minutes and prices", () => {
    expect(timecode(3725.25)).toBe("01:02:05.250");
    expect(timecode(0)).toBe("00:00:00.000");
    expect(startedMinutes(1)).toBe(1);
    expect(startedMinutes(60)).toBe(1);
    expect(startedMinutes(60.5)).toBe(2);
    expect(
      costUsd(
        { [EVENTS.video]: 1, [EVENTS.frame]: 7, [EVENTS.sceneMinute]: 3 },
        { [EVENTS.video]: 0.005, [EVENTS.frame]: 0.003, [EVENTS.sceneMinute]: 0.01 },
      ),
    ).toBe(0.056); // prettier-ignore
    expect(formatUsd(0.056)).toBe("$0.056");
    expect(formatUsd(0.05)).toBe("$0.05");
    expect(formatUsd(1.5)).toBe("$1.5");
  });

  it("scales with the video size and the GIF's pixels", () => {
    expect(sizeFactor(640, 360)).toBe(1);
    expect(sizeFactor(1920, 1080)).toBe(1);
    expect(sizeFactor(1080, 1920)).toBe(1);
    expect(sizeFactor(2048, 1080)).toBe(1);
    expect(sizeFactor(2560, 1440)).toBe(2);
    expect(sizeFactor(3840, 2160)).toBe(4);
    expect(sizeFactor(7680, 4320)).toBe(16);
    const landscape = { width: 480, height: 270 };
    expect(gifEvents(5, 10, landscape, 1)).toBe(1);
    expect(gifEvents(1, 1, landscape, 1)).toBe(1);
    expect(gifEvents(5, 10, { width: 480, height: 854 }, 1)).toBe(2);
    expect(gifEvents(15, 10, landscape, 1)).toBe(2);
    expect(gifEvents(15, 25, { width: 1080, height: 608 }, 1)).toBe(22);
    expect(gifEvents(5, 10, landscape, 4)).toBe(4);
  });
});

describe("notVideoError", () => {
  const b = (s: string | number[]) =>
    typeof s === "string" ? Buffer.from(s, "latin1") : Buffer.from(s);
  it.each([
    ["", /empty/],
    ["<!DOCTYPE html><html>", /web page/],
    ["#EXTM3U\n", /HLS/],
    ['<?xml version="1.0"?><MPD xmlns="x">', /DASH/],
    ["%PDF-1.7", /PDF/],
    [[0xff, 0xd8, 0xff, 0xe0], /image, not a video/],
  ])("catches %j", (head, re) => {
    expect(notVideoError(b(head), null)).toMatch(re);
  });

  it("lets videos through", () => {
    expect(notVideoError(b("\0\0\0\x20ftypisom"), "video/mp4")).toBeNull();
    expect(notVideoError(b([0x1a, 0x45, 0xdf, 0xa3]), null)).toBeNull();
    expect(notVideoError(b('{"a":1}'), "application/json")).toMatch(/JSON/);
  });
});
