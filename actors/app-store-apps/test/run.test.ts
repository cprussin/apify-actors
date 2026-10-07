import { describe, expect, it, vi } from "vitest";
import { EMPTY_APP, type App, type Row, type Store } from "../src/app.js";
import { InputError, normalizeInput, type RawInput } from "../src/input.js";
import { changeOf, RankTracker, stateKey } from "../src/ranks.js";
import { runApps, type ChargeEvent, type RunDeps } from "../src/run.js";

const NOW = new Date("2026-10-07T12:00:00Z");

const app = (store: Store, appId: string, extra: Partial<App> = {}): App => ({
  ...EMPTY_APP,
  store,
  appId,
  name: `App ${appId}`,
  url: `https://example.com/${appId}`,
  ...extra,
});

function setup(over: Partial<RunDeps> = {}, budget = Infinity) {
  const out: { row: Row; event: ChargeEvent | null }[] = [];
  let charged = 0;
  const deps: RunDeps = {
    apple: {
      search: vi.fn(async () =>
        ["1", "2", "3", "4"].map((id) => app("apple", id)),
      ),
      lookup: vi.fn(async (ids: string[]) => {
        const m = new Map<string, App>();
        for (const id of ids)
          if (id !== "10404")
            m.set(id, app("apple", id.replace("bundle:", "9")));
        return m;
      }),
      chart: vi.fn(async () => [app("apple", "10"), app("apple", "11")]),
    },
    google: {
      details: vi.fn(async (id: string) =>
        id === "com.missing.app" ? null : app("google", id),
      ),
      chart: vi.fn(async () => [
        app("google", "com.a"),
        app("google", "com.b"),
      ]),
    },
    emit: async (row, event) => {
      out.push({ row, event });
      if (event) charged += 1;
      return charged < budget;
    },
    now: () => NOW,
    ...over,
  };
  return { deps, out };
}

const run = (raw: RawInput, deps: RunDeps) =>
  runApps(normalizeInput(raw), deps);

describe("normalizeInput", () => {
  it("applies defaults", () => {
    expect(
      normalizeInput({ keywords: [" photo  editor ", "Photo Editor"] }),
    ).toEqual({
      mode: "keywordRanks",
      keywords: ["photo editor"],
      trackedApps: [],
      charts: ["topFree"],
      stores: ["apple", "google"],
      category: "all",
      apps: [],
      country: "us",
      language: "en",
      maxResults: 50,
      rankChangesOnly: false,
      minRankChange: 1,
    });
  });

  it.each<[RawInput, RegExp]>([
    [{ keywords: [] }, /keyword/],
    [{ mode: "appDetails" }, /apps/],
    [{ mode: "nope" }, /mode/],
    [{ keywords: ["x"], country: "usa" }, /country/],
    [{ keywords: ["x"], maxResults: 0 }, /maxResults/],
    [{ keywords: ["x"], minRankChange: 0 }, /minRankChange/],
    [{ mode: "topCharts", charts: ["topNew"] }, /charts/],
    [{ mode: "topCharts", stores: ["amazon"] }, /stores/],
    [{ mode: "topCharts", category: "cats" }, /category/],
    [{ keywords: ["x"], trackedApps: ["com.spotify.music"] }, /Google Play/],
    [{ mode: "appDetails", apps: ["spotify"] }, /store/],
  ])("rejects %j", (raw, msg) => {
    expect(() => normalizeInput(raw)).toThrow(InputError);
    expect(() => normalizeInput(raw)).toThrow(msg);
  });

  it("caps maxResults, maps uk and ignores rank tracking for details", () => {
    const n = normalizeInput({
      mode: "appDetails",
      apps: ["id324684580", "324684580", "com.spotify.music"],
      country: "UK",
      maxResults: 1000,
      rankChangesOnly: true,
    });
    expect(n.apps).toHaveLength(2);
    expect(n.country).toBe("gb");
    expect(n.maxResults).toBe(200);
    expect(n.rankChangesOnly).toBe(false);
  });
});

