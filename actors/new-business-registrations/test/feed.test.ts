import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ADAPTERS, STATE_CODES } from "../src/adapters/index.js";
import { buildWhere, recordUrl } from "../src/adapters/types.js";
import {
  computeWindow,
  inputHash,
  InputError,
  normalizeInput,
} from "../src/input.js";
import { categorize, type BusinessRecord, type Row } from "../src/record.js";
import { runFeed, seenKey } from "../src/run.js";
import {
  resourceUrl,
  SocrataClient,
  type FetchLike,
  type SoqlQuery,
} from "../src/socrata.js";
import { PersistentSeenStore, type KeyValueLike } from "../src/state.js";

const fixture = (name: string): Row[] =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
  ) as Row[];

const FIXTURES: Record<string, Row[]> = {
  "4ykn-tg5h": fixture("co.json"),
  "n9v6-gdp6": fixture("ny.json"),
  "tckn-sxa6": fixture("or.json"),
  "n7gp-d28j": fixture("ct.json"),
  "xvd7-5r2c": fixture("pa.json"),
  "9cir-efmm": fixture("tx.json"),
};
const OR_ENRICH = fixture("or-enrich.json");
const NOW = new Date("2026-09-29T15:00:00Z");
const noFilters = { cities: [], zipCodes: [], counties: [], nameKeywords: [] };

/** Fake Socrata: serves each dataset's fixture once (one short page). */
const fakeClient = (overrides: Record<string, () => Row[]> = {}) => {
  const query = vi.fn(async (_d: string, id: string, q: SoqlQuery) => {
    if (overrides[id]) return overrides[id]();
    if (id === "tckn-sxa6" && q.where?.includes("MAILING ADDRESS"))
      return structuredClone(OR_ENRICH);
    if (q.offset) return [];
    return structuredClone(FIXTURES[id] ?? []);
  });
  return { query };
};

describe("input", () => {
  it("applies defaults", () => {
    const i = normalizeInput({});
    expect(i.states).toEqual(STATE_CODES);
    expect(i.formedWithinDays).toBe(30);
    expect(i.maxResults).toBe(100);
    expect(i.entityTypes).toEqual([]);
    expect(i.onlyNew).toBe(false);
  });

  it("normalizes and validates", () => {
    const i = normalizeInput({
      states: ["ny", "co"],
      entityTypes: ["LLC"],
      counties: ["Kings County"],
      nameKeywords: [" roofing "],
    });
    expect(i.states).toEqual(["NY", "CO"]);
    expect(i.entityTypes).toEqual(["llc"]);
    expect(i.counties).toEqual(["KINGS"]);
    expect(i.nameKeywords).toEqual(["ROOFING"]);
    expect(() => normalizeInput({ states: ["ZZ"] })).toThrow(InputError);
    expect(() => normalizeInput({ entityTypes: ["trust"] })).toThrow(
      InputError,
    );
    expect(() => normalizeInput({ zipCodes: ["8020A"] })).toThrow(InputError);
    expect(() => normalizeInput({ formedAfter: "09/01/2026" })).toThrow(
      InputError,
    );
    expect(() =>
      normalizeInput({ formedAfter: "2026-09-10", formedBefore: "2026-09-01" }),
    ).toThrow(InputError);
    expect(() => normalizeInput({ formedWithinDays: 0 })).toThrow(InputError);
  });

  it("computes the formation window", () => {
    expect(computeWindow(normalizeInput({}), NOW)).toEqual({
      from: "2026-08-30",
      to: "2026-09-29",
    });
    expect(
      computeWindow(
        normalizeInput({
          formedAfter: "2026-01-01",
          formedBefore: "2026-01-31",
        }),
        NOW,
      ),
    ).toEqual({ from: "2026-01-01", to: "2026-01-31" });
  });

  it("hashes only search-defining fields, order-insensitively", () => {
    const a = normalizeInput({ states: ["CO", "NY"], maxResults: 5 });
    const b = normalizeInput({ states: ["NY", "CO"], maxResults: 99 });
    const c = normalizeInput({ states: ["CO"] });
    expect(inputHash(a)).toBe(inputHash(b));
    expect(inputHash(a)).not.toBe(inputHash(c));
  });
});

