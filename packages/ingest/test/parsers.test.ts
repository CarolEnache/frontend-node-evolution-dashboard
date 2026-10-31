import { describe, expect, it } from "vitest";
import { parseGithubReleases } from "../src/github";
import { normaliseEntry } from "../src/normalise";
import { parseFeed } from "../src/rss";
import { diffCaniuse } from "../src/sources/caniuse";
import { diffBcd, parseMdnReleaseNotes } from "../src/sources/mdn-bcd";
import { currentLts, parseNodeIndex, selectNewNodeReleases, type NodeDistRelease } from "../src/sources/node";
import { parseTypeScriptPackument } from "../src/sources/typescript";
import { ingestSource } from "../src/index";
import { SOURCE_URLS } from "../src/sources/types";

const releaseNotes = `
## Statistics
- 10 additions

## Additions
- \`api.CSSAnchorPositioning\`
- css.properties.overflow-clip-margin

## Removals
- api.DeprecatedThing
`;

describe("source parsers", () => {
  it("reads MDN addition lists and compat diffs", () => {
    const additions = parseMdnReleaseNotes(releaseNotes, {
      version: "8.1.7",
      date: "2026-10-22",
      url: "https://github.com/mdn/browser-compat-data/releases/latest",
    });
    expect(additions.map((item) => item.key)).toEqual([
      "api.CSSAnchorPositioning",
      "css.properties.overflow-clip-margin",
    ]);

    const previous = {
      css: {
        properties: {
          "overflow-clip-margin": {
            __compat: { support: { firefox: { version_added: false } }, status: { experimental: false } },
          },
        },
      },
    };
    const next = {
      css: {
        properties: {
          "overflow-clip-margin": {
            __compat: { support: { firefox: { version_added: "145" } } },
          },
          "reading-order": {
            __compat: { support: { chrome: { version_added: "140" } } },
          },
        },
      },
    };
    const diffs = diffBcd(previous, next, {
      version: "8.1.7",
      date: "2026-10-22",
      url: "https://github.com/mdn/browser-compat-data",
    }).map((draft) => normaliseEntry(draft));
    expect(diffs.map((entry) => entry.type).sort()).toEqual(["feature", "support-change"]);
    expect(diffs.some((entry) => entry.title.includes("firefox 145"))).toBe(true);
  });

  it("diffs Can I Use features and support flips from n/p to y/a", () => {
    const previous = {
      data: {
        "css-grid": { title: "CSS Grid", stats: { firefox: { "120": "n", "121": "y" } } },
      },
    };
    const next = {
      updated: 1761600000,
      data: {
        "css-grid": { title: "CSS Grid", categories: ["CSS"], stats: { firefox: { "120": "y", "121": "y" } } },
        "anchor-positioning": { title: "Anchor positioning", description: "CSS anchor positioning.", categories: ["CSS"] },
      },
    };
    const drafts = diffCaniuse(previous, next, {
      version: "1.0.30001820",
      date: "2026-10-28",
      url: "https://caniuse.com",
    });
    expect(drafts.map((draft) => draft.type).sort()).toEqual(["feature", "support-change"]);
    expect(drafts.find((draft) => draft.type === "support-change")?.title).toContain("firefox 120");
  });

  it("selects new Node releases by index order and flags LTS and security", () => {
    const index: NodeDistRelease[] = [
      { version: "v27.0.0-alpha", date: "2026-10-29", lts: false, security: false, npm: "11.6.0", v8: "14.0" },
      { version: "v26.13.0", date: "2026-10-28", lts: "Lithium", security: false, npm: "11.5.0", v8: "13.9" },
      { version: "v26.12.1", date: "2026-10-20", lts: "Lithium", security: true },
    ];
    expect(selectNewNodeReleases(index, "v26.13.0").map((release) => release.version)).toEqual(["v27.0.0-alpha"]);
    const drafts = parseNodeIndex(index, { previousVersion: "v26.12.1" });
    expect(drafts.map((draft) => draft.type)).toEqual(["release", "lts"]);
    expect(drafts[1]?.tags).toEqual(expect.arrayContaining(["lts", "lithium"]));
    expect(
      currentLts(
        {
          v24: { lts: "2025-10-28", end: "2027-04-30", codename: "Krypton" },
          v26: { lts: "2026-10-28", end: "2028-04-30", codename: "Lithium" },
          v27: { start: "2027-04-22", codename: "TBD" },
        },
        new Date("2026-10-31T00:00:00.000Z"),
      )?.codename,
    ).toBe("Lithium");
  });

  it("tracks TypeScript latest, beta, and rc, and ignores nightlies", () => {
    const drafts = parseTypeScriptPackument({
      "dist-tags": {
        latest: "7.0.2",
        beta: "7.1.0-beta",
        rc: "7.0.2",
        next: "7.1.0-dev.20261031.1",
      },
      time: {
        "7.0.2": "2026-10-20T00:00:00.000Z",
        "7.1.0-beta": "2026-10-29T00:00:00.000Z",
        "7.1.0-dev.20261031.1": "2026-10-31T00:00:00.000Z",
      },
    });
    expect(drafts.map((draft) => draft.version)).toEqual(["7.0.2", "7.1.0-beta"]);
    expect(drafts.some((draft) => String(draft.version).includes("-dev."))).toBe(false);
  });

  it("drops Next.js canaries and keeps stable releases plus the working blog feed", () => {
    const releases = parseGithubReleases("nextjs", [
      {
        tag_name: "v16.5.0-canary.35",
        name: "v16.5.0-canary.35",
        prerelease: true,
        draft: false,
        published_at: "2026-10-30T00:00:00.000Z",
        html_url: "https://github.com/vercel/next.js/releases/tag/v16.5.0-canary.35",
      },
      {
        tag_name: "v16.4.3",
        name: "Next.js 16.4.3",
        prerelease: false,
        draft: false,
        body: "Stable release.",
        published_at: "2026-10-28T00:00:00.000Z",
        html_url: "https://github.com/vercel/next.js/releases/tag/v16.4.3",
      },
    ]);
    expect(releases).toHaveLength(1);
    expect(releases[0]?.version).toBe("16.4.3");

    const items = parseFeed(`<?xml version="1.0"?>
      <rss version="2.0"><channel>
        <item>
          <title>Cache Components</title>
          <link>https://nextjs.org/blog/cache-components</link>
          <pubDate>Wed, 28 Oct 2026 00:00:00 GMT</pubDate>
          <description><![CDATA[<p>How caching works.</p>]]></description>
        </item>
      </channel></rss>`);
    expect(items[0]?.url).toBe("https://nextjs.org/blog/cache-components");
    expect(items[0]?.summary).toContain("How caching works.");
  });

  it("normalises a Next.js ingest from the releases list and feed.xml", async () => {
    const fetchImpl = async (url: string) => {
      if (url === SOURCE_URLS.nextLatest) {
        return new Response(null, { status: 304, headers: { etag: '"latest"' } });
      }
      if (url === SOURCE_URLS.nextReleases) {
        return new Response(
          JSON.stringify([
            { tag_name: "v16.5.0-canary.35", prerelease: true, draft: false, published_at: "2026-10-30T00:00:00.000Z" },
            {
              tag_name: "v16.4.3",
              name: "Next.js 16.4.3",
              prerelease: false,
              draft: false,
              body: "Turbopack is the default.",
              published_at: "2026-10-28T00:00:00.000Z",
              html_url: "https://github.com/vercel/next.js/releases/tag/v16.4.3",
            },
          ]),
          { status: 200, headers: { etag: '"list"' } },
        );
      }
      if (url === SOURCE_URLS.nextFeed) {
        return new Response(
          `<?xml version="1.0"?><rss version="2.0"><channel><item>
            <title>Next.js 16.4</title>
            <link>https://nextjs.org/blog/next-16-4</link>
            <pubDate>Tue, 28 Oct 2026 00:00:00 GMT</pubDate>
            <description>Release notes.</description>
          </item></channel></rss>`,
          { status: 200 },
        );
      }
      return new Response("missing", { status: 404 });
    };
    const result = await ingestSource("nextjs", {
      fetchImpl: fetchImpl as typeof fetch,
      states: [{ source: "nextjs", url: SOURCE_URLS.nextLatest, etag: '"latest"', version: "16.4.3" }],
    });
    expect(result.skipped).toBe(false);
    expect(result.entries.map((entry) => entry.id).sort()).toEqual([
      "nextjs:article:next-js-16-4",
      "nextjs:release:16.4.3",
    ]);
    expect(result.entries.some((entry) => entry.version?.includes("canary"))).toBe(false);
  });
});
