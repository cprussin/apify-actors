# Impressum Extractor: DACH Legal Notice, HRB & VAT ID

**Impressum Extractor** turns a list of company websites into clean company records from their **Impressum** (legal notice), as JSON, CSV or Excel. German, Austrian and Swiss websites must publish one (§ 5 DDG, § 5 ECG, Art. 3 UWG), and French sites publish _mentions légales_. The actor finds that page and reads the company fields:

- ✅ **Legal company name and legal form**: GmbH, AG, UG (haftungsbeschränkt), GmbH & Co. KG, KG, OHG, e.K., SE, Austrian FN-registered companies, Swiss AG/GmbH/Sàrl, French SAS/SARL/SA, ...
- ✅ **Register court and number**: Amtsgericht + HRB/HRA (DE), Firmenbuch FN + Handelsgericht (AT), UID CHE-xxx.xxx.xxx + Handelsregisteramt (CH), RCS / SIREN (FR).
- ✅ **VAT ID**: USt-IdNr. (DE…), UID (ATU…), MWST (CHE… MWST), TVA (FR…) and other EU VAT numbers.
- ✅ **Address and contact**: street, postal code, city, company phone, fax and the generic contact mailbox (info@, kontakt@, office@, ...).
- ✅ **Country guess** (ISO code) from VAT ID, register, court, address, phone prefix and TLD.
- ✅ **Finds the page for you**: Impressum links in the home page footer, then common paths such as `/impressum`, `/imprint`, `/legal-notice`, `/mentions-legales`, `/kontakt/impressum`.
- ✅ **Fair billing**: one row per domain, and you pay only for rows with a register number or VAT ID. Not found, blocked or incomplete rows are free.
- ✅ Light and polite: plain HTTP (no browser, no proxy, no search engine), a few requests per domain, and it respects robots.txt.

