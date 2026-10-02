import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  addMonths,
  computeWindow,
  inputHash,
  InputError,
  normalizeInput,
} from "../src/input.js";
import { runRadar } from "../src/run.js";
import { PersistentSeenStore, type KeyValueLike } from "../src/state.js";
import type { ContractRecord } from "../src/transform.js";
import { toContractRecord } from "../src/transform.js";
import {
  buildSearchBody,
  HttpError,
  initialCursor,
  nextCursor,
  normalizeSortValue,
  UsaSpendingClient,
  type AwardDetail,
  type FetchLike,
  type SearchResponse,
} from "../src/usaspending.js";

const fixture = <T>(name: string): T =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
  ) as T;

const page1 = fixture<SearchResponse>("search-page-1.json");
const page2 = fixture<SearchResponse>("search-page-2.json");
const detail = fixture<AwardDetail>("award-detail.json");
const NOW = new Date("2026-09-29T15:00:00Z");

describe("input", () => {
  it("applies defaults", () => {
    const i = normalizeInput({});
    expect(i.endsInMonthsMin).toBe(6);
    expect(i.endsInMonthsMax).toBe(18);
    expect(i.awardTypes).toEqual(["A", "B", "C", "D"]);
    expect(i.maxResults).toBe(25);
  });

  it("validates", () => {
    expect(() =>
      normalizeInput({ endsInMonthsMin: 12, endsInMonthsMax: 6 }),
    ).toThrow(InputError);
    expect(() => normalizeInput({ awardTypes: ["IDV_A"] })).toThrow(InputError);
    expect(() => normalizeInput({ naicsCodes: ["54151"] })).toThrow(InputError);
    expect(() =>
      normalizeInput({ minAwardValue: 10, maxAwardValue: 5 }),
    ).toThrow(InputError);
  });

  it("computes the date window", () => {
    const w = computeWindow(normalizeInput({}), NOW);
    expect(w).toEqual({
      today: "2026-09-29",
      start: "2027-03-29",
      end: "2028-03-29",
    });
    expect(addMonths(new Date("2027-01-31T00:00:00Z"), 1).toISOString()).toBe(
      "2027-02-28T00:00:00.000Z",
    );
  });

  it("hashes only search-defining fields, order-insensitively", () => {
    const a = normalizeInput({ naicsCodes: ["11", "22"], maxResults: 5 });
    const b = normalizeInput({ naicsCodes: ["22", "11"], maxResults: 99 });
    const c = normalizeInput({ naicsCodes: ["33"] });
    expect(inputHash(a)).toBe(inputHash(b));
    expect(inputHash(a)).not.toBe(inputHash(c));
  });
});

describe("request building", () => {
  it("maps inputs to USAspending filters", () => {
    const input = normalizeInput({
      naicsCodes: ["541512"],
      pscCodes: ["da01"],
      awardingAgencies: ["Department of Defense"],
      awardingSubAgencies: ["Department of the Army"],
      placeOfPerformanceStates: ["va", "MD"],
      setAsideTypes: ["sba"],
      awardTypes: ["C", "D"],
      minAwardValue: 100,
      maxAwardValue: 200,
      keywords: ["cloud"],
    });
    const body = buildSearchBody(
      input,
      initialCursor(computeWindow(input, NOW)),
    );
    expect(body).toMatchObject({
      sort: "End Date",
      order: "asc",
      limit: 100,
      subawards: false,
      last_record_sort_value: "2027-03-29",
      last_record_unique_id: 0,
      filters: {
        award_type_codes: ["C", "D"],
        naics_codes: ["541512"],
        psc_codes: ["DA01"],
        keywords: ["cloud"],
        set_aside_type_codes: ["SBA"],
        agencies: [
          { type: "awarding", tier: "toptier", name: "Department of Defense" },
          { type: "awarding", tier: "subtier", name: "Department of the Army" },
        ],
        place_of_performance_locations: [
          { country: "USA", state: "VA" },
          { country: "USA", state: "MD" },
        ],
        award_amounts: [{ lower_bound: 100, upper_bound: 200 }],
      },
    });
    expect(body.fields).toContain("End Date");
  });

  it("normalizes epoch-millis sort values to yyyy-MM-dd", () => {
    expect(normalizeSortValue("1814313600000")).toBe("2027-06-30");
    expect(normalizeSortValue("2027-06-30")).toBe("2027-06-30");
    expect(nextCursor(page1.page_metadata)).toEqual({
      sortValue: "2027-06-30",
      uniqueId: 100002,
    });
    expect(
      nextCursor({ page: 1, hasNext: false, last_record_sort_value: "None" }),
    ).toBeNull();
  });
});

