import { HttpError, classify, isUnreachable, type Page } from "./http.js";
import {
  CANDIDATE_PATHS,
  extractImprint,
  isChallenge,
  isPlaceholder,
  looksLikeImprint,
  parsePage,
  sameSite,
  score,
  type DomainTarget,
  type ImprintFields,
} from "./impressum.js";
import type { NormalizedInput } from "./input.js";
import { Robots } from "./robots.js";

export const CHARGE_EVENT = "imprint-extracted";

export type DomainStatus =
  | "found"
  | "notFound"
  | "blocked"
  | "robotsDisallowed"
  | "unreachable"
  | "invalidInput"
  | "error";

export interface ImprintResult extends ImprintFields {
  /** The input line as given. */
  input: string;
  /** Domain without "www.". */
  domain: string | null;
  status: DomainStatus;
  /** The Impressum page the fields come from. */
  sourceUrl: string | null;
  /** Pages fetched for this domain (incl. robots.txt). */
  pagesFetched: number;
  error: string | null;
  scrapedAt: string;
}

export interface RunDeps {
  /** GET a URL (throws HttpError on non-2xx). */
  get: (url: string) => Promise<Page>;
  /**
   * Push one item, charging `imprint-extracted` when `charge` is set. Return
   * `false` to stop (budget reached).
   */
  emit: (item: ImprintResult, charge: boolean) => Promise<boolean>;
  log?: (msg: string) => void;
  now?: () => Date;
}

export interface RunStats {
  domains: number;
  found: number;
  /** Rows with a register number or VAT ID (the charged ones). */
  charged: number;
  notFound: number;
  blocked: number;
  robotsDisallowed: number;
  unreachable: number;
  invalid: number;
  errors: number;
  stopReason: "done" | "budget";
}

/** Fetches per domain, robots.txt included. */
export const MAX_FETCHES_PER_DOMAIN = 12;
/** Impressum links from the home page tried before the common paths. */
const MAX_LINKS = 3;

const errMsg = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).slice(0, 300);

const EMPTY: ImprintFields = {
  companyName: null,
  legalForm: null,
  street: null,
  postalCode: null,
  city: null,
  address: null,
  phone: null,
  fax: null,
  email: null,
  registerCourt: null,
  registerType: null,
  registerNumber: null,
  vatId: null,
  countryGuess: null,
};

const isHtml = (p: Page) =>
  !p.contentType ||
  /html|xml|text\/plain/i.test(p.contentType) ||
  /^\s*</.test(p.body.slice(0, 200));

const norm = (u: string) => {
  try {
    const x = new URL(u);
    x.hash = "";
    return x.href.replace(/\/$/, "");
  } catch {
    return u;
  }
};

