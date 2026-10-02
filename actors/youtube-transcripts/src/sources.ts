/** Parsing of user-supplied YouTube URLs / IDs into video, playlist or channel sources. */

export type ChannelTab = "all" | "videos" | "shorts" | "streams";

export type Source =
  | { kind: "video"; videoId: string; input: string }
  | { kind: "playlist"; playlistId: string; input: string }
  | {
      kind: "channel";
      /** Known channel ID (UC...), or undefined when it must be resolved from `url`. */
      channelId?: string;
      url: string;
      tab: ChannelTab;
      input: string;
    };

export class SourceError extends Error {}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const PLAYLIST_ID = /^(PL|UU|OL|FL|LL)[A-Za-z0-9_-]{10,}$/;
const YT_HOST = /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be)$/;

const VIDEO_PATHS = new Set(["shorts", "embed", "live", "v", "e"]);
const TABS: Record<string, ChannelTab> = {
  videos: "videos",
  shorts: "shorts",
  streams: "streams",
};

/** Uploads playlist for a channel: UU = all, UULF = videos, UUSH = shorts, UULV = streams. */
export function uploadsPlaylistId(channelId: string, tab: ChannelTab): string {
  const rest = channelId.slice(2);
  const prefix =
    tab === "videos"
      ? "UULF"
      : tab === "shorts"
        ? "UUSH"
        : tab === "streams"
          ? "UULV"
          : "UU";
  return prefix + rest;
}

export const videoUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

export function parseSource(raw: string): Source {
  const input = raw.trim();
  if (!input) throw new SourceError("Empty URL.");
  if (VIDEO_ID.test(input)) return { kind: "video", videoId: input, input };
  if (CHANNEL_ID.test(input))
    return {
      kind: "channel",
      channelId: input,
      url: `https://www.youtube.com/channel/${input}`,
      tab: "all",
      input,
    };
  if (PLAYLIST_ID.test(input))
    return { kind: "playlist", playlistId: input, input };
  if (/^@[\w.-]+$/.test(input))
    return {
      kind: "channel",
      url: `https://www.youtube.com/${input}`,
      tab: "all",
      input,
    };

  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    throw new SourceError(`Not a YouTube URL or video ID: "${input}"`);
  }
  const host = url.hostname.toLowerCase();
  if (!YT_HOST.test(host))
    throw new SourceError(`Not a YouTube URL or video ID: "${input}"`);
  const parts = url.pathname.split("/").filter(Boolean);

  if (host.endsWith("youtu.be")) {
    const id = parts[0];
    if (id && VIDEO_ID.test(id)) return { kind: "video", videoId: id, input };
    throw new SourceError(`No video ID in "${input}"`);
  }

  const first = parts[0] ?? "";
  if (first === "watch") {
    const v = url.searchParams.get("v");
    if (v && VIDEO_ID.test(v)) return { kind: "video", videoId: v, input };
    throw new SourceError(`No video ID in "${input}"`);
  }
  if (VIDEO_PATHS.has(first)) {
    const id = parts[1];
    if (id && VIDEO_ID.test(id)) return { kind: "video", videoId: id, input };
    throw new SourceError(`No video ID in "${input}"`);
  }
  if (first === "playlist") {
    const list = url.searchParams.get("list");
    if (list && /^[A-Za-z0-9_-]{12,}$/.test(list))
      return { kind: "playlist", playlistId: list, input };
    throw new SourceError(`No playlist ID in "${input}"`);
  }

  const tabOf = (seg: string | undefined): ChannelTab =>
    (seg && TABS[seg.toLowerCase()]) || "all";
  if (first === "channel") {
    const id = parts[1];
    if (id && CHANNEL_ID.test(id))
      return {
        kind: "channel",
        channelId: id,
        url: `https://www.youtube.com/channel/${id}`,
        tab: tabOf(parts[2]),
        input,
      };
    throw new SourceError(`No channel ID in "${input}"`);
  }
  if (first.startsWith("@")) {
    return {
      kind: "channel",
      url: `https://www.youtube.com/${first}`,
      tab: tabOf(parts[1]),
      input,
    };
  }
  if ((first === "c" || first === "user") && parts[1]) {
    return {
      kind: "channel",
      url: `https://www.youtube.com/${first}/${parts[1]}`,
      tab: tabOf(parts[2]),
      input,
    };
  }
  throw new SourceError(`Unsupported YouTube URL: "${input}"`);
}
