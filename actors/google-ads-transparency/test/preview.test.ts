import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePreview, previewDocuments } from "../src/preview.js";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("parsePreview", () => {
  it("extracts headline, description and display URL from a search text ad", () => {
    const c = parsePreview(fixture("preview-text.txt"), "Nike, Inc.");
    expect(c.headline).toBe("Men's footwear size chart. Nike UK");
    expect(c.description).toBe(
      "Find the right shoe size with our easy-to-read Nike men's footwear size chart.",
    );
    expect(c.displayUrl).toBe("www.nike.com/");
    expect(c.texts).toContain("Nike");
    expect(c.texts.some((t) => /Rendering Service/.test(t))).toBe(false);
    expect(c.width).toBe(380);
    expect(c.height).toBe(320);
  });

  it("extracts product title and image from a shopping ad", () => {
    const c = parsePreview(fixture("preview-shopping.txt"), "Nike, Inc.");
    expect(c.headline).toMatch(/^Nike A'Two "A'Pink Shoe"/);
    expect(c.texts).not.toContain("[Price]");
    expect(c.imageUrls).toEqual([
      "https://encrypted-tbn0.gstatic.com/shopping?q=tbn:ANd9GcQWr8ImL_L0LvwQqnKfvuReP-Q4kgZ6owEpjzO7ZgUM9zuM16w",
    ]);
    expect(c.youtubeVideoId).toBeNull();
  });

  it("extracts the YouTube video ID and copy from a video ad", () => {
    const c = parsePreview(fixture("preview-video.txt"), "Nike, Inc.");
    expect(c.youtubeVideoId).toBe("RZ1MLoOdWcc");
    expect(c.texts).toContain("Engineered for Max Airflow");
    expect(c.texts).not.toContain("00:00:00.000");
    expect(c.imageUrls.some((u) => u.includes("RZ1MLoOdWcc"))).toBe(false);
  });

  it("reads image-only previews (YouTube thumbnail)", () => {
    const c = parsePreview(fixture("preview-thumbnail.txt"));
    expect(c.youtubeVideoId).toBe("ZGR8dd8Q5j8");
    expect(c.imageUrls).toEqual([]);
    expect([c.width, c.height]).toEqual([480, 360]);
  });

  it("reads template config of app-install ads", () => {
    const c = parsePreview(
      fixture("preview-app.txt"),
      "株式会社ナイキジャパン",
    );
    expect(c.app).toEqual({
      appId: "com.nike.omega",
      appName: "Nike公式アプリ",
      appStore: "Google Play",
    });
    expect(c.headline).toBe("Nike公式アプリ");
    expect(c.description).toMatch(/^スニーカー、アパレル/);
    expect(c.callToAction).toBe("インストール");
    expect(c.imageUrls).toContain(
      "https://tpc.googlesyndication.com/simgad/663401388605462180",
    );
    expect(
      c.imageUrls.some((u) =>
        u.startsWith("https://lh3.googleusercontent.com/"),
      ),
    ).toBe(true);
    expect(c.texts.some((t) => /^\[.*\]$/.test(t))).toBe(false);
  });

  it("returns empty content for unexpected input", () => {
    expect(previewDocuments("(function(){})()")).toEqual([]);
    const c = parsePreview("garbage");
    expect(c).toMatchObject({ texts: [], headline: null, imageUrls: [] });
  });
});
