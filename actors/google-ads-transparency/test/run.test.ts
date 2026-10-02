import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeInput, type RawInput } from "../src/input.js";
import {
  parseSearchCreatives,
  parseSuggestions,
  type SearchFilter,
} from "../src/rpc.js";
import { runScraper, type Ad, type AdvertiserResult } from "../src/run.js";
import { Seen } from "../src/state.js";
import type { TransparencyApi } from "../src/transparency.js";

const text = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const json = (name: string) =>
  JSON.parse(text(name)) as Record<string, unknown>;

const page1 = parseSearchCreatives(json("search-page1.txt"));
const page2 = parseSearchCreatives(json("search-page2.txt"));
const videos = parseSearchCreatives(json("search-domain-video.txt"));

function fakeApi(opts: { failPreview?: boolean; failSearch?: boolean } = {}) {
  const calls: { filter: SearchFilter; count: number; token?: string }[] = [];
  const previews: string[] = [];
  const api: TransparencyApi = {
    suggestions: async () => parseSuggestions(json("suggestions-nike.txt")),
    searchCreatives: async (filter, count, token) => {
      calls.push({ filter, count, token });
      if (opts.failSearch) throw new Error("boom");
      if (filter.domain) return { ...videos, nextPageToken: null };
      const p = token ? page2 : page1;
      return {
        ...p,
        ads: p.ads.slice(0, count),
        nextPageToken: token ? null : "next",
      };
    },
    preview: async (url) => {
      previews.push(url);
      if (opts.failPreview) throw new Error("preview down");
      return text(
        url.includes("creativeId=8") ? "preview-video.txt" : "preview-text.txt",
      );
    },
  };
  return { api, calls, previews };
}

async function run(raw: RawInput, api: TransparencyApi, budget = Infinity) {
  const items: { item: Ad | AdvertiserResult; event: string }[] = [];
  const stats = await runScraper(normalizeInput(raw), {
    api,
    emit: async (item, event) => {
      items.push({ item, event });
      return items.length < budget;
    },
  });
  return { items, stats };
}

