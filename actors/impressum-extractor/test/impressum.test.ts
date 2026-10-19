import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { decodeBody, sniffCharset } from "../src/charset.js";
import {
  classify,
  HttpClient,
  HttpError,
  type FetchLike,
} from "../src/http.js";
import {
  canonicalForm,
  deobfuscate,
  extractImprint,
  findCourt,
  guessCountry,
  isChallenge,
  isGenericEmail,
  isPlaceholder,
  nameFromLine,
  parseDomain,
  parsePage,
  sameSite,
  toLines,
  type ImprintFields,
} from "../src/impressum.js";
import { InputError, normalizeInput } from "../src/input.js";
import { Robots } from "../src/robots.js";
import { runImprints, type ImprintResult } from "../src/run.js";

const raw = (name: string): Buffer =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const fixture = (name: string): string => decodeBody(raw(name), null);

const extract = (name: string, url: string): ImprintFields =>
  extractImprint(parsePage(fixture(name), url), new URL(url).hostname);

// Personal data in the fixtures that must never reach the output.
const PERSONAL = [
  "Jana Albrecht",
  "Albrecht",
  "Tobias Wendt",
  "j.albrecht",
  "Klaus Weber",
  "Sabine",
  "Lena Hofer",
  "lena.hofer",
  "Reto Brunner",
  "Nadia Imhof",
  "Camille Moreau",
  "Mia Kowalski",
  "Paul Brandt",
];
const noPersonalData = (f: object) => {
  const json = JSON.stringify(f);
  for (const p of PERSONAL) expect(json, p).not.toContain(p);
};

describe("domains", () => {
  it("parses domains and URLs", () => {
    expect(parseDomain("Example.DE")).toMatchObject({
      host: "example.de",
      domain: "example.de",
      origin: "https://example.de",
      url: null,
    });
    expect(
      parseDomain(" https://www.example.at/impressum?lang=de "),
    ).toMatchObject({
      host: "www.example.at",
      domain: "example.at",
      url: "https://www.example.at/impressum?lang=de",
    });
    expect(parseDomain("http://shop.example.ch/")).toMatchObject({
      origin: "http://shop.example.ch",
      domain: "shop.example.ch",
      url: null,
    });
    expect(parseDomain("münchen-bäckerei.de")?.host).toMatch(
      /^xn--mnchen-bckerei-[a-z0-9]+\.de$/,
    );
  });

  it("rejects non-domains", () => {
    for (const bad of [
      "",
      "not a domain",
      "localhost",
      "192.168.0.1",
      "ftp://example.de",
      "mailto:info@example.de",
      "example",
    ])
      expect(parseDomain(bad), bad).toBeNull();
  });

  it("matches same-site hosts", () => {
    expect(sameSite("www.example.de", "example.de")).toBe(true);
    expect(sameSite("shop.example.de", "www.example.de")).toBe(true);
    expect(sameSite("example.de", "example.at")).toBe(false);
    expect(sameSite("badexample.de", "example.de")).toBe(false);
  });
});

describe("robots.txt", () => {
  const txt = [
    "# comment",
    "User-agent: Googlebot",
    "Disallow:",
    "",
    "User-agent: *",
    "User-agent: OtherBot",
    "Disallow: /intern/",
    "Disallow: /*.pdf$",
    "Allow: /intern/impressum",
    "Disallow: /rechtliches",
    "Crawl-delay: 2",
  ].join("\n");
  const r = Robots.parse(txt);

  it("applies the * group with longest match", () => {
    expect(r.isAllowed("/")).toBe(true);
    expect(r.isAllowed("/impressum")).toBe(true);
    expect(r.isAllowed("/intern/team")).toBe(false);
    expect(r.isAllowed("/intern/impressum")).toBe(true);
    expect(r.isAllowed("/rechtliches/impressum")).toBe(false);
    expect(r.isAllowed("/docs/agb.pdf")).toBe(false);
    expect(r.isAllowed("/docs/agb.pdf?x=1")).toBe(true);
    expect(r.isAllowed("/robots.txt")).toBe(true);
  });

  it("uses a named group when the agent has one", () => {
    expect(Robots.parse(txt, "googlebot").isAllowed("/intern/team")).toBe(true);
  });

  it("handles allow-all, disallow-all and empty files", () => {
    expect(Robots.allowAll().isAllowed("/x")).toBe(true);
    expect(Robots.disallowAll().isAllowed("/impressum")).toBe(false);
    expect(Robots.parse("").isAllowed("/impressum")).toBe(true);
    expect(
      Robots.parse("User-agent: *\nDisallow: /").isAllowed("/impressum"),
    ).toBe(false);
  });
});

