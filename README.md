# Apify actors

Source code of [my public Apify actors](https://apify.com/cprussin). Each `actors/<name>` directory is a standalone actor. You can run them on Apify (paid per result) or locally.

This repo is a read-only mirror, synced automatically. Please report issues on the actor's Apify page.

- [![Run on Apify](https://img.shields.io/badge/Run_on-Apify-97D700?logo=apify)](https://apify.com/cprussin/aliexpress-scraper) [aliexpress-scraper](actors/aliexpress-scraper): AliExpress Scraper: Products, Prices & Reviews
- [![Run on Apify](https://img.shields.io/badge/Run_on-Apify-97D700?logo=apify)](https://apify.com/cprussin/app-store-reviews) [app-store-reviews](actors/app-store-reviews): App Store & Google Play Reviews Scraper
- [![Run on Apify](https://img.shields.io/badge/Run_on-Apify-97D700?logo=apify)](https://apify.com/cprussin/bilibili-scraper) [bilibili-scraper](actors/bilibili-scraper): Bilibili Scraper: Videos, Comments, Trending & Search
- [![Run on Apify](https://img.shields.io/badge/Run_on-Apify-97D700?logo=apify)](https://apify.com/cprussin/federal-recompete-radar) [federal-recompete-radar](actors/federal-recompete-radar): Federal Recompete Radar - Expiring US Government Contracts
- [![Run on Apify](https://img.shields.io/badge/Run_on-Apify-97D700?logo=apify)](https://apify.com/cprussin/google-ads-transparency) [google-ads-transparency](actors/google-ads-transparency): Google Ads Transparency Scraper: Ads, Copy, Images & Video
- [![Run on Apify](https://img.shields.io/badge/Run_on-Apify-97D700?logo=apify)](https://apify.com/cprussin/google-flights-prices) [google-flights-prices](actors/google-flights-prices): Google Flights Scraper: Prices, Itineraries & Date Ranges
- [![Run on Apify](https://img.shields.io/badge/Run_on-Apify-97D700?logo=apify)](https://apify.com/cprussin/google-trends) [google-trends](actors/google-trends): Google Trends Scraper: Interest, Regions, Related & Trending
- [![Run on Apify](https://img.shields.io/badge/Run_on-Apify-97D700?logo=apify)](https://apify.com/cprussin/new-business-registrations) [new-business-registrations](actors/new-business-registrations): New Business Registrations - New LLC & Corporation Leads
- [![Run on Apify](https://img.shields.io/badge/Run_on-Apify-97D700?logo=apify)](https://apify.com/cprussin/product-hunt-launches) [product-hunt-launches](actors/product-hunt-launches): Product Hunt Scraper: Launches, Leaderboards & Makers
- [![Run on Apify](https://img.shields.io/badge/Run_on-Apify-97D700?logo=apify)](https://apify.com/cprussin/substack-scraper) [substack-scraper](actors/substack-scraper): Substack Scraper: Newsletter Posts, Content & Stats
- [![Run on Apify](https://img.shields.io/badge/Run_on-Apify-97D700?logo=apify)](https://apify.com/cprussin/telegram-channel-scraper) [telegram-channel-scraper](actors/telegram-channel-scraper): Telegram Channel Scraper - Posts, Views & Reactions
- [![Run on Apify](https://img.shields.io/badge/Run_on-Apify-97D700?logo=apify)](https://apify.com/cprussin/tennis-matches-odds) [tennis-matches-odds](actors/tennis-matches-odds): Tennis Results & Betting Odds Scraper (ATP, WTA, ITF)
- [![Run on Apify](https://img.shields.io/badge/Run_on-Apify-97D700?logo=apify)](https://apify.com/cprussin/trustpilot-reviews) [trustpilot-reviews](actors/trustpilot-reviews): Trustpilot Reviews Scraper - Reviews, Ratings & TrustScore
- [![Run on Apify](https://img.shields.io/badge/Run_on-Apify-97D700?logo=apify)](https://apify.com/cprussin/wellfound-jobs) [wellfound-jobs](actors/wellfound-jobs): Wellfound Jobs Scraper: Startup Jobs, Salary & Equity
- [![Run on Apify](https://img.shields.io/badge/Run_on-Apify-97D700?logo=apify)](https://apify.com/cprussin/youtube-transcripts) [youtube-transcripts](actors/youtube-transcripts): YouTube Transcript Scraper - Captions & Subtitles for AI/RAG

## Run locally

```sh
npm install
npm test
npm run start:dev -w actors/<name>
```

Each actor's `README.md` documents its input and output.

## License

[MIT](LICENSE)
