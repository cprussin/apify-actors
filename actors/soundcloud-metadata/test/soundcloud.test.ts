import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ClientIdError,
  ClientIdProvider,
  extractBundleUrls,
  extractClientId,
  HOMEPAGE,
} from "../src/client-id.js";
import { HttpClient, type FetchLike } from "../src/http.js";
import { InputError, normalizeInput } from "../src/input.js";
import {
  parseTagList,
  toItem,
  toPlaylist,
  toTrack,
  toUser,
  type RawPlaylist,
  type RawTrack,
  type RawUser,
} from "../src/item.js";
import { runScrape, type RunDeps } from "../src/run.js";
import { SoundCloudClient, SoundCloudError } from "../src/soundcloud.js";
import { parseTarget, TargetError } from "../src/target.js";

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const json = <T>(name: string): T => JSON.parse(fixture(name)) as T;

const TRACK = json<RawTrack>("track.json");
const USER = json<RawUser>("user.json");
const PLAYLIST = json<RawPlaylist>("playlist.json");
const HOMEPAGE_HTML = fixture("homepage.html");
const BUNDLE_ID = fixture("bundle.js.txt");
const BUNDLE_NOID = fixture("bundle-noid.js.txt");
const CLIENT_ID = "AbCdEf0123456789AbCdEf0123456789";

/** A fetch stub routed by URL. `routes` maps a URL to [status, body]. */
const resp = (status: number, body: string) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  text: async () => body,
});
const mockFetch =
  (route: (url: string) => { status: number; body: string }): FetchLike =>
  async (url) => {
    const { status, body } = route(url);
    return resp(status, body);
  };
const fastHttp = (fetch: FetchLike) =>
  new HttpClient({ fetch, baseDelayMs: 0, sleep: async () => {} });

describe("parseTarget", () => {
  it.each([
    ["https://soundcloud.com/edsheeran", "https://soundcloud.com/edsheeran"],
    [
      "soundcloud.com/edsheeran/shape-of-you",
      "https://soundcloud.com/edsheeran/shape-of-you",
    ],
    [
      "https://soundcloud.com/edsheeran/sets/divide?in=x",
      "https://soundcloud.com/edsheeran/sets/divide",
    ],
    [
      "https://www.soundcloud.com/edsheeran/",
      "https://soundcloud.com/edsheeran",
    ],
    [
      "https://m.soundcloud.com/edsheeran/track",
      "https://soundcloud.com/edsheeran/track",
    ],
  ])("normalizes %s", (input, url) => {
    expect(parseTarget(input).url).toBe(url);
  });

  it("passes through short links", () => {
    expect(parseTarget("https://on.soundcloud.com/abc123").url).toBe(
      "https://on.soundcloud.com/abc123",
    );
  });

  it.each([
    "https://example.com/foo",
    "https://youtube.com/watch",
    "https://soundcloud.com",
    "https://soundcloud.com/discover",
    "https://soundcloud.com/search?q=x",
    "",
  ])("rejects %s", (bad) => {
    expect(() => parseTarget(bad)).toThrow(TargetError);
  });
});

describe("client_id parsing", () => {
  it("extracts unique bundle URLs in order", () => {
    expect(extractBundleUrls(HOMEPAGE_HTML)).toEqual([
      "https://a-v2.sndcdn.com/assets/0-abc.js",
      "https://a-v2.sndcdn.com/assets/50-def.js",
    ]);
  });
  it("extracts the client_id from a bundle", () => {
    expect(extractClientId(BUNDLE_ID)).toBe(CLIENT_ID);
    expect(extractClientId(BUNDLE_NOID)).toBeNull();
  });
});

describe("ClientIdProvider", () => {
  // Homepage lists 0-abc then 50-def; provider tries newest-first (50-def),
  // which has no id, then falls back to 0-abc, which does.
  const route = (url: string) => {
    if (url.startsWith(HOMEPAGE)) return { status: 200, body: HOMEPAGE_HTML };
    if (url.endsWith("50-def.js")) return { status: 200, body: BUNDLE_NOID };
    if (url.endsWith("0-abc.js")) return { status: 200, body: BUNDLE_ID };
    return { status: 404, body: "" };
  };

  it("extracts and caches the client_id (skipping bundles without one)", async () => {
    const http = fastHttp(mockFetch(route));
    const p = new ClientIdProvider(http);
    expect(await p.get()).toBe(CLIENT_ID);
    const n = http.requests;
    expect(await p.get()).toBe(CLIENT_ID);
    expect(http.requests).toBe(n); // cached, no new requests
  });

  it("uses a seed without fetching, and refreshes on demand", async () => {
    const http = fastHttp(mockFetch(route));
    const p = new ClientIdProvider(http, "seed0000000000000000000000000000");
    expect(await p.get()).toBe("seed0000000000000000000000000000");
    expect(http.requests).toBe(0);
    expect(await p.refresh("seed0000000000000000000000000000")).toBe(CLIENT_ID);
  });

  it("throws when no bundle has an id", async () => {
    const http = fastHttp(
      mockFetch((url) =>
        url.startsWith(HOMEPAGE)
          ? { status: 200, body: HOMEPAGE_HTML }
          : { status: 200, body: BUNDLE_NOID },
      ),
    );
    await expect(new ClientIdProvider(http).get()).rejects.toThrow(
      ClientIdError,
    );
  });
});

