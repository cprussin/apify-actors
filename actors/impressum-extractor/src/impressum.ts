/**
 * Finding and parsing Impressum / legal-notice pages (DE, AT, CH, FR and
 * similar). Company-level fields only: no managing directors, responsible
 * persons or personal emails are ever extracted.
 */
import * as cheerio from "cheerio";

// ---------------------------------------------------------------- domains

export interface DomainTarget {
  /** The input line as given. */
  input: string;
  /** Host to fetch, e.g. "www.example.de". */
  host: string;
  /** Site key: host without "www.", e.g. "example.de". */
  domain: string;
  /** "https://www.example.de" */
  origin: string;
  /** A full URL given as input (path other than "/"), tried first. */
  url: string | null;
}

const stripWww = (h: string) => h.replace(/^www\d?\./, "");

/** Parses "example.de", "www.example.de/impressum" or a full URL. */
export function parseDomain(raw: string): DomainTarget | null {
  const input = raw.trim();
  if (!input || /\s/.test(input)) return null;
  let u: URL;
  try {
    u = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`,
    );
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return null;
  // No IP literals or TLD-less hosts: company websites only.
  if (/^\d+(\.\d+){3}$/.test(host) || !/\.[a-z][a-z0-9-]*[a-z0-9]$/.test(host))
    return null;
  const origin = `${u.protocol}//${host}${u.port ? `:${u.port}` : ""}`;
  const path = u.pathname + u.search;
  return {
    input,
    host,
    domain: stripWww(host),
    origin,
    url: path !== "/" ? `${origin}${path}` : null,
  };
}

/** Whether two hosts belong to the same site (www, subdomain or parent). */
export function sameSite(a: string, b: string): boolean {
  const x = stripWww(a.toLowerCase());
  const y = stripWww(b.toLowerCase());
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
}

/** Paths tried when the home page links to no Impressum. */
export const CANDIDATE_PATHS = [
  "/impressum",
  "/imprint",
  "/legal-notice",
  "/mentions-legales",
  "/kontakt/impressum",
  "/de/impressum",
  "/en/imprint",
  "/impressum.html",
  "/fr/mentions-legales",
  "/aviso-legal",
];

// ------------------------------------------------------------ HTML → text

const LINK_TEXT =
  /\b(impressum|imprint|legal notice|site notice|mentions l[ée]gales|aviso legal|offenlegung|legal disclosure|note l[ée]gale|informations l[ée]gales)\b/i;
const LINK_HREF =
  /(impressum|imprint|legal[-_]?notice|site[-_]?notice|mentions[-_]?legales|aviso[-_]?legal|offenlegung)/i;
const NOT_IMPRINT = /datenschutz|privacy|cookie|agb|terms|conditions|cgv|cgu/i;
const EXACT_LINK =
  /^(impressum|imprint|legal notice|site notice|mentions l[ée]gales|aviso legal|offenlegung|impressum (?:&|und|\/) (?:kontakt|datenschutz)|kontakt (?:&|und|\/) impressum)$/i;
// Impressum generators, templates and guides are not the site's own Impressum.
const NOT_IMPRINT_TOOL =
  /generator|vorlage|muster|template|erstellen|ratgeber|pflicht|checkliste|beispiel|example|wiki|blog|magazin|news/i;

/** Words that mark a page as an Impressum. */
export const IMPRINT_KEYWORDS =
  /impressum|imprint|legal notice|site notice|mentions l[ée]gales|aviso legal|offenlegung|angaben gem(?:ä|ae)(?:ß|ss)|informations l[ée]gales|legal disclosure|anbieterkennzeichnung/i;

const BLOCK = new Set(
  "address article aside blockquote br dd div dl dt figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section table tbody td tfoot th thead tr ul".split(
    " ",
  ),
);
const DROP =
  "script, style, noscript, template, svg, iframe, select, button, head, object, canvas";

interface DomNode {
  type: string;
  name?: string;
  data?: string;
  children?: DomNode[];
}

function nodeText(root: DomNode): string {
  const out: string[] = [];
  const walk = (n: DomNode) => {
    if (n.type === "text") {
      out.push(n.data ?? "");
      return;
    }
    if (n.type !== "tag" && n.type !== "root") return;
    const block = n.name ? BLOCK.has(n.name) : false;
    if (block) out.push("\n");
    for (const c of n.children ?? []) walk(c);
    if (block) out.push("\n");
    else if (n.name === "td" || n.name === "span") out.push(" ");
  };
  walk(root);
  return out.join("");
}

// A label on its own line (e.g. in a <dt> or <td>) is joined with its value.
const LABEL_ONLY =
  /^(Registergericht|Register court|Registereintrag|Eintragung im Handelsregister|Handelsregister|Registernummer|Register number|Handelsregisternummer|Firmenbuch|Firmenbuchnummer|Firmenbuchgericht|Umsatzsteuer-?ID|Umsatzsteuer-Identifikationsnummer(?: gemäß § ?27 ?a Umsatzsteuergesetz)?|USt\.?-?Id\.?-?Nr\.?|USt-IdNr\.?|UID(?:-Nr\.?|-Nummer)?|VAT(?: ID| No\.?| number)?|MWST(?:-Nr\.?)?|N° TVA(?: intracommunautaire)?|TVA(?: intracommunautaire)?|SIRE[NT]|RCS|Telefon|Tel\.?|Phone|Fax|Telefax|E-?Mail|Sitz(?: der Gesellschaft)?|Anschrift|Adresse|Address|Kontakt|Contact)\s*[:.]?$/i;

export function toLines(text: string): string[] {
  const lines = text
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/[\u200b-\u200d\u2060\ufeff\u00ad]/g, "")
    .split(/\n/)
    .map((l) => l.replace(/[ \t\r\f\v]+/g, " ").trim())
    .filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    const next = lines[i + 1];
    if (LABEL_ONLY.test(l) && next && !LABEL_ONLY.test(next)) {
      out.push(`${l.replace(/\s*[:.]$/, "")}: ${next}`);
      i += 1;
    } else out.push(l);
  }
  return out;
}

