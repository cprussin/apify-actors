import { describe, expect, it } from "vitest";
import {
  GRACE_DAYS,
  MAX_SEEN_PER_GROUP,
  Monitor,
  laterOf,
  parseState,
  stateKey,
} from "../src/state.js";

const T = (d: number, h = 0) => new Date(Date.UTC(2026, 8, d, h)).toISOString();

/** Simulate a run: persist + reload like the key-value store would. */
const reload = (m: Monitor) => new Monitor(JSON.parse(JSON.stringify(m)));

describe("state", () => {
  it("stateKey is stable, order-insensitive for keys, and input-specific", () => {
    const a = stateKey({ companies: ["a.com"], language: "en", stars: [1] });
    expect(a).toMatch(/^STATE-[0-9a-f]{16}$/);
    expect(
      stateKey({
        stars: [1],
        language: "en",
        companies: ["a.com"],
        x: undefined,
      }),
    ).toBe(a);
    expect(
      stateKey({ companies: ["a.com"], language: "de", stars: [1] }),
    ).not.toBe(a);
  });

  it("parseState tolerates garbage", () => {
    expect(parseState(null)).toEqual({ version: 1, groups: {} });
    expect(parseState("x")).toEqual({ version: 1, groups: {} });
    expect(
      parseState({
        groups: { g: { watermark: 5, seen: { a: "d", b: 1 } }, h: null },
      }),
    ).toEqual({
      version: 1,
      groups: { g: { watermark: undefined, seen: { a: "d" } } },
    });
  });

  it("first run is a baseline; later runs skip seen IDs and page from watermark - grace", () => {
    const m1 = new Monitor(undefined);
    expect(m1.hasHistory("c")).toBe(false);
    expect(m1.since("c")).toBeUndefined();
    m1.record("c", "r2", T(20));
    m1.record("c", "r1", T(19));
    // Baseline run cut short at maxReviews still sets the watermark.
    m1.finish("c", false);

    const m2 = reload(m1);
    expect(m2.hasHistory("c")).toBe(true);
    expect(m2.since("c")).toBe(T(20 - GRACE_DAYS));
    expect(m2.isSeen("c", "r2")).toBe(true);
    expect(m2.isSeen("c", "r3")).toBe(false);
    expect(m2.isSeen("other", "r2")).toBe(false);

    m2.record("c", "r3", T(22));
    m2.finish("c", true);
    const m3 = reload(m2);
    expect(m3.since("c")).toBe(T(22 - GRACE_DAYS));
    expect(m3.isSeen("c", "r3")).toBe(true);
  });

  it("an incomplete later run keeps the old watermark but remembers IDs", () => {
    const m = new Monitor({ groups: { c: { watermark: T(10), seen: {} } } });
    m.record("c", "new", T(25));
    m.finish("c", false);
    const r = reload(m);
    expect(r.since("c")).toBe(T(10 - GRACE_DAYS));
    expect(r.isSeen("c", "new")).toBe(true);
  });

  it("a completed group with no reviews gets a baseline watermark", () => {
    const m = new Monitor(undefined);
    m.finish("c", true);
    expect(reload(m).hasHistory("c")).toBe(true);
  });

  it("drops IDs outside the paging window and caps the rest", () => {
    const m = new Monitor({
      groups: { c: { watermark: T(28), seen: { old: T(1), recent: T(27) } } },
    });
    const json = m.toJSON();
    expect(Object.keys(json.groups.c!.seen)).toEqual(["recent"]);

    const big = new Monitor(undefined);
    for (let i = 0; i < MAX_SEEN_PER_GROUP + 10; i++) {
      big.record(
        "c",
        `r${i}`,
        new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
      );
    }
    big.finish("c", true);
    const seen = Object.keys(big.toJSON().groups.c!.seen);
    expect(seen).toHaveLength(MAX_SEEN_PER_GROUP);
    expect(seen).not.toContain("r0");
    expect(seen).toContain(`r${MAX_SEEN_PER_GROUP + 9}`);
  });

  it("laterOf", () => {
    expect(laterOf(undefined, undefined)).toBeUndefined();
    expect(laterOf("2026-09-01", undefined)).toBe("2026-09-01");
    expect(laterOf(undefined, "2026-09-01")).toBe("2026-09-01");
    expect(laterOf("2026-09-01", "2026-08-25T00:00:00.000Z")).toBe(
      "2026-09-01",
    );
  });
});
