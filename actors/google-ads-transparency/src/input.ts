import { regionId } from "./regions.js";
import { PLATFORM_IDS, type Format, type Platform } from "./rpc.js";

/** Raw actor input, as defined in .actor/input_schema.json. */
export interface RawInput {
  mode?: string;
  advertisers?: (string | null)[];
  region?: string;
  dateFrom?: string;
  dateTo?: string;
  formats?: string[];
  platform?: string;
  maxAdsPerAdvertiser?: number | string;
  includeAdContent?: boolean;
  maxAdvertisersPerQuery?: number | string;
  onlyNew?: boolean;
  proxyConfiguration?: Record<string, unknown>;
}

export class InputError extends Error {}

export type Mode = "ads" | "advertisers";

export type Target =
  | { kind: "id"; query: string; advertiserId: string }
  | { kind: "domain"; query: string; domain: string }
  | { kind: "name"; query: string; name: string };

export interface NormalizedInput {
  mode: Mode;
  targets: Target[];
  /** ISO country code, or null for anywhere. */
  region: string | null;
  regionId: number | null;
  /** YYYYMMDD. */
  startDate: number | null;
  endDate: number | null;
  /** Empty = all formats. */
  formats: Format[];
  platform: Platform | null;
  maxAdsPerAdvertiser: number;
  includeAdContent: boolean;
  maxAdvertisersPerQuery: number;
  /** Skip ads/advertisers returned by earlier runs with the same input (monitoring). */
  onlyNew: boolean;
}

export const DEFAULT_INPUT = {
  mode: "ads",
  advertisers: ["Nike"],
  region: "US",
  maxAdsPerAdvertiser: 20,
  includeAdContent: true,
  maxAdvertisersPerQuery: 10,
} satisfies RawInput;

export const MAX_ADS_PER_ADVERTISER = 100_000;
export const MAX_TARGETS = 500;
const FORMATS: Format[] = ["text", "image", "video"];

const ID = /\bAR\d{15,25}\b/;

/** Advertiser ID, Transparency Center URL, domain or name -> target. */
export function parseTarget(raw: string): Target {
  const query = raw.trim();
  const id = ID.exec(query)?.[0];
  if (id) return { kind: "id", query, advertiserId: id };
  if (/^https?:\/\//i.test(query)) {
    let url: URL;
    try {
      url = new URL(query);
    } catch {
      throw new InputError(`"${query}" is not a valid URL.`);
    }
    if (/adstransparency\.google\.com$/i.test(url.hostname)) {
      const domain = url.searchParams.get("domain");
      if (domain) return { kind: "domain", query, domain: cleanDomain(domain) };
      throw new InputError(
        `"${query}" has no advertiser ID (AR...) or domain. Open an advertiser page in the Transparency Center and copy its URL.`,
      );
    }
    return { kind: "domain", query, domain: cleanDomain(url.hostname) };
  }
  if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/\S*)?$/i.test(query)) {
    return { kind: "domain", query, domain: cleanDomain(query) };
  }
  return { kind: "name", query, name: query };
}