describe("runApps", () => {
  it("keyword ranks: one charged rank row per search result", async () => {
    const { deps, out } = setup();
    const stats = await run({ keywords: ["a", "b"], maxResults: 3 }, deps);
    expect(out).toHaveLength(6);
    expect(out.every((o) => o.event === "rank-row")).toBe(true);
    expect(
      out.slice(0, 3).map((o) => [o.row.keyword, o.row.rank, o.row.appId]),
    ).toEqual([
      ["a", 1, "1"],
      ["a", 2, "2"],
      ["a", 3, "3"],
    ]);
    expect(out[0]!.row).toMatchObject({
      type: "keywordRank",
      store: "apple",
      country: "us",
      language: null,
      scrapedAt: NOW.toISOString(),
      changeType: null,
    });
    expect(stats).toMatchObject({ charged: 6, stopReason: "done", failed: [] });
  });

  it("keyword ranks: tracked apps only, with not-ranked rows", async () => {
    const { deps, out } = setup();
    vi.mocked(deps.apple.search).mockResolvedValue(
      ["10001", "10002", "10003"].map((id) => app("apple", id)),
    );
    await run(
      { keywords: ["a"], trackedApps: ["id10003", "id10077"], maxResults: 4 },
      deps,
    );
    expect(out.map((o) => [o.row.appId, o.row.rank, o.row.changeType])).toEqual(
      [
        ["10003", 3, null],
        ["10077", null, "notRanked"],
      ],
    );
  });

  it("failed queries become free error rows", async () => {
    const { deps, out } = setup();
    vi.mocked(deps.apple.search).mockImplementationOnce(async () => {
      throw new Error("HTTP 503");
    });
    const stats = await run({ keywords: ["bad", "good"], maxResults: 1 }, deps);
    expect(out.map((o) => [o.row.type, o.event, o.row.keyword])).toEqual([
      ["error", null, "bad"],
      ["keywordRank", "rank-row", "good"],
    ]);
    expect(out[0]!.row.error).toBe("HTTP 503");
    expect(stats.failed).toEqual(['keyword "bad"']);
  });

  it("throws when every query fails", async () => {
    const { deps } = setup();
    vi.mocked(deps.apple.search).mockRejectedValue(new Error("down"));
    await expect(run({ keywords: ["a"] }, deps)).rejects.toThrow(/All 1/);
  });

  it("stops at the budget", async () => {
    const { deps, out } = setup({}, 2);
    const stats = await run({ keywords: ["a", "b"] }, deps);
    expect(out).toHaveLength(2);
    expect(stats.stopReason).toBe("budget");
  });

  it("top charts on both stores", async () => {
    const { deps, out } = setup();
    await run(
      {
        mode: "topCharts",
        charts: ["topFree", "topGrossing"],
        category: "games",
        language: "de",
        country: "de",
      },
      deps,
    );
    expect(deps.apple.chart).toHaveBeenCalledWith("topFree", "6014", "de", 50);
    expect(deps.google.chart).toHaveBeenCalledWith(
      "topGrossing",
      "GAME",
      "de",
      "de",
      50,
    );
    expect(out).toHaveLength(8);
    expect(out[0]!.row).toMatchObject({
      type: "chartRank",
      chart: "topFree",
      chartCategory: "games",
      rank: 1,
      language: null,
    });
    expect(out[4]!.row).toMatchObject({ store: "google", language: "de" });
    expect(out.every((o) => o.event === "rank-row")).toBe(true);
  });

  it("an empty chart is an error row", async () => {
    const { deps, out } = setup();
    vi.mocked(deps.google.chart).mockResolvedValue([]);
    await run({ mode: "topCharts", stores: ["apple", "google"] }, deps);
    expect(out.map((o) => o.row.type)).toEqual([
      "chartRank",
      "chartRank",
      "error",
    ]);
    expect(out[2]!.row).toMatchObject({
      store: "google",
      error: expect.stringMatching(/empty chart/),
    });
  });

  it("app details in input order, charged per app, not-found free", async () => {
    const { deps, out } = setup();
    await run(
      {
        mode: "appDetails",
        apps: [
          "com.spotify.music",
          "id10404",
          "apple:com.x.y",
          "id10005",
          "com.missing.app",
        ],
      },
      deps,
    );
    expect(deps.apple.lookup).toHaveBeenCalledTimes(1);
    expect(
      out.map((o) => [o.row.type, o.event, o.row.appId ?? o.row.bundleId]),
    ).toEqual([
      ["app", "app", "com.spotify.music"],
      ["error", null, "10404"],
      ["app", "app", "9com.x.y"],
      ["app", "app", "10005"],
      ["error", null, "com.missing.app"],
    ]);
    expect(out[1]!.row.error).toMatch(/not found in the US App Store/);
    expect(out[0]!.row.language).toBe("en");
    expect(out[2]!.row.language).toBeNull();
  });

  it("an Apple lookup failure fails only Apple apps", async () => {
    const { deps, out } = setup();
    vi.mocked(deps.apple.lookup).mockRejectedValue(new Error("HTTP 500"));
    await run({ mode: "appDetails", apps: ["id10001", "com.a.b"] }, deps);
    expect(out.map((o) => o.row.type)).toEqual(["error", "app"]);
  });

  describe("rank changes only", () => {
    const ranks = (ids: string[]) => ids.map((id) => app("apple", id));

    it("baseline, then only changes and drops", async () => {
      const tracker = new RankTracker();
      const save = vi.fn(async () => {});
      const raw = { keywords: ["a"], rankChangesOnly: true };

      const first = setup({ tracker, afterGroup: save });
      vi.mocked(first.deps.apple.search).mockResolvedValue(
        ranks(["1", "2", "3"]),
      );
      await run(raw, first.deps);
      expect(first.out.map((o) => o.row.changeType)).toEqual([
        "baseline",
        "baseline",
        "baseline",
      ]);
      expect(save).toHaveBeenCalledTimes(1);

      // Persisted state round-trips through JSON.
      const second = setup({
        tracker: new RankTracker(JSON.parse(JSON.stringify(tracker.toJSON()))),
      });
      vi.mocked(second.deps.apple.search).mockResolvedValue(
        ranks(["2", "1", "4"]),
      );
      const stats = await run(raw, second.deps);
      expect(
        second.out.map((o) => [
          o.row.appId,
          o.row.rank,
          o.row.previousRank,
          o.row.rankChange,
          o.row.changeType,
        ]),
      ).toEqual([
        ["2", 1, 2, 1, "up"],
        ["1", 2, 1, -1, "down"],
        ["4", 3, null, null, "new"],
        ["3", null, 3, null, "dropped"],
      ]);
      expect(second.out[3]!.row.name).toBe("App 3");
      expect(stats.unchanged).toBe(0);
    });

    it("skips unchanged ranks", async () => {
      const tracker = new RankTracker();
      tracker.commit(
        "keyword:apple:us:a",
        [
          { appId: "1", rank: 1, name: null, store: "apple" },
          { appId: "2", rank: 2, name: null, store: "apple" },
        ],
        "2026-10-06T00:00:00Z",
      );
      const { deps, out } = setup({ tracker });
      vi.mocked(deps.apple.search).mockResolvedValue(ranks(["1", "2"]));
      const stats = await run({ keywords: ["A"], rankChangesOnly: true }, deps);
      expect(out).toHaveLength(0);
      expect(stats.unchanged).toBe(2);
    });

    it("uses the deeper list: slides past the cut-off and jitter", async () => {
      const tracker = new RankTracker();
      const deep = (ids: string[]) => ids.map((id) => app("apple", id));
      const raw = {
        keywords: ["a"],
        rankChangesOnly: true,
        maxResults: 3,
        minRankChange: 2,
      };
      const first = setup({ tracker });
      vi.mocked(first.deps.apple.search).mockResolvedValue(
        deep(["1", "2", "3", "4", "5", "6"]),
      );
      await run(raw, first.deps);
      expect(first.out.map((o) => o.row.appId)).toEqual(["1", "2", "3"]);

      // 1<->2 swap, 3 slides to #4, 4 enters at #3: all 1-place jitter.
      const second = setup({ tracker });
      vi.mocked(second.deps.apple.search).mockResolvedValue(
        deep(["2", "1", "4", "3", "5", "6"]),
      );
      const s2 = await run(raw, second.deps);
      expect(second.out).toHaveLength(0);
      expect(s2.unchanged).toBe(3);

      const third = setup({ tracker });
      vi.mocked(third.deps.apple.search).mockResolvedValue(
        deep(["6", "5", "2", "1", "4", "3"]),
      );
      await run(raw, third.deps);
      expect(
        third.out.map((o) => [
          o.row.appId,
          o.row.rank,
          o.row.previousRank,
          o.row.rankChange,
          o.row.changeType,
        ]),
      ).toEqual([
        ["6", 1, 6, 5, "new"],
        ["5", 2, 5, 3, "new"],
        ["2", 3, 1, -2, "down"],
        ["1", 4, 2, -2, "dropped"],
        ["4", 5, 3, -2, "dropped"],
      ]);
    });

    it("doesn't record a list cut short by the budget", async () => {
      const tracker = new RankTracker();
      const { deps } = setup({ tracker }, 1);
      await run({ keywords: ["a"], rankChangesOnly: true }, deps);
      expect(tracker.toJSON().groups).toEqual({});
    });
  });
});

