/** One timestamped piece of the transcript (seconds from the start). */
export interface Segment {
  start: number;
  end: number;
  text: string;
}

export const segmentsToText = (segments: Segment[]): string =>
  segments
    .map((s) => s.text.trim())
    .filter(Boolean)
    .join(" ");

export const wordCount = (text: string): number =>
  text.split(/\s+/).filter(Boolean).length;

export function formatTimestamp(sec: number, sep: "," | "."): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`;
}

/** Cue end: never before the start (players drop zero-length cues). */
const endOf = (s: Segment) => Math.max(s.end, s.start + 0.001);

export function toSrt(segments: Segment[]): string {
  return segments
    .map(
      (s, i) =>
        `${i + 1}\n${formatTimestamp(s.start, ",")} --> ${formatTimestamp(endOf(s), ",")}\n${s.text}\n`,
    )
    .join("\n");
}

export function toVtt(segments: Segment[]): string {
  const cues = segments.map(
    (s) =>
      `${formatTimestamp(s.start, ".")} --> ${formatTimestamp(endOf(s), ".")}\n${s.text}\n`,
  );
  return ["WEBVTT\n", ...cues].join("\n");
}