**Company data only.** The actor never outputs managing directors, owners, responsible persons (V.i.S.d.P.), personal names or personal email addresses. See [Lawful use](#lawful-use).

## Start in one minute

Click **Start** with the prefilled input:

```json
{
  "domains": ["heise.de"]
}
```

You get: one row for heise.de with `companyName` (Heise Medien GmbH & Co. KG), `legalForm`, `address`, `registerCourt` (Amtsgericht Hannover), `registerNumber` (HRB 60405), `vatId`, `email` and the `sourceUrl` of the Impressum.

**Cost:** $0.003: 1 imprint × $0.003, plus the $0.00005 actor-start fee.

## Use with an AI assistant

Connect the [Apify MCP server](https://mcp.apify.com) to Claude, ChatGPT, Cursor or any MCP client (`https://mcp.apify.com?tools=cprussin/impressum-extractor` loads only this actor), then paste:

```text
Use the Apify actor cprussin/impressum-extractor on these websites: heise.de, hetzner.com, jimdo.com. List each company's legal name, legal form, register court, register number and VAT ID.
```

## Recipes

### Enrich a list of German company domains

```json
{
  "domains": ["heise.de", "hetzner.com", "jimdo.com", "check24.de", "otto.de"]
}
```

### Austria, Switzerland and France in one run

Austrian FN numbers, Swiss UID/MWST numbers and French RCS/TVA numbers are recognized next to German ones.

```json
{
  "domains": ["a1.net", "derstandard.at", "galaxus.ch", "doctolib.fr"]
}
```

### Paste the Impressum URL directly

When you already know the page, give its URL: it is tried first.

```json
{
  "domains": ["https://www.heise.de/impressum.html"]
}
```

### Large lists, faster

Process 10,000 domains per run, up to 20 in parallel.

```json
{
  "domains": ["heise.de", "otto.de", "bosch.de"],
  "maxConcurrency": 20
}
```

## Who uses Impressum data?

- **B2B sales and CRM teams**: add legal names, register numbers and VAT IDs to account lists, and deduplicate companies across brands and domains.
- **KYC, onboarding and compliance**: pre-fill supplier and customer records, then verify them in the official register.
- **Invoicing and procurement**: get the correct legal entity and VAT ID for a vendor's website.
- **Market research**: count legal forms, register courts or countries across a list of websites.
- **AI agents**: look up who legally runs a website through the Apify API or MCP server.

## How does the Impressum extractor work?

1. Add company domains or URLs, one per line.
2. For each domain the actor reads `robots.txt`, loads the home page and follows its Impressum / legal-notice links (text such as _Impressum_, _Imprint_, _Legal notice_, _Mentions légales_, _Aviso legal_).
3. If none works, it tries common paths (`/impressum`, `/imprint`, `/legal-notice`, `/mentions-legales`, `/kontakt/impressum`, ...).
4. It parses the page's HTML and keeps the company fields. It stops at the first page with a register number or VAT ID, so most domains take 3–4 requests.

## How do I choose which domains to process?

| Field            | Description                                                        | Example                   |
| ---------------- | ------------------------------------------------------------------ | ------------------------- |
| `domains`        | Company domains or URLs, one per line (up to 10,000; deduplicated) | `["heise.de", "otto.de"]` |
| `maxConcurrency` | Domains processed in parallel, 1–20 (default 5)                    | `10`                      |

- `example.de`, `www.example.de`, `https://example.de/` and `https://www.example.de/impressum` all work. One row per domain.
- Lines that are not domains are returned as `invalidInput` rows (free) instead of failing the run.

## What data do you get for each domain?

```json
{
  "input": "heise.de",
  "domain": "heise.de",
  "status": "found",
  "sourceUrl": "https://www.heise.de/impressum.html",
  "companyName": "Heise Medien GmbH & Co. KG",
  "legalForm": "GmbH & Co. KG",
  "street": "Karl-Wiechert-Allee 10",
  "postalCode": "30625",
  "city": "Hannover",
  "address": "Karl-Wiechert-Allee 10, 30625 Hannover",
  "phone": null,
  "fax": null,
  "email": "webmaster@heise.de",
  "registerCourt": "Amtsgericht Hannover",
  "registerType": "HRB",
  "registerNumber": "HRB 60405",
  "vatId": "DE813501887",
  "countryGuess": "DE",
  "pagesFetched": 4,
  "error": null,
  "scrapedAt": "2026-10-19T12:00:00.000Z"
}
```

- `status`: `found` (Impressum page found), `notFound`, `blocked` (403/429 or a bot challenge), `robotsDisallowed`, `unreachable` (DNS, TLS or connection error), `invalidInput` or `error`.
- `registerNumber` includes its prefix: `HRB 60405`, `FN 482913 k`, `CHE-317.482.905`, `RCS Lyon 842 315 907`. `registerType` is the prefix alone.
- `vatId` has no spaces (`DE813501887`, `ATU71839245`, `FR41842315907`); Swiss numbers keep their official format (`CHE-317.482.905 MWST`).
- `email` is only a role mailbox (info@, kontakt@, office@, service@, ...) or brand@brand. Personal-looking addresses are dropped.
- `countryGuess` is a best guess; fields that aren't on the page are `null`.

## How much does it cost to extract Impressum data?

Pay-per-event, only for useful rows:

| Event             | Price      | When                                               |
| ----------------- | ---------- | -------------------------------------------------- |
| Imprint extracted | **$0.003** | A row with a register number or a VAT ID (or both) |

That's **$3 per 1,000 imprints**. Rows without a register number or VAT ID (not found, blocked, sole traders without either) are free. If you set a **maximum cost per run**, the actor stops cleanly when it reaches it.

## Tips

- **Clean your list first**: one domain per company. Brand sites often share one Impressum; the parent company's domain gives the best results.
- **Check `status`**: `blocked` and `unreachable` rows are free; retry them later or look them up by hand.
- **Verify before you rely on it**: an Impressum is self-reported. For contracts or KYC, confirm the register number at handelsregister.de, firmenbuch.at, zefix.ch or annuaire-entreprises.data.gouv.fr, and the VAT ID with the EU VIES service.

## Lawful use

The Impressum is a legally required public disclosure, but how you use the data is your responsibility:

- **Company data only, by design.** The actor does not output names of managing directors, owners, shareholders or responsible persons, and drops personal email addresses, to reduce GDPR exposure. Sole traders (e.K., Einzelunternehmen) may still carry the owner's name in the company name, as registered.
- **No cold email.** German law (§ 7 UWG) and similar rules in Austria, Switzerland and France restrict unsolicited advertising by email, phone and fax, also to businesses. Don't use the contact fields for cold outreach without a legal basis.
- **GDPR applies** to any personal data you combine with these records. Have a lawful basis, keep records minimal, and honor objection and deletion requests.
- No email verification, no search engines and no login: the actor reads only the public pages the website itself links to, and respects robots.txt.

## Impressum extractor FAQ

**Which countries work?** Germany, Austria, Switzerland and France are tuned; Luxembourg, Liechtenstein, Belgium, the Netherlands, Italy and Spain work for VAT IDs and many legal forms.

**Why no managing directors?** On purpose. Director names are personal data under the GDPR; this actor keeps to company-level fields.

**Why was a site `notFound`?** Some sites render the Impressum only with JavaScript, put it in a PDF or an image, or host it on another domain. The actor uses plain HTTP and the site's own links only.

**Why `blocked`?** A few large sites answer automated requests with 403 or a bot challenge. The actor doesn't use proxies or browsers to get around that; these rows are free.

**Does it respect robots.txt?** Yes. Pages disallowed for all user agents are skipped (`robotsDisallowed`), and an unreachable robots.txt (5xx) counts as "disallow all", as RFC 9309 says.

**Can I use it through the API or with AI agents?** Yes. Call it through the Apify API, the Apify MCP server or any Apify integration.

**Disclaimer:** This actor is not affiliated with any of the websites it reads. Company names and trademarks belong to their owners. You are responsible for complying with applicable laws (including the GDPR and UWG) and the websites' terms when using the data.

## Related actors

- [New Business Registrations](https://apify.com/cprussin/new-business-registrations?fpr=to54nm): Newly registered LLCs and corporations from official state registries.
- [SEC Form D Scraper](https://apify.com/cprussin/sec-form-d-funding?fpr=to54nm): New startup funding rounds and private placements from SEC EDGAR Form D filings.
- [Website Screenshot API](https://apify.com/cprussin/website-screenshot?fpr=to54nm): Full-page or viewport screenshots and PDFs of any URL.
