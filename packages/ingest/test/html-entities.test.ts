import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fixture } from "../../../test/fixture";
import { ingestSource } from "../src/index";
import { clampSummary, normaliseEntry } from "../src/normalise";
import { SOURCE_URLS } from "../src/sources/types";

const snippets = JSON.parse(
  readFileSync(new URL("../../../test/fixtures/typescript/devblog-entities.json", import.meta.url), "utf8"),
) as string[];

describe("TypeScript devblog HTML entities", () => {
  it("decodes numeric entities from the real devblog feed into summaries and titles", async () => {
    const feed = fixture("typescript/devblog-feed.xml");
    expect(feed).toContain("&#8217;");
    expect(feed).toContain("&#8230;");
    expect(feed).toContain("Progress on TypeScript 7 &#8211; December 2025");

    const result = await ingestSource("typescript", {
      fetchImpl: (async (url: string) => {
        if (url === SOURCE_URLS.tsFeed) return new Response(feed, { status: 200 });
        return new Response(null, { status: 304 });
      }) as typeof fetch,
    });

    const beta = result.entries.find((entry) => entry.url.endsWith("/announcing-typescript-7-1-beta/"));
    const progress = result.entries.find((entry) => entry.url.endsWith("/progress-on-typescript-7-december-2025/"));
    expect(beta?.summary).toContain("we\u2019re excited");
    expect(beta?.summary).toContain("Let\u2019s take a look");
    expect(beta?.summary).toContain("[\u2026]");
    expect(beta?.summary).not.toContain("&#8217;");
    expect(beta?.summary).not.toContain("&#8230;");
    expect(beta?.summary).not.toContain("<p>");
    expect(progress?.title).toBe("Progress on TypeScript 7 \u2013 December 2025");
    expect(progress?.summary).toContain("\u201cProject Corsa\u201d");
    expect(progress?.summary).toContain("[\u2026]");
    expect(progress?.title).not.toContain("&#8211;");
    expect(progress?.summary).not.toMatch(/&#(?:\d+|x[\da-fA-F]+);/);
  });

  it("decodes decimal, hex, and named entities copied from the devblog, then clamps", () => {
    const [quotes, check, script, grin, cross, backtick] = snippets;
    expect(quotes).toContain("&quot;");
    expect(check).toContain("&#x2705;");
    expect(script).toContain("&lt;script&gt;");
    expect(clampSummary(quotes)).toBe('the two "pull" on types');
    expect(clampSummary(check)).toBe("// \u2705 Works");
    expect(clampSummary(script)).toBe("supporting <script>");
    expect(clampSummary(grin)).toBe("\u{1F600}");
    expect(clampSummary(cross)).toBe("\u274C");
    expect(clampSummary(backtick)).toBe("`");
    expect(clampSummary("<p>Let&#8217;s&nbsp;go&#8230;</p>")).toBe("Let\u2019s go\u2026");
    expect(clampSummary("Fish &#X2013; chips")).toBe("Fish \u2013 chips");
    expect(clampSummary("it&rsquo;s ready&hellip;")).toBe("it\u2019s ready\u2026");
    expect(clampSummary("A &amp; B")).toBe("A & B");
    expect(clampSummary("keep &notarealentity;")).toBe("keep &notarealentity;");
    expect(clampSummary("&#8217;".repeat(200))).toBe("\u2019".repeat(200));
    expect(clampSummary("&#8217")).toBe("&#8217");
    expect(clampSummary("AT&T")).toBe("AT&T");
    expect(clampSummary("&#xD800;")).toBe("\uFFFD");
    expect(clampSummary("&#x110000;")).toBe("\uFFFD");
    expect(clampSummary("&#0;")).toBe("\uFFFD");
    expect(clampSummary(clampSummary("Let&#8217;s go&#8230;"))).toBe("Let\u2019s go\u2026");
  });

  it("decodes a title and still collapses ordinary whitespace", () => {
    const entry = normaliseEntry({
      source: "typescript",
      type: "article",
      key: "progress-on-typescript-7-december-2025",
      title: "  Progress on TypeScript 7 &#8211; December 2025  ",
      date: "2025-12-02",
      url: "https://devblogs.microsoft.com/typescript/progress-on-typescript-7-december-2025/",
      summary: "Shipped.",
    });
    expect(entry.title).toBe("Progress on TypeScript 7 \u2013 December 2025");
    expect(entry.id).toBe("typescript:article:progress-on-typescript-7-december-2025");
    expect(clampSummary("  hello   world ")).toBe("hello world");
  });
});