describe("charset", () => {
  it("decodes Latin-1 pages by their meta tag", () => {
    const html = fixture("de-kg-latin1.html");
    expect(html).toContain("Persönlich haftende Gesellschafterin");
    expect(html).not.toContain("�");
  });

  it("prefers the header charset and falls back from invalid UTF-8", () => {
    expect(sniffCharset("text/html; charset=UTF-8", "")).toBe("utf-8");
    expect(sniffCharset(null, '<meta charset="windows-1252">')).toBe(
      "windows-1252",
    );
    const latin1 = Buffer.from("Straße 1, Köln", "latin1");
    expect(decodeBody(latin1, "text/html")).toBe("Straße 1, Köln");
    expect(decodeBody(Buffer.from("Straße", "utf8"), null)).toBe("Straße");
  });
});

describe("text and links", () => {
  it("joins labels on their own line with the value", () => {
    expect(toLines("USt-IdNr.:\nDE123\n\nTelefon\n0421 1")).toEqual([
      "USt-IdNr.: DE123",
      "Telefon: 0421 1",
    ]);
  });

  it("finds the footer Impressum link and skips generators and privacy", () => {
    const page = parsePage(
      fixture("de-home.html"),
      "https://www.nordlicht-logistik.de/",
    );
    expect(page.imprintLinks).toEqual([
      {
        url: "https://www.nordlicht-logistik.de/rechtliches/impressum",
        exact: true,
      },
      { url: "https://partner.example.org/impressum", exact: false },
    ]);
    expect(page.lang).toBe("de-de");
  });
});

describe("German GmbH Impressum", () => {
  const f = extract(
    "de-gmbh.html",
    "https://www.nordlicht-logistik.de/rechtliches/impressum",
  );

  it("extracts the company fields", () => {
    expect(f).toEqual({
      companyName: "Nordlicht Logistik GmbH",
      legalForm: "GmbH",
      street: "Hafenweg 14",
      postalCode: "28197",
      city: "Bremen",
      address: "Hafenweg 14, 28197 Bremen",
      phone: "+49 (0)421 690 418-0",
      fax: "+49 (0)421 690 418-99",
      email: "info@nordlicht-logistik.de",
      registerCourt: "Amtsgericht Bremen",
      registerType: "HRB",
      registerNumber: "HRB 31842 HB",
      vatId: "DE287451936",
      countryGuess: "DE",
    });
  });

  it("outputs no managing directors, responsible persons or personal emails", () => {
    noPersonalData(f);
  });
});

describe("German GmbH & Co. KG Impressum (Latin-1, table layout)", () => {
  const f = extract(
    "de-kg-latin1.html",
    "https://www.weber-gartenbau.de/impressum.html",
  );

  it("takes the KG, not its general partner or the web agency", () => {
    expect(f.companyName).toBe("Weber Gartenbau GmbH & Co. KG");
    expect(f.legalForm).toBe("GmbH & Co. KG");
    expect(f.registerType).toBe("HRA");
    expect(f.registerNumber).toBe("HRA 58213 B");
    expect(f.registerCourt).toBe("Amtsgericht Charlottenburg");
  });

  it("extracts address, contact and VAT ID", () => {
    expect(f).toMatchObject({
      street: "Grüner Ring 7a",
      postalCode: "10437",
      city: "Berlin",
      phone: "030 / 44 71 92 - 0",
      fax: "030 / 44 71 92 - 29",
      email: "kontakt@weber-gartenbau.de",
      vatId: "DE318204675",
      countryGuess: "DE",
    });
    noPersonalData(f);
  });
});