describe("item mapping", () => {
  it("parses SoundCloud tag lists", () => {
    expect(parseTagList('Pop "deep house" chill')).toEqual([
      "Pop",
      "deep house",
      "chill",
    ]);
    expect(parseTagList(null)).toEqual([]);
  });

  it("maps a track", () => {
    const t = toTrack(TRACK, "src");
    expect(t).toMatchObject({
      type: "track",
      id: 406715293,
      title: "Shape of You",
      username: "Ed Sheeran",
      userUrl: "https://soundcloud.com/edsheeran",
      genre: "Pop",
      tags: ["Pop", "singer songwriter", "acoustic"],
      durationMs: 233840,
      playbackCount: 84266602,
      likesCount: 1049387,
      commentCount: 3120,
      streamable: true,
      downloadable: false,
      source: "src",
    });
    expect(t.createdAt).toBe("2017-01-06T00:00:00.000Z");
    expect(t.followersCount).toBeNull();
  });

  it("maps a user", () => {
    const u = toUser(USER, "src");
    expect(u).toMatchObject({
      type: "user",
      id: 8678091,
      username: "Ed Sheeran",
      followersCount: 2986991,
      trackCount: 468,
      verified: true,
      city: "Halifax",
      countryCode: "GB",
    });
    expect(u.playbackCount).toBeNull();
  });

  it("maps a playlist", () => {
    const p = toPlaylist(PLAYLIST, "src");
    expect(p).toMatchObject({
      type: "playlist",
      title: "Divide (Deluxe)",
      trackCount: 16,
      isAlbum: true,
      setType: "album",
      username: "Ed Sheeran",
    });
  });

  it("dispatches by kind, and returns null for unknown kinds", () => {
    expect(toItem(TRACK, "s")?.type).toBe("track");
    expect(toItem(USER, "s")?.type).toBe("user");
    expect(toItem(PLAYLIST, "s")?.type).toBe("playlist");
    expect(toItem({ kind: "comment" } as RawTrack, "s")).toBeNull();
  });
});

describe("normalizeInput", () => {
  it("defaults search type and limits", () => {
    const n = normalizeInput({ urls: ["soundcloud.com/edsheeran"] });
    expect(n.targets).toHaveLength(1);
    expect(n.searchType).toBe("tracks");
    expect(n.maxItems).toBe(10);
    expect(n.maxConcurrency).toBe(5);
  });

  it("dedupes URLs and keeps search", () => {
    const n = normalizeInput({
      urls: ["soundcloud.com/x", "https://soundcloud.com/x/"],
      search: " lofi ",
      searchType: "users",
      maxItems: 50,
    });
    expect(n.targets).toHaveLength(1);
    expect(n.search).toBe("lofi");
    expect(n.searchType).toBe("users");
  });

  it("caps maxItems and maxConcurrency", () => {
    const n = normalizeInput({
      search: "x",
      maxItems: 999999,
      maxConcurrency: 999,
    });
    expect(n.maxItems).toBe(1000);
    expect(n.maxConcurrency).toBe(20);
  });

  it("requires urls or search", () => {
    expect(() => normalizeInput({})).toThrow(InputError);
    expect(() => normalizeInput({ urls: [] })).toThrow(InputError);
  });

  it("rejects a bad search type and bad numbers", () => {
    expect(() => normalizeInput({ search: "x", searchType: "albums" })).toThrow(
      InputError,
    );
    expect(() => normalizeInput({ search: "x", maxItems: 0 })).toThrow(
      InputError,
    );
  });
});

