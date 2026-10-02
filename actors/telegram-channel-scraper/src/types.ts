export type MediaType =
  | "photo"
  | "video"
  | "roundVideo"
  | "voice"
  | "audio"
  | "document"
  | "sticker"
  | "poll"
  | "location";

export interface Media {
  type: MediaType;
  /** Direct file URL when the preview exposes one (photos, most videos, voice). */
  url: string | null;
  thumbnailUrl: string | null;
  /** e.g. "2:11" for videos and voice messages. */
  duration: string | null;
  /** Document/audio file name, or poll question. */
  title: string | null;
}

export interface Reaction {
  /** Unicode emoji, or null for custom emoji and paid (Stars) reactions. */
  emoji: string | null;
  customEmojiId: string | null;
  paid: boolean;
  count: number | null;
}

export interface LinkPreview {
  url: string;
  siteName: string | null;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
}

export interface PostRef {
  name: string | null;
  url: string | null;
  channel: string | null;
  postId: number | null;
}

export interface Post {
  type: "post";
  channel: string;
  postId: number;
  date: string;
  edited: boolean;
  author: string | null;
  text: string;
  views: number | null;
  reactions: Reaction[];
  media: Media[];
  linkPreview: LinkPreview | null;
  forwardedFrom: PostRef | null;
  replyTo: (PostRef & { text: string | null }) | null;
  links: string[];
  hashtags: string[];
  permalink: string;
}

export interface ChannelInfo {
  type: "channel";
  channel: string;
  title: string | null;
  description: string | null;
  /** Exact when available from the channel page, otherwise rounded (e.g. 10.6M). */
  subscribers: number | null;
  photoUrl: string | null;
  verified: boolean;
  /** Media counters shown by Telegram, e.g. { photos: 102, videos: 46, links: 200 }. */
  counters: Record<string, number | null>;
  url: string;
}

export type ErrorCode =
  "invalidInput" | "notFound" | "previewDisabled" | "notAChannel" | "failed";

export interface ErrorItem {
  type: "error";
  channel: string;
  errorCode: ErrorCode;
  error: string;
}

export type OutputItem = Post | ChannelInfo | ErrorItem;