describe("transform", () => {
  it("merges search row and award detail", () => {
    const r = toContractRecord(page1.results[0]!, detail, "2026-09-29");
    expect(r).toMatchObject({
      awardId: "CONT_AWD_36C10B22C0001_3600_-NONE-_-NONE-",
      piid: "36C10B22C0001",
      recipientName: "ACME FEDERAL SOLUTIONS LLC",
      recipientUei: "ABCDEF123456",
      awardingAgency: "Department of Veterans Affairs",
      awardingOffice: "TECHNOLOGY ACQUISITION CENTER NJ (36C10B)",
      naicsCode: "541512",
      pscCode: "DA01",
      setAsideType: "SDVOSBC",
      numberOfOffers: 3,
      obligatedAmount: 4250000.5,
      currentValue: 5100000,
      potentialValue: 8750000,
      startDate: "2022-04-01",
      currentEndDate: "2027-03-29",
      potentialEndDate: "2029-03-31",
      daysUntilExpiry: 181,
      placeOfPerformance: { state: "VA", city: "ARLINGTON", zip: "22201" },
      usaspendingUrl:
        "https://www.usaspending.gov/award/CONT_AWD_36C10B22C0001_3600_-NONE-_-NONE-",
    });
  });

  it("works from the search row alone", () => {
    const r = toContractRecord(page1.results[1]!, null, "2026-09-29");
    expect(r.recipientName).toBe("BETA SYSTEMS INC");
    expect(r.piid).toBe("36C10B22C0002");
    expect(r.naicsCode).toBe("541512");
    expect(r.potentialValue).toBeNull();
    expect(r.placeOfPerformance.state).toBe("VA");
    expect(r.lastModifiedDate).toBe("2026-08-14");
  });
});

const fakeClient = (pages: SearchResponse[]) => {
  const searchContracts = vi.fn(async () => {
    const p = pages.shift();
    if (!p) throw new Error("no more pages");
    return structuredClone(p);
  });
  const getAward = vi.fn(async (id: string) => ({
    ...structuredClone(detail),
    generated_unique_award_id: id,
    piid: id.split("_")[2]!,
  }));
  return { searchContracts, getAward };
};

