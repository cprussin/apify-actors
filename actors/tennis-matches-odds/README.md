# Tennis Results & Betting Odds Scraper (ATP, WTA, ITF)

**Tennis Results & Betting Odds Scraper** exports **historical and daily tennis match results with closing betting odds** from [TennisExplorer](https://www.tennisexplorer.com): ATP, WTA, ATP Challenger and ITF singles. Each match comes with set-by-set scores (tiebreaks included), winner, tournament, surface, round, seeds and the home/away closing odds. Optionally add **per-bookmaker odds** (closing and opening) and player rankings.

- ✅ **Results + odds in one row**: ready for betting models, backtests and sports analytics.
- ✅ **Any date range**: yesterday by default, or years of history (one day per request).
- ✅ **ATP, WTA, Challenger, ITF men and women**, plus UTR/exhibition events if you want them.
- ✅ **Player mode**: the full singles match history of chosen players, with round, surface and odds.
- ✅ **Per-bookmaker odds** (bet365, Pinnacle, Betfair, 1xBet, Unibet...): closing and opening prices.
- ✅ **Daily monitoring**: `onlyNew` returns each match once across scheduled runs.
- ✅ No login, no API key, no proxy. Polite, low-rate scraping (about 1 request per second).

## Who uses tennis results and odds data?

- **Sports bettors and tipsters** backtest strategies against closing odds (closing line value, favourite/underdog ROI, surface edges).
- **Data scientists and ML engineers** build tennis prediction datasets: Elo models, logistic regression, gradient boosting, neural nets.
- **Sports analytics teams and journalists** track form, upsets and surface performance.
- **Fantasy and odds-comparison sites** feed daily results into their products.
- **Students and researchers** study betting-market efficiency.

## How does the tennis matches and odds scraper work?

1. **Daily results mode** (default): for every day in `startDate`…`endDate`, the actor loads TennisExplorer's results page for men's and/or women's singles (`/results/?type=atp-single|wta-single&year=&month=&day=`), which lists every finished match with its closing odds.
2. It keeps the tours you asked for, then (by default) looks up **round and surface** on each tournament page, once per tournament.
3. With `includeBookmakerOdds`, it also opens each match's detail page (`/match-detail/?id=`) for the per-bookmaker odds, full player names and rankings.
4. **Player mode**: set `playerSlugs` and it reads each player's yearly match list (`/player/<slug>/?annual=<year>`) instead.
5. Requests are sequential, about one per second with random jitter, with retries and exponential backoff. TennisExplorer's robots.txt allows these pages.

If a day genuinely has no matches (TennisExplorer says so), the run succeeds with a warning. If pages can't be loaded or parsed, the run fails instead of returning an empty "success".

## How do I choose which tennis matches to scrape?

| Field                    | Description                                                                                                               | Example                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `startDate`              | First day: `YYYY-MM-DD`, `yesterday`, or relative (`"7 days"`). Empty = end date (player mode: 1 January of that year)    | `"2025-01-01"`          |
| `endDate`                | Last day (inclusive). Empty = yesterday                                                                                   | `"2025-12-31"`          |
| `tours`                  | `ATP`, `WTA`, `CHALLENGER`, `ITF_MEN`, `ITF_WOMEN`, `OTHER_MEN`, `OTHER_WOMEN`                                            | `["ATP", "CHALLENGER"]` |
| `playerSlugs`            | Player mode: TennisExplorer player slugs or URLs                                                                          | `["hurkacz"]`           |
| `maxMatches`             | Stop after this many matches (default 500)                                                                                | `10000`                 |
| `includeRoundAndSurface` | Look up round and surface on tournament pages (default `true`)                                                            | `true`                  |
| `includeBookmakerOdds`   | Add per-bookmaker odds, rankings and full names from each match page (default `false`; one extra request and event/match) | `true`                  |
| `onlyNew`                | Skip matches returned by earlier runs with the same tours and players                                                     | `true`                  |

Example: every ATP and Challenger match of the 2025 season.

```json
{
  "startDate": "2025-01-01",
  "endDate": "2025-12-31",
  "tours": ["ATP", "CHALLENGER"],
  "maxMatches": 30000
}
```

A full season is about 730 results pages (two per day when you mix men's and women's tours) plus one per tournament, so it takes roughly 20–30 minutes at the polite request rate.

## What data do you get for each tennis match?

One dataset item per match:

```json
{
  "matchId": "3334240",
  "date": "2026-09-28",
  "time": "13:25",
  "tournament": "Chengdu",
  "tournamentUrl": "https://www.tennisexplorer.com/chengdu/2026/atp-men/",
  "tournamentCountry": "CN",
  "tour": "ATP",
  "surface": "hard",
  "round": "SF",
  "player1": {
    "name": "Hurkacz Hubert",
    "slug": "hurkacz",
    "country": null,
    "seed": "5",
    "rank": 41
  },
  "player2": {
    "name": "Shapovalov Denis",
    "slug": "shapovalov",
    "country": null,
    "seed": "7",
    "rank": 46
  },
  "winner": "player1",
  "winnerName": "Hurkacz Hubert",
  "setsPlayer1": 2,
  "setsPlayer2": 1,
  "setScores": [
    { "player1": 6, "player2": 7, "tiebreak": 8 },
    { "player1": 6, "player2": 3, "tiebreak": null },
    { "player1": 6, "player2": 3, "tiebreak": null }
  ],
  "score": "6-7(8) 6-3 6-3",
  "status": "completed",
  "oddsHome": 1.61,
  "oddsAway": 2.29,
  "url": "https://www.tennisexplorer.com/match-detail/?id=3334240",
  "bookmakerOdds": [
    {
      "bookmaker": "bet-at-home",
      "oddsHome": 1.58,
      "oddsAway": 2.25,
      "openingOddsHome": 1.55,
      "openingOddsAway": 2.3
    },
    {
      "bookmaker": "Pinnacle",
      "oddsHome": 1.66,
      "oddsAway": 2.37,
      "openingOddsHome": 1.77,
      "openingOddsAway": 2.16
    }
  ]
}
```

(`bookmakerOdds`, `rank` and full names only appear with `includeBookmakerOdds`; shortened example.)

**Field notes**

- **Odds are the closing odds as displayed by TennisExplorer** (its average across bookmakers, decimal format). `oddsHome` belongs to `player1`, `oddsAway` to `player2`. They are `null` when TennisExplorer shows no odds (common for low-level ITF matches). Odds are not validated against any bookmaker.
- `bookmakerOdds[].oddsHome/oddsAway` are each bookmaker's last displayed price; `openingOdds*` is the earliest price in the movement history TennisExplorer shows. Swapped automatically when the detail page lists the players in the other order.
- `player1` is the player TennisExplorer lists first, which is the winner on its results pages. `winner` is `"player1"`/`"player2"`.
- `status`: `completed`, `retired` (last set unfinished) or `walkover` (no games played). Retirement is inferred from the score.
- `tiebreak` is the losing player's tiebreak points, as shown (6-7(8) means the tiebreak was lost 8-10).
- `date`/`time` are TennisExplorer's (Central European time); `time` is `null` when not shown.
- `round`: `1R`, `2R`, `R16`, `QF`, `SF`, `F`; qualifying rounds as `Q-1R`, `Q-QF`... Empty for ITF men's matches that TennisExplorer groups under "Futures" (no tournament page).
- `tour` is derived from the tournament name: "challenger" → `CHALLENGER`, "ITF"/"Futures" → `ITF_*`, UTR/exhibitions/team events → `OTHER_*`, everything else → `ATP`/`WTA` (WTA includes WTA 125 events).
- `rank` is the ranking shown on the match page, which may be the player's current ranking rather than the ranking at match time.
- `country`: only filled in player mode, for the requested player.
- Singles only; doubles aren't included.

## How much does it cost to scrape tennis results and odds?

Pay-per-event, only for what you get:

| Event                                                        | Price      |
| ------------------------------------------------------------ | ---------- |
| Match (one item in the dataset)                              | **$0.004** |
| Per-bookmaker odds added to a match (`includeBookmakerOdds`) | **$0.002** |

That's **$4 per 1,000 matches**, or $6 per 1,000 with per-bookmaker odds. Filtered-out and already-seen (`onlyNew`) matches are free, and so is a match whose detail page failed to load (it's returned without bookmaker odds, and not charged the extra event). If you set a **maximum cost per run**, the actor stops cleanly when it reaches it.

