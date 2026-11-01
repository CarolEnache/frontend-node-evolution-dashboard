import { describe, expect, it } from "vitest";
import type { SourceState } from "@evolution/shared-types";
import { fixture } from "../../../test/fixture";
import { mockFetch, notModified, type FetchRoute } from "../../../test/mock-fetch";
import { ingestAll, ingestSource } from "../src/index";
import { SOURCE_URLS, type IngestContext } from "../src/sources/types";

const NOW = () => new Date("2026-10-31T12:00:00.000Z");

function ctx(routes: Record<string, FetchRoute | FetchRoute[]>, states?: SourceState[]): IngestContext {
  return { fetchImpl: mockFetch(routes), now: NOW, states };
}

const unchanged = notModified();

describe("source fetchers", () => {
  it("diffs Can I Use releases, new features, and support flips", async () => {
    const result = await ingestSource(
      "caniuse",
      ctx(
        {
          [SOURCE_URLS.caniuseMeta]: fixture("caniuse/meta-1821.json"),
          [SOURCE_URLS.caniuseData("1.0.30001821")]: fixture("caniuse/data-1821.json"),
          [SOURCE_URLS.caniuseData("1.0.30001820")]: fixture("caniuse/data-1820.json"),
        },
        [{ source: "caniuse", url: SOURCE_URLS.caniuseMeta, version: "1.0.30001820", etag: '"old"' }],
      ),
    );
    expect(result.skipped).toBe(false);
    expect(result.entries.map((entry) => entry.type).sort()).toEqual(["feature", "release", "support-change"]);
    expect(result.entries.find((entry) => entry.type === "release")?.id).toBe("caniuse:release:1.0.30001821");
    const support = result.entries.find((entry) => entry.type === "support-change");
    expect(support?.summary).toContain('"n"');
    expect(support?.summary).toContain('"a"');
    expect(support?.title).toContain("firefox 120");
    expect(result.entries.find((entry) => entry.type === "release")?.date).toBe("2026-10-28T00:00:00.000Z");
    expect(result.states.map((state) => state.version)).toEqual(["1.0.30001821", "1.0.30001821"]);
    expect(result.states[0]?.lastSuccessAt).toBe("2026-10-31T12:00:00.000Z");
  });

  it("records a Can I Use release without a diff on the first run", async () => {
    const result = await ingestSource(
      "caniuse",
      ctx({
        [SOURCE_URLS.caniuseMeta]: fixture("caniuse/meta-1821.json"),
        [SOURCE_URLS.caniuseData("1.0.30001821")]: fixture("caniuse/data-1821.json"),
      }),
    );
    expect(result.entries.map((entry) => entry.type)).toEqual(["release"]);
    expect(result.skipped).toBe(false);
  });

  it("skips Can I Use and MDN when the npm version is unchanged or the metadata is 304", async () => {
    const same = await ingestSource(
      "caniuse",
      ctx({ [SOURCE_URLS.caniuseMeta]: fixture("caniuse/meta-1821.json") }, [
        { source: "caniuse", url: SOURCE_URLS.caniuseMeta, version: "1.0.30001821" },
      ]),
    );
    expect(same.skipped).toBe(true);
    expect(same.entries).toEqual([]);

    const cached = await ingestSource("mdn-bcd", ctx({ [SOURCE_URLS.mdnMeta]: unchanged }));
    expect(cached.skipped).toBe(true);
    expect(cached.states[0]?.etag).toBe('"same"');
  });

  it("diffs MDN release notes and compat records", async () => {
    const result = await ingestSource(
      "mdn-bcd",
      ctx(
        {
          [SOURCE_URLS.mdnMeta]: fixture("mdn/meta-8.1.7.json"),
          [SOURCE_URLS.mdnRelease]: fixture("mdn/release.json"),
          [SOURCE_URLS.mdnData("8.1.7")]: fixture("mdn/data-8.1.7.json"),
          [SOURCE_URLS.mdnData("8.1.6")]: fixture("mdn/data-8.1.6.json"),
        },
        [{ source: "mdn-bcd", url: SOURCE_URLS.mdnMeta, version: "8.1.6" }],
      ),
    );
    expect(result.skipped).toBe(false);
    expect(result.entries.map((entry) => entry.type).sort()).toEqual(["feature", "release", "support-change"]);
    expect(result.entries.find((entry) => entry.type === "release")?.id).toBe("mdn-bcd:release:8.1.7");
    expect(result.entries.find((entry) => entry.type === "support-change")?.title).toContain("firefox 145");
    expect(result.entries.every((entry) => entry.date === "2026-10-22T00:00:00.000Z")).toBe(true);
    expect(result.entries.some((entry) => entry.title.includes("chrome 100"))).toBe(false);
    expect(result.states).toHaveLength(3);
  });

  it("still publishes an MDN release when the data payload is empty", async () => {
    const result = await ingestSource(
      "mdn-bcd",
      ctx(
        {
          [SOURCE_URLS.mdnMeta]: fixture("mdn/meta-8.1.7.json"),
          [SOURCE_URLS.mdnRelease]: unchanged,
          [SOURCE_URLS.mdnData("8.1.7")]: "",
        },
        [{ source: "mdn-bcd", url: SOURCE_URLS.mdnMeta, version: "8.1.6" }],
      ),
    );
    expect(result.entries.map((entry) => entry.id)).toEqual(["mdn-bcd:release:8.1.7"]);
    expect(result.entries[0]?.date).toBe("2026-10-31T12:00:00.000Z");
  });

  it("ingests Node releases, the current LTS line, and the releases feed", async () => {
    const result = await ingestSource(
      "node",
      ctx({
        [SOURCE_URLS.nodeIndex]: fixture("node/index.json"),
        [SOURCE_URLS.nodeSchedule]: fixture("node/schedule.json"),
        [SOURCE_URLS.nodeRss]: fixture("node/releases.xml"),
      }),
    );
    expect(result.skipped).toBe(false);
    expect(result.entries.map((entry) => entry.id).sort()).toEqual([
      "node:lts:26.13.0",
      "node:release:27.0.0-alpha",
      "node:security:26.12.1",
      "node:security:node-js-security-advisory",
    ]);
    expect(result.states[0]?.version).toBe("v27.0.0-alpha");
    expect(result.states[1]?.version).toBe("v26 Lithium");
    const security = result.entries.find((entry) => entry.id === "node:security:26.12.1");
    expect(security?.type).toBe("security");
    expect(security?.tags).toEqual(expect.arrayContaining(["security", "lts"]));
  });

  it("limits Node releases to versions newer than the stored index and skips when nothing changed", async () => {
    const newer = await ingestSource(
      "node",
      ctx(
        {
          [SOURCE_URLS.nodeIndex]: fixture("node/index.json"),
          [SOURCE_URLS.nodeSchedule]: unchanged,
          [SOURCE_URLS.nodeRss]: unchanged,
        },
        [{ source: "node", url: SOURCE_URLS.nodeIndex, version: "v26.13.0" }],
      ),
    );
    expect(newer.entries.map((entry) => entry.version)).toEqual(["27.0.0-alpha"]);

    const skipped = await ingestSource(
      "node",
      ctx({
        [SOURCE_URLS.nodeIndex]: unchanged,
        [SOURCE_URLS.nodeSchedule]: unchanged,
        [SOURCE_URLS.nodeRss]: unchanged,
      }),
    );
    expect(skipped.skipped).toBe(true);
    expect(skipped.entries).toEqual([]);
  });

  it("keeps a changed Node feed when the index is unchanged", async () => {
    const result = await ingestSource(
      "node",
      ctx({
        [SOURCE_URLS.nodeIndex]: unchanged,
        [SOURCE_URLS.nodeSchedule]: unchanged,
        [SOURCE_URLS.nodeRss]: fixture("node/releases.xml"),
      }),
    );
    expect(result.skipped).toBe(false);
    expect(result.entries.map((entry) => entry.type).sort()).toEqual(["lts", "security"]);
  });

  it("ingests TypeScript dist-tags, GitHub releases, and the Atom feed", async () => {
    const result = await ingestSource(
      "typescript",
      ctx({
        [SOURCE_URLS.tsMeta]: fixture("typescript/packument.json"),
        [SOURCE_URLS.tsReleases]: fixture("typescript/releases.json"),
        [SOURCE_URLS.tsFeed]: fixture("typescript/feed.xml"),
      }),
    );
    expect(result.skipped).toBe(false);
    expect(result.entries.map((entry) => entry.id).sort()).toEqual([
      "typescript:article:announcing-typescript-7-0",
      "typescript:release:7.0.2",
      "typescript:release:7.1.0-beta",
    ]);
    expect(result.entries.some((entry) => entry.version?.includes("-dev."))).toBe(false);
    expect(result.entries.find((entry) => entry.type === "article")?.url).toBe(
      "https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/",
    );
    expect(result.states[0]?.version).toBe("7.0.2");
  });

  it("ingests stable Next.js releases and drops canaries, prereleases, and drafts", async () => {
    const result = await ingestSource(
      "nextjs",
      ctx({
        [SOURCE_URLS.nextLatest]: fixture("nextjs/latest.json"),
        [SOURCE_URLS.nextReleases]: fixture("nextjs/releases.json"),
        [SOURCE_URLS.nextFeed]: fixture("nextjs/feed.xml"),
      }),
    );
    expect(result.skipped).toBe(false);
    expect(result.entries.map((entry) => entry.id).sort()).toEqual([
      "nextjs:article:cache-components",
      "nextjs:release:16.4.3",
    ]);
    expect(result.states[0]?.version).toBe("v16.4.3");
    expect(result.entries.find((entry) => entry.type === "article")?.summary).toContain("How caching works.");
  });

  it("stores a canary tag without emitting a canary entry", async () => {
    const result = await ingestSource(
      "nextjs",
      ctx({
        [SOURCE_URLS.nextLatest]: fixture("nextjs/latest-canary.json"),
        [SOURCE_URLS.nextReleases]: unchanged,
        [SOURCE_URLS.nextFeed]: unchanged,
      }),
    );
    expect(result.skipped).toBe(false);
    expect(result.entries).toEqual([]);
    expect(result.states[0]?.version).toBe("v16.5.0-canary.35");
  });

  it("skips Next.js and TypeScript when every response is 304", async () => {
    const next = await ingestSource(
      "nextjs",
      ctx({
        [SOURCE_URLS.nextLatest]: unchanged,
        [SOURCE_URLS.nextReleases]: unchanged,
        [SOURCE_URLS.nextFeed]: unchanged,
      }),
    );
    const typescript = await ingestSource(
      "typescript",
      ctx({
        [SOURCE_URLS.tsMeta]: unchanged,
        [SOURCE_URLS.tsReleases]: unchanged,
        [SOURCE_URLS.tsFeed]: unchanged,
      }),
    );
    expect(next.skipped).toBe(true);
    expect(typescript.skipped).toBe(true);
  });

  it.each([
    ["caniuse", SOURCE_URLS.caniuseMeta],
    ["mdn-bcd", SOURCE_URLS.mdnMeta],
    ["node", SOURCE_URLS.nodeIndex],
    ["typescript", SOURCE_URLS.tsMeta],
    ["nextjs", SOURCE_URLS.nextLatest],
  ] as const)("rejects %s non-200 responses and timeouts", async (source, url) => {
    await expect(ingestSource(source, ctx({ [url]: 503 }))).rejects.toThrow(/failed with 503/);
    await expect(ingestSource(source, ctx({ [url]: "timeout" }))).rejects.toThrow(/timeout/i);
  });

  it("rejects malformed JSON after the sibling documents have been fetched", async () => {
    const bad = fixture("shared/malformed.txt");
    await expect(ingestSource("caniuse", ctx({ [SOURCE_URLS.caniuseMeta]: bad }))).rejects.toThrow(/invalid JSON/);
    await expect(ingestSource("mdn-bcd", ctx({ [SOURCE_URLS.mdnMeta]: bad }))).rejects.toThrow(/invalid JSON/);
    await expect(
      ingestSource("node", ctx({
        [SOURCE_URLS.nodeIndex]: bad,
        [SOURCE_URLS.nodeSchedule]: unchanged,
        [SOURCE_URLS.nodeRss]: unchanged,
      })),
    ).rejects.toThrow(/invalid JSON/);
    await expect(
      ingestSource("typescript", ctx({
        [SOURCE_URLS.tsMeta]: bad,
        [SOURCE_URLS.tsReleases]: unchanged,
        [SOURCE_URLS.tsFeed]: unchanged,
      })),
    ).rejects.toThrow(/invalid JSON/);
    await expect(
      ingestSource("nextjs", ctx({
        [SOURCE_URLS.nextLatest]: bad,
        [SOURCE_URLS.nextReleases]: unchanged,
        [SOURCE_URLS.nextFeed]: unchanged,
      })),
    ).rejects.toThrow(/invalid JSON/);
  });

  it("rejects metadata that is missing a version and payloads of the wrong shape", async () => {
    await expect(
      ingestSource("caniuse", ctx({ [SOURCE_URLS.caniuseMeta]: fixture("caniuse/meta-missing-version.json") })),
    ).rejects.toThrow(/missing a version/);
    await expect(
      ingestSource("mdn-bcd", ctx({ [SOURCE_URLS.mdnMeta]: fixture("mdn/meta-missing-version.json") })),
    ).rejects.toThrow(/missing a version/);
    await expect(
      ingestSource(
        "caniuse",
        ctx({
          [SOURCE_URLS.caniuseMeta]: fixture("caniuse/meta-1821.json"),
          [SOURCE_URLS.caniuseData("1.0.30001821")]: "",
        }),
      ),
    ).rejects.toThrow(/empty/i);
    await expect(
      ingestSource(
        "caniuse",
        ctx({
          [SOURCE_URLS.caniuseMeta]: fixture("caniuse/meta-1821.json"),
          [SOURCE_URLS.caniuseData("1.0.30001821")]: fixture("shared/malformed.txt"),
        }),
      ),
    ).rejects.toThrow(/Can I Use data returned invalid JSON/);
    await expect(
      ingestSource(
        "node",
        ctx({
          [SOURCE_URLS.nodeIndex]: fixture("node/index-not-array.json"),
          [SOURCE_URLS.nodeSchedule]: unchanged,
          [SOURCE_URLS.nodeRss]: unchanged,
        }),
      ),
    ).rejects.toThrow(/must be an array/);
    const arrayPayload = await ingestSource(
      "typescript",
      ctx({
        [SOURCE_URLS.tsMeta]: fixture("typescript/packument-array.json"),
        [SOURCE_URLS.tsReleases]: unchanged,
        [SOURCE_URLS.tsFeed]: unchanged,
      }),
    );
    expect(arrayPayload.entries).toEqual([]);
    await expect(
      ingestSource(
        "typescript",
        ctx({
          [SOURCE_URLS.tsMeta]: "null",
          [SOURCE_URLS.tsReleases]: unchanged,
          [SOURCE_URLS.tsFeed]: unchanged,
        }),
      ),
    ).rejects.toThrow(/dist-tags/);
    await expect(
      ingestSource(
        "node",
        ctx({
          [SOURCE_URLS.nodeIndex]: unchanged,
          [SOURCE_URLS.nodeSchedule]: unchanged,
          [SOURCE_URLS.nodeRss]: fixture("shared/unclosed.xml"),
        }),
      ),
    ).rejects.toThrow();
  });

  it.fails("TODO: null TypeScript metadata throws TypeError before packument validation", async () => {
    await expect(
      ingestSource(
        "typescript",
        ctx({
          [SOURCE_URLS.tsMeta]: "null",
          [SOURCE_URLS.tsReleases]: unchanged,
          [SOURCE_URLS.tsFeed]: unchanged,
        }),
      ),
    ).rejects.toThrow(/must be an object/);
  });

  it("treats an empty changed body as no entries for Node metadata", async () => {
    const result = await ingestSource(
      "node",
      ctx({
        [SOURCE_URLS.nodeIndex]: "",
        [SOURCE_URLS.nodeSchedule]: unchanged,
        [SOURCE_URLS.nodeRss]: unchanged,
      }),
    );
    expect(result.skipped).toBe(false);
    expect(result.entries).toEqual([]);
  });

  it.fails("TODO: Can I Use and MDN feature keys are dropped when the dataset version is set", async () => {
    const caniuse = await ingestSource(
      "caniuse",
      ctx(
        {
          [SOURCE_URLS.caniuseMeta]: fixture("caniuse/meta-1821.json"),
          [SOURCE_URLS.caniuseData("1.0.30001821")]: fixture("caniuse/data-1821.json"),
          [SOURCE_URLS.caniuseData("1.0.30001820")]: fixture("caniuse/data-1820.json"),
        },
        [{ source: "caniuse", url: SOURCE_URLS.caniuseMeta, version: "1.0.30001820" }],
      ),
    );
    expect(caniuse.entries.map((entry) => entry.id).sort()).toEqual([
      "caniuse:feature:anchor-positioning",
      "caniuse:feature:unnamed-feature",
      "caniuse:release:1.0.30001821",
      "caniuse:support-change:css-grid:firefox:120",
    ]);
    const mdn = await ingestSource(
      "mdn-bcd",
      ctx(
        {
          [SOURCE_URLS.mdnMeta]: fixture("mdn/meta-8.1.7.json"),
          [SOURCE_URLS.mdnRelease]: fixture("mdn/release.json"),
          [SOURCE_URLS.mdnData("8.1.7")]: fixture("mdn/data-8.1.7.json"),
          [SOURCE_URLS.mdnData("8.1.6")]: fixture("mdn/data-8.1.6.json"),
        },
        [{ source: "mdn-bcd", url: SOURCE_URLS.mdnMeta, version: "8.1.6" }],
      ),
    );
    expect(mdn.entries.map((entry) => entry.id).sort()).toEqual([
      "mdn-bcd:feature:api.CSSAnchorPositioning",
      "mdn-bcd:feature:css.properties.overflow-clip-margin",
      "mdn-bcd:feature:css.properties.reading-order",
      "mdn-bcd:release:8.1.7",
      "mdn-bcd:support-change:css.properties.overflow-clip-margin:firefox:145",
    ]);
  });

  it("runs every source when each conditional request is unchanged", async () => {
    const routes: Record<string, FetchRoute> = {
      [SOURCE_URLS.mdnMeta]: unchanged,
      [SOURCE_URLS.caniuseMeta]: unchanged,
      [SOURCE_URLS.nodeIndex]: unchanged,
      [SOURCE_URLS.nodeSchedule]: unchanged,
      [SOURCE_URLS.nodeRss]: unchanged,
      [SOURCE_URLS.tsMeta]: unchanged,
      [SOURCE_URLS.tsReleases]: unchanged,
      [SOURCE_URLS.tsFeed]: unchanged,
      [SOURCE_URLS.nextLatest]: unchanged,
      [SOURCE_URLS.nextReleases]: unchanged,
      [SOURCE_URLS.nextFeed]: unchanged,
    };
    const results = await ingestAll(ctx(routes));
    expect(results.map((result) => result.source)).toEqual(["mdn-bcd", "caniuse", "node", "typescript", "nextjs"]);
    expect(results.every((result) => result.skipped && result.entries.length === 0)).toBe(true);
  });

  it("limits ingestAll to the requested sources and propagates fetcher failures", async () => {
    const onlyNode = await ingestAll(
      ctx({
        [SOURCE_URLS.nodeIndex]: unchanged,
        [SOURCE_URLS.nodeSchedule]: unchanged,
        [SOURCE_URLS.nodeRss]: unchanged,
      }),
      ["node"],
    );
    expect(onlyNode.map((result) => result.source)).toEqual(["node"]);
    await expect(ingestAll(ctx({ [SOURCE_URLS.caniuseMeta]: 502 }), ["caniuse"])).rejects.toThrow(/502/);
  });
});
