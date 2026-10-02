/**
 * Parses the ad preview script served by displayads-formats.googleusercontent.com
 * (content.js). It embeds the rendered ad as escaped HTML inside
 * previewservice.insertPreviewHtmlContent(parentId, elementId, '<html>', w, h, ...).
 * Extraction is best effort: text nodes, image URLs and YouTube video IDs.
 */

export interface AdContent {
  /** All visible text snippets of the rendered ad, in order. */
  texts: string[];
  headline: string | null;
  description: string | null;
  /** Display URL shown on text ads, e.g. "www.nike.com/". */
  displayUrl: string | null;
  callToAction: string | null;
  /** App promoted by app-install ads. */
  app: {
    appId: string | null;
    appName: string | null;
    appStore: string | null;
  } | null;
  imageUrls: string[];
  youtubeVideoId: string | null;
  width: number | null;
  height: number | null;
}

const unescapeJs = (s: string) =>
  s
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h: string) =>
      String.fromCharCode(parseInt(h, 16)),
    )
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) =>
      String.fromCharCode(parseInt(h, 16)),
    )
    .replace(/\\(["'/\\])/g, "$1");

export const decodeEntities = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) =>
      String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/** Returns the JS string literal starting at `start` (a quote), unescaped. */
function readJsString(src: string, start: number): [string, number] | null {
  const quote = src[start];
  if (quote !== "'" && quote !== '"') return null;
  let i = start + 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\") i += 2;
    else if (ch === quote) return [src.slice(start + 1, i), i + 1];
    else i += 1;
  }
  return null;
}

/** Extracts the preview HTML documents (one per rendered variation). */
export function previewDocuments(
  js: string,
): { html: string; width: number | null; height: number | null }[] {
  const out: { html: string; width: number | null; height: number | null }[] =
    [];
  // insertPreviewImageContent(parentId, elementId, 'imageUrl', w, h): plain
  // image previews (e.g. a YouTube thumbnail); wrapped as <img> here.
  const re = /(?:^|[;\s){])previewservice\.insertPreview(Html|Image)Content\(/g;
  for (const m of js.matchAll(re)) {
    let i = m.index + m[0].length;
    let arg3: string | null = null;
    // Third argument is the HTML / image URL; skip the two id strings.
    for (let arg = 0; arg < 3; arg++) {
      while (i < js.length && /[\s,]/.test(js[i]!)) i++;
      const s = readJsString(js, i);
      if (!s) break;
      i = s[1];
      if (arg === 2) arg3 = s[0];
    }
    if (arg3 === null) continue;
    const dims = /^\s*,\s*(\d+)\s*,\s*(\d+)/.exec(js.slice(i, i + 40));
    const content = unescapeJs(arg3);
    out.push({
      html:
        m[1] === "Html" ? content : `<img src="${content.replace(/"/g, "")}">`,
      width: dims ? Number(dims[1]) : null,
      height: dims ? Number(dims[2]) : null,
    });
  }
  return out;
}

/** Renderer chrome and placeholders that aren't ad copy. */
const NOISE = [
  /Rendering Service$/i,
  /^AdSense$/i,
  /^Google .*\bAd\b/i,
  /^\d{2}:\d{2}(:\d{2})?(\.\d+)?$/,
  /^(Visit site|Yes|No|Ad|Sponsored|\[Price\]|Install|Learn more|Shop now|Open|Close|Skip Ad|Watch video)$/i,
  // Renderer placeholders: "[Price]", "<Rating> • <ETA>".
  /^[[<][^\]>]*[\]>]( • [[<][^\]>]*[\]>])*$/,
];

function visibleTexts(html: string): string[] {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<template[\s\S]*?<\/template>/gi, " ");
  const texts: string[] = [];
  for (const m of body.matchAll(/>([^<>]+)</g)) {
    const t = decodeEntities(m[1]!)
      .replace(/[⁦-⁩‎‏]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (t.length < 2 || /[{};]|&&|=>/.test(t)) continue;
    if (NOISE.some((r) => r.test(t))) continue;
    if (!texts.includes(t)) texts.push(t);
  }
  return texts;
}