describe("Austrian Impressum", () => {
  const f = extract(
    "at-gmbh.html",
    "https://www.bergblick-software.at/impressum",
  );

  it("extracts FN, Firmenbuchgericht and UID", () => {
    expect(f).toEqual({
      companyName: "Bergblick Software GmbH",
      legalForm: "GmbH",
      street: "Mariahilfer Straße 88/3/12",
      postalCode: "1070",
      city: "Wien",
      address: "Mariahilfer Straße 88/3/12, 1070 Wien",
      phone: "+43 1 890 23 45",
      fax: null,
      email: "office@bergblick-software.at",
      registerCourt: "Handelsgericht Wien",
      registerType: "FN",
      registerNumber: "FN 482913 k",
      vatId: "ATU71839245",
      countryGuess: "AT",
    });
    noPersonalData(f);
  });
});

describe("Swiss Impressum", () => {
  const f = extract("ch-ag.html", "https://www.alpenrot.ch/impressum");

  it("extracts the UID as register number and the MWST number as VAT ID", () => {
    expect(f).toEqual({
      companyName: "Alpenrot AG",
      legalForm: "AG",
      street: "Bahnhofstrasse 21",
      postalCode: "8001",
      city: "Zürich",
      address: "Bahnhofstrasse 21, 8001 Zürich",
      phone: "+41 44 512 37 80",
      fax: null,
      email: "kontakt@alpenrot.ch",
      registerCourt: "Handelsregisteramt des Kantons Zürich",
      registerType: "CHE",
      registerNumber: "CHE-317.482.905",
      vatId: "CHE-317.482.905 MWST",
      countryGuess: "CH",
    });
    noPersonalData(f);
  });
});

describe("French mentions légales", () => {
  const f = extract(
    "fr-sas.html",
    "https://www.atelier-lumiere.fr/mentions-legales",
  );

  it("extracts RCS, TVA and the publisher, not the host", () => {
    expect(f).toEqual({
      companyName: "Atelier Lumière SAS",
      legalForm: "SAS",
      street: "12 rue des Tanneurs",
      postalCode: "69002",
      city: "Lyon",
      address: "12 rue des Tanneurs, 69002 Lyon",
      phone: "+33 4 72 00 11 22",
      fax: null,
      email: "contact@atelier-lumiere.fr",
      registerCourt: "RCS Lyon",
      registerType: "RCS",
      registerNumber: "RCS Lyon 842 315 907",
      vatId: "FR41842315907",
      countryGuess: "FR",
    });
    noPersonalData(f);
  });
});

describe("Impressum without register or VAT ID", () => {
  it("still extracts the company, address and contact", () => {
    const f = extract(
      "de-gbr-no-register.html",
      "https://cafe-morgenrot.de/impressum",
    );
    expect(f).toMatchObject({
      companyName: "Café Morgenrot GbR",
      legalForm: "GbR",
      address: "Lindenplatz 3, 04109 Leipzig",
      phone: "0341 25 66 81",
      email: "hallo@cafe-morgenrot.de",
      registerNumber: null,
      vatId: null,
      countryGuess: "DE",
    });
    noPersonalData(f);
  });
});