describe("ranks", () => {
  it("changeOf", () => {
    expect(changeOf(null, 3).changeType).toBe("new");
    expect(changeOf(5, 2)).toEqual({
      previousRank: 5,
      rankChange: 3,
      changeType: "up",
    });
    expect(changeOf(2, 2).changeType).toBe("same");
    expect(changeOf(2, 4).changeType).toBe("down");
    expect(changeOf(2, 4, true, 3).changeType).toBe("same");
    expect(changeOf(60, 4, false, 3).changeType).toBe("new");
  });

  it("stateKey is stable and order-independent", () => {
    expect(stateKey({ a: 1, b: [1, 2] })).toBe(stateKey({ b: [1, 2], a: 1 }));
    expect(stateKey({ a: 1 })).not.toBe(stateKey({ a: 2 }));
    expect(stateKey({ a: 1 })).toMatch(/^RANKS-[0-9a-f]{16}$/);
  });

  it("tolerates corrupt state", () => {
    const t = new RankTracker({
      groups: { x: { at: 1 }, y: { at: "t", ranks: { a: { rank: "1" } } } },
    });
    expect(t.toJSON()).toEqual({
      version: 1,
      groups: { y: { at: "t", ranks: {} } },
    });
    expect(new RankTracker("junk").toJSON().groups).toEqual({});
  });
});
