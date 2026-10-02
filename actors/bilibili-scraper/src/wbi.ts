import { createHash } from "node:crypto";

/**
 * WBI request signing, as used by bilibili.com's web client and documented in
 * SocialSisterYi/bilibili-API-collect (docs/misc/sign/wbi.md).
 */
export const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
];

/** "https://i0.hdslb.com/bfs/wbi/7cd08494...077c.png" -> "7cd08494...077c" */
export function keyFromUrl(url: string): string {
  const base = url.split("/").pop() ?? "";
  return base.split(".")[0] ?? "";
}

export function mixinKey(imgKey: string, subKey: string): string {
  const orig = imgKey + subKey;
  return MIXIN_KEY_ENC_TAB.map((i) => orig[i] ?? "")
    .join("")
    .slice(0, 32);
}

export type Params = Record<string, string | number>;

/** Returns the signed query string (params + wts + w_rid). */
export function signQuery(params: Params, mixin: string, wts: number): string {
  const all: Params = { ...params, wts };
  const query = Object.keys(all)
    .sort()
    .map(
      (k) =>
        `${encodeURIComponent(k)}=${encodeURIComponent(String(all[k]).replace(/[!'()*]/g, ""))}`,
    )
    .join("&");
  const wRid = createHash("md5")
    .update(query + mixin)
    .digest("hex");
  return `${query}&w_rid=${wRid}`;
}

export function plainQuery(params: Params): string {
  return new URLSearchParams(
    Object.entries(params).map(([k, v]): [string, string] => [k, String(v)]),
  ).toString();
}