describe("field helpers", () => {
  it("reads company names from lines", () => {
    expect(nameFromLine("Anbieter: Muster Handels-GmbH")?.name).toBe(
      "Muster Handels-GmbH",
    );
    expect(nameFromLine("Impressum Beispiel SE")).toMatchObject({
      name: "Beispiel SE",
      form: "SE",
    });
    expect(
      nameFromLine("© 2026 Alpenrot AG. Alle Rechte vorbehalten."),
    ).toMatchObject({
      name: "Alpenrot AG",
      copyright: true,
    });
    expect(
      nameFromLine("Kaffeerösterei Sonnenschein UG (haftungsbeschraenkt)")
        ?.form,
    ).toBe("UG (haftungsbeschränkt)");
    expect(nameFromLine("Blumen Schulz e. K.")?.form).toBe("e.K.");
    expect(nameFromLine("Horlogerie du Lac Sàrl, Rue du Rhône 4")?.name).toBe(
      "Horlogerie du Lac Sàrl",
    );
    expect(nameFromLine("STANDARD Verlagsgesellschaft m.b.H.,")?.form).toBe(
      "m.b.H.",
    );
  });

  it("ignores roles, sentences and other companies", () => {
    for (const l of [
      "Geschäftsführer: Max Weber GmbH",
      "Persönlich haftende Gesellschafterin: Weber Verwaltungs GmbH",
      "Die Nordlicht Logistik GmbH ist nicht bereit, teilzunehmen.",
      "Möglicher Betreff nur bei einer AG",
      "Konzept & Design: Grünfink Werbeagentur GmbH",
      "Hébergeur : Nuage Hébergement SARL",
      "Amtsgericht München HRB 1234",
      "GmbH",
    ])
      expect(nameFromLine(l), l).toBeNull();
  });

  it("canonicalizes legal forms", () => {
    expect(canonicalForm("GmbH&Co.KG")).toBe("GmbH & Co. KG");
    expect(canonicalForm("GmbH & Co KG")).toBe("GmbH & Co. KG");
    expect(canonicalForm("S.à r.l.")).toBe("S.à r.l.");
    expect(canonicalForm("PartGmbB")).toBe("PartG mbB");
  });

  it("finds register courts", () => {
    expect(findCourt(["Registergericht: AG Charlottenburg"])).toBe(
      "Amtsgericht Charlottenburg",
    );
    expect(
      findCourt([
        "Eingetragen beim Amtsgerichts Frankfurt am Main unter HRB 1",
      ]),
    ).toBe("Amtsgericht Frankfurt am Main");
    expect(findCourt(["AG Köln, HRB 12345"])).toBe("Amtsgericht Köln");
    expect(findCourt(["Firmenbuchgericht: Landesgericht Linz"])).toBe(
      "Landesgericht Linz",
    );
    expect(findCourt(["Ansbach Registration Office, HRB 6089"])).toBe(
      "Ansbach Registration Office",
    );
    expect(findCourt(["Registre du commerce du canton de Vaud"])).toBe(
      "Registre du commerce du canton de Vaud",
    );
    expect(findCourt(["Sitz der Gesellschaft: Berlin"])).toBeNull();
  });

  it("keeps only role mailboxes", () => {
    expect(isGenericEmail("info@example.de")).toBe(true);
    expect(isGenericEmail("kunden-service@example.de")).toBe(true);
    expect(isGenericEmail("office.wien@example.at")).toBe(false);
    expect(isGenericEmail("info.de@example.de")).toBe(true);
    expect(isGenericEmail("nordlicht@nordlicht.de")).toBe(true);
    expect(isGenericEmail("j.albrecht@nordlicht.de")).toBe(false);
    expect(isGenericEmail("tobias@nordlicht.de")).toBe(false);
    expect(isGenericEmail("camille.moreau@atelier.fr")).toBe(false);
  });

  it("undoes email obfuscation", () => {
    expect(deobfuscate("info (at) example (dot) de")).toBe("info@example.de");
    expect(deobfuscate("kontakt[at]example.de")).toBe("kontakt@example.de");
  });

  it("guesses the country", () => {
    const none = {
      vatId: null,
      registerType: null,
      registerCourt: null,
      addressCountry: null,
      postalCode: null,
      phone: null,
      host: null,
      lang: null,
    };
    expect(guessCountry({ ...none, vatId: "ATU12345679", host: "x.de" })).toBe(
      "AT",
    );
    expect(guessCountry({ ...none, registerType: "HRB", host: "x.com" })).toBe(
      "DE",
    );
    expect(guessCountry({ ...none, phone: "+41 44 000 00 00" })).toBe("CH");
    expect(guessCountry({ ...none, postalCode: "1010" })).toBeNull();
    expect(guessCountry(none)).toBeNull();
  });

  it("spots sample data and bot challenges", () => {
    const f = extract(
      "de-gmbh.html",
      "https://nordlicht-logistik.de/impressum",
    );
    expect(isPlaceholder(f)).toBe(false);
    expect(isPlaceholder({ ...f, vatId: "DE123456789" })).toBe(true);
    expect(
      isPlaceholder({ ...f, registerCourt: "Amtsgericht Musterstadt" }),
    ).toBe(true);
    expect(isChallenge("<html><head><title>Just a moment...</title>")).toBe(
      true,
    );
    expect(isChallenge(fixture("de-gmbh.html"))).toBe(false);
  });
});