describe("runScraper", () => {
  it("resolves a name, paginates and enriches ads", async () => {
    const f = fakeApi();
    const { items, stats } = await run(
      { advertisers: ["Nike"], maxAdsPerAdvertiser: 6 },
      f.api,
    );
    expect(items).toHaveLength(6);
    expect(items.every((i) => i.event === "ad")).toBe(true);
    expect(f.calls.map((c) => [c.count, c.token])).toEqual([
      [6, undefined],
      [2, "next"],
    ]);
    expect(f.calls[0]!.filter).toEqual({
      advertiserIds: ["AR16735076323512287233"],
      regionId: 2840,
      platform: undefined,
      startDate: undefined,
      endDate: undefined,
      format: undefined,
    });
    const ad = items[0]!.item as Ad;
    expect(ad).toMatchObject({
      advertiserId: "AR16735076323512287233",
      advertiserName: "Nike, Inc.",
      region: "US",
      query: "Nike",
      adUrl: `https://adstransparency.google.com/advertiser/AR16735076323512287233/creative/${ad.creativeId}?region=US`,
    });
    const withPreview = items
      .map((i) => i.item as Ad)
      .filter((a) => a.previewUrl);
    expect(withPreview.length).toBe(f.previews.length);
    for (const a of withPreview) {
      expect(a.headline).toBeTruthy();
      expect(a.targetDomain).toBe("nike.com");
    }
    expect(stats.targets["Nike"]).toMatchObject({
      status: "maxAds",
      emitted: 6,
      advertiserName: "Nike, Inc.",
    });
  });

  it("splits the quota across formats and extracts videos", async () => {
    const f = fakeApi();
    const { items } = await run(
      {
        advertisers: ["nike.com"],
        formats: ["video", "image"],
        maxAdsPerAdvertiser: 4,
      },
      f.api,
    );
    expect(f.calls.map((c) => [c.filter.format, c.count])).toEqual([
      ["video", 2],
      ["image", 2],
    ]);
    // Both queries return the same 2 videos: duplicates are skipped.
    expect(items).toHaveLength(2);
    const ad = items[0]!.item as Ad;
    expect(ad.format).toBe("video");
    expect(ad.videoId).toBe("RZ1MLoOdWcc");
    expect(ad.videoUrl).toBe("https://www.youtube.com/watch?v=RZ1MLoOdWcc");
  });

  it("keeps ads when a preview fails, without content", async () => {
    const { items, stats } = await run(
      { advertisers: ["nike.com"] },
      fakeApi({ failPreview: true }).api,
    );
    expect(items).toHaveLength(2);
    expect((items[0]!.item as Ad).contentError).toMatch(/preview down/);
    expect((items[0]!.item as Ad).headline).toBeNull();
    expect(stats.contentErrors).toBe(2);
  });

  it("skips preview downloads when content is off", async () => {
    const f = fakeApi();
    await run({ advertisers: ["nike.com"], includeAdContent: false }, f.api);
    expect(f.previews).toEqual([]);
  });

  it("stops at the budget", async () => {
    const { items, stats } = await run(
      { advertisers: ["Nike", "nike.com"] },
      fakeApi().api,
      3,
    );
    expect(items).toHaveLength(3);
    expect(stats.stopReason).toBe("budget");
  });

  it("returns advertisers in advertiser search mode", async () => {
    const f = fakeApi();
    const { items } = await run(
      { mode: "advertisers", advertisers: ["nike"], maxAdvertisersPerQuery: 3 },
      f.api,
    );
    expect(items).toHaveLength(3);
    expect(items[0]!.event).toBe("advertiser");
    expect(items[0]!.item).toMatchObject({
      query: "nike",
      advertiserId: expect.stringMatching(/^AR\d+$/),
      advertiserUrl: expect.stringMatching(
        /^https:\/\/adstransparency\.google\.com\/advertiser\/AR\d+\?region=US$/,
      ),
    });
    expect(f.calls).toEqual([]);
  });

  it("onlyNew: skips (and doesn't charge) ads and advertisers seen before", async () => {
    const go = async (raw: RawInput, state: unknown) => {
      const seen = new Seen(state);
      const f = fakeApi();
      const out: string[] = [];
      const stats = await runScraper(
        normalizeInput({ ...raw, onlyNew: true }),
        {
          api: f.api,
          seen,
          emit: async (item) => {
            out.push(
              "creativeId" in item ? item.creativeId : item.advertiserId,
            );
            return true;
          },
        },
      );
      return { out, stats, f, state: seen.toJSON() };
    };
    const ads = { advertisers: ["Nike"], maxAdsPerAdvertiser: 3 };
    const r1 = await go(ads, undefined);
    expect(r1.out).toHaveLength(3);
    // Known ads don't count toward the quota: the next 3 come next run.
    const r2 = await go(ads, r1.state);
    expect(r2.out).toHaveLength(3);
    expect(r2.out.some((id) => r1.out.includes(id))).toBe(false);
    expect(r2.stats.skippedSeen).toBe(3);
    expect(r2.f.calls[0]!.count).toBe(100);
    const r3 = await go({ ...ads, maxAdsPerAdvertiser: 1000 }, r2.state);
    const r4 = await go({ ...ads, maxAdsPerAdvertiser: 1000 }, r3.state);
    expect(r4.out).toEqual([]);
    expect(r4.stats.targets["Nike"]!.status).toBe("done");

    const advertisers = { mode: "advertisers", advertisers: ["nike"] };
    const a1 = await go(
      { ...advertisers, maxAdvertisersPerQuery: 2 },
      undefined,
    );
    const a2 = await go(
      { ...advertisers, maxAdvertisersPerQuery: 3 },
      a1.state,
    );
    expect(a2.out).toHaveLength(1);
    expect(a1.out).not.toContain(a2.out[0]);
  });

  it("reports unknown names and throws when every advertiser fails", async () => {
    const api = fakeApi().api;
    api.suggestions = async () => ({ advertisers: [], domains: [] });
    const { items, stats } = await run({ advertisers: ["zzqq"] }, api);
    expect(items).toEqual([]);
    expect(stats.targets["zzqq"]!.status).toBe("notFound");
    await expect(
      run({ advertisers: ["nike.com"] }, fakeApi({ failSearch: true }).api),
    ).rejects.toThrow(/All advertisers failed/);
  });
});