describe("runRadar", () => {
  const input = normalizeInput({});
  const window = computeWindow(input, NOW);

  it("paginates with search_after and stops past the window end", async () => {
    const client = fakeClient([page1, page2]);
    const out: ContractRecord[] = [];
    const stats = await runRadar(input, window, {
      client,
      emit: async (r) => (out.push(r), true),
    });
    expect(out.map((r) => r.piid)).toEqual([
      "36C10B22C0001",
      "36C10B22C0002",
      "36C10B22C0003",
    ]);
    expect(stats).toMatchObject({
      emitted: 3,
      pages: 2,
      stopReason: "windowEnd",
      mode: "search_after",
    });
    const second = client.searchContracts.mock.calls[1] as unknown as [
      Record<string, unknown>,
    ];
    expect(second[0].last_record_sort_value).toBe("2027-06-30");
    expect(second[0].last_record_unique_id).toBe(100002);
  });

  it("respects maxResults and budget", async () => {
    let out = 0;
    let stats = await runRadar({ ...input, maxResults: 2 }, window, {
      client: fakeClient([page1, page2]),
      emit: async () => (out++, true),
    });
    expect(stats.stopReason).toBe("maxResults");
    expect(out).toBe(2);

    stats = await runRadar(input, window, {
      client: fakeClient([page1, page2]),
      emit: async () => false,
    });
    expect(stats).toMatchObject({ emitted: 1, stopReason: "budget" });
  });

  it("skips previously seen awards in onlyNew mode", async () => {
    const seen = new Set([page1.results[0]!.generated_internal_id]);
    const stats = await runRadar({ ...input, onlyNew: true }, window, {
      client: fakeClient([page1, page2]),
      seen: { has: (id) => seen.has(id), add: (id) => void seen.add(id) },
      emit: async () => true,
    });
    expect(stats).toMatchObject({ emitted: 2, skippedSeen: 1 });
    expect(seen.size).toBe(3);
  });

  it("filters by potential value", async () => {
    const stats = await runRadar(
      { ...input, minPotentialValue: 9_000_000 },
      window,
      { client: fakeClient([page1, page2]), emit: async () => true },
    );
    expect(stats).toMatchObject({ emitted: 0, skippedFilter: 3 });
  });

  it("falls back to paged mode if search_after is rejected", async () => {
    const calls: Record<string, unknown>[] = [];
    const descPage: SearchResponse = {
      ...page2,
      results: [...page2.results]
        .reverse()
        .concat(page1.results.slice().reverse()),
      page_metadata: { page: 1, hasNext: false },
    };
    const client = {
      searchContracts: vi.fn(async (body: Record<string, unknown>) => {
        calls.push(body);
        if ("last_record_unique_id" in body)
          throw new HttpError(422, "bad", "x");
        return structuredClone(descPage);
      }),
      getAward: vi.fn(async () => detail),
    };
    const out: string[] = [];
    const stats = await runRadar({ ...input, includeDetails: false }, window, {
      client,
      emit: async (r) => (out.push(r.piid!), true),
    });
    expect(stats.mode).toBe("paged");
    expect(out).toEqual(["36C10B22C0003", "36C10B22C0002", "36C10B22C0001"]);
    expect(calls[1]).toMatchObject({ order: "desc", page: 1 });
    expect(client.getAward).not.toHaveBeenCalled();
  });
});

describe("UsaSpendingClient", () => {
  const res = (status: number, body: unknown, headers = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: async () => JSON.stringify(body),
  });

  it("retries 429/5xx with backoff, honoring Retry-After", async () => {
    const responses = [
      res(429, {}, { "retry-after": "2" }),
      res(503, {}),
      res(200, page1),
    ];
    const fetch = vi.fn(async () => responses.shift()!) as unknown as FetchLike;
    const sleep = vi.fn(async () => {});
    const client = new UsaSpendingClient({ fetch, sleep, baseDelayMs: 10 });
    const out = await client.searchContracts({});
    expect(out.results).toHaveLength(2);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls[0]).toEqual([2000]);
  });

  it("does not retry 4xx and gives up after maxRetries", async () => {
    const sleep = vi.fn(async () => {});
    const bad = new UsaSpendingClient({
      fetch: (async () => res(400, { detail: "nope" })) as FetchLike,
      sleep,
    });
    await expect(bad.getAward("x")).rejects.toMatchObject({ status: 400 });
    expect(sleep).not.toHaveBeenCalled();

    const down = new UsaSpendingClient({
      fetch: (async () => res(500, {})) as FetchLike,
      sleep,
      maxRetries: 2,
    });
    await expect(down.getAward("x")).rejects.toMatchObject({ status: 500 });
    expect(sleep).toHaveBeenCalledTimes(2);
  });
});

describe("PersistentSeenStore", () => {
  it("round-trips through a key-value store", async () => {
    const data = new Map<string, unknown>();
    const kv: KeyValueLike = {
      getValue: async <T>(k: string) => (data.get(k) as T) ?? null,
      setValue: async (k, v) => void data.set(k, v),
    };
    const a = await PersistentSeenStore.open(kv, "h");
    a.add("x");
    await a.save();
    const b = await PersistentSeenStore.open(kv, "h");
    expect(b.has("x")).toBe(true);
    expect((await PersistentSeenStore.open(kv, "other")).has("x")).toBe(false);
  });
});
