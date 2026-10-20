import {
  BOARD_NAMES,
  PLATFORM_NAMES,
  parseBaidu,
  parseBilibili,
  parseDouyinBillboard,
  parseDouyinWeb,
  parseToutiao,
  type BoardRow,
  type Platform,
} from "./boards.js";
import { HttpError, isUnreachable, type Page } from "./http.js";
import type { NormalizedInput } from "./input.js";
import { Robots } from "./robots.js";

export const CHARGE_EVENT = "trend";

export interface TrendItem extends BoardRow {
  platform: Platform;
  /** Platform name in English and Chinese. */
  platformName: string;
  /** Board name in Chinese. */
  board: string;
  /** When the board was fetched (ISO 8601). */
  fetchedAt: string;
}

export interface RunDeps {
  /** GET a URL (throws HttpError on non-2xx). */
  get: (url: string, headers?: Record<string, string>) => Promise<Page>;
  /** Push one item (charged). Return `false` to stop (budget reached). */
  emit: (item: TrendItem) => Promise<boolean>;
  log?: (msg: string) => void;
  now?: () => Date;
}

export interface PlatformResult {
  platform: Platform;
  status: "ok" | "empty" | "robotsDisallowed" | "failed" | "skipped";
  items: number;
  /** The endpoint the rows came from. */
  source: string | null;
  error: string | null;
}

export interface RunStats {
  items: number;
  platforms: PlatformResult[];
  stopReason: "done" | "budget";
}

export const URLS = {
  douyinBillboard:
    "https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/",
  douyinHome: "https://www.douyin.com/",
  douyinWeb:
    "https://www.douyin.com/aweme/v1/web/hot/search/list/?device_platform=webapp&aid=6383&channel=channel_pc_web&detail_list=1",
  baidu: "https://top.baidu.com/api/board?tab=realtime",
  toutiao: "https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc",
  bilibili: "https://s.search.bilibili.com/main/hotword",
} as const;

const errMsg = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).slice(0, 300);

export class RobotsDisallowed extends Error {}

/** robots.txt per origin, fetched once per run (RFC 9309 semantics). */
export class RobotsCache {
  private readonly cache = new Map<string, Promise<Robots>>();
  constructor(private readonly get: RunDeps["get"]) {}

  private async load(origin: string): Promise<Robots> {
    try {
      const p = await this.get(`${origin}/robots.txt`, {
        accept: "text/plain,*/*;q=0.5",
      });
      // An HTML page instead of robots.txt means "none".
      return /<html/i.test(p.body.slice(0, 500))
        ? Robots.allowAll()
        : Robots.parse(p.body);
    } catch (e) {
      // 4xx = no rules; 5xx or unreachable = disallow all.
      if (e instanceof HttpError && e.status < 500 && e.status !== 429)
        return Robots.allowAll();
      return Robots.disallowAll();
    }
  }

  async check(url: string): Promise<void> {
    const u = new URL(url);
    let r = this.cache.get(u.origin);
    if (!r) {
      r = this.load(u.origin);
      this.cache.set(u.origin, r);
    }
    if (!(await r).isAllowed(u.pathname + u.search))
      throw new RobotsDisallowed(
        `robots.txt of ${u.host} disallows ${u.pathname}`,
      );
  }
}

interface Fetched {
  rows: BoardRow[];
  source: string;
}

/** GET a URL after checking robots.txt. */
const fetchAllowed = async (
  deps: RunDeps,
  robots: RobotsCache,
  url: string,
  headers?: Record<string, string>,
) => {
  await robots.check(url);
  return deps.get(url, headers);
};

async function fetchDouyin(
  deps: RunDeps,
  robots: RobotsCache,
  log: (m: string) => void,
): Promise<Fetched> {
  let first: unknown;
  try {
    const p = await fetchAllowed(deps, robots, URLS.douyinBillboard);
    const rows = parseDouyinBillboard(p.body);
    if (rows.length) return { rows, source: URLS.douyinBillboard };
    first = new Error("Douyin billboard returned no words");
  } catch (e) {
    first = e;
  }
  log(`douyin: billboard API failed (${errMsg(first)}); trying douyin.com.`);
  // The web board wants the cookies the home page sets.
  let cookies: string[] = [];
  try {
    cookies = (await fetchAllowed(deps, robots, URLS.douyinHome)).cookies;
  } catch (e) {
    if (e instanceof RobotsDisallowed) throw e;
    log(`douyin: home page failed (${errMsg(e)}); trying without cookies.`);
  }
  const headers: Record<string, string> = { referer: URLS.douyinHome };
  if (cookies.length) headers.cookie = cookies.join("; ");
  const p = await fetchAllowed(deps, robots, URLS.douyinWeb, headers);
  return { rows: parseDouyinWeb(p.body), source: URLS.douyinWeb };
}

async function fetchSimple(
  deps: RunDeps,
  robots: RobotsCache,
  url: string,
  parse: (body: string) => BoardRow[],
  headers?: Record<string, string>,
): Promise<Fetched> {
  const p = await fetchAllowed(deps, robots, url, headers);
  return { rows: parse(p.body), source: url };
}

export function fetchBoard(
  platform: Platform,
  deps: RunDeps,
  robots: RobotsCache,
  log: (m: string) => void,
): Promise<Fetched> {
  switch (platform) {
    case "douyin":
      return fetchDouyin(deps, robots, log);
    case "baidu":
      return fetchSimple(deps, robots, URLS.baidu, parseBaidu);
    case "toutiao":
      return fetchSimple(deps, robots, URLS.toutiao, parseToutiao, {
        referer: "https://www.toutiao.com/",
      });
    case "bilibili":
      return fetchSimple(deps, robots, URLS.bilibili, parseBilibili, {
        referer: "https://www.bilibili.com/",
      });
  }
}

/** Fetches each board in turn; a failing board is logged and skipped. */
export async function runBoards(
  input: NormalizedInput,
  deps: RunDeps,
): Promise<RunStats> {
  const log = deps.log ?? (() => {});
  const now = deps.now ?? (() => new Date());
  const robots = new RobotsCache(deps.get);
  const stats: RunStats = { items: 0, platforms: [], stopReason: "done" };

  for (const platform of input.platforms) {
    const res: PlatformResult = {
      platform,
      status: "ok",
      items: 0,
      source: null,
      error: null,
    };
    stats.platforms.push(res);
    if (stats.stopReason === "budget") {
      res.status = "skipped";
      continue;
    }
    let fetched: Fetched;
    try {
      fetched = await fetchBoard(platform, deps, robots, log);
    } catch (e) {
      res.status =
        e instanceof RobotsDisallowed ? "robotsDisallowed" : "failed";
      res.error = isUnreachable(e) ? `unreachable: ${errMsg(e)}` : errMsg(e);
      log(`${platform}: ${res.status} (${res.error})`);
      continue;
    }
    res.source = fetched.source;
    const rows = input.maxItemsPerPlatform
      ? fetched.rows.slice(0, input.maxItemsPerPlatform)
      : fetched.rows;
    if (!rows.length) {
      res.status = "empty";
      log(`${platform}: the board returned no rows.`);
      continue;
    }
    const fetchedAt = now().toISOString();
    for (const r of rows) {
      const more = await deps.emit({
        platform,
        platformName: PLATFORM_NAMES[platform],
        board: BOARD_NAMES[platform],
        ...r,
        fetchedAt,
      });
      res.items += 1;
      stats.items += 1;
      if (!more) {
        stats.stopReason = "budget";
        break;
      }
    }
  }
  return stats;
}
