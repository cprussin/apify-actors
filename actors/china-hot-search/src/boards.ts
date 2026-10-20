/** Parsers for the four hot-search boards (JSON bodies to rows). */

export const PLATFORMS = ["douyin", "baidu", "toutiao", "bilibili"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_NAMES: Record<Platform, string> = {
  douyin: "Douyin (抖音)",
  baidu: "Baidu (百度)",
  toutiao: "Toutiao (今日头条)",
  bilibili: "Bilibili (哔哩哔哩)",
};

export const BOARD_NAMES: Record<Platform, string> = {
  douyin: "抖音热榜",
  baidu: "百度热搜",
  toutiao: "头条热榜",
  bilibili: "B站热搜",
};

/** One board row, before `fetchedAt` and the platform names are added. */
export interface BoardRow {
  /** 1 = top of the board. */
  rank: number;
  /** The keyword or headline as shown (Chinese). */
  title: string;
  /** The platform's heat score; null when it shows none. */
  hotValue: number | null;
  /** Search or topic page for the keyword. */
  url: string;
  /** Badge as shown, e.g. 新, 热, 爆, 辟谣; null when none. */
  label: string | null;
  /** The badge in English, e.g. new, hot, explosive, debunk. */
  labelEn: string | null;
  /** Short summary (Baidu only). */
  description: string | null;
  /** Topic categories in English (Toutiao only). */
  categories: string[];
  /** Videos about the topic (Douyin web board only). */
  videoCount: number | null;
  /** When the topic started trending, ISO 8601 (Douyin web board only). */
  eventTime: string | null;
}

export class ParseError extends Error {}

type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string =>
  typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const isoFromUnix = (v: unknown): string | null => {
  const n = num(v);
  return n && n > 0 ? new Date(n * 1000).toISOString() : null;
};

export function parseJson(body: string, what: string): Obj {
  try {
    return obj(JSON.parse(body));
  } catch {
    throw new ParseError(
      `${what}: response is not JSON (${body.slice(0, 80).replace(/\s+/g, " ")})`,
    );
  }
}

const row = (r: Partial<BoardRow> & Pick<BoardRow, "rank" | "title" | "url">) =>
  ({
    hotValue: null,
    label: null,
    labelEn: null,
    description: null,
    categories: [],
    videoCount: null,
    eventTime: null,
    ...r,
  }) satisfies BoardRow;

/** Douyin `label` codes (from the badge images the web app shows). */
export const DOUYIN_LABELS: Record<number, [string, string]> = {
  1: ["新", "new"],
  2: ["商", "sponsored"],
  3: ["热", "hot"],
  4: ["爆", "explosive"],
  5: ["首发", "first release"],
  7: ["同城", "local"],
  8: ["独家", "exclusive"],
  9: ["挑战", "challenge"],
  10: ["当事人说", "first-hand"],
  16: ["辟谣", "debunk"],
  17: ["热议", "hot debate"],
};

const douyinLabel = (code: unknown) => {
  const l = DOUYIN_LABELS[num(code) ?? 0];
  return l ? { label: l[0], labelEn: l[1] } : {};
};

export const douyinSearchUrl = (word: string) =>
  `https://www.douyin.com/search/${encodeURIComponent(word)}`;

/** iesdouyin.com/web/api/v2/hotsearch/billboard/word/ */
export function parseDouyinBillboard(body: string): BoardRow[] {
  const d = parseJson(body, "Douyin");
  if (num(d.status_code) !== 0 || !Array.isArray(d.word_list))
    throw new ParseError(
      `Douyin: unexpected response (status_code ${str(d.status_code) || "-"})`,
    );
  const out: BoardRow[] = [];
  for (const w of arr(d.word_list).map(obj)) {
    const title = str(w.word);
    if (!title) continue;
    out.push(
      row({
        rank: out.length + 1,
        title,
        hotValue: num(w.hot_value),
        url: douyinSearchUrl(title),
        ...douyinLabel(w.label),
      }),
    );
  }
  return out;
}

/** douyin.com/aweme/v1/web/hot/search/list/ */
export function parseDouyinWeb(body: string): BoardRow[] {
  const d = parseJson(body, "Douyin");
  const list = obj(d.data).word_list;
  if (num(d.status_code) !== 0 || !Array.isArray(list))
    throw new ParseError(
      `Douyin: unexpected response (status_code ${str(d.status_code) || "-"})`,
    );
  const out: BoardRow[] = [];
  for (const w of arr(list).map(obj)) {
    const title = str(w.word);
    if (!title) continue;
    const id = str(w.sentence_id);
    out.push(
      row({
        rank: num(w.position) ?? out.length + 1,
        title,
        hotValue: num(w.hot_value),
        url: id
          ? `https://www.douyin.com/hot/${encodeURIComponent(id)}`
          : douyinSearchUrl(title),
        ...douyinLabel(w.label),
        videoCount: num(w.video_count),
        eventTime: isoFromUnix(w.event_time),
      }),
    );
  }
  return out;
}

/** Baidu `hotTag` codes. */
export const BAIDU_LABELS: Record<string, [string, string]> = {
  "1": ["新", "new"],
  "3": ["热", "hot"],
};

/** top.baidu.com/api/board?tab=realtime (the pinned top item is skipped). */
export function parseBaidu(body: string): BoardRow[] {
  const d = parseJson(body, "Baidu");
  const card = arr(obj(d.data).cards).map(obj)[0];
  if (d.success !== true || !card || !Array.isArray(card.content))
    throw new ParseError("Baidu: unexpected response (no realtime board)");
  const out: BoardRow[] = [];
  for (const w of arr(card.content).map(obj)) {
    const title = str(w.word) || str(w.query);
    if (!title) continue;
    const l = BAIDU_LABELS[str(w.hotTag)];
    out.push(
      row({
        rank: out.length + 1,
        title,
        hotValue: num(w.hotScore),
        url:
          str(w.rawUrl) ||
          `https://www.baidu.com/s?wd=${encodeURIComponent(str(w.query) || title)}`,
        ...(l ? { label: l[0], labelEn: l[1] } : {}),
        description: str(w.desc) || null,
      }),
    );
  }
  return out;
}

/** Toutiao `Label` values. */
export const TOUTIAO_LABELS: Record<string, [string, string]> = {
  new: ["新", "new"],
  hot: ["热", "hot"],
  boom: ["爆", "explosive"],
  refuteRumors: ["辟谣", "debunk"],
  exclusive: ["独家", "exclusive"],
  interpretation: ["解读", "explainer"],
};

/** toutiao.com/hot-event/hot-board/ (the pinned top story is skipped). */
export function parseToutiao(body: string): BoardRow[] {
  const d = parseJson(body, "Toutiao");
  if (d.status !== "success" || !Array.isArray(d.data))
    throw new ParseError(
      `Toutiao: unexpected response (status ${str(d.status) || "-"})`,
    );
  const out: BoardRow[] = [];
  for (const w of arr(d.data).map(obj)) {
    const title = str(w.Title);
    if (!title) continue;
    const id = str(w.ClusterIdStr) || str(w.ClusterId);
    const code = str(w.Label);
    const l = TOUTIAO_LABELS[code];
    out.push(
      row({
        rank: out.length + 1,
        title,
        hotValue: num(w.HotValue),
        url: id
          ? `https://www.toutiao.com/trending/${id}/`
          : `https://so.toutiao.com/search?keyword=${encodeURIComponent(title)}`,
        ...(l
          ? { label: l[0], labelEn: l[1] }
          : code
            ? { label: str(w.LabelDesc) || code, labelEn: code }
            : {}),
        categories: arr(w.InterestCategory).map(str).filter(Boolean),
      }),
    );
  }
  return out;
}

/** Bilibili `word_type` codes (from the badge icons). */
export const BILIBILI_LABELS: Record<number, [string, string]> = {
  4: ["新", "new"],
  5: ["热", "hot"],
};

/** s.search.bilibili.com/main/hotword */
export function parseBilibili(body: string): BoardRow[] {
  const d = parseJson(body, "Bilibili");
  if (num(d.code) !== 0 || !Array.isArray(d.list))
    throw new ParseError(
      `Bilibili: unexpected response (code ${str(d.code) || "-"})`,
    );
  const out: BoardRow[] = [];
  for (const w of arr(d.list).map(obj)) {
    const title = str(w.show_name) || str(w.keyword);
    if (!title) continue;
    const l = BILIBILI_LABELS[num(w.word_type) ?? 0];
    out.push(
      row({
        rank: num(w.pos) ?? out.length + 1,
        title,
        hotValue: num(w.heat_score),
        url: `https://search.bilibili.com/all?keyword=${encodeURIComponent(str(w.keyword) || title)}`,
        ...(l ? { label: l[0], labelEn: l[1] } : {}),
      }),
    );
  }
  return out;
}
