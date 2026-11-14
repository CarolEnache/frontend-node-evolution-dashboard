import { describe, expect, it } from "vitest";
import { decodeHtmlEntities } from "../src/html-text";

describe("decodeHtmlEntities", () => {
  it("decodes decimal, hex, and named entities and leaves everything else", () => {
    expect(decodeHtmlEntities("we&#8217;re")).toBe("we\u2019re");
    expect(decodeHtmlEntities("wait&#8230;")).toBe("wait\u2026");
    expect(decodeHtmlEntities("&#x2013;")).toBe("\u2013");
    expect(decodeHtmlEntities("&#X2705;")).toBe("\u2705");
    expect(decodeHtmlEntities("&#x1f600;")).toBe("\u{1F600}");
    expect(decodeHtmlEntities("&quot;pull&quot;")).toBe('"pull"');
    expect(decodeHtmlEntities("&rsquo;")).toBe("\u2019");
    expect(decodeHtmlEntities("&amp;")).toBe("&");
    expect(decodeHtmlEntities("plain text")).toBe("plain text");
    expect(decodeHtmlEntities("")).toBe("");
    expect(decodeHtmlEntities("&#8217")).toBe("&#8217");
    expect(decodeHtmlEntities("AT&T")).toBe("AT&T");
    expect(decodeHtmlEntities("&notarealentity;")).toBe("&notarealentity;");
  });

  it("is idempotent and replaces lone surrogates", () => {
    const decoded = decodeHtmlEntities("Let&#8217;s go&#8230;");
    expect(decodeHtmlEntities(decoded)).toBe(decoded);
    expect(decodeHtmlEntities("&#xD800;")).toBe("\uFFFD");
    expect(decodeHtmlEntities("&#xDC00;")).toBe("\uFFFD");
    expect(decodeHtmlEntities("&#x1F600;")).toBe("\u{1F600}");
    expect(decoded.includes("\uFFFD")).toBe(false);
  });
});