describe("SoQL building", () => {
  const window = { from: "2026-09-01", to: "2026-09-29" };

  it("builds the date window and base filter", () => {
    expect(buildWhere(ADAPTERS.CO, window, noFilters)).toBe(
      "entityformdate >= '2026-09-01T00:00:00' AND entityformdate < '2026-09-30T00:00:00'",
    );
    expect(buildWhere(ADAPTERS.OR, window, noFilters)).toContain(
      "(associated_name_type = 'PRINCIPAL PLACE OF BUSINESS' AND entity_type not in ('ASSUMED BUSINESS NAME', 'RESERVED NAME'))",
    );
  });

  it("pushes city, ZIP, county and keyword filters", () => {
    const where = buildWhere(ADAPTERS.NY, window, {
      cities: ["BROOKLYN", "QUEENS"],
      zipCodes: ["112"],
      counties: ["KINGS"],
      nameKeywords: ["O'BRIEN", "50%"],
    });
    expect(where).toContain(
      "(upper(location_city) in ('BROOKLYN', 'QUEENS') OR upper(dos_process_city) in ('BROOKLYN', 'QUEENS'))",
    );
    expect(where).toContain(
      "(location_zip like '112%' OR dos_process_zip like '112%')",
    );
    expect(where).toContain("upper(county) like 'KINGS%'");
    expect(where).toContain(
      "(upper(current_entity_name) like '%O''BRIEN%' OR upper(current_entity_name) like '%50%')",
    );
  });

  it("returns null when a county filter can't be applied", () => {
    expect(
      buildWhere(ADAPTERS.CO, window, { ...noFilters, counties: ["DENVER"] }),
    ).toBeNull();
  });

  it("builds resource and record URLs", () => {
    expect(
      resourceUrl("data.ny.gov", "n9v6-gdp6", {
        where: "a = 'b'",
        order: "x DESC, :id",
        limit: 10,
        offset: 20,
      }),
    ).toBe(
      "https://data.ny.gov/resource/n9v6-gdp6.json?%24where=a+%3D+%27b%27&%24order=x+DESC%2C+%3Aid&%24limit=10&%24offset=20",
    );
    expect(recordUrl(ADAPTERS.CO, "123")).toBe(
      "https://data.colorado.gov/resource/4ykn-tg5h.json?%24where=entityid+%3D+%27123%27",
    );
  });
});

describe("adapters", () => {
  const map = (code: keyof typeof ADAPTERS, file: string) =>
    FIXTURES[file]!.map((r) => ADAPTERS[code].toRecord(r)!);

  it("CO", () => {
    const [a, b, c] = map("CO", "4ykn-tg5h");
    expect(a).toMatchObject({
      state: "CO",
      entityId: "20261234567",
      name: "Mile High Roofing LLC",
      entityType: "DLLC",
      entityCategory: "llc",
      status: "Good Standing",
      formationDate: "2026-09-25",
      jurisdiction: "CO",
      principalAddress: {
        street: "1600 Broadway",
        street2: "Suite 200",
        city: "Denver",
        state: "CO",
        zip: "80202",
        country: "US",
      },
      mailingAddress: { street: "PO Box 123", zip: "80201" },
      registeredAgentName: "Jane Q Doe",
      registeredAgentAddress: { street: "1600 Broadway", city: "Denver" },
      sourceDataset:
        "data.colorado.gov/4ykn-tg5h (Business Entities in Colorado)",
    });
    expect(b).toMatchObject({
      entityCategory: "corporation",
      mailingAddress: null,
      registeredAgentName: "Registered Agents Inc.",
      registeredAgentAddress: { street: "30 N Gould St", state: "WY" },
    });
    expect(c).toMatchObject({
      entityCategory: "nonprofit",
      principalAddress: { city: "Denver", street: null },
      registeredAgentName: null,
      registeredAgentAddress: null,
    });
  });

  it("NY", () => {
    const [a, b] = map("NY", "n9v6-gdp6");
    expect(a).toMatchObject({
      entityId: "7012345",
      entityCategory: "llc",
      status: "Active",
      county: "KINGS",
      principalAddress: null,
      mailingAddress: { street: "100 ATLANTIC AVE", city: "BROOKLYN" },
      registeredAgentName: "NORTHWEST REGISTERED AGENT LLC",
      registeredAgentAddress: { street2: "STE 700", zip: "12207" },
    });
    expect(b).toMatchObject({
      entityCategory: "corporation",
      jurisdiction: "DELAWARE",
      principalAddress: { street: "350 5TH AVE", zip: "10118" },
      registeredAgentName: null,
    });
  });

  it("CT, PA, TX", () => {
    const [ct1, ct2] = map("CT", "n7gp-d28j");
    expect(ct1).toMatchObject({
      entityId: "2912345",
      entityCategory: "llc",
      jurisdiction: "Connecticut",
      principalAddress: { street: "55 Church St", zip: "06510" },
    });
    expect(ct2!.entityCategory).toBe("nonprofit");

    const [pa] = map("PA", "xvd7-5r2c");
    expect(pa).toMatchObject({
      entityId: "0014567890",
      entityCategory: "llc",
      county: "ALLEGHENY",
      status: null,
      principalAddress: { street: "100 GRANT ST", city: "PITTSBURGH" },
    });

    const [tx1, tx2] = map("TX", "9cir-efmm");
    expect(tx1).toMatchObject({
      entityId: "0805512345",
      entityType: "Texas Limited Liability Company",
      entityCategory: "llc",
      status: "Active",
      formationDate: "2026-09-10",
      principalAddress: null,
      mailingAddress: { street: "257 WESTWOOD DR", city: "LEAGUE CITY" },
    });
    expect(tx2!.entityCategory).toBe("corporation");
  });

  it("OR enriches mailing address and registered agent", async () => {
    const recs = map("OR", "tckn-sxa6");
    const client = fakeClient();
    await ADAPTERS.OR.enrich!(recs, client);
    expect(client.query.mock.calls[0]![2].where).toBe(
      "registry_number in ('262244792', '261783394') AND associated_name_type in ('MAILING ADDRESS', 'REGISTERED AGENT')",
    );
    expect(recs[0]).toMatchObject({
      principalAddress: { street: "942 WINDEMERE DR NW", zip: "97304" },
      mailingAddress: { street: "PO BOX 42" },
      registeredAgentName: "STEPHANIE OTT",
      registeredAgentAddress: { street2: "UNIT A", city: "LINCOLN CITY" },
    });
    expect(recs[1]!.registeredAgentName).toBe("CT CORPORATION SYSTEM");
  });

  it("skips rows without id or name", () => {
    for (const a of Object.values(ADAPTERS)) expect(a.toRecord({})).toBeNull();
  });

  it("categorizes raw entity types", () => {
    expect(categorize("DOMESTIC LIMITED LIABILITY COMPANY")).toBe("llc");
    expect(categorize("DOMESTIC LIMITED LIABILITY PARTNERSHIP")).toBe(
      "partnership",
    );
    expect(categorize("Limited Partnership")).toBe("partnership");
    expect(categorize("DOMESTIC NOT-FOR-PROFIT CORPORATION")).toBe("nonprofit");
    expect(categorize("Stock")).toBe("corporation");
    expect(categorize("DOMESTIC PROFESSIONAL CORPORATION")).toBe("corporation");
    expect(categorize("Statutory Trust")).toBe("other");
    expect(categorize(null)).toBe("other");
  });
});

