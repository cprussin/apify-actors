import * as cheerio from "cheerio";
import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import type {
  ChannelInfo,
  LinkPreview,
  Media,
  Post,
  PostRef,
  Reaction,
} from "./types.js";

/** "10.6M" -> 10600000, "6.43K" -> 6430, "24 240" -> 24240, "1,234" -> 1234. */
export function parseCount(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = s.replace(/[\s\u00a0,]/g, "");
  const m = /^(\d+(?:\.\d+)?)([KMB])?$/i.exec(t);
  if (!m) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[
    (m[2] ?? "").toUpperCase() as "K" | "M" | "B"
  ];
  return Math.round(Number(m[1]) * (mult ?? 1));
}

const bgUrl = (style: string | undefined): string | null => {
  const m = /background-image:\s*url\(['"]?([^'")]+)['"]?\)/.exec(style ?? "");
  return m ? absUrl(m[1]!) : null;
};

const absUrl = (u: string): string => (u.startsWith("//") ? `https:${u}` : u);

const clean = (s: string): string =>
  s
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();

/** Text with <br> as newlines. */
function richText($: CheerioAPI, el: Cheerio<AnyNode>): string {
  if (!el.length) return "";
  const c = el.first().clone();
  c.find("br").replaceWith("\n");
  return clean(c.text());
}

const orNull = (s: string): string | null => (s ? s : null);

/** Parse "https://t.me/<channel>/<id>" into its parts. */
export function parsePostUrl(url: string | undefined): {
  channel: string | null;
  postId: number | null;
} {
  const m = /^https?:\/\/t\.me\/(?:s\/)?([A-Za-z0-9_]+)(?:\/(\d+))?/.exec(
    url ?? "",
  );
  if (!m || m[1] === "c") return { channel: null, postId: null };
  return { channel: m[1]!.toLowerCase(), postId: m[2] ? Number(m[2]) : null };
}

export type PageKind =
  | { kind: "preview" }
  | { kind: "notFound" }
  | { kind: "channel"; title: string | null } // channel, but preview disabled
  | { kind: "group"; title: string | null }
  | { kind: "user"; title: string | null };

/**
 * t.me/s/<name> serves the channel preview, or redirects to t.me/<name>
 * when there is no preview (preview disabled, group, user, bot, unknown).
 */
export function classifyPage(html: string): PageKind {
  const $ = cheerio.load(html);
  if ($(".tgme_channel_history, .tgme_widget_message_wrap").length)
    return { kind: "preview" };
  const title = orNull(
    clean($(".tgme_page_title").first().text().replace("✔", "")),
  );
  if (!title) return { kind: "notFound" };
  const extra = $(".tgme_page_extra")
    .map((_, e) => clean($(e).text()))
    .get()
    .join(" ");
  if (/\bsubscribers?\b/i.test(extra)) return { kind: "channel", title };
  if (/\bmembers?\b/i.test(extra)) return { kind: "group", title };
  return { kind: "user", title };
}

export interface ProfileInfo {
  title: string | null;
  description: string | null;
  subscribers: number | null;
  photoUrl: string | null;
  verified: boolean;
}

/** Parse the t.me/<name> landing page (exact subscriber count). */
export function parseProfilePage(html: string): ProfileInfo | null {
  const $ = cheerio.load(html);
  const titleEl = $(".tgme_page_title").first();
  if (!titleEl.length) return null;
  let subscribers: number | null = null;
  $(".tgme_page_extra").each((_, e) => {
    const m = /([\d\s\u00a0,.]+[KMB]?)\s*subscribers?/i.exec($(e).text());
    if (m) subscribers = parseCount(m[1]);
  });
  return {
    title: orNull(clean(titleEl.text().replace("✔", ""))),
    description: orNull(richText($, $(".tgme_page_description"))),
    subscribers,
    photoUrl: $("img.tgme_page_photo_image").attr("src") ?? null,
    verified: titleEl.find(".verified-icon").length > 0,
  };
}

export interface PreviewPage {
  channelInfo: Omit<ChannelInfo, "channel" | "url"> & { username: string };
  /** Posts on the page, newest first (service messages excluded). */
  posts: Post[];
  /** Smallest post ID on the page (including service messages), for ?before=. */
  minPostId: number | null;
}