## Tips for scraping tennis results and odds

- **Daily feed for a model:** schedule the actor daily with `"startDate": "3 days"`, `"endDate": "yesterday"` and `"onlyNew": true`. Each match is returned once, including results TennisExplorer adds late. State is kept in the key-value store `tennis-matches-odds-state` in your account, one record per tours + players combination.
- **Backfill history:** run one season at a time (`2024-01-01` to `2024-12-31`), then switch to the daily schedule.
- **Cheaper, faster runs:** set `includeRoundAndSurface: false` if you don't need them (saves one request per tournament).
- **Find a player slug:** open the player on TennisExplorer and copy the part after `/player/`, e.g. `hurkacz` or `medvedev-e0d2d`.

## Tennis matches and odds FAQ

**Where does the data come from?** Only from public TennisExplorer pages (results, tournament, match and player pages). Nothing is taken from Flashscore, Livesport or any bookmaker API.

**How far back does it go?** As far as TennisExplorer's results archive (ATP/WTA results and odds go back many years; odds coverage for older and lower-level matches is thinner).

**Are the odds live?** No. The actor is for finished matches; odds are the closing odds as TennisExplorer shows them after the match.

**Can I use it through the API or with AI agents?** Yes: through the Apify API, the Apify MCP server or any Apify integration (Google Sheets, webhooks, Make, Zapier).

**Is this legal?** The actor reads publicly available pages at a low rate and respects robots.txt. You are responsible for how you use the data and for complying with TennisExplorer's terms. Gamble responsibly; this is data, not betting advice.

**Disclaimer:** This actor is not affiliated with, endorsed by or sponsored by TennisExplorer, the ATP, the WTA, the ITF or any bookmaker.

## Related actors

- [google-trends](https://apify.com/cprussin/google-trends): Google Trends interest over time, regions, related queries and trending searches.
- [telegram-channel-scraper](https://apify.com/cprussin/telegram-channel-scraper): Posts, views and reactions from public Telegram channels.