describe("input", () => {
  it("uses the default domain when none is given", () => {
    expect(normalizeInput({}).targets.map((t) => t.domain)).toEqual([
      "heise.de",
    ]);
    expect(normalizeInput(null).maxConcurrency).toBe(5);
  });

  it("dedupes by domain and keeps invalid lines apart", () => {
    const n = normalizeInput({
      domains: [
        "example.de",
        "https://www.example.de/impressum",
        "not a domain",
        { url: "example.at" },
        "",
      ],
      maxConcurrency: "3",
    });
    expect(n.targets.map((t) => [t.domain, t.url])).toEqual([
      ["example.de", "https://www.example.de/impressum"],
      ["example.at", null],
    ]);
    expect(n.invalid).toEqual(["not a domain"]);
    expect(n.maxConcurrency).toBe(3);
  });

  it("rejects bad input", () => {
    expect(() => normalizeInput({ domains: ["nope"] })).toThrow(InputError);
    expect(() =>
      normalizeInput({ domains: ["example.de"], maxConcurrency: 50 }),
    ).toThrow(InputError);
  });
});

describe("HttpClient", () => {
  const res = (status: number, body = "", url?: string) => ({
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: { get: () => "text/html" },
    text: async () => body,
  });

  it("classifies errors", () => {
    expect(classify(new HttpError(403, "", "u"))).toBe("blocked");
    expect(classify(new HttpError(503, "", "u"))).toBe("transient");
    expect(classify(new HttpError(404, "", "u"))).toBe("fatal");
    expect(classify(new Error("socket hang up"))).toBe("transient");
  });

  it("retries 5xx once and never retries 404 or 403", async () => {
    const fetch = vi
      .fn<FetchLike>()
      .mockResolvedValueOnce(res(503))
      .mockResolvedValueOnce(res(200, "ok", "https://x.de/final"));
    const c = new HttpClient({ fetch, sleep: async () => {} });
    expect(await c.get("https://x.de/")).toMatchObject({
      url: "https://x.de/final",
      body: "ok",
      contentType: "text/html",
    });
    expect(fetch).toHaveBeenCalledTimes(2);

    for (const status of [404, 403]) {
      const f = vi.fn<FetchLike>().mockResolvedValue(res(status));
      const c2 = new HttpClient({ fetch: f, sleep: async () => {} });
      await expect(c2.get("https://x.de/")).rejects.toBeInstanceOf(HttpError);
      expect(f).toHaveBeenCalledTimes(1);
    }
  });

  it("doesn't retry DNS errors", async () => {
    const err = Object.assign(new Error("getaddrinfo ENOTFOUND x.de"), {
      code: "ENOTFOUND",
    });
    const fetch = vi.fn<FetchLike>().mockRejectedValue(err);
    const c = new HttpClient({ fetch, sleep: async () => {} });
    await expect(c.get("https://x.de/")).rejects.toThrow("ENOTFOUND");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("runImprints", () => {
  const NOW = new Date("2026-10-19T12:00:00.000Z");
  const pages: Record<string, string | number | Error> = {
    // Nordlicht: home page links to the Impressum.
    "https://nordlicht-logistik.de/robots.txt":
      "User-agent: *\nDisallow: /intern/",
    "https://nordlicht-logistik.de/": fixture("de-home.html"),
    "https://nordlicht-logistik.de/rechtliches/impressum":
      fixture("de-gmbh.html"),
    // Café: no links on the home page; found at /impressum, no register/VAT.
    "https://cafe-morgenrot.de/robots.txt": 404,
    "https://cafe-morgenrot.de/": "<html><body><h1>Café</h1></body></html>",
    "https://cafe-morgenrot.de/impressum": fixture("de-gbr-no-register.html"),
    // Alpenrot: robots.txt disallows everything.
    "https://alpenrot.ch/robots.txt": "User-agent: *\nDisallow: /",
    // Bergblick: blocked.
    "https://bergblick-software.at/robots.txt": 403,
    "https://bergblick-software.at/": 403,
    "https://bergblick-software.at/impressum": 403,
    // Atelier: the Impressum URL given directly.
    "https://atelier-lumiere.fr/robots.txt": "",
    "https://atelier-lumiere.fr/mentions-legales": fixture("fr-sas.html"),
    // Gone: DNS error.
    "https://gone.example.de/robots.txt": Object.assign(
      new Error("getaddrinfo ENOTFOUND gone.example.de"),
      { code: "ENOTFOUND" },
    ),
    "http://gone.example.de/robots.txt": Object.assign(
      new Error("getaddrinfo ENOTFOUND gone.example.de"),
      { code: "ENOTFOUND" },
    ),
  };
  const requested: string[] = [];
  const get = async (url: string) => {
    requested.push(url);
    const p = pages[url] ?? 404;
    if (p instanceof Error) throw p;
    if (typeof p === "number") throw new HttpError(p, "", url);
    return { url, status: 200, contentType: "text/html", body: p };
  };

  it("finds, parses and charges only register/VAT rows", async () => {
    const out: [ImprintResult, boolean][] = [];
    const stats = await runImprints(
      normalizeInput({
        domains: [
          "nordlicht-logistik.de",
          "cafe-morgenrot.de",
          "alpenrot.ch",
          "bergblick-software.at",
          "https://atelier-lumiere.fr/mentions-legales",
          "gone.example.de",
          "kein domain",
        ],
        maxConcurrency: 1,
      }),
      {
        get,
        emit: async (item, charge) => (out.push([item, charge]), true),
        now: () => NOW,
      },
    );
    const by = Object.fromEntries(out.map(([r, c]) => [r.input, { r, c }]));

    expect(by["nordlicht-logistik.de"]!.c).toBe(true);
    expect(by["nordlicht-logistik.de"]!.r).toMatchObject({
      domain: "nordlicht-logistik.de",
      status: "found",
      sourceUrl: "https://nordlicht-logistik.de/rechtliches/impressum",
      companyName: "Nordlicht Logistik GmbH",
      registerNumber: "HRB 31842 HB",
      vatId: "DE287451936",
      pagesFetched: 3,
      error: null,
      scrapedAt: "2026-10-19T12:00:00.000Z",
    });
    // Off-site partner link never fetched.
    expect(requested.some((u) => u.includes("example.org"))).toBe(false);

    expect(by["cafe-morgenrot.de"]!.c).toBe(false);
    expect(by["cafe-morgenrot.de"]!.r).toMatchObject({
      status: "found",
      sourceUrl: "https://cafe-morgenrot.de/impressum",
      companyName: "Café Morgenrot GbR",
      registerNumber: null,
      vatId: null,
    });

    expect(by["alpenrot.ch"]!.r.status).toBe("robotsDisallowed");
    expect(requested.filter((u) => u.includes("alpenrot.ch"))).toEqual([
      "https://alpenrot.ch/robots.txt",
    ]);
    expect(by["bergblick-software.at"]!.r.status).toBe("blocked");
    expect(by["bergblick-software.at"]!.r.pagesFetched).toBe(3);
    expect(by["https://atelier-lumiere.fr/mentions-legales"]!).toMatchObject({
      c: true,
      r: { status: "found", pagesFetched: 2, vatId: "FR41842315907" },
    });
    expect(by["gone.example.de"]!.r.status).toBe("unreachable");
    expect(by["kein domain"]!).toMatchObject({
      c: false,
      r: { status: "invalidInput", domain: null },
    });
    for (const [r] of out) noPersonalData(r);

    expect(stats).toMatchObject({
      domains: 7,
      found: 3,
      charged: 2,
      blocked: 1,
      robotsDisallowed: 1,
      unreachable: 1,
      invalid: 1,
      stopReason: "done",
    });
  });

  it("stops when the budget is reached", async () => {
    const out: ImprintResult[] = [];
    const stats = await runImprints(
      normalizeInput({
        domains: [
          "nordlicht-logistik.de",
          "https://atelier-lumiere.fr/mentions-legales",
          "cafe-morgenrot.de",
        ],
        maxConcurrency: 1,
      }),
      { get, emit: async (item, charge) => (out.push(item), !charge) },
    );
    expect(out.map((r) => r.domain)).toEqual(["nordlicht-logistik.de"]);
    expect(stats.stopReason).toBe("budget");
  });
});
