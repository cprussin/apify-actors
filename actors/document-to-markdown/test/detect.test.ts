import { describe, expect, it } from "vitest";
import { charsetOf, detectType, extensionOf } from "../src/detect.js";

const zip = (...names: string[]) =>
  Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from(names.join("\0"), "latin1"),
  ]);

describe("detectType", () => {
  it("detects by magic bytes, ignoring a wrong Content-Type", () => {
    expect(
      detectType(
        Buffer.from("%PDF-1.7\n..."),
        "application/octet-stream",
        "https://x.org/dl",
      ),
    ).toEqual({ type: "pdf" });
    expect(
      detectType(zip("[Content_Types].xml", "word/document.xml"), null, null)
        .type,
    ).toBe("docx");
    expect(detectType(zip("ppt/presentation.xml"), null, null).type).toBe(
      "pptx",
    );
    expect(detectType(zip("xl/workbook.xml"), null, null).type).toBe("xlsx");
    expect(
      detectType(zip("mimetypeapplication/epub+zip"), null, null).type,
    ).toBe("epub");
  });

  it("uses the extension for unrecognized ZIP layouts", () => {
    expect(detectType(zip("other"), null, "a.docx").type).toBe("docx");
    expect(detectType(zip("other"), null, "a.zip")).toMatchObject({
      type: null,
      error: expect.stringMatching(/ZIP archive/),
    });
  });

  it("rejects legacy Office, images and binaries with a reason", () => {
    expect(
      detectType(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2]), null, "a.doc"),
    ).toMatchObject({
      type: null,
      error: expect.stringMatching(/Legacy Office/),
    });
    expect(
      detectType(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0]),
        "image/png",
        null,
      ),
    ).toMatchObject({ type: null, error: expect.stringMatching(/image/) });
    expect(
      detectType(Buffer.from([1, 2, 0, 3]), "application/octet-stream", null),
    ).toMatchObject({
      type: null,
      error: expect.stringMatching(/Unsupported/),
    });
    expect(detectType(Buffer.alloc(0), null, null)).toMatchObject({
      error: "The file is empty.",
    });
  });

  it("detects HTML, CSV and text", () => {
    const html = Buffer.from("  <!DOCTYPE html><html><body>Hi</body></html>");
    expect(detectType(html, "text/html", "https://x.org/").type).toBe("html");
    expect(detectType(html, null, null).type).toBe("html");
    expect(detectType(Buffer.from("a,b\n1,2"), "text/csv", null).type).toBe(
      "csv",
    );
    expect(detectType(Buffer.from("a,b\n1,2"), null, "data.csv").type).toBe(
      "csv",
    );
    expect(detectType(Buffer.from("# Notes"), null, "notes.md").type).toBe(
      "txt",
    );
  });

  it("flags an HTML page served for a .pdf link", () => {
    const res = detectType(
      Buffer.from("<html><body>Please log in</body></html>"),
      "text/html",
      "https://x.org/paper.pdf",
    );
    expect(res).toMatchObject({
      type: null,
      error: expect.stringMatching(/HTML page/),
    });
  });
});

describe("helpers", () => {
  it("reads extensions and charsets", () => {
    expect(extensionOf("https://x.org/a/B.PDF?x=1")).toBe("pdf");
    expect(extensionOf("report.final.docx")).toBe("docx");
    expect(extensionOf("https://x.org/")).toBe("");
    expect(charsetOf('text/html; charset="ISO-8859-1"')).toBe("iso-8859-1");
    expect(charsetOf("text/html")).toBeNull();
  });
});
