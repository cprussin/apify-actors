import { describe, expect, it } from "vitest";
import {
  firstHeading,
  normalizeMarkdown,
  segmentsOf,
  toPlainText,
  wordCount,
} from "../src/markdown.js";

describe("normalizeMarkdown", () => {
  it("separates tables from text and collapses blank lines", () => {
    expect(
      normalizeMarkdown(
        "# T  \r\nPoint\n| a | b |\n| --- | --- |\n| 1 | 2 |\ntail\n\n\n\nend\n\n",
      ),
    ).toBe("# T\nPoint\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\ntail\n\nend");
  });

  it("promotes the first row of a headerless table", () => {
    expect(
      normalizeMarkdown(
        "|  |  |\n| --- | --- |\n| Region | Revenue |\n| EU | 120 |",
      ),
    ).toBe("| Region | Revenue |\n| --- | --- |\n| EU | 120 |");
  });
});

describe("toPlainText", () => {
  it("strips Markdown syntax and tabulates tables", () => {
    const md = [
      "<!-- Slide number: 1 -->",
      "# Title",
      "Some **bold**, *italic* and `code` with a [link](https://x.org) and ![alt](i.png).",
      "- item",
      "> quote",
      "| a | b |",
      "| --- | --- |",
      "| 1 | **2** |",
      "---",
    ].join("\n");
    expect(toPlainText(md)).toBe(
      "Title\nSome bold, italic and code with a link and alt.\nitem\nquote\na\tb\n1\t2",
    );
  });

  it("keeps snake_case and arithmetic intact", () => {
    expect(toPlainText("use my_var_name and 2*3*4")).toBe(
      "use my_var_name and 2*3*4",
    );
  });
});

describe("firstHeading / wordCount", () => {
  it("finds the first heading", () => {
    expect(firstHeading("text\n## **Intro** ##\n# Later")).toBe("Intro");
    expect(firstHeading("no headings")).toBeNull();
  });

  it("counts words", () => {
    expect(wordCount("It's a well-known fact: 3 cats.")).toBe(6);
    expect(wordCount("")).toBe(0);
  });
});

describe("segmentsOf", () => {
  it("splits PPTX by slide", () => {
    const md =
      "<!-- Slide number: 1 -->\n# One\n\n<!-- Slide number: 2 -->\n# Two\n| a |\n| --- |";
    expect(segmentsOf("pptx", md)).toEqual([
      { page: 1, markdown: "# One\n\n" },
      { page: 2, markdown: "# Two\n| a |\n| --- |" },
    ]);
  });

  it("splits XLSX by sheet", () => {
    const md = "## Sales\n| a |\n| --- |\n\n## Costs\n| b |\n| --- |";
    expect(segmentsOf("xlsx", md).map((s) => s.page)).toEqual([1, 2]);
    expect(segmentsOf("xlsx", md)[1]!.markdown).toMatch(/^## Costs/);
  });

  it("keeps other types whole", () => {
    expect(segmentsOf("docx", "# A\n\n# B")).toEqual([
      { page: null, markdown: "# A\n\n# B" },
    ]);
  });
});
