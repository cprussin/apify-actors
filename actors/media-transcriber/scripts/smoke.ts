/**
 * Live smoke test: downloads real media and a real podcast feed and
 * transcribes them with the Python worker (no Apify platform involved).
 * Needs the Python side (MEDIA_PYTHON pointing at a venv with
 * requirements.txt and faster-whisper) and FFmpeg.
 * Usage: npm run smoke -w actors/media-transcriber [-- <media URL>...]
 * Extra URLs are transcribed too, with the real-time factor printed.
 * Behind a proxy, run with NODE_USE_ENV_PROXY=1.
 */
import { downloadToFile, fetchText } from "../src/download.js";
import { normalizeInput, SAMPLE_URL, type RawInput } from "../src/input.js";
import { runTranscriptions, type OutputItem } from "../src/run.js";
import { PythonWorker } from "../src/worker.js";

const FEED = "https://www.nasa.gov/feeds/podcasts/houston-we-have-a-podcast";
const worker = new PythonWorker();
const problems: string[] = [];

async function run(raw: RawInput) {
  const input = normalizeInput(raw);
  const items: OutputItem[] = [];
  const started = Date.now();
  const stats = await runTranscriptions(input, {
    fetchFeed: (url) =>
      fetchText(url, { maxBytes: 20 * 1024 * 1024, timeoutMs: 60_000 }),
    download: (job, path) => {
      if (job.kind === "kv") throw new Error("URLs only");
      return downloadToFile(job.url, path, {
        maxBytes: input.maxBytes,
        timeoutMs: input.timeoutMs,
      });
    },
    transcribe: worker.transcribe,
    budgetMinutes: () => Infinity,
    emit: async (batch) => {
      items.push(...batch);
      return { pushed: true, more: true };
    },
    saveFile: async (key) => `memory://${key}`,
    threads: 1,
    log: (m) => console.warn(`  log: ${m}`),
  });
  const secs = (Date.now() - started) / 1000;
  console.log(
    `${JSON.stringify(stats)} in ${secs.toFixed(1)} s` +
      (stats.audioSeconds
        ? ` (real-time factor ${(secs / stats.audioSeconds).toFixed(3)}, incl. download and model load)`
        : ""),
  );
  return items;
}

const [sample] = await run({ urls: [SAMPLE_URL] });
console.log(
  `  ${sample?.language} (${sample?.languageProbability}) ${sample?.durationSeconds} s: ${sample?.text}`,
);
if (!sample || sample.error || !/moon/i.test(sample.text ?? ""))
  problems.push(`sample clip: ${sample?.error ?? "unexpected text"}`);

const [episode] = await run({
  rssFeeds: [FEED],
  maxEpisodes: 1,
  maxDurationMinutes: 5,
});
console.log(
  `  feed: ${episode?.podcastTitle} / ${episode?.title}: ${episode?.error}`,
);
if (!episode || episode.sourceType !== "rss" || !episode.title)
  problems.push("feed: no episode");

const [missing] = await run({
  urls: ["https://www.nasa.gov/wp-content/uploads/0000/00/missing.mp3"],
});
if (!missing?.error) problems.push("missing file did not fail");
console.log(`  missing: ${missing?.error}`);

const extra = process.argv.slice(2);
if (extra.length) {
  for (const model of ["base", "small"])
    for (const item of await run({ urls: extra, model }))
      console.log(
        `  ${model} ${item.url}: ${item.error ?? `${item.durationSeconds} s, ${item.wordCount} words`}`,
      );
}

worker.close();
if (problems.length) {
  console.error(`FAILED:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("OK");