describe("SoundCloudClient", () => {
  const seed = (fetch: FetchLike) =>
    new SoundCloudClient(
      fastHttp(fetch),
      new ClientIdProvider(fastHttp(fetch), CLIENT_ID),
    );

  it("resolves a URL to its object", async () => {
    const c = seed(
      mockFetch(() => ({ status: 200, body: fixture("track.json") })),
    );
    const obj = await c.resolve(
      "https://soundcloud.com/edsheeran/shape-of-you",
    );
    expect((obj as RawTrack).title).toBe("Shape of You");
  });

  it("returns null on 404", async () => {
    const c = seed(mockFetch(() => ({ status: 404, body: "not found" })));
    expect(await c.resolve("https://soundcloud.com/nope/nope")).toBeNull();
  });

  it("refreshes the client_id on a 401 and retries", async () => {
    const stale = "staleoldstaleoldstaleoldstaleold";
    const http = fastHttp(
      mockFetch((url) => {
        if (url.startsWith(HOMEPAGE))
          return { status: 200, body: HOMEPAGE_HTML };
        if (url.endsWith("0-abc.js")) return { status: 200, body: BUNDLE_ID };
        if (url.endsWith("50-def.js"))
          return { status: 200, body: BUNDLE_NOID };
        if (url.includes(`client_id=${stale}`))
          return { status: 401, body: "" };
        if (url.includes(`client_id=${CLIENT_ID}`))
          return { status: 200, body: fixture("track.json") };
        return { status: 400, body: "" };
      }),
    );
    const c = new SoundCloudClient(http, new ClientIdProvider(http, stale));
    const obj = await c.resolve(
      "https://soundcloud.com/edsheeran/shape-of-you",
    );
    expect((obj as RawTrack).title).toBe("Shape of You");
  });

  it("throws if 401 persists after a refresh", async () => {
    const http = fastHttp(
      mockFetch((url) => {
        if (url.startsWith(HOMEPAGE))
          return { status: 200, body: HOMEPAGE_HTML };
        if (url.endsWith("0-abc.js")) return { status: 200, body: BUNDLE_ID };
        if (url.endsWith("50-def.js"))
          return { status: 200, body: BUNDLE_NOID };
        return { status: 401, body: "" };
      }),
    );
    const c = new SoundCloudClient(
      http,
      new ClientIdProvider(http, "x".repeat(32)),
    );
    await expect(c.resolve("https://soundcloud.com/a/b")).rejects.toThrow(
      SoundCloudError,
    );
  });

  it("searches and maps a collection", async () => {
    const c = seed(
      mockFetch(() => ({ status: 200, body: fixture("search-tracks.json") })),
    );
    const out = await c.search("tracks", "lofi", 10);
    expect(out).toHaveLength(2);
    expect((out[0] as RawTrack).title).toBe("Lofi One");
  });

  it("stops search paging at max", async () => {
    const c = seed(
      mockFetch(() => ({ status: 200, body: fixture("search-tracks.json") })),
    );
    expect(await c.search("tracks", "lofi", 1)).toHaveLength(1);
  });
});

describe("runScrape", () => {
  const client: RunDeps["client"] = {
    resolve: async (url) => {
      if (url.includes("missing")) return null;
      if (url.includes("edsheeran/shape")) return TRACK;
      return USER;
    },
    search: async (_type, _q, max) =>
      [TRACK, USER, PLAYLIST].slice(0, max) as never,
  };

  it("resolves URLs and runs search, charging each item", async () => {
    const out: string[] = [];
    const stats = await runScrape(
      {
        targets: [
          { url: "https://soundcloud.com/edsheeran/shape", input: "a" },
          { url: "https://soundcloud.com/edsheeran", input: "b" },
          { url: "https://soundcloud.com/x/missing", input: "c" },
        ],
        search: "lofi",
        searchType: "tracks",
        maxItems: 2,
        maxConcurrency: 2,
      },
      { client, emit: async (i) => (out.push(i.type), true) },
    );
    expect(stats.resolved).toBe(2);
    expect(stats.notFound).toBe(1);
    expect(stats.searchResults).toBe(2);
    expect(stats.emitted).toBe(4);
    expect(out).toEqual(["track", "user", "track", "user"]);
  });

  it("stops at the budget", async () => {
    let n = 0;
    const stats = await runScrape(
      {
        targets: [],
        search: "lofi",
        searchType: "tracks",
        maxItems: 3,
        maxConcurrency: 1,
      },
      { client, emit: async () => ++n < 2 },
    );
    expect(stats.stopReason).toBe("budget");
    expect(stats.emitted).toBe(2);
  });
});