export function parsePreviewPage(html: string, channel: string): PreviewPage {
  const $ = cheerio.load(html);
  const info = $(".tgme_channel_info");
  const counters: Record<string, number | null> = {};
  info.find(".tgme_channel_info_counter").each((_, e) => {
    const type = clean($(e).find(".counter_type").text()).toLowerCase();
    if (type) counters[type] = parseCount($(e).find(".counter_value").text());
  });
  const subscribers =
    counters.subscribers ?? counters.subscriber ?? counters.members ?? null;
  delete counters.subscribers;
  delete counters.subscriber;
  const username = clean(info.find(".tgme_channel_info_header_username").text())
    .replace(/^@/, "")
    .toLowerCase();

  const posts: Post[] = [];
  let minPostId: number | null = null;
  $(".tgme_widget_message[data-post]").each((_, e) => {
    const msg = $(e);
    const { postId } = parsePostUrl(`https://t.me/${msg.attr("data-post")}`);
    if (postId === null) return;
    if (minPostId === null || postId < minPostId) minPostId = postId;
    if (msg.hasClass("service_message")) return;
    const post = parseMessage($, msg, channel, postId);
    if (post) posts.push(post);
  });
  posts.sort((a, b) => b.postId - a.postId);

  return {
    channelInfo: {
      type: "channel",
      username: username || channel,
      title: orNull(clean(info.find(".tgme_channel_info_header_title").text())),
      description: orNull(
        richText($, info.find(".tgme_channel_info_description")),
      ),
      subscribers,
      photoUrl: info.find(".tgme_page_photo_image img").attr("src") ?? null,
      verified: info.find(".tgme_channel_info_header_labels .verified-icon")
        .length
        ? true
        : false,
      counters,
    },
    posts,
    minPostId,
  };
}

const notInReply = (el: AnyNode, $: CheerioAPI): boolean =>
  $(el).closest(".tgme_widget_message_reply, .tgme_widget_message_link_preview")
    .length === 0;

function parseMedia($: CheerioAPI, msg: Cheerio<AnyNode>): Media[] {
  const out: Media[] = [];
  const base = {
    url: null,
    thumbnailUrl: null,
    duration: null,
    title: null,
  } satisfies Omit<Media, "type">;
  msg
    .find(
      [
        ".tgme_widget_message_photo_wrap",
        ".tgme_widget_message_video_player",
        ".tgme_widget_message_roundvideo_player",
        ".tgme_widget_message_voice_player",
        ".tgme_widget_message_document_wrap",
        ".tgme_widget_message_sticker_wrap",
        ".tgme_widget_message_poll",
        ".tgme_widget_message_location_wrap",
      ].join(", "),
    )
    .filter((_, el) => notInReply(el, $))
    .each((_, el) => {
      const e = $(el);
      const duration = orNull(
        clean(
          e
            .find(
              ".message_video_duration, .tgme_widget_message_voice_duration, .tgme_widget_message_roundvideo_duration",
            )
            .first()
            .text(),
        ),
      );
      if (e.hasClass("tgme_widget_message_photo_wrap")) {
        out.push({ type: "photo", ...base, url: bgUrl(e.attr("style")) });
      } else if (e.hasClass("tgme_widget_message_video_player")) {
        out.push({
          type: "video",
          ...base,
          url: e.find("video").attr("src") ?? null,
          thumbnailUrl: bgUrl(
            e.find(".tgme_widget_message_video_thumb").attr("style"),
          ),
          duration,
        });
      } else if (e.hasClass("tgme_widget_message_roundvideo_player")) {
        out.push({
          type: "roundVideo",
          ...base,
          url: e.find("video").attr("src") ?? null,
          thumbnailUrl: bgUrl(
            e.find(".tgme_widget_message_roundvideo_thumb").attr("style"),
          ),
          duration,
        });
      } else if (e.hasClass("tgme_widget_message_voice_player")) {
        out.push({
          type: "voice",
          ...base,
          url: e.find("audio").attr("src") ?? null,
          duration,
        });
      } else if (e.hasClass("tgme_widget_message_document_wrap")) {
        const isAudio = e
          .find(".tgme_widget_message_document_icon")
          .hasClass("audio");
        const title = clean(
          e.find(".tgme_widget_message_document_title").text(),
        );
        const extra = clean(
          e.find(".tgme_widget_message_document_extra").text(),
        );
        out.push({
          type: isAudio ? "audio" : "document",
          ...base,
          url: e.attr("href") ?? null,
          title: orNull([title, extra].filter(Boolean).join(" - ")),
        });
      } else if (e.hasClass("tgme_widget_message_sticker_wrap")) {
        const s = e.find(".tgme_widget_message_sticker").first();
        out.push({
          type: "sticker",
          ...base,
          url:
            s.attr("data-webp") ??
            bgUrl(s.attr("style")) ??
            e.find("img").attr("src") ??
            e.find("video").attr("src") ??
            null,
        });
      } else if (e.hasClass("tgme_widget_message_poll")) {
        out.push({
          type: "poll",
          ...base,
          title: orNull(
            clean(e.find(".tgme_widget_message_poll_question").text()),
          ),
        });
      } else if (e.hasClass("tgme_widget_message_location_wrap")) {
        out.push({ type: "location", ...base, url: e.attr("href") ?? null });
      }
    });
  for (const m of out) {
    if (m.url) m.url = absUrl(m.url);
  }
  return out;
}