/** Finds and parses one domain's Impressum. Never throws. */
export async function processDomain(
  t: DomainTarget,
  deps: Pick<RunDeps, "get" | "log">,
  scrapedAt: string,
): Promise<ImprintResult> {
  let fetches = 0;
  let blocked = 0;
  let unreachable = 0;
  let disallowed = 0;
  let attempted = 0;
  let lastError: string | null = null;
  const robotsByOrigin = new Map<string, Promise<Robots>>();
  let origin = t.origin;

  const get = async (url: string): Promise<Page> => {
    fetches += 1;
    return deps.get(url);
  };

  const loadRobots = async (o: string): Promise<Robots> => {
    try {
      const p = await get(`${o}/robots.txt`);
      // A robots.txt that redirects to an HTML page means "none".
      return /<html/i.test(p.body.slice(0, 500))
        ? Robots.allowAll()
        : Robots.parse(p.body);
    } catch (e) {
      // RFC 9309: 4xx = no rules; 5xx or unreachable = disallow all.
      // A rate limit on robots.txt is a block, not "no rules".
      if (e instanceof HttpError && e.status === 429) throw e;
      if (e instanceof HttpError && e.status < 500) return Robots.allowAll();
      if (isUnreachable(e)) throw e;
      return Robots.disallowAll();
    }
  };
  const robotsFor = (o: string) => {
    let r = robotsByOrigin.get(o);
    if (!r) {
      r = loadRobots(o);
      robotsByOrigin.set(o, r);
    }
    return r;
  };

  const result = (
    status: DomainStatus,
    fields: ImprintFields = EMPTY,
    sourceUrl: string | null = null,
    error: string | null = null,
  ): ImprintResult => ({
    input: t.input,
    domain: t.domain,
    status,
    sourceUrl,
    ...fields,
    pagesFetched: fetches,
    error,
    scrapedAt,
  });

  // robots.txt first; fall back to http:// when https doesn't connect.
  try {
    await robotsFor(origin);
  } catch (e) {
    if (e instanceof HttpError)
      return result("blocked", EMPTY, null, errMsg(e));
    if (origin.startsWith("https:")) {
      const httpOrigin = origin.replace(/^https:/, "http:");
      try {
        await robotsFor(httpOrigin);
        origin = httpOrigin;
      } catch (e2) {
        return result("unreachable", EMPTY, null, errMsg(e2));
      }
    } else return result("unreachable", EMPTY, null, errMsg(e));
  }

  /** Fetch a page if robots allows it; null when skipped or failed. */
  const fetchPage = async (url: string): Promise<Page | null> => {
    // A site that blocked us twice will block the rest too.
    if (fetches >= MAX_FETCHES_PER_DOMAIN || blocked >= 2) return null;
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    let robots: Robots;
    try {
      robots = await robotsFor(u.origin);
    } catch {
      return null;
    }
    if (!robots.isAllowed(u.pathname + u.search)) {
      disallowed += 1;
      return null;
    }
    attempted += 1;
    try {
      const p = await get(url);
      if (!isHtml(p)) return null;
      if (isChallenge(p.body)) {
        blocked += 1;
        lastError = `Bot challenge page at ${p.url.slice(0, 160)}`;
        return null;
      }
      return p;
    } catch (e) {
      if (classify(e) === "blocked") blocked += 1;
      else if (isUnreachable(e)) unreachable += 1;
      if (!(e instanceof HttpError && e.status === 404)) lastError = errMsg(e);
      return null;
    }
  };

  const tried = new Set<string>();
  let homeKey: string | null = null;
  const siteHosts = new Set([t.host]);
  let best: { fields: ImprintFields; url: string; s: number } | null = null;

  /** Evaluates a fetched page; true when it has register or VAT fields. */
  const consider = (p: Page, requireCharged: boolean): boolean => {
    const parsed = parsePage(p.body, p.url);
    const fields = extractImprint(parsed, new URL(p.url).hostname);
    if (isPlaceholder(fields)) return false;
    const charged = !!(fields.registerNumber || fields.vatId);
    if (requireCharged ? !charged : !looksLikeImprint(parsed, fields, p.url))
      return false;
    const s = score(fields);
    if (!best || s > best.s) best = { fields, url: p.url, s };
    return charged;
  };

  const tryUrl = async (url: string): Promise<boolean> => {
    const key = norm(url);
    if (tried.has(key)) return false;
    tried.add(key);
    const p = await fetchPage(url);
    if (!p) return false;
    const finalKey = norm(p.url);
    tried.add(finalKey);
    // Redirected to the home page (a soft 404): only a full Impressum counts.
    const toHome = finalKey === homeKey || new URL(p.url).pathname === "/";
    return consider(p, toHome);
  };

  try {
    // 1. A full URL given as input.
    if (t.url && (await tryUrl(t.url.replace(t.origin, origin)))) return done();

    // 2. Links from the home page footer/nav.
    const home = await fetchPage(`${origin}/`);
    let homeLinks: string[] = [];

    let homeOrigin = origin;
    if (home) {
      const finalHost = new URL(home.url).hostname;
      siteHosts.add(finalHost);
      homeOrigin = new URL(home.url).origin;
      const parsed = parsePage(home.body, home.url);
      const onSite = (u: string) =>
        [...siteHosts].some((s) => sameSite(new URL(u).hostname, s));
      // Own-site links first; another domain only for an exact "Impressum"
      // link (e.g. a group's legal site).
      homeLinks = [
        ...parsed.imprintLinks.filter((l) => onSite(l.url)),
        ...parsed.imprintLinks.filter((l) => !onSite(l.url) && l.exact),
      ]
        .map((l) => l.url)
        .slice(0, MAX_LINKS);
      homeKey = norm(home.url);
      tried.add(homeKey);
    }
    for (const l of homeLinks) if (await tryUrl(l)) return done();

    // 3. Common paths, on the host the home page ended up on.
    for (const path of CANDIDATE_PATHS) {
      if (fetches >= MAX_FETCHES_PER_DOMAIN) break;
      if (await tryUrl(`${homeOrigin}${path}`)) return done();
    }

    // 4. One-page sites with the Impressum on the home page itself.
    if (!best && home) consider(home, true);
    if (best) return done();
  } catch (e) {
    return result("error", EMPTY, null, errMsg(e));
  }

  if (attempted === 0 && disallowed > 0)
    return result(
      "robotsDisallowed",
      EMPTY,
      null,
      "robots.txt disallows the Impressum pages.",
    );
  if (attempted > 0 && unreachable === attempted)
    return result("unreachable", EMPTY, null, lastError);
  if (attempted > 0 && blocked === attempted)
    return result("blocked", EMPTY, null, lastError);
  return result("notFound", EMPTY, null, lastError);

  function done(): ImprintResult {
    const b = best!;
    return result("found", b.fields, b.url);
  }
}

