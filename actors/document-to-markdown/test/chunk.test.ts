import { describe, expect, it } from "vitest";
import { chunkSegments, splitText } from "../src/chunk.js";

const para = (n: number, word = "lorem") =>
  Array.from({ length: n }, (_, i) => `${word}${i}`).join(" ") + ".";

describe("splitText", () => {
  it("splits at line, sentence and word boundaries within the limit", () => {
    const text = `${para(30)} ${para(30, "ipsum")}\n${para(10, "dolor")}`;
    const parts = splitText(text, 120);
    expect(parts.every((p) => p.length <= 120)).toBe(true);
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe(
      text.replace(/\s+/g, " "),
    );
  });

  it("hard-cuts a single overlong word", () => {
    expect(splitText("x".repeat(250), 100)).toEqual([
      "x".repeat(100),
      "x".repeat(100),
      "x".repeat(50),
    ]);
  });
});

describe("chunkSegments", () => {
  it("packs paragraphs with page ranges and headings, within the size", () => {
    const segments = [
      { page: 1, markdown: `# Intro\n\n${para(40)}\n\n${para(40, "a")}` },
      {
        page: 2,
        markdown: `${para(40, "b")}\n\n## Methods\n\n${para(40, "c")}`,
      },
    ];
    const chunks = chunkSegments(segments, { size: 400, overlap: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(400);
    expect(chunks[0]).toMatchObject({ pageStart: 1, heading: "Intro" });
    expect(chunks[0]!.text.startsWith("# Intro")).toBe(true);
    const last = chunks.at(-1)!;
    expect(last).toMatchObject({ pageEnd: 2, heading: "Methods" });
    // Nothing lost or duplicated without overlap.
    const words = (s: string) => s.match(/\w+/g)!.join(" ");
    expect(words(chunks.map((c) => c.text).join("\n\n"))).toBe(
      words(segments.map((s) => s.markdown).join("\n\n")),
    );
  });

  it("starts each chunk with the end of the previous one", () => {
    const md = [para(30), para(30, "ipsum"), para(30, "dolor")].join("\n\n");
    const chunks = chunkSegments([{ page: null, markdown: md }], {
      size: 300,
      overlap: 60,
    });
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(300);
    for (let i = 1; i < chunks.length; i++) {
      const lead = chunks[i]!.text.split("\n\n")[0]!;
      expect(lead.length).toBeLessThanOrEqual(60);
      expect(chunks[i - 1]!.text.endsWith(lead)).toBe(true);
    }
    expect(chunks[0]!.pageStart).toBeNull();
  });

  it("splits long tables by rows and repeats the header", () => {
    const rows = Array.from(
      { length: 40 },
      (_, i) => `| row ${i} | ${i * 10} |`,
    );
    const table = ["| Name | Value |", "| --- | --- |", ...rows].join("\n");
    const chunks = chunkSegments([{ page: 3, markdown: table }], {
      size: 300,
      overlap: 0,
    });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(300);
      expect(c.text.startsWith("| Name | Value |\n| --- | --- |\n| row")).toBe(
        true,
      );
      expect(c.pageStart).toBe(3);
    }
    const all = chunks.flatMap((c) => c.text.split("\n").slice(2));
    expect(all).toEqual(rows);
  });

  it("drops slide markers and returns nothing for empty input", () => {
    const chunks = chunkSegments(
      [{ page: 1, markdown: "<!-- Slide number: 1 -->\n# Slide" }],
      { size: 200, overlap: 0 },
    );
    expect(chunks).toEqual([
      { text: "# Slide", pageStart: 1, pageEnd: 1, heading: "Slide" },
    ]);
    expect(
      chunkSegments([{ page: null, markdown: "" }], { size: 200, overlap: 0 }),
    ).toEqual([]);
  });
});