function parseReactions($: CheerioAPI, msg: Cheerio<AnyNode>): Reaction[] {
  return msg
    .find(".tgme_widget_message_reactions .tgme_reaction")
    .map((_, el): Reaction => {
      const r = $(el);
      const countText = r
        .contents()
        .filter((_, n) => n.type === "text")
        .text();
      const emoji = orNull(clean(r.find("b").first().text()));
      return {
        emoji,
        customEmojiId: emoji
          ? null
          : (r.find("tg-emoji").attr("emoji-id") ?? null),
        paid: r.hasClass("tgme_reaction_paid"),
        count: parseCount(countText),
      };
    })
    .get();
}

function parseMessage(
  $: CheerioAPI,
  msg: Cheerio<AnyNode>,
  channel: string,
  postId: number,
): Post | null {
  const dateEl = msg.find(".tgme_widget_message_date").last();
  const dt = dateEl.find("time").attr("datetime");
  const ts = dt ? Date.parse(dt) : NaN;
  if (Number.isNaN(ts)) return null;
  const permalink =
    dateEl.attr("href") ?? `https://t.me/${msg.attr("data-post")}`;

  const textEl = msg
    .find(".tgme_widget_message_text")
    .filter((_, el) => notInReply(el, $))
    .first();
  const text = richText($, textEl);

  const links = new Set<string>();
  textEl.find("a[href]").each((_, a) => {
    const href = $(a).attr("href") ?? "";
    if (/^https?:\/\//i.test(href)) links.add(href);
  });
  let linkPreview: LinkPreview | null = null;
  const lp = msg.find("a.tgme_widget_message_link_preview").first();
  if (lp.length && lp.attr("href")) {
    linkPreview = {
      url: lp.attr("href")!,
      siteName: orNull(clean(lp.find(".link_preview_site_name").text())),
      title: orNull(clean(lp.find(".link_preview_title").text())),
      description: orNull(richText($, lp.find(".link_preview_description"))),
      imageUrl: bgUrl(
        lp.find(".link_preview_image, .link_preview_right_image").attr("style"),
      ),
    };
    links.add(linkPreview.url);
  }

  const hashtags = [
    ...new Set(
      [...text.matchAll(/(?:^|[^\p{L}\p{N}_&])#([\p{L}\p{N}_]+)/gu)].map(
        (m) => m[1]!,
      ),
    ),
  ];

  let forwardedFrom: PostRef | null = null;
  const fwd = msg.find(".tgme_widget_message_forwarded_from").first();
  if (fwd.length) {
    const nameEl = fwd.find(".tgme_widget_message_forwarded_from_name").first();
    const url = nameEl.attr("href") ?? null;
    forwardedFrom = {
      name: orNull(
        clean((nameEl.length ? nameEl : fwd).text()).replace(
          /^Forwarded from\s*/i,
          "",
        ),
      ),
      url,
      ...parsePostUrl(url ?? undefined),
    };
  }

  let replyTo: Post["replyTo"] = null;
  const reply = msg.find("a.tgme_widget_message_reply").first();
  if (reply.length) {
    const url = reply.attr("href") ?? null;
    replyTo = {
      name: orNull(
        clean(reply.find(".tgme_widget_message_author_name").text()),
      ),
      url,
      ...parsePostUrl(url ?? undefined),
      text: orNull(richText($, reply.find(".tgme_widget_message_text"))),
    };
  }

  const meta = msg.find(".tgme_widget_message_meta").first();
  return {
    type: "post",
    channel,
    postId,
    date: new Date(ts).toISOString(),
    edited: /\bedited\b/i.test(meta.text()),
    author: orNull(clean(meta.find(".tgme_widget_message_from_author").text())),
    text,
    views: parseCount(msg.find(".tgme_widget_message_views").first().text()),
    reactions: parseReactions($, msg),
    media: parseMedia($, msg),
    linkPreview,
    forwardedFrom,
    replyTo,
    links: [...links],
    hashtags,
    permalink,
  };
}
