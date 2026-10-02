import { describe, expect, it } from "vitest";
import { HttpClient, HttpError, type FetchLike } from "../src/http.js";

const res = (status: number, body = "") => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  text: async () => body,
});

function client(statuses: number[]) {
  let now = 0;
  const sleeps: number[] = [];
  const calls: string[] = [];
  const fetch: FetchLike = async (url) => {
    calls.push(url);
    return res(statuses.shift() ?? 200, "ok");
  };
  const http = new HttpClient({
    fetch,
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
  });
  return { http, sleeps, calls, tick: (ms: number) => (now += ms) };
}

describe("HttpClient", () => {
  it("spaces requests at least ~1 s apart", async () => {
    const c = client([]);
    await c.http.get("a");
    await c.http.get("b");
    await c.http.get("c");
    expect(c.sleeps.length).toBe(2);
    expect(c.sleeps.every((ms) => ms >= 1000 && ms <= 1500)).toBe(true);
  });

  it("returns null on 404 and retries 429/503 with backoff", async () => {
    const c = client([404, 429, 503, 200]);
    expect(await c.http.get("a")).toBeNull();
    expect(await c.http.get("b")).toBe("ok");
    expect(c.calls).toEqual(["a", "b", "b", "b"]);
    expect(c.sleeps.filter((ms) => ms >= 1500).length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it("gives up after maxRetries and does not retry 400", async () => {
    const c = client([500, 500, 500, 500, 500]);
    await expect(c.http.get("a")).rejects.toThrow(HttpError);
    expect(c.calls.length).toBe(5);
    const d = client([400]);
    await expect(d.http.get("a")).rejects.toThrow(/HTTP 400/);
    expect(d.calls.length).toBe(1);
  });
});
