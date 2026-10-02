export class ChannelRefError extends Error {}

const USERNAME = /^[a-z][a-z0-9_]{2,31}$/i;
const RESERVED = new Set([
  "s",
  "c",
  "joinchat",
  "addstickers",
  "addemoji",
  "share",
  "proxy",
  "socks",
  "iv",
  "login",
  "setlanguage",
  "addtheme",
  "boost",
]);

/**
 * Parse a channel username from "durov", "@durov", "t.me/durov",
 * "https://t.me/s/durov", "https://t.me/durov/123" or "telegram.me/durov".
 * Returns the lowercased username.
 */
export function parseChannelRef(input: string): string {
  const s = input.trim();
  if (!s) throw new ChannelRefError("Empty channel.");
  const bare = s.replace(/^@/, "");
  if (USERNAME.test(bare)) return bare.toLowerCase();

  const m =
    /^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog)\/(.*)$/i.exec(
      s,
    );
  if (!m) {
    throw new ChannelRefError(
      `"${s}" is not a Telegram channel username or t.me link.`,
    );
  }
  const parts = m[1]!.split(/[?#]/)[0]!.split("/").filter(Boolean);
  if (parts[0] === "s") parts.shift();
  const name = parts[0] ?? "";
  if (name.startsWith("+") || name.toLowerCase() === "joinchat") {
    throw new ChannelRefError(
      `"${s}" is a private invite link. Only public channels (t.me/<username>) can be scraped.`,
    );
  }
  if (name === "c") {
    throw new ChannelRefError(
      `"${s}" is a private channel link. Only public channels (t.me/<username>) can be scraped.`,
    );
  }
  if (!USERNAME.test(name) || RESERVED.has(name.toLowerCase())) {
    throw new ChannelRefError(
      `"${s}" does not contain a valid public channel username.`,
    );
  }
  return name.toLowerCase();
}

export const previewUrl = (username: string, before?: number): string =>
  `https://t.me/s/${username}` + (before ? `?before=${before}` : "");

export const profileUrl = (username: string): string =>
  `https://t.me/${username}`;
