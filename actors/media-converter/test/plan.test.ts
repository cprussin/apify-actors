import { describe, expect, it } from "vitest";
import {
  above1080p,
  billedMinutes,
  eventFor,
  fitResolution,
  longSide,
  MIN_VIDEO_KBPS,
  savedPercent,
  targetBitrates,
  vp9Crf,
} from "../src/plan.js";

describe("fitResolution", () => {
  it("fits the shorter side and a 16:9 long side, never upscaling", () => {
    expect(longSide(480)).toBe(854);
    expect(longSide(720)).toBe(1280);
    expect(longSide(1080)).toBe(1920);
    expect(fitResolution(3840, 2160, 1080)).toEqual({
      width: 1920,
      height: 1080,
      scaled: true,
    });
    expect(fitResolution(1920, 1080, 720)).toEqual({
      width: 1280,
      height: 720,
      scaled: true,
    });
    // Portrait: 720p means 720 wide.
    expect(fitResolution(1080, 1920, 720)).toEqual({
      width: 720,
      height: 1280,
      scaled: true,
    });
    // Ultra-wide: the long side limits.
    expect(fitResolution(2560, 1080, 1080)).toEqual({
      width: 1920,
      height: 810,
      scaled: true,
    });
    expect(fitResolution(640, 360, 1080)).toEqual({
      width: 640,
      height: 360,
      scaled: false,
    });
    // Odd sizes become even for 4:2:0 encoders.
    expect(fitResolution(641, 361, 1080)).toMatchObject({ scaled: true });
  });
});

describe("eventFor", () => {
  it("bills audio outputs as audio minutes", () => {
    expect(eventFor("mp3", null, { width: 3840, height: 2160 })).toBe(
      "audio-minute",
    );
    expect(eventFor("wav", null, null)).toBe("audio-minute");
  });

  it("bills video by output tier, and >1080p input as 1080p", () => {
    const e = (w: number, h: number, iw = w, ih = h) =>
      eventFor("mp4", { width: w, height: h }, { width: iw, height: ih });
    expect(e(320, 240)).toBe("video-480p-minute");
    expect(e(854, 480)).toBe("video-480p-minute");
    expect(e(480, 854)).toBe("video-480p-minute");
    expect(e(1280, 720)).toBe("video-720p-minute");
    expect(e(960, 720)).toBe("video-720p-minute");
    expect(e(1920, 1080)).toBe("video-1080p-minute");
    expect(e(1920, 810)).toBe("video-1080p-minute");
    expect(e(854, 480, 3840, 2160)).toBe("video-1080p-minute");
    expect(above1080p(1920, 1080)).toBe(false);
    expect(above1080p(2560, 1440)).toBe(true);
  });
});

describe("billedMinutes", () => {
  it("counts started minutes with a 1 s grace", () => {
    expect(billedMinutes(3)).toBe(1);
    expect(billedMinutes(60)).toBe(1);
    expect(billedMinutes(61)).toBe(1);
    expect(billedMinutes(61.5)).toBe(2);
    expect(billedMinutes(600.4)).toBe(10);
    expect(billedMinutes(620)).toBe(11);
  });
});

describe("targetBitrates", () => {
  const MB = 1024 * 1024;
  it("splits a video target between video and audio", () => {
    // 10 MB over 60 s: ~1356 kbit/s in all.
    const r = targetBitrates(10 * MB, 60, true, true);
    expect(r.audioKbps).toBe(128);
    expect(r.videoKbps).toBe(1228);
    expect(r.warning).toBeNull();
    expect(targetBitrates(10 * MB, 60, true, false).audioKbps).toBeNull();
  });

  it("warns when the target is too small", () => {
    const r = targetBitrates(1 * MB, 600, true, true);
    expect(r.videoKbps).toBe(MIN_VIDEO_KBPS);
    expect(r.warning).toMatch(/too small/);
  });

  it("gives an audio target to the audio, within 32-320 kbit/s", () => {
    expect(targetBitrates(5 * MB, 300, false, true)).toEqual({
      videoKbps: null,
      audioKbps: 136,
      warning: null,
    });
    expect(targetBitrates(100 * MB, 60, false, true).audioKbps).toBe(320);
    expect(targetBitrates(1 * MB, 3600, false, true)).toMatchObject({
      audioKbps: 32,
      warning: expect.stringMatching(/too small/),
    });
  });
});

describe("misc", () => {
  it("maps CRF to VP9 and computes savings", () => {
    expect(vp9Crf(23)).toBe(33);
    expect(vp9Crf(60)).toBe(63);
    expect(savedPercent(1000, 250)).toBe(75);
    expect(savedPercent(1000, 1500)).toBe(-50);
    expect(savedPercent(0, 1)).toBeNull();
  });
});
