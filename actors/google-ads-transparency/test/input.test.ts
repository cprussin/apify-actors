import { describe, expect, it } from "vitest";
import {
  InputError,
  normalizeInput,
  parseDate,
  parseTarget,
} from "../src/input.js";
import { regionCode, regionId } from "../src/regions.js";

const now = new Date("2026-09-29T12:00:00Z");

describe("parseTarget", () => {
  it("recognizes IDs, URLs, domains and names", () => {
    expect(parseTarget("AR16735076323512287233")).toEqual({
      kind: "id",
      query: "AR16735076323512287233",
      advertiserId: "AR16735076323512287233",
    });
    expect(
      parseTarget(
        "https://adstransparency.google.com/advertiser/AR16735076323512287233/creative/CR17861883293088088065?region=US",
      ),
    ).toMatchObject({ kind: "id", advertiserId: "AR16735076323512287233" });
    expect(
      parseTarget(
        "https://adstransparency.google.com/?region=US&domain=Nike.com",
      ),
    ).toMatchObject({ kind: "domain", domain: "nike.com" });
    expect(parseTarget("https://www.nike.com/us/")).toMatchObject({
      kind: "domain",
      domain: "nike.com",
    });
    expect(parseTarget("www.Nike.com")).toMatchObject({
      kind: "domain",
      domain: "nike.com",
    });
    expect(parseTarget("Nike, Inc.")).toMatchObject({
      kind: "name",
      name: "Nike, Inc.",
    });
    expect(() =>
      parseTarget("https://adstransparency.google.com/?region=US"),
    ).toThrow(InputError);
  });
});

describe("parseDate", () => {
  it("parses absolute and relative dates", () => {
    expect(parseDate("2026-01-31", "d", now)).toBe(20260131);
    expect(parseDate("30 days", "d", now)).toBe(20260830);
    expect(parseDate("6 months ago", "d", now)).toBe(20260329);
    expect(parseDate("today", "d", now)).toBe(20260929);
    expect(parseDate("", "d", now)).toBeNull();
    expect(() => parseDate("2026-02-30", "d", now)).toThrow(InputError);
    expect(() => parseDate("yesterday", "d", now)).toThrow(InputError);
  });
});

describe("regions", () => {
  it("maps ISO codes to Google geo target IDs and back", () => {
    expect(regionId("US")).toBe(2840);
    expect(regionId("gb")).toBe(2826);
    expect(regionId("UK")).toBe(2826);
    expect(regionId("DE")).toBe(2276);
    expect(regionId("XX")).toBeUndefined();
    expect(regionCode(2840)).toBe("US");
    expect(regionCode(21137)).toBe("21137");
  });
});

describe("normalizeInput", () => {
  it("applies defaults", () => {
    expect(normalizeInput({}, now)).toEqual({
      mode: "ads",
      targets: [{ kind: "name", query: "Nike", name: "Nike" }],
      region: "US",
      regionId: 2840,
      startDate: null,
      endDate: null,
      formats: [],
      platform: null,
      maxAdsPerAdvertiser: 20,
      includeAdContent: true,
      maxAdvertisersPerQuery: 10,
      onlyNew: false,
    });
  });

  it("normalizes filters", () => {
    const n = normalizeInput(
      {
        advertisers: [
          "nike.com",
          " nike.com ",
          "",
          null,
          "AR1234567890123456789",
        ],
        region: "",
        dateFrom: "2026-01-01",
        formats: ["VIDEO", "image"],
        platform: "youtube",
        maxAdsPerAdvertiser: "50",
        includeAdContent: false,
      },
      now,
    );
    expect(n.targets.map((t) => t.kind)).toEqual(["domain", "id"]);
    expect(n.region).toBeNull();
    expect(n.regionId).toBeNull();
    expect([n.startDate, n.endDate]).toEqual([20260101, 20260929]);
    expect(n.formats).toEqual(["video", "image"]);
    expect(n.platform).toBe("YOUTUBE");
    expect(n.maxAdsPerAdvertiser).toBe(50);
    expect(n.includeAdContent).toBe(false);
  });

  it("treats all three formats as no filter", () => {
    expect(
      normalizeInput({ formats: ["text", "image", "video"] }, now).formats,
    ).toEqual([]);
  });

  it("rejects bad input", () => {
    expect(() => normalizeInput({ advertisers: [] }, now)).toThrow(InputError);
    expect(() => normalizeInput({ region: "USA" }, now)).toThrow(InputError);
    expect(() => normalizeInput({ formats: ["gif"] }, now)).toThrow(InputError);
    expect(() => normalizeInput({ platform: "DISPLAY" }, now)).toThrow(
      InputError,
    );
    expect(() => normalizeInput({ maxAdsPerAdvertiser: 0 }, now)).toThrow(
      InputError,
    );
    expect(() =>
      normalizeInput({ dateFrom: "2026-05-01", dateTo: "2026-04-01" }, now),
    ).toThrow(InputError);
    expect(() =>
      normalizeInput({ mode: "advertisers", advertisers: ["nike.com"] }, now),
    ).toThrow(InputError);
  });
});