const IMAGE_URL =
  /https:\/\/(?:tpc\.googlesyndication\.com\/(?:archive\/)?simgad\/\d+|encrypted-tbn\d\.gstatic\.com\/(?:shopping|images)\?q=tbn:[\w-]+|lh\d\.googleusercontent\.com\/[\w/-]+|i\.ytimg\.com\/vi\/[\w-]{11}\/\w+\.jpg)/g;
const YT_ID =
  /(?:ytimg\.com\/vi(?:_webp)?\/|youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?v=)|"video_?id"\s*:\s*")([\w-]{11})/;
const DISPLAY_URL =
  /^(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?$/i;

/**
 * Template ads (app promos, responsive ads) carry their assets in a JS config
 * object: 'appName': 'Nike', 'landscapeImage': 'https://...'.
 */
function templateConfig(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/'(\w+)'\s*:\s*'((?:[^'\\]|\\.){1,2000})'/g)) {
    const v = decodeEntities(unescapeJs(m[2]!)).trim();
    // Skip renderer placeholders like "[Price]".
    if (v && !/^\[.*\]$/.test(v) && !(m[1]! in out)) out[m[1]!] = v;
  }
  return out;
}

const HEADLINE_KEYS = [
  "headline",
  "title",
  "longHeadline",
  "shortHeadline",
  "appName",
];
const DESCRIPTION_KEYS = [
  "description",
  "longDescription",
  "shortDescription",
  "bodyText",
];
const pick = (cfg: Record<string, string>, keys: string[]) =>
  keys.map((k) => cfg[k]).find((v) => v && v.length > 1) ?? null;

export function parsePreview(
  js: string,
  advertiserName?: string | null,
): AdContent {
  const docs = previewDocuments(js);
  const texts: string[] = [];
  const images = new Set<string>();
  let youtubeVideoId: string | null = null;
  const cfg: Record<string, string> = {};
  for (const d of docs) {
    for (const t of visibleTexts(d.html)) if (!texts.includes(t)) texts.push(t);
    const flat = decodeEntities(unescapeJs(d.html));
    for (const m of flat.matchAll(IMAGE_URL)) images.add(m[0]);
    youtubeVideoId ??= YT_ID.exec(flat)?.[1] ?? null;
    for (const [k, v] of Object.entries(templateConfig(d.html))) cfg[k] ??= v;
  }
  youtubeVideoId ??=
    [cfg.videoId, cfg.youtubeVideoId, cfg.video_id].find((v) =>
      /^[\w-]{11}$/.test(v ?? ""),
    ) ?? null;
  for (const [k, v] of Object.entries(cfg)) {
    if (/image$/i.test(k) && /^(https:)?\/\/\S+$/.test(v)) {
      images.add(v.startsWith("//") ? `https:${v}` : v);
    }
  }
  const cfgHeadline = pick(cfg, HEADLINE_KEYS);
  const cfgDescription = pick(cfg, DESCRIPTION_KEYS);
  for (const t of [cfgHeadline, cfgDescription]) {
    if (t && !texts.includes(t)) texts.push(t);
  }
  const app =
    cfg.appId || cfg.appName
      ? {
          appId: cfg.appId ?? null,
          appName: cfg.appName ?? null,
          appStore: cfg.appStoreName ?? null,
        }
      : null;
  const callToAction = cfg.callToAction ?? null;
  const displayUrl = texts.find((t) => DISPLAY_URL.test(t)) ?? null;
  const adv = (advertiserName ?? "").toLowerCase();
  const copy = texts.filter(
    (t) =>
      t !== displayUrl &&
      t.toLowerCase() !== adv &&
      !adv.startsWith(t.toLowerCase()),
  );
  const headline = cfgHeadline ?? copy[0] ?? null;
  const description =
    cfgDescription ??
    copy
      .filter((t) => t !== headline && t.length >= 20)
      .sort((a, b) => b.length - a.length)[0] ??
    null;
  return {
    texts,
    headline,
    description,
    displayUrl,
    callToAction,
    app,
    imageUrls: [...images].filter(
      (u) => !(youtubeVideoId && u.includes(`/vi/${youtubeVideoId}/`)),
    ),
    youtubeVideoId,
    width: docs[0]?.width ?? null,
    height: docs[0]?.height ?? null,
  };
}
