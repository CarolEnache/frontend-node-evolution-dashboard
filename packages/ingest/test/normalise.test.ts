import { describe, expect, it } from "vitest";
import { dedupeEntries } from "../src/dedupe";
import { clampSummary, normaliseEntry, toIso } from "../src/normalise";

describe("normalisation", () => {
  it("clamps summaries, canonicalises dates, and builds the shared id", () => {
    const entry = normaliseEntry({
      source: "nextjs",
      type: "release",
      version: "v16.4.3",
      title: " Next.js 16.4.3 ",
      date: "2026-10-28",
      url: "https://github.com/vercel/next.js/releases/tag/v16.4.3",
      summary: `<p>${"A".repeat(1200)}</p>`,
      tags: ["App-Router", "app-router"],
      raw: { tag: "v16.4.3" },
    });
    expect(entry.id).toBe("nextjs:release:16.4.3");
    expect(entry.version).toBe("16.4.3");
    expect(entry.date).toBe("2026-10-28T00:00:00.000Z");
    expect(entry.summary.length).toBe(1000);
    expect([...entry.summary].length).toBe(1000);
    expect(entry.summary.endsWith("…")).toBe(true);
    expect(entry.tags).toContain("app-router");
    expect(entry.tags.filter((tag) => tag === "app-router")).toHaveLength(1);
    expect(toIso("Wed, 28 Oct 2026 00:00:00 GMT")).toBe("2026-10-28T00:00:00.000Z");
  });

  it("keeps a feature key when the draft also carries a package version", () => {
    const entry = normaliseEntry({
      source: "mdn-bcd",
      type: "feature",
      key: "api.Foo",
      version: "8.2.0",
      title: "api.Foo",
      date: "2026-10-22",
      url: "https://github.com/mdn/browser-compat-data/releases/tag/v8.2.0",
      summary: "Added in 8.2.0.",
    });
    expect(entry.id).toBe("mdn-bcd:feature:api.Foo");
    expect(entry.version).toBe("8.2.0");
  });

  it("keeps a distinct id per feature and support-change when they share a dataset version", () => {
    const shared = {
      version: "1.0.30001821",
      date: "2026-10-28",
      url: "https://caniuse.com/",
      summary: "Changed in this dataset.",
    };
    const entries = [
      normaliseEntry({
        source: "caniuse",
        type: "feature",
        key: "anchor-positioning",
        title: "Anchor positioning",
        ...shared,
      }),
      normaliseEntry({
        source: "caniuse",
        type: "feature",
        key: "unnamed-feature",
        title: "unnamed-feature",
        ...shared,
      }),
      normaliseEntry({
        source: "caniuse",
        type: "support-change",
        key: "css-grid:firefox:120",
        title: "CSS Grid is supported in firefox 120",
        ...shared,
      }),
      normaliseEntry({
        source: "mdn-bcd",
        type: "support-change",
        key: "css.properties.overflow-clip-margin:firefox:145",
        version: "8.1.7",
        title: "overflow-clip-margin shipped in firefox 145",
        date: "2026-10-22",
        url: "https://github.com/mdn/browser-compat-data",
        summary: "Shipped.",
      }),
    ];
    expect(dedupeEntries(entries).map((entry) => entry.id).sort()).toEqual([
      "caniuse:feature:anchor-positioning",
      "caniuse:feature:unnamed-feature",
      "caniuse:support-change:css-grid:firefox:120",
      "mdn-bcd:support-change:css.properties.overflow-clip-margin:firefox:145",
    ]);
  });

  it("dedupes a release seen in both the API and a feed, keeping the more specific type", () => {
    const fromApi = normaliseEntry({
      source: "node",
      type: "lts",
      version: "v26.13.0",
      title: "Node.js v26.13.0 (Lithium LTS)",
      date: "2026-10-28",
      url: "https://nodejs.org/en/blog/release/v26.13.0",
      summary: "LTS codename Lithium. Notable changes include a security patch for the HTTP parser and a new test runner flag.",
      tags: ["lts", "lithium"],
      raw: { via: "index" },
    });
    const fromFeed = normaliseEntry({
      source: "node",
      type: "release",
      version: "26.13.0",
      title: "Node.js v26.13.0",
      date: "2026-10-28",
      url: "https://nodejs.org/en/feed/releases.xml",
      summary: "Short",
      tags: ["node"],
      raw: { via: "rss" },
    });
    const [merged] = dedupeEntries([fromFeed, fromApi]);
    expect(dedupeEntries([fromFeed, fromApi])).toHaveLength(1);
    expect(merged?.id).toBe("node:lts:26.13.0");
    expect(merged?.type).toBe("lts");
    expect(merged?.summary).toContain("Lithium");
    expect(merged?.tags).toEqual(expect.arrayContaining(["lts", "lithium", "node"]));
  });

  it("keeps a surrogate pair that sits on the clamp boundary", () => {
    const emoji = "\u{1F600}";
    const input = `${"a".repeat(998)}${emoji}${"b".repeat(10)}`;
    const summary = clampSummary(input);
    expect([...summary].length).toBe(1000);
    expect(summary.startsWith(`${"a".repeat(998)}${emoji}`)).toBe(true);
    expect(summary.endsWith("…")).toBe(true);
    expect(summary.codePointAt(998)).toBe(emoji.codePointAt(0));
  });

  it("tags from the full decoded summary when the keyword is past the clamp", () => {
    const entry = normaliseEntry({
      source: "node",
      type: "release",
      version: "22.21.0",
      title: "Node.js 22.21.0",
      date: "2026-10-28",
      url: "https://nodejs.org/en/blog/release/v22.21.0",
      summary: `${"a".repeat(1200)} typescript`,
    });
    expect(entry.summary).toBe(`${"a".repeat(999)}\u2026`);
    expect(entry.tags).toEqual(expect.arrayContaining(["node", "typescript"]));
  });

  it("rejects an entry with no identity", () => {
    expect(clampSummary("  hello   world ")).toBe("hello world");
    expect(() =>
      normaliseEntry({
        source: "caniuse",
        type: "feature",
        title: "Missing",
        date: "2026-10-01",
        url: "https://caniuse.com",
        summary: "No key",
      }),
    ).toThrow(/version or key/i);
  });
});