export interface ParsedPage {
  /** Visible text lines (main content when it holds the Impressum). */
  lines: string[];
  /**
   * Links to Impressum pages, best first (absolute URLs). `exact` when the
   * link text is just "Impressum", "Imprint", "Mentions légales", ...
   */
  imprintLinks: { url: string; exact: boolean }[];
  /** mailto: addresses on the page. */
  mailtos: string[];
  /** tel: numbers on the page. */
  tels: string[];
  /** <html lang>, lowercased. */
  lang: string | null;
}

export function parsePage(html: string, pageUrl: string): ParsedPage {
  const $ = cheerio.load(html);
  const lang = ($("html").attr("lang") ?? "").trim().toLowerCase() || null;

  const scored: { url: string; score: number; exact: boolean; i: number }[] =
    [];
  const mailtos: string[] = [];
  const tels: string[] = [];
  let base = pageUrl;
  const baseHref = $("base[href]").attr("href");
  if (baseHref) {
    try {
      base = new URL(baseHref, pageUrl).href;
    } catch {
      // Ignore a broken <base>.
    }
  }
  $("a[href]").each((i, el) => {
    const href = ($(el).attr("href") ?? "").trim();
    if (/^mailto:/i.test(href)) {
      mailtos.push(safeDecode(href.slice(7).split("?")[0]!));
      return;
    }
    if (/^tel:/i.test(href)) {
      tels.push(safeDecode(href.slice(4)));
      return;
    }
    if (!href || href.startsWith("#") || /^(javascript|data):/i.test(href))
      return;
    const texts = [$(el).text(), $(el).attr("title"), $(el).attr("aria-label")]
      .map((x) => (x ?? "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      return;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return;
    url.hash = "";
    let score = 0;
    const exact = texts.some((x) => EXACT_LINK.test(x));
    if (exact) score = 4;
    else if (texts.some((x) => LINK_TEXT.test(x) && x.length <= 60)) score = 3;
    if (LINK_HREF.test(url.pathname)) score += 2;
    const all = `${texts.join(" ")} ${url.pathname}`;
    if (!score || NOT_IMPRINT_TOOL.test(all)) return;
    if (score < 4 && NOT_IMPRINT.test(all)) return;
    scored.push({ url: url.href, score, exact, i });
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  const seenLinks = new Set<string>();
  const imprintLinks = scored
    .filter((s) => !seenLinks.has(s.url) && seenLinks.add(s.url))
    .map((s) => ({ url: s.url, exact: s.exact }));

  $(DROP).remove();
  const bodyNode = ($("body")[0] ?? $.root()[0]) as unknown as DomNode;
  let lines = toLines(nodeText(bodyNode));
  // Prefer the main content area when it holds the Impressum itself.
  for (const sel of ["main", "[role=main]", "article", "#content"]) {
    const el = $(sel).first()[0] as unknown as DomNode | undefined;
    if (!el) continue;
    const ml = toLines(nodeText(el));
    const t = ml.join("\n");
    if (hasRegisterOrVat(t) || (IMPRINT_KEYWORDS.test(t) && ml.length >= 3)) {
      lines = ml;
      break;
    }
  }
  return { lines, imprintLinks, mailtos, tels, lang };
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s).trim();
  } catch {
    return s.trim();
  }
}

// ------------------------------------------------------------ legal forms

/** Legal forms, longest first. Matched case-sensitively. */
const LEGAL_FORMS = [
  String.raw`GmbH\s*&\s*Co\.?\s*KGaA`,
  String.raw`GmbH\s*&\s*Co\.?\s*OHG`,
  String.raw`GmbH\s*&\s*Co\.?\s*KG`,
  String.raw`AG\s*&\s*Co\.?\s*KGaA`,
  String.raw`AG\s*&\s*Co\.?\s*KG`,
  String.raw`SE\s*&\s*Co\.?\s*KGaA`,
  String.raw`SE\s*&\s*Co\.?\s*KG`,
  String.raw`UG\s*\(haftungsbeschr(?:ä|ae)nkt\)\s*&\s*Co\.?\s*KG`,
  String.raw`UG\s*\(haftungsbeschr(?:ä|ae)nkt\)`,
  String.raw`gGmbH`,
  String.raw`GmbH`,
  String.raw`Ges\.?\s?m\.?\s?b\.?\s?H\.?`,
  String.raw`mbH`,
  String.raw`m\.\s?b\.\s?H\.`,
  String.raw`KGaA`,
  String.raw`PartG\s?mbB`,
  String.raw`PartG`,
  String.raw`OHG`,
  String.raw`oHG`,
  String.raw`GbR`,
  String.raw`GesbR`,
  String.raw`e\.\s?Kfm\.`,
  String.raw`e\.\s?Kfr\.`,
  String.raw`e\.\s?K\.`,
  String.raw`e\.\s?U\.`,
  String.raw`e\.\s?V\.`,
  String.raw`eG`,
  String.raw`AG`,
  String.raw`SE`,
  String.raw`KG`,
  String.raw`OG`,
  String.raw`S\.\s?à\s?r\.\s?l\.`,
  String.raw`S\.a\.r\.l\.`,
  String.raw`Sàrl`,
  String.raw`SàRL`,
  String.raw`SARL`,
  String.raw`Sarl`,
  String.raw`SASU`,
  String.raw`S\.A\.S\.`,
  String.raw`SAS`,
  String.raw`EURL`,
  String.raw`SNC`,
  String.raw`SCOP`,
  String.raw`SCI`,
  String.raw`S\.A\.`,
  String.raw`SA`,
  String.raw`S\.L\.U\.`,
  String.raw`S\.L\.`,
  String.raw`S\.p\.A\.`,
  String.raw`S\.r\.l\.`,
  String.raw`B\.V\.`,
  String.raw`N\.V\.`,
  String.raw`Ltd\.?`,
  String.raw`Limited`,
  String.raw`LLC`,
  String.raw`Inc\.?`,
  String.raw`Genossenschaft`,
  String.raw`Stiftung`,
];
const FORM = `(?:${LEGAL_FORMS.join("|")})`;
/** A legal form at the end of a name. */
const FORM_AT_END = new RegExp(`(?<![\\p{L}\\p{N}])(${FORM})\\s*$`, "u");

/** Canonical spelling of a matched legal form. */
export function canonicalForm(f: string): string {
  return f
    .replace(/\s+/g, " ")
    .replace(/\s*&\s*Co\.?\s*/g, " & Co. ")
    .replace(/^UG\s*\(haftungsbeschr(?:ä|ae)nkt\)/, "UG (haftungsbeschränkt)")
    .replace(/^e\.\s?(K|Kfm|Kfr|U|V)\./, "e.$1.")
    .replace(/^S\.\s?à\s?r\.\s?l\.$/, "S.à r.l.")
    .replace(/^PartG\s?mbB$/, "PartG mbB")
    .replace(/^Ges\.?\s?m\.?\s?b\.?\s?H\.?$/, "Ges.m.b.H.")
    .trim();
}

// ------------------------------------------------------------- extraction

export type RegisterType =
  "HRB" | "HRA" | "GnR" | "PR" | "VR" | "FN" | "CHE" | "RCS" | "SIREN";

export interface ImprintFields {
  companyName: string | null;
  legalForm: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  address: string | null;
  phone: string | null;
  fax: string | null;
  email: string | null;
  registerCourt: string | null;
  registerType: RegisterType | null;
  registerNumber: string | null;
  vatId: string | null;
  countryGuess: string | null;
}

// Lines that name people, roles or other things, never the company itself.
const NOT_NAME =
  /(Amtsgericht|Handelsgericht|Landesgericht|Registergericht|Handelsregister|Firmenbuch|\bRegister|\bUSt\b|USt-|Umsatzsteuer|\bVAT\b|\bUID\b|\bMwSt|\bMWST|\bTVA\b|SIRE[NT]|\bRCS\b|\bTel\b|\bTelefon\b|\bPhone\b|\bFax\b|E-?Mail|@|https?:|www\.|§|Geschäftsführ|Gesch\.-?F|Vorstand|Aufsichtsrat|vertreten|Vertretungsberechtigt|Inhaber|V\.?\s?i\.?\s?S\.?\s?d\.?\s?P|Verantwortlich|Gesellschafter|Komplementär|haftende|Prokur|Directeur|Directrice|Gérant|gérant|Président|Managing|Director|\bCEO\b|represented|Responsible|\bSitz\b|Siège|Datenschutzbeauftragte|Privacy|Cookie|Haftungsausschluss|Haftungshinweis|\bHaftung\b|Urheber|Bildnachweis|(?:Design|Konzept|Umsetzung|Realisierung|Webdesign|Gestaltung|Hosting|Programmierung|Fotos?|Bilder|Technik|Entwicklung)(?:\s(?:und|&)\s\p{L}+)?\s*:|Hébergeur|Hébergement|hosted|realisiert|powered|Mitglied|kammer\b|Aufsicht|Berufs|Streitschlichtung)/iu;
// Sentence words: a line with these is prose, not a company name.
const PROSE =
  /(?<![\p{L}])(nur|bei|einer|eine|ein|ist|sind|wird|werden|wir|sie|unsere?|ihre?|hier|als|auch|oder|nicht|keine?|über|durch|möglicher?|sowie|bitte|wenn|falls|nach|sich|est|sont|une?|nous|notre|votre|pour|avec|sur|is|are|our|your|we|with|only|if|when|this|that|diese[rs]?)(?![\p{L}])/iu;
const NAME_PREFIX =
  /^(?:Angaben gem(?:ä|ae)(?:ß|ss)[^:]*:|Anbieter(?:in)?|Diensteanbieter(?:in)?|Herausgeber(?:in)?|Betreiber(?:in)?(?: der Website| dieser Website)?|Firma|Firmenname|Firmierung|Unternehmen|Name|Company(?: name)?|Legal name|Publisher|Operator|Provider|Raison sociale|Dénomination(?: sociale)?|Société|[ÉE]diteur(?: du site)?|Propriétaire|Titular|Razón social)\s*[:：]\s*/i;

interface NameHit {
  name: string;
  form: string;
  index: number;
  copyright: boolean;
}

/** Company name and legal form from one line, if it names a company. */
export function nameFromLine(line: string): Omit<NameHit, "index"> | null {
  if (line.length > 160) return null;
  let l = line
    .replace(
      /^(impressum|imprint|legal notice|site notice|mentions l[ée]gales)\s*[:\-–|]?\s+/i,
      "",
    )
    .replace(NAME_PREFIX, "");
  let copyright = false;
  if (/^(©|\(c\)|copyright)/i.test(l)) {
    copyright = true;
    l = l
      .replace(/^(©|\(c\)|copyright)\s*(©\s*)?/i, "")
      .replace(/^\d{4}(\s*[-–]\s*\d{4})?\s*(by\s+)?/i, "");
  }
  l = l.replace(/\s+(au|with|mit einem)\s+capital\b.*$/i, "");
  const SEP = /\s[|–—·•]\s|,\s|;\s|\s-\s|:\s/g;
  const segs: { seg: string; at: number }[] = [];
  let at = 0;
  for (const m of l.matchAll(SEP)) {
    segs.push({ seg: l.slice(at, m.index), at });
    at = m.index + m[0].length;
  }
  segs.push({ seg: l.slice(at), at });
  for (const { seg, at: offset } of segs) {
    // "Geschäftsführer: X GmbH", "Design: Y GmbH": a role label before it.
    if (offset && NOT_NAME.test(l.slice(0, offset))) return null;
    const s = seg
      .trim()
      .replace(/^(la|le)\s+société\s+/i, "")
      .replace(/[\s,;:]+$/, "")
      .replace(
        /\.?\s*(all rights reserved|alle rechte vorbehalten|tous droits réservés)\.?$/i,
        "",
      )
      .trim();
    const m = FORM_AT_END.exec(s);
    if (!m) continue;
    const before = s.slice(0, m.index).trim();
    if ((before.match(/\p{L}/gu) ?? []).length < 2) continue;
    if (NOT_NAME.test(s) || PROSE.test(before)) return null;
    if (s.split(/\s+/).length > 12) continue;
    if (/^(die|der|das|the|des|von|by|für|for|bei|at|chez|par)\s/i.test(s))
      continue;
    return { name: s, form: canonicalForm(m[1]!), copyright };
  }
  return null;
}

// Postal code + city segment, optionally with a country prefix (D-, A-, CH-).
const POSTAL =
  /^(?:(D|DE|A|AT|CH|F|FR|L|LU|FL)\s?[-–]\s?)?(\d{4,5})\s+(\p{Lu}[\p{L}'’.()\- /]{1,40}?)$/u;
const STREET =
  /^(?:[\p{L}][\p{L}.'’\- ]{1,50}\s\d{1,4}\s?[a-zA-Z]?(?:\s?[-–/]\s?\d{1,4}\s?[a-zA-Z]?)*(?:\s(?:Top|Stiege|Tür|Stock|OG|EG)\s?\d+)*|Postfach\s\d[\d ]*|\d{1,4}(?:\s?(?:bis|ter|[a-c]))?,?\s+(?:rue|avenue|av\.|boulevard|bd|place|chemin|route|allée|quai|impasse|cours|square|voie|rond-point|esplanade|parvis)\b[\p{L}\p{N}'’.\- ]{2,60})$/iu;
const STREET_EXCLUDE =
  /(\bHR[AB]\b|\bFN\b|\bUSt|\bTel\b|\bFax\b|\bSeite\b|\bPage\b|§|\bJahr|Mitarbeiter)/i;
const COUNTRY_WORDS: [RegExp, string][] = [
  [
    /^(Deutschland|Germany|Allemagne|Germania|Alemania|Bundesrepublik Deutschland)$/i,
    "DE",
  ],
  [/^(Österreich|Oesterreich|Austria|Autriche)$/i, "AT"],
  [/^(Schweiz|Switzerland|Suisse|Svizzera|Svizra)$/i, "CH"],
  [/^(France|Frankreich|Francia)$/i, "FR"],
  [/^(Luxembourg|Luxemburg)$/i, "LU"],
  [/^(Liechtenstein)$/i, "LI"],
  [/^(Belgien|Belgium|Belgique|België)$/i, "BE"],
  [/^(Niederlande|Netherlands|Nederland|Pays-Bas)$/i, "NL"],
  [/^(Italien|Italy|Italia|Italie)$/i, "IT"],
  [/^(Spanien|Spain|España|Espagne)$/i, "ES"],
];
const POSTAL_PREFIX: Record<string, string> = {
  D: "DE",
  DE: "DE",
  A: "AT",
  AT: "AT",
  CH: "CH",
  F: "FR",
  FR: "FR",
  L: "LU",
  LU: "LU",
  FL: "LI",
};

interface AddressHit {
  street: string | null;
  postalCode: string;
  city: string;
  country: string | null;
  index: number;
}

const segments = (line: string) =>
  line
    .split(/,\s*|\s[|·•–—]\s|;\s*/)
    .map((s) =>
      s
        .replace(NAME_PREFIX, "")
        .replace(
          /^(Anschrift|Adresse|Address|Postanschrift|Sitz|Si[èe]ge(?: social)?|Domicile|Registered office)\s*:\s*/i,
          "",
        )
        .trim(),
    )
    .filter(Boolean);

function countryOf(seg: string | undefined): string | null {
  if (!seg) return null;
  for (const [re, cc] of COUNTRY_WORDS) if (re.test(seg.trim())) return cc;
  return null;
}

/** First street + postal code + city at or after line `from`. */
export function findAddress(
  lines: string[],
  from = 0,
  to = lines.length,
): AddressHit | null {
  for (let i = from; i < Math.min(to, lines.length); i++) {
    const segs = segments(lines[i]!);
    for (let j = 0; j < segs.length; j++) {
      const m = POSTAL.exec(segs[j]!);
      if (!m) continue;
      let city = m[3]!.trim();
      // "12345 Berlin Deutschland" → country at the end.
      let country = m[1] ? (POSTAL_PREFIX[m[1]] ?? null) : null;
      const tail = /\s(\p{L}+)$/u.exec(city);
      if (tail && countryOf(tail[1])) {
        country ??= countryOf(tail[1]);
        city = city.slice(0, tail.index).trim();
      }
      if (/\d/.test(city) || STREET_EXCLUDE.test(city)) continue;
      const prev = j > 0 ? segs[j - 1] : segments(lines[i - 1] ?? "").at(-1);
      const street =
        prev && STREET.test(prev) && !STREET_EXCLUDE.test(prev) ? prev : null;
      const next = segs[j + 1] ?? lines[i + 1];
      country ??= countryOf(next);
      return { street, postalCode: m[2]!, city, country, index: i };
    }
  }
  return null;
}

const NUM = String.raw`(\+?\s?\(?\d[\d\s()./–-]{4,}\d)`;
const FAX_RE = new RegExp(
  String.raw`(?<![\p{L}])(?:Telefax|Fax(?:-?Nr\.?|nummer)?|Télécopie)\s*(?:\([^)]{0,20}\))?\s*[.:：]?\s*${NUM}`,
  "iu",
);
const TEL_RE = new RegExp(
  String.raw`(?<![\p{L}])(?:Telefon(?:nummer)?|Telephone|Téléphone|Teléfono|Telefono|Phone|Tel(?!efax)\.?(?:-?Nr\.?)?|Tél\.?|Fon|Hotline|Zentrale)\s*(?:\([^)]{0,20}\))?\s*[.:：]?\s*${NUM}`,
  "iu",
);
const SHORT_FAX = new RegExp(
  String.raw`(?:^|[|·•,;]\s*)F\s?[:.]\s*${NUM}`,
  "u",
);
const SHORT_TEL = new RegExp(
  String.raw`(?:^|[|·•,;]\s*)T\s?[:.]\s*${NUM}`,
  "u",
);

function cleanPhone(p: string): string | null {
  const s = p
    .replace(/\s+/g, " ")
    .replace(/[\s./–-]+$/, "")
    .trim();
  const digits = s.replace(/\D/g, "").length;
  return digits >= 6 && digits <= 16 ? s : null;
}

function findPhones(lines: string[], tels: string[]) {
  let phone: string | null = null;
  let fax: string | null = null;
  for (const l of lines) {
    if (!fax) {
      const m = FAX_RE.exec(l) ?? SHORT_FAX.exec(l);
      if (m) fax = cleanPhone(m[1]!);
    }
    if (!phone) {
      const m = TEL_RE.exec(l) ?? SHORT_TEL.exec(l);
      if (m) phone = cleanPhone(m[1]!);
    }
    if (phone && fax) break;
  }
  if (!phone)
    for (const t of tels) {
      phone = cleanPhone(t);
      if (phone) break;
    }
  return { phone, fax };
}

// Role mailboxes. Any other address could be a person's and is never output.
const GENERIC_LOCAL = new Set(
  "info infos information informationen kontakt contact contacts contacto office mail email e-mail hello hallo hi service services support help hilfe impressum imprint legal recht datenschutz privacy dsb gdpr dpo dataprotection sales vertrieb verkauf team post postmaster empfang zentrale buero büro bureau admin webmaster web presse press media marketing shop store order orders bestellung bestellungen kundenservice kundendienst kunden customer customers customerservice customercare care anfrage anfragen inquiry inquiries enquiries enquiry request requests accounting buchhaltung billing rechnung rechnungen invoice invoices finance jobs job karriere career careers hr personal bewerbung bewerbungen welcome willkommen general accueil secretariat sekretariat direction redaktion editorial feedback online internet noreply no reply mailbox central headoffice zentral verwaltung administration booking buchung reservierung reservation reservations ticket tickets hotline helpdesk technik tech it ecommerce partner partners business kontaktformular praxis kanzlei".split(
    " ",
  ),
);

/** Whether an email is a role mailbox (info@, kontakt@, ...), not a person's. */
export function isGenericEmail(email: string, siteDomain?: string): boolean {
  const [local, dom] = email.toLowerCase().split("@");
  if (!local || !dom) return false;
  const tokens = local.split(/[._+-]/).filter(Boolean);
  if (
    tokens.length &&
    tokens.every(
      (t) =>
        GENERIC_LOCAL.has(t) || /^\d{1,4}$/.test(t) || /^[a-z]{2}$/.test(t),
    ) &&
    tokens.some((t) => GENERIC_LOCAL.has(t))
  )
    return true;
  // brand@brand.de
  const brand = (siteDomain ?? dom).split(".")[0];
  return !!brand && brand.length >= 3 && local === brand;
}

const EMAIL_SRC = String.raw`[a-z0-9][a-z0-9._%+-]*@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}`;
const EMAIL_RE = new RegExp(EMAIL_SRC, "gi");
const EMAIL_ONE = new RegExp(`^${EMAIL_SRC}$`, "i");

/** Undoes "info (at) example (dot) de" style obfuscation. */
export function deobfuscate(s: string): string {
  return s
    .replace(/\s*[[({<]\s*(?:at|ät|@|et)\s*[\])}>]\s*/gi, "@")
    .replace(/\s*[[({<]\s*(?:dot|punkt|point|\.)\s*[\])}>]\s*/gi, ".");
}

function findEmail(
  lines: string[],
  mailtos: string[],
  siteDomain: string | undefined,
): string | null {
  const all = [
    ...mailtos,
    ...deobfuscate(lines.join("\n")).matchAll(EMAIL_RE),
  ].map((m) => (typeof m === "string" ? m : m[0]).toLowerCase().trim());
  const ok = [...new Set(all)].filter(
    (e) =>
      EMAIL_ONE.test(e) &&
      !/\.(png|jpe?g|gif|webp|svg|css|js)$/i.test(e) &&
      !/@(example|beispiel|domain|sentry|wixpress)\./i.test(e) &&
      isGenericEmail(e, siteDomain),
  );
  if (!ok.length) return null;
  const own = siteDomain
    ? ok.find((e) => sameSite(e.split("@")[1]!, siteDomain))
    : undefined;
  return own ?? ok[0]!;
}

// ---------------------------------------------------- register and VAT

const VAT_LABEL =
  /(USt|Umsatzsteuer|\bVAT\b|\bUID\b|MwSt|MWST|Mehrwertsteuer|\bTVA\b|T\.V\.A|\bIVA\b|\bBTW\b|\bNIF\b|\bCIF\b|Partita|Tax ID|Steuer-?ID|intracom|Identifikationsnummer)/i;

const VAT_STRONG: [RegExp, (m: RegExpExecArray) => string][] = [
  [
    /(?<![A-Z0-9])DE\s?(\d{3})\s?(\d{3})\s?(\d{3})(?!\d)/,
    (m) => `DE${m[1]}${m[2]}${m[3]}`,
  ],
  [
    /(?<![A-Z0-9])ATU\s?((?:\d\s?){7}\d)(?!\d)/,
    (m) => `ATU${m[1]!.replace(/\s/g, "")}`,
  ],
  [
    /(?<![A-Z0-9])FR\s?([0-9A-HJ-NP-Z]{2})\s?(\d{3})\s?(\d{3})\s?(\d{3})(?!\d)/,
    (m) => `FR${m[1]}${m[2]}${m[3]}${m[4]}`,
  ],
  [
    /(?<![A-Z0-9])CHE[-\s]?(\d{3})[.\s]?(\d{3})[.\s]?(\d{3})\s*(MWST|TVA|IVA|VAT)\b/,
    (m) => `CHE-${m[1]}.${m[2]}.${m[3]} ${m[4]}`,
  ],
  [/(?<![A-Z0-9])(NL\d{9}B\d{2})(?![A-Z0-9])/, (m) => m[1]!],
];
const VAT_LABELED =
  /(?<![A-Z0-9])(BE\s?0?\d{3}[.\s]?\d{3}[.\s]?\d{3}|LU\s?\d{8}|IT\s?\d{11}|ES\s?[A-Z0-9]\d{7}[A-Z0-9]|PL\s?\d{10}|DK\s?\d{8}|SE\s?\d{12}|CZ\s?\d{8,10}|IE\s?\d{7}[A-Z]{1,2}|PT\s?\d{9}|GB\s?\d{9}|LI\s?\d{5}|FI\s?\d{8}|EL\s?\d{9}|HU\s?\d{8}|SI\s?\d{8}|SK\s?\d{10}|CHE[-\s]?\d{3}[.\s]?\d{3}[.\s]?\d{3})(?![A-Z0-9])/;

function findVat(lines: string[]): { vat: string; index: number } | null {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    for (const [re, fmt] of VAT_STRONG) {
      const m = re.exec(l);
      if (m) return { vat: fmt(m), index: i };
    }
    const labeled =
      VAT_LABEL.test(l) ||
      (i > 0 && VAT_LABEL.test(lines[i - 1]!) && lines[i - 1]!.length < 80);
    if (!labeled) continue;
    const m = VAT_LABELED.exec(l);
    if (m) {
      const raw = m[1]!.replace(/[\s.]/g, "");
      if (raw.startsWith("CHE")) {
        const d = raw.replace(/\D/g, "");
        return {
          vat: `CHE-${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)} MWST`,
          index: i,
        };
      }
      return { vat: raw, index: i };
    }
  }
  return null;
}

interface RegisterHit {
  type: RegisterType;
  number: string;
  court: string | null;
  index: number;
}

const HR_RE =
  /(?<![\p{L}])(HR\s?[AB]|GnR|PR|VR)\s*[-.:]?\s*(?:Nr\.?\s*)?(\d{1,6}(?:\s?[A-Z]{1,2}(?![\p{L}\d]))?)(?!\d)/u;
const FN_RE =
  /(?:(?<![\p{L}])FN|Firmenbuch(?:nummer|-?Nr\.?)?)\s*[:.]?\s*(?:FN\s*)?(\d{1,6})\s?([a-z])(?![\p{L}\p{N}])/u;
const CHE_RE = /(?<![A-Z0-9])CHE[-\s]?(\d{3})[.\s]?(\d{3})[.\s]?(\d{3})(?!\d)/;
const RCS_RE =
  /(?<![\p{L}])R\.?\s?C\.?\s?S\.?\s+(?:de\s+|d['’]\s*)?(\p{Lu}[\p{L}'’-]+(?:[ -]\p{Lu}[\p{L}'’-]+)?)[^\n\d]{0,40}?(\d{3})\s?(\d{3})\s?(\d{3})(?!\d)/u;
const SIREN_RE =
  /\bSIRE[NT]\s*(?:n°|no|nr)?\s*[:.]?\s*(\d{3})\s?(\d{3})\s?(\d{3})/i;

function findRegister(lines: string[]): RegisterHit | null {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    const hr = HR_RE.exec(l);
    if (hr) {
      const type = hr[1]!.replace(/\s/g, "") as RegisterType;
      // PR / VR are too short to trust without a register word nearby.
      const ctx = `${lines[i - 1] ?? ""} ${l}`;
      if (
        (type !== "PR" && type !== "VR") ||
        /register|registergericht/i.test(ctx)
      )
        return {
          type,
          number: `${type} ${hr[2]!.replace(/\s+/g, " ")}`,
          court: findCourt([lines[i - 1] ?? "", l, lines[i + 1] ?? ""]),
          index: i,
        };
    }
    const fn = FN_RE.exec(l);
    if (fn)
      return {
        type: "FN",
        number: `FN ${fn[1]} ${fn[2]}`,
        court: findCourt([lines[i - 1] ?? "", l, lines[i + 1] ?? ""]),
        index: i,
      };
    const rcs = RCS_RE.exec(l);
    if (rcs)
      return {
        type: "RCS",
        number: `RCS ${rcs[1]} ${rcs[2]} ${rcs[3]} ${rcs[4]}`,
        court: `RCS ${rcs[1]}`,
        index: i,
      };
  }
  // Swiss UID (also the commercial-register ID), then French SIREN/SIRET.
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    const che = CHE_RE.exec(l);
    if (che)
      return {
        type: "CHE",
        number: `CHE-${che[1]}.${che[2]}.${che[3]}`,
        court: findCourt([lines[i - 1] ?? "", l, lines[i + 1] ?? ""]),
        index: i,
      };
    const siren = SIREN_RE.exec(l);
    if (siren)
      return {
        type: "SIREN",
        number: `${siren[1]} ${siren[2]} ${siren[3]}`,
        court: null,
        index: i,
      };
  }
  return null;
}

const CITY = String.raw`\p{Lu}[\p{L}.'’-]*(?:(?: am| an der| im| in der| a\. ?M\.| i\. ?Br\.| \(\p{L}[\p{L}. ]*\)|[ -]\p{Lu}[\p{L}.'’-]*)){0,3}`;
const COURT_PATTERNS: [RegExp, (m: RegExpExecArray) => string][] = [
  [
    new RegExp(
      String.raw`(?:Registergericht|Register court|Registration court|Court of registration|Registry court|Firmenbuchgericht|Handelsregistergericht)\s*[:.]?\s*(?:ist\s+(?:das\s+)?)?((?:Amtsgericht|AG|Handelsgericht|Landesgericht(?: für ZRS)?|Local Court|District Court)\s+(?:of\s+)?${CITY})`,
      "u",
    ),
    (m) => m[1]!,
  ],
  [
    new RegExp(
      String.raw`(?<![\p{L}])(Amtsgericht(?:s|es)?|Handelsgericht(?:s|es)?|Landesgericht(?:s|es)?(?: für ZRS)?|Local Court|District Court)\s+(?:of\s+)?(${CITY})`,
      "u",
    ),
    (m) =>
      `${m[1]!.replace(/(?:s|es)$/, "").replace(/gericht$/, "gericht")} ${m[2]}`,
  ],
  [
    new RegExp(
      String.raw`(?<![\p{L}])(${CITY})\s+(?:Registration Office|Register Court|Registry Court|Local Court|District Court)(?![\p{L}])`,
      "u",
    ),
    (m) => m[0]!.trim(),
  ],
  [
    new RegExp(
      String.raw`(?:^|[\s,;:(])AG\s+(${CITY})\s*[,:]?\s*(?:unter\s+)?HR\s?[AB]`,
      "u",
    ),
    (m) => `Amtsgericht ${m[1]}`,
  ],
  [
    new RegExp(
      String.raw`(Handelsregister(?:amt)?\s+(?:des\s+)?Kantons?\s+${CITY}|Registre du commerce\s+(?:du canton\s+)?(?:de\s+|du\s+|d['’]\s*)?${CITY}|Registro di commercio\s+(?:del\s+)?(?:Cantone\s+)?${CITY})`,
      "u",
    ),
    (m) => m[1]!,
  ],
];

/** Register court from a few lines around the register number. */
export function findCourt(lines: string[]): string | null {
  for (const l of lines) {
    for (const [re, fmt] of COURT_PATTERNS) {
      const m = re.exec(l);
      if (!m) continue;
      let court = fmt(m)
        .replace(/^AG\s/, "Amtsgericht ")
        .replace(
          /\s+(unter|under|sous|HR[AB]|FN|Nr|Registernummer|Register|und|and)\b.*$/u,
          "",
        )
        .trim();
      // "Amtsgerichts München" → "Amtsgericht München"
      court = court.replace(
        /^(Amts|Handels|Landes)gericht(?:s|es)\b/,
        "$1gericht",
      );
      if (court.length <= 60) return court;
    }
  }
  return null;
}

/** True when the text holds a register number or VAT ID. */
export function hasRegisterOrVat(text: string): boolean {
  const lines = text.split("\n");
  return !!(findRegister(lines) || findVat(lines));
}

// --------------------------------------------------------------- country

const VAT_PREFIX_COUNTRY: Record<string, string> = {
  DE: "DE",
  AT: "AT",
  CH: "CH",
  FR: "FR",
  NL: "NL",
  BE: "BE",
  LU: "LU",
  IT: "IT",
  ES: "ES",
  PL: "PL",
  DK: "DK",
  SE: "SE",
  CZ: "CZ",
  IE: "IE",
  PT: "PT",
  GB: "GB",
  LI: "LI",
  FI: "FI",
  EL: "GR",
  HU: "HU",
  SI: "SI",
  SK: "SK",
};
const TLD_COUNTRY: Record<string, string> = {
  de: "DE",
  at: "AT",
  ch: "CH",
  li: "LI",
  fr: "FR",
  lu: "LU",
  be: "BE",
  nl: "NL",
  it: "IT",
  es: "ES",
};
const PHONE_COUNTRY: Record<string, string> = {
  "49": "DE",
  "43": "AT",
  "41": "CH",
  "33": "FR",
  "352": "LU",
  "423": "LI",
  "32": "BE",
  "31": "NL",
  "39": "IT",
  "34": "ES",
};

export interface CountryHints {
  vatId: string | null;
  registerType: RegisterType | null;
  registerCourt: string | null;
  addressCountry: string | null;
  postalCode: string | null;
  phone: string | null;
  host: string | null;
  lang: string | null;
}

/** ISO 3166-1 alpha-2 guess from VAT, register, address, phone and TLD. */
export function guessCountry(h: CountryHints): string | null {
  const votes = new Map<string, number>();
  const vote = (cc: string | null | undefined, w: number) => {
    if (cc) votes.set(cc, (votes.get(cc) ?? 0) + w);
  };
  if (h.vatId) vote(VAT_PREFIX_COUNTRY[h.vatId.slice(0, 2)], 5);
  switch (h.registerType) {
    case "HRA":
    case "HRB":
    case "GnR":
    case "PR":
    case "VR":
      vote("DE", 4);
      break;
    case "FN":
      vote("AT", 4);
      break;
    case "CHE":
      vote("CH", 4);
      break;
    case "RCS":
    case "SIREN":
      vote("FR", 4);
      break;
  }
  if (h.registerCourt) {
    if (/^Amtsgericht/.test(h.registerCourt)) vote("DE", 2);
    if (/^(Handels|Landes)gericht/.test(h.registerCourt)) vote("AT", 2);
    if (/Kanton|canton|Cantone/.test(h.registerCourt)) vote("CH", 2);
  }
  vote(h.addressCountry, 3);
  if (h.postalCode?.length === 5) {
    vote("DE", 0.5);
    vote("FR", 0.5);
  } else if (h.postalCode?.length === 4) {
    vote("AT", 0.5);
    vote("CH", 0.5);
  }
  const intl = /^(?:\+|00)\s?\(?(\d{2,3})/.exec(
    h.phone?.replace(/\s/g, "") ?? "",
  );
  if (intl) {
    const cc3 = PHONE_COUNTRY[intl[1]!];
    const cc2 = PHONE_COUNTRY[intl[1]!.slice(0, 2)];
    vote(cc3 ?? cc2, 1.5);
  }
  if (h.host) vote(TLD_COUNTRY[h.host.split(".").at(-1)!], 1);
  if (h.lang) {
    const region = /^[a-z]{2}-([a-z]{2})$/.exec(h.lang)?.[1]?.toUpperCase();
    if (region) vote(region, 0.75);
    else if (h.lang.startsWith("de")) vote("DE", 0.25);
    else if (h.lang.startsWith("fr")) vote("FR", 0.25);
  }
  let best: string | null = null;
  let bestW = 0;
  for (const [cc, w] of votes)
    if (w > bestW) {
      best = cc;
      bestW = w;
    }
  return bestW >= 1 ? best : null;
}

// ------------------------------------------------------------- top level

/** Line index of the Impressum heading, or 0. */
function headingIndex(lines: string[]): number {
  const i = lines.findIndex(
    (l) =>
      l.length <= 80 &&
      /^(impressum|imprint|legal notice|site notice|mentions l[ée]gales|aviso legal|offenlegung|angaben gem(?:ä|ae)(?:ß|ss)|informations l[ée]gales|legal disclosure|anbieterkennzeichnung)\b/i.test(
        l,
      ),
  );
  return i < 0 ? 0 : i;
}

/** Extracts the company fields from a parsed Impressum page. */
export function extractImprint(
  page: ParsedPage,
  siteHost?: string,
): ImprintFields {
  const lines = page.lines;
  const h = headingIndex(lines);
  const register = findRegister(lines.slice(h)) ?? findRegister(lines);
  const vat = findVat(lines.slice(h)) ?? findVat(lines);

  const names: NameHit[] = [];
  lines.forEach((l, index) => {
    const n = nameFromLine(l);
    if (n) names.push({ ...n, index });
  });
  const name =
    names.find((n) => !n.copyright && n.index >= h) ??
    names.find((n) => !n.copyright) ??
    names[0] ??
    null;

  const address =
    (name ? findAddress(lines, name.index, name.index + 8) : null) ??
    findAddress(lines, h);
  const { phone, fax } = findPhones(lines.slice(h), page.tels);
  const email = findEmail(lines, page.mailtos, siteHost && stripWww(siteHost));

  const fields: ImprintFields = {
    companyName: name?.name ?? null,
    legalForm: name?.form ?? null,
    street: address?.street ?? null,
    postalCode: address?.postalCode ?? null,
    city: address?.city ?? null,
    address: address
      ? [address.street, `${address.postalCode} ${address.city}`]
          .filter(Boolean)
          .join(", ")
      : null,
    phone,
    fax,
    email,
    registerCourt: register?.court ?? null,
    registerType: register?.type ?? null,
    registerNumber: register?.number ?? null,
    vatId: vat?.vat ?? null,
    countryGuess: null,
  };
  // A Swiss UID that is also the VAT number: keep both.
  fields.countryGuess = guessCountry({
    vatId: fields.vatId,
    registerType: fields.registerType,
    registerCourt: fields.registerCourt,
    addressCountry: address?.country ?? null,
    postalCode: fields.postalCode,
    phone: fields.phone,
    host: siteHost ?? null,
    lang: page.lang,
  });
  return fields;
}

/** Whether a page is an Impressum: keywords plus at least one company field. */
export function looksLikeImprint(
  page: ParsedPage,
  fields: ImprintFields,
  url: string,
): boolean {
  if (fields.registerNumber || fields.vatId) return true;
  const keyword =
    IMPRINT_KEYWORDS.test(page.lines.slice(0, 400).join("\n")) ||
    LINK_HREF.test(url);
  return keyword && !!(fields.companyName || fields.address);
}

const PLACEHOLDER_VAT = new Set([
  "DE123456789",
  "DE999999999",
  "ATU12345678",
  "ATU99999999",
  "FR12345678901",
  "CHE-123.456.789 MWST",
]);
const PLACEHOLDER_TEXT = /muster|beispiel|example|exemple|lorem|xxx/i;

/** Sample data (Impressum generators, templates): never a real company. */
export function isPlaceholder(f: ImprintFields): boolean {
  return (
    (!!f.vatId && PLACEHOLDER_VAT.has(f.vatId)) ||
    f.registerNumber === "CHE-123.456.789" ||
    PLACEHOLDER_TEXT.test(`${f.registerCourt ?? ""} ${f.city ?? ""}`) ||
    /^(Muster|Beispiel|Example|Exemple)/i.test(f.companyName ?? "")
  );
}

/** Bot challenge pages that answer 200 (JavaScript checks, captchas). */
export function isChallenge(html: string): boolean {
  const head = html.slice(0, 20_000);
  return (
    /<title>\s*(Client Challenge|Just a moment|Attention Required|Access denied|Pardon Our Interruption|Request unsuccessful|Bot Verification|Human Verification|Ich bin kein Roboter)/i.test(
      head,
    ) ||
    /cf-browser-verification|cf_chl_opt|_Incapsula_Resource|challenge-platform|px-captcha|captcha-delivery/i.test(
      head,
    )
  );
}

/** Fields worth having, for choosing the best of several pages. */
export function score(f: ImprintFields): number {
  return (
    (f.registerNumber ? 10 : 0) +
    (f.vatId ? 10 : 0) +
    (f.companyName ? 3 : 0) +
    (f.address ? 2 : 0) +
    (f.phone ? 1 : 0) +
    (f.email ? 1 : 0)
  );
}