describe("runFeed", () => {
  const input = normalizeInput({});
  const window = computeWindow(input, NOW);

  it("interleaves states round-robin and collapses multi-row entities", async () => {
    const out: BusinessRecord[] = [];
    const stats = await runFeed(input, window, {
      client: fakeClient(),
      emit: async (r) => (out.push(r), true),
    });
    expect(out.slice(0, 6).map((r) => r.state)).toEqual(STATE_CODES);
    // CO 3 + CT 2 + NY 2 + OR 2 + PA 2 (3 rows, 2 filings) + TX 2
    expect(stats.emitted).toBe(13);
    expect(stats.stopReason).toBe("exhausted");
    expect(stats.states.PA).toMatchObject({ rows: 3, emitted: 2 });
    expect(out.find((r) => r.state === "OR")!.registeredAgentName).toBe(
      "STEPHANIE OTT",
    );
  });

  it("pages with $offset until a short page", async () => {
    const page = FIXTURES["4ykn-tg5h"]!;
    const client = {
      query: vi.fn(async (_d: string, _id: string, q: SoqlQuery) =>
        q.offset === 0
          ? structuredClone(page.slice(0, 2))
          : structuredClone(page.slice(2)),
      ),
    };
    const stats = await runFeed({ ...input, states: ["CO"] }, window, {
      client,
      pageSize: 2,
      emit: async () => true,
    });
    expect(stats.states.CO).toMatchObject({
      pages: 2,
      emitted: 3,
      status: "exhausted",
    });
    expect(client.query.mock.calls[1]![2]).toMatchObject({
      offset: 2,
      limit: 2,
      order: "entityformdate DESC, :id",
    });
  });

  it("respects maxResults and budget", async () => {
    let n = 0;
    let stats = await runFeed({ ...input, maxResults: 4 }, window, {
      client: fakeClient(),
      emit: async () => (n++, true),
    });
    expect(stats.stopReason).toBe("maxResults");
    expect(n).toBe(4);

    stats = await runFeed(input, window, {
      client: fakeClient(),
      emit: async () => false,
    });
    expect(stats).toMatchObject({ emitted: 1, stopReason: "budget" });
  });

  it("filters by entity category", async () => {
    const out: BusinessRecord[] = [];
    const stats = await runFeed(
      { ...input, entityTypes: ["nonprofit"] },
      window,
      { client: fakeClient(), emit: async (r) => (out.push(r), true) },
    );
    expect(out.map((r) => r.name).sort()).toEqual([
      "Hartford Youth Soccer, Inc.",
      "Rocky Mountain Food Pantry",
    ]);
    expect(stats.states.CO!.skippedFilter).toBe(2);
  });

  it("skips previously seen businesses in onlyNew mode", async () => {
    const seen = new Set(["CO:20261234567", "TX:0805512345"]);
    const stats = await runFeed({ ...input, onlyNew: true }, window, {
      client: fakeClient(),
      seen: { has: (id) => seen.has(id), add: (id) => void seen.add(id) },
      emit: async () => true,
    });
    expect(stats.emitted).toBe(11);
    expect(stats.states.CO!.skippedSeen).toBe(1);
    expect(seen.size).toBe(13);
    expect(seen.has(seenKey({ state: "PA", entityId: "0014567891" }))).toBe(
      true,
    );
  });

  it("skips states without counties when filtering by county", async () => {
    const client = fakeClient();
    const stats = await runFeed({ ...input, counties: ["KINGS"] }, window, {
      client,
      emit: async () => true,
    });
    expect(stats.states.CO!.status).toBe("skipped");
    expect(stats.states.NY!.status).toBe("exhausted");
    const queried = new Set(client.query.mock.calls.map((c) => c[1]));
    expect(queried).toEqual(new Set(["n9v6-gdp6", "xvd7-5r2c"]));
  });

  it("keeps going when one state fails, fails when all do", async () => {
    const logs: string[] = [];
    const stats = await runFeed(input, window, {
      client: fakeClient({
        "n9v6-gdp6": () => {
          throw new Error("boom");
        },
      }),
      log: (m) => logs.push(m),
      emit: async () => true,
    });
    expect(stats.states.NY).toMatchObject({ status: "failed", error: "boom" });
    expect(stats.emitted).toBe(11);
    expect(logs.some((l) => l.includes("NY: failed"))).toBe(true);

    await expect(
      runFeed({ ...input, states: ["NY"] }, window, {
        client: fakeClient({
          "n9v6-gdp6": () => {
            throw new Error("boom");
          },
        }),
        emit: async () => true,
      }),
    ).rejects.toThrow(/All states failed/);
  });

  it("emits records even if OR enrichment fails", async () => {
    const client = {
      query: vi.fn(async (_d: string, id: string, q: SoqlQuery) => {
        if (q.where?.includes("MAILING ADDRESS")) throw new Error("enrich");
        return q.offset ? [] : structuredClone(FIXTURES[id] ?? []);
      }),
    };
    const out: BusinessRecord[] = [];
    await runFeed({ ...input, states: ["OR"] }, window, {
      client,
      emit: async (r) => (out.push(r), true),
    });
    expect(out).toHaveLength(2);
    expect(out[0]!.registeredAgentName).toBeNull();
  });
});

