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
    expect(beta?.title).toBe("Announcing TypeScript 7.1 Beta");
    expect(beta?.summary).toBe(
      "Today we\u2019re excited to announce the beta release of TypeScript 7.1! npm install -D typescript@beta Let\u2019s take a look at what\u2019s new in TypeScript 7.1! Support for Import Attributes in Ambient Modules Import attributes are metadata that are attached to import statements. Typically, they\u2019re meant to instruct runtimes and bundlers on how to interpret the [\u2026] The post Announcing TypeScript 7.1 Beta appeared first on TypeScript .",
    );
    expect(progress?.title).toBe("Progress on TypeScript 7 \u2013 December 2025");
    expect(progress?.summary).toBe(
      "Earlier this year, the TypeScript team announced that we\u2019ve been porting the compiler and language service to native code to take advantage of better raw performance, memory usage, and parallelism. This effort (codenamed \u201cProject Corsa\u201d, and soon \u201cTypeScript 7.0\u201d) has been a significant undertaking, but we\u2019ve made big strides in the past few months. We\u2019re [\u2026] The post Progress on TypeScript 7 \u2013 December 2025 appeared first on TypeScript .",
    );
  });

  it("stores a double-encoded literal entity after one decode", () => {
    const entry = normaliseEntry({
      source: "typescript",
      type: "article",
      key: "literal-br",
      title: "Use &amp;lt;br&amp;gt;",
      date: "2026-11-14",
      url: "https://example.com/literal-br",
      summary: "Keep &amp;lt;br&amp;gt; as text",
    });
    expect(entry.title).toBe("Use &lt;br&gt;");
    expect(entry.summary).toBe("Keep &lt;br&gt; as text");
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
