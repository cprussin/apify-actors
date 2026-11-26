import { describe, expect, it } from "vitest";
import {
  dHash,
  frameStats,
  hamming,
  isBlank,
  lumaStats,
  THUMB_HEIGHT,
  THUMB_WIDTH,
} from "../src/filter.js";

const img = (f: (x: number, y: number) => number) => {
  const g = new Uint8Array(THUMB_WIDTH * THUMB_HEIGHT);
  for (let i = 0; i < g.length; i++)
    g[i] = f(i % THUMB_WIDTH, Math.floor(i / THUMB_WIDTH));
  return g;
};

describe("blank frames", () => {
  it("flags flat, black and white frames", () => {
    expect(isBlank(lumaStats(img(() => 0)))).toBe(true);
    expect(isBlank(lumaStats(img(() => 128)))).toBe(true);
    expect(isBlank(lumaStats(img(() => 252)))).toBe(true);
    // Dark but with detail: mean under 8 still counts as black.
    expect(isBlank(lumaStats(img((x) => (x % 2 ? 14 : 0))))).toBe(true);
    expect(isBlank(lumaStats(img((x) => x * 4)))).toBe(false);
  });
});

describe("dHash", () => {
  it("is 0 for left-to-right ramps and all ones the other way", () => {
    const up = img((x) => x * 4);
    const down = img((x) => 255 - x * 4);
    expect(dHash(up, THUMB_WIDTH, THUMB_HEIGHT)).toBe(0n);
    expect(hamming(dHash(down, THUMB_WIDTH, THUMB_HEIGHT), 0n)).toBe(64);
  });

  it("keeps near-identical frames close and different ones far", () => {
    const a = frameStats(img((x, y) => (x * 3 + y * 5) % 256));
    const noisy = frameStats(
      img((x, y) => Math.min(255, ((x * 3 + y * 5) % 256) + ((x + y) % 2))),
    );
    const other = frameStats(img((x, y) => (x * 7 + y * 11) % 256));
    expect(hamming(a.hash, noisy.hash)).toBeLessThanOrEqual(6);
    expect(hamming(a.hash, other.hash)).toBeGreaterThan(6);
  });
});