export async function runImprints(
  input: NormalizedInput,
  deps: RunDeps,
): Promise<RunStats> {
  const log = deps.log ?? (() => {});
  const now = deps.now ?? (() => new Date());
  const stats: RunStats = {
    domains: input.targets.length + input.invalid.length,
    found: 0,
    charged: 0,
    notFound: 0,
    blocked: 0,
    robotsDisallowed: 0,
    unreachable: 0,
    invalid: 0,
    errors: 0,
    stopReason: "done",
  };
  let stopped = false;

  const emit = async (item: ImprintResult) => {
    if (stopped) return;
    const charge = !!(item.registerNumber || item.vatId);
    const more = await deps.emit(item, charge);
    switch (item.status) {
      case "found":
        stats.found += 1;
        break;
      case "notFound":
        stats.notFound += 1;
        break;
      case "blocked":
        stats.blocked += 1;
        break;
      case "robotsDisallowed":
        stats.robotsDisallowed += 1;
        break;
      case "unreachable":
        stats.unreachable += 1;
        break;
      case "invalidInput":
        stats.invalid += 1;
        break;
      default:
        stats.errors += 1;
    }
    if (charge) stats.charged += 1;
    if (!more) {
      stopped = true;
      stats.stopReason = "budget";
    }
  };

  for (const raw of input.invalid) {
    log(`"${raw}" is not a domain or URL; skipped.`);
    await emit({
      input: raw,
      domain: null,
      status: "invalidInput",
      sourceUrl: null,
      ...EMPTY,
      pagesFetched: 0,
      error: "Not a domain or website URL.",
      scrapedAt: now().toISOString(),
    });
  }

  let next = 0;
  const worker = async () => {
    while (!stopped && next < input.targets.length) {
      const t = input.targets[next++]!;
      const item = await processDomain(t, deps, now().toISOString());
      if (item.status !== "found" && item.error)
        log(`${t.domain}: ${item.status} (${item.error.slice(0, 160)})`);
      await emit(item);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(input.maxConcurrency, input.targets.length) },
      worker,
    ),
  );
  return stats;
}
