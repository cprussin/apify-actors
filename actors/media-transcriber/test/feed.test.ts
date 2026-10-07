import { describe, expect, it } from "vitest";
import { notMediaError } from "../src/detect.js";
import { parseDuration, parseFeed } from "../src/feed.js";

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
<channel>
  <title><![CDATA[Tiny Pod]]></title>
  <item>
    <title>Episode 1</title>
    <guid isPermaLink="false">ep-1</guid>
    <pubDate>Mon, 01 Sep 2026 10:00:00 GMT</pubDate>
    <enclosure url="https://cdn.x.org/ep1.mp3" length="1000" type="audio/mpeg"/>
    <itunes:duration>12:30</itunes:duration>
  </item>
  <item>
    <title>Episode 3 &amp; friends</title>
    <guid>ep-3</guid>
    <pubDate>Wed, 01 Oct 2026 10:00:00 GMT</pubDate>
    <enclosure url="https://cdn.x.org/cover.jpg" type="image/jpeg"/>
    <enclosure url="/media/ep3.m4a" type="audio/x-m4a"/>
    <itunes:duration>3725</itunes:duration>
  </item>
  <item>
    <title>Episode 2</title>
    <pubDate>Mon, 15 Sep 2026 10:00:00 GMT</pubDate>
    <enclosure url="https://cdn.x.org/ep2.mp4" type="video/mp4"/>
    <itunes:duration>1:02:03</itunes:duration>
  </item>
  <item>
    <title>Blog post without media</title>
  </item>
</channel>
</rss>`;

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Pod</title>
  <entry>
    <title>Talk</title>
    <id>urn:talk-1</id>
    <updated>2026-10-01T00:00:00Z</updated>
    <link rel="alternate" href="https://x.org/talk"/>
    <link rel="enclosure" href="https://x.org/talk.ogg" type="audio/ogg"/>
  </entry>
</feed>`;

describe("parseFeed", () => {
  it("parses RSS enclosures, newest first", () => {
    const feed = parseFeed(RSS, "https://feeds.x.org/pod.xml");
    expect(feed.title).toBe("Tiny Pod");
    expect(feed.episodes).toEqual([
      {
        guid: "ep-3",
        title: "Episode 3 & friends",
        url: "https://feeds.x.org/media/ep3.m4a",
        publishedAt: "2026-10-01T10:00:00.000Z",
        durationSecs: 3725,
      },
      {
        guid: "https://cdn.x.org/ep2.mp4",
        title: "Episode 2",
        url: "https://cdn.x.org/ep2.mp4",
        publishedAt: "2026-09-15T10:00:00.000Z",
        durationSecs: 3723,
      },
      {
        guid: "ep-1",
        title: "Episode 1",
        url: "https://cdn.x.org/ep1.mp3",
        publishedAt: "2026-09-01T10:00:00.000Z",
        durationSecs: 750,
      },
    ]);
  });

  it("parses Atom enclosures", () => {
    expect(parseFeed(ATOM)).toEqual({
      title: "Atom Pod",
      episodes: [
        {
          guid: "urn:talk-1",
          title: "Talk",
          url: "https://x.org/talk.ogg",
          publishedAt: "2026-10-01T00:00:00.000Z",
          durationSecs: null,
        },
      ],
    });
  });

  it("rejects web pages and other files", () => {
    expect(() => parseFeed("<!doctype html><html><body>hi")).toThrow(
      /web page/,
    );
    expect(() => parseFeed('{"a":1}')).toThrow(/Not an RSS/);
  });

  it("parses itunes:duration", () => {
    expect(parseDuration("90")).toBe(90);
    expect(parseDuration("01:30")).toBe(90);
    expect(parseDuration("1:00:00")).toBe(3600);
    expect(parseDuration("soon")).toBeNull();
    expect(parseDuration(undefined)).toBeNull();
  });
});

describe("notMediaError", () => {
  const b = (s: string) => Buffer.from(s);
  it("flags pages, feeds, PDFs and empty files", () => {
    expect(notMediaError(b("\n<!DOCTYPE html><html>"), "text/html")).toMatch(
      /web page/,
    );
    expect(notMediaError(b('<?xml version="1.0"?><rss>'), null)).toMatch(
      /rssFeeds/,
    );
    expect(notMediaError(b("%PDF-1.7"), null)).toMatch(/document-to-markdown/);
    expect(notMediaError(b('{"error":1}'), "application/json")).toMatch(/JSON/);
    expect(notMediaError(Buffer.alloc(0), null)).toMatch(/empty/);
  });

  it("lets media through", () => {
    expect(notMediaError(b("ID3\x04\x00"), "audio/mpeg")).toBeNull();
    expect(notMediaError(b("RIFF....WAVE"), null)).toBeNull();
    expect(notMediaError(b("\x00\x00\x00\x18ftypmp42"), null)).toBeNull();
  });
});