const cleanDomain = (d: string) =>
  d
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "");

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) =>
  Number(
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`,
  );

/** "YYYY-MM-DD" or relative "30 days" / "6 months" -> YYYYMMDD. */
export function parseDate(v: unknown, field: string, now: Date): number | null {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const s = String(v).trim().toLowerCase();
  if (s === "today") return ymd(now);
  const rel = /^(\d+)\s*(day|week|month|year)s?(\s+ago)?$/.exec(s);
  if (rel) {
    const n = Number(rel[1]);
    const d = new Date(now);
    if (rel[2] === "day") d.setUTCDate(d.getUTCDate() - n);
    if (rel[2] === "week") d.setUTCDate(d.getUTCDate() - 7 * n);
    if (rel[2] === "month") d.setUTCMonth(d.getUTCMonth() - n);
    if (rel[2] === "year") d.setUTCFullYear(d.getUTCFullYear() - n);
    return ymd(d);
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const d = new Date(`${s}T00:00:00Z`);
    if (!Number.isNaN(d.getTime()) && ymd(d) === Number(m[1]! + m[2]! + m[3]!))
      return ymd(d);
  }
  throw new InputError(
    `${field} "${String(v)}" must be YYYY-MM-DD, "today", or relative like "30 days".`,
  );
}

function intInRange(v: unknown, field: string, min: number, max: number) {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) {
    throw new InputError(
      `${field} must be a whole number from ${min} to ${max}.`,
    );
  }
  return n;
}

export function normalizeInput(
  raw: RawInput | null | undefined,
  now: Date = new Date(),
): NormalizedInput {
  const r: RawInput = { ...DEFAULT_INPUT, ...(raw ?? {}) };

  const mode = (r.mode ?? "ads") as Mode;
  if (mode !== "ads" && mode !== "advertisers") {
    throw new InputError(`mode must be "ads" or "advertisers".`);
  }

  const list = (Array.isArray(r.advertisers) ? r.advertisers : [])
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean);
  if (!list.length) {
    throw new InputError(
      "Add at least one advertiser name, advertiser ID (AR...), domain or Transparency Center URL to advertisers.",
    );
  }
  if (list.length > MAX_TARGETS) {
    throw new InputError(`At most ${MAX_TARGETS} advertisers per run.`);
  }
  const targets: Target[] = [];
  const seen = new Set<string>();
  for (const s of list) {
    const t = parseTarget(s);
    if (mode === "advertisers" && t.kind !== "name") {
      throw new InputError(
        `Advertiser search mode takes names (e.g. "Nike"); "${s}" is an ID, URL or domain.`,
      );
    }
    const key =
      t.kind === "id"
        ? t.advertiserId
        : t.kind === "domain"
          ? t.domain
          : t.name.toLowerCase();
    if (seen.has(`${t.kind}:${key}`)) continue;
    seen.add(`${t.kind}:${key}`);
    targets.push(t);
  }

  let region: string | null = null;
  let rid: number | null = null;
  const rg = (r.region ?? "").trim();
  if (rg && !/^(anywhere|any|all|worldwide)$/i.test(rg)) {
    const id = regionId(rg);
    if (!/^[a-z]{2}$/i.test(rg) || id === undefined) {
      throw new InputError(
        `region "${rg}" must be a 2-letter country code like US, GB or DE, or empty for anywhere.`,
      );
    }
    region = rg.toUpperCase() === "UK" ? "GB" : rg.toUpperCase();
    rid = id;
  }

  let startDate = parseDate(r.dateFrom, "dateFrom", now);
  let endDate = parseDate(r.dateTo, "dateTo", now);
  if (startDate !== null || endDate !== null) {
    startDate ??= 20180101;
    endDate ??= ymd(now);
    if (startDate > endDate) {
      throw new InputError("dateFrom must be on or before dateTo.");
    }
  }

  const formats = [
    ...new Set(
      (Array.isArray(r.formats) ? r.formats : []).map((f) =>
        String(f).toLowerCase(),
      ),
    ),
  ];
  for (const f of formats) {
    if (!FORMATS.includes(f as Format)) {
      throw new InputError(`formats may only contain text, image and video.`);
    }
  }

  const p = (r.platform ?? "").trim().toUpperCase();
  if (p && p !== "ANY" && !(p in PLATFORM_IDS)) {
    throw new InputError(
      `platform must be one of ${Object.keys(PLATFORM_IDS).join(", ")} (or empty for all).`,
    );
  }

  return {
    mode,
    targets,
    region,
    regionId: rid,
    startDate,
    endDate,
    // All three formats = no filter (one query instead of three).
    formats: formats.length === FORMATS.length ? [] : (formats as Format[]),
    platform: p && p !== "ANY" ? (p as Platform) : null,
    maxAdsPerAdvertiser: intInRange(
      r.maxAdsPerAdvertiser,
      "maxAdsPerAdvertiser",
      1,
      MAX_ADS_PER_ADVERTISER,
    ),
    includeAdContent: r.includeAdContent !== false,
    maxAdvertisersPerQuery: intInRange(
      r.maxAdvertisersPerQuery,
      "maxAdvertisersPerQuery",
      1,
      100,
    ),
    onlyNew: r.onlyNew === true,
  };
}