describe("SocrataClient", () => {
  const res = (status: number, body: unknown, headers = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: async () => JSON.stringify(body),
  });

  it("retries 429/5xx with backoff, honoring Retry-After, and sends the app token", async () => {
    const responses = [
      res(429, {}, { "retry-after": "2" }),
      res(503, {}),
      res(200, [{ a: 1 }]),
    ];
    const fetch = vi.fn(async () => responses.shift()!);
    const sleep = vi.fn(async () => {});
    const client = new SocrataClient({
      fetch: fetch as unknown as FetchLike,
      sleep,
      appToken: "tok",
    });
    expect(await client.query("d.gov", "abcd-1234", { limit: 1 })).toEqual([
      { a: 1 },
    ]);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls[0]).toEqual([2000]);
    const [url, init] = fetch.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> },
    ];
    expect(url).toBe("https://d.gov/resource/abcd-1234.json?%24limit=1");
    expect(init.headers["x-app-token"]).toBe("tok");
  });

  it("does not retry 4xx and gives up after maxRetries", async () => {
    const sleep = vi.fn(async () => {});
    const bad = new SocrataClient({
      fetch: (async () => res(400, { message: "no-such-column" })) as FetchLike,
      sleep,
    });
    await expect(bad.query("d", "x", {})).rejects.toMatchObject({
      status: 400,
    });
    expect(sleep).not.toHaveBeenCalled();

    const down = new SocrataClient({
      fetch: (async () => res(500, {})) as FetchLike,
      sleep,
      maxRetries: 2,
    });
    await expect(down.query("d", "x", {})).rejects.toMatchObject({
      status: 500,
    });
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
    a.add("CO:1");
    await a.save();
    const b = await PersistentSeenStore.open(kv, "h");
    expect(b.has("CO:1")).toBe(true);
    expect((await PersistentSeenStore.open(kv, "other")).has("CO:1")).toBe(
      false,
    );
  });
});
