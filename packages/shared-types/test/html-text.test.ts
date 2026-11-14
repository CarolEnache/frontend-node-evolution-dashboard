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

  it("is idempotent when entities sit next to a literal ampersand", () => {
    const input = "Let&#8217;s &amp; AT&T go&#8230; &#x1F600;";
    const once = decodeHtmlEntities(input);
    expect(once).toBe("Let\u2019s & AT&T go\u2026 \u{1F600}");
    expect(decodeHtmlEntities(once)).toBe(once);
  });

  it("replaces lone surrogates and keeps a well-formed emoji", () => {
    expect(decodeHtmlEntities("&#xD800;")).toBe("\uFFFD");
    expect(decodeHtmlEntities("&#xDC00;")).toBe("\uFFFD");
    expect(decodeHtmlEntities("&#x1F600;")).toBe("\u{1F600}");
  });
});
