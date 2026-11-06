import { describe, expect, it, vi } from "vitest";
import type { Entry } from "@evolution/shared-types";
import { fixture } from "../../../test/fixture";
import { dedupeEntries } from "../src/dedupe";
import { conditionalHeaders, fetchIfChanged, findState, touchedState } from "../src/fetch-if-changed";
import { parseGithubReleases } from "../src/github";
import { clampSummary, inferTags, normaliseEntry, parseJson, toIso } from "../src/normalise";
import { parseFeed, slugKey } from "../src/rss";
import { diffCaniuse } from "../src/sources/caniuse";
import { collectCompat, diffBcd, sectionItems } from "../src/sources/mdn-bcd";
import { currentLts, parseNodeIndex, selectNewNodeReleases, type NodeDistRelease } from "../src/sources/node";
import { isNightlyTypeScript, parseTypeScriptPackument } from "../src/sources/typescript";

const meta = { version: "1.2.3", date: "2026-10-28T00:00:00.000Z", url: "https://example.com" };

function entry(overrides: Partial<Entry> & Pick<Entry, "id" | "type">): Entry {
  return {
    source: "node",
    title: overrides.id,
    date: "2026-10-28T00:00:00.000Z",
    url: "https://example.com",
    summary: overrides.id,
    tags: [],
    raw: null,
    ...overrides,
  };
}

describe("conditional fetch errors", () => {
  it("throws on non-200 responses and on timeouts", async () => {
    const failing = vi.fn(async () => new Response("nope", { status: 429 }));
    await expect(fetchIfChanged("https://example.com/data.json", undefined, { fetchImpl: failing as typeof fetch })).rejects.toThrow(
      "GET https://example.com/data.json failed with 429",
    );
    const timeout = vi.fn(async () => {
      const error = new Error("The operation was aborted due to timeout");
      error.name = "TimeoutError";
      throw error;
    });
    await expect(fetchIfChanged("https://example.com/slow", undefined, { fetchImpl: timeout as typeof fetch })).rejects.toThrow(/timeout/i);
  });

  it("keeps previous validators when a 304 omits them and records a 200 with none", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 304 }));
    const cached = await fetchIfChanged(
      "https://example.com/data.json",
      { etag: '"keep"', lastModified: "Wed, 21 Oct 2015 07:28:00 GMT" },
      { fetchImpl: fetchImpl as typeof fetch },
    );
    expect(cached).toMatchObject({ changed: false, status: 304, body: null, etag: '"keep"', lastModified: "Wed, 21 Oct 2015 07:28:00 GMT" });

    const fresh = await fetchIfChanged("https://example.com/data.json", undefined, {
      fetchImpl: (async () => new Response("ok", { status: 200 })) as typeof fetch,
    });
    expect(fresh.etag).toBeNull();
    expect(fresh.lastModified).toBeNull();
  });

  it("builds headers for generic, GitHub, and npm packument URLs", () => {
    const generic = conditionalHeaders("https://example.com/feed.xml", undefined, {
      githubToken: "should-not-leak",
      headers: { "x-test": "1" },
    });
    expect(generic["x-test"]).toBe("1");
    expect(generic.authorization).toBeUndefined();
    expect(generic["if-none-match"]).toBeUndefined();

    const latest = conditionalHeaders("https://registry.npmjs.org/typescript/latest");
    expect(latest.accept).not.toBe("application/vnd.npm.install-v1+json");

    const github = conditionalHeaders("https://api.github.com/repos/nodejs/node/releases", undefined, {
      headers: { accept: "application/json" },
    });
    expect(github.accept).toBe("application/vnd.github+json");
    expect(github.authorization).toBeUndefined();
  });

  it("finds source state and fills a touched row", () => {
    expect(findState(undefined, "https://example.com")).toBeUndefined();
    const states = [{ source: "node" as const, url: "https://example.com", version: "1" }];
    expect(findState(states, "https://missing.example")).toBeUndefined();
    expect(findState(states, "https://example.com")?.version).toBe("1");
    expect(
      touchedState(states[0], "node", "https://example.com", {
        changed: true,
        status: 200,
        body: "{}",
        etag: '"e"',
        lastModified: null,
      }, "2026-10-31T00:00:00.000Z"),
    ).toMatchObject({ version: "1", etag: '"e"', lastSuccessAt: "2026-10-31T00:00:00.000Z" });
  });
});

describe("normalise and dedupe edges", () => {
  it("rejects bad dates and bad JSON, and infers tags", () => {
    expect(() => toIso("not-a-date")).toThrow(/Invalid date/);
    expect(parseJson('{"ok":true}', "Example")).toEqual({ ok: true });
    expect(() => parseJson(fixture("shared/malformed.txt"), "Example")).toThrow(/Example returned invalid JSON/);
    expect(inferTags("CSS and App Router security", ["", "Node"])).toEqual(
      expect.arrayContaining(["css", "app-router", "security", "node"]),
    );
    expect(clampSummary("a".repeat(1000))).toHaveLength(1000);
    const titled = normaliseEntry({
      source: "caniuse",
      type: "feature",
      key: "grid",
      title: "Grid",
      date: "2026-10-01T00:00:00.000Z",
      url: "https://caniuse.com/grid",
      summary: "",
      id: "custom-id",
    });
    expect(titled.id).toBe("custom-id");
    expect(titled.summary).toBe("Grid");
  });

  it("keeps a feature key when the draft also carries a dataset version", () => {
    const feature = normaliseEntry({
      source: "caniuse",
      type: "feature",
      key: "anchor-positioning",
      version: "1.0.30001821",
      title: "Anchor positioning",
      date: "2026-10-28",
      url: "https://caniuse.com/anchor-positioning",
      summary: "CSS anchor positioning.",
    });
    expect(feature.id).toBe("caniuse:feature:anchor-positioning");
  });

  it("prefers a security release over an LTS row with the same version", () => {
    const security = entry({
      id: "node:security:26.12.1",
      type: "security",
      version: "v26.12.1",
      summary: "Short",
      tags: ["security"],
      raw: { via: "index" },
    });
    const lts = entry({
      id: "node:lts:26.12.1",
      type: "lts",
      version: "26.12.1",
      summary: "A longer LTS summary that should win on length.",
      tags: ["lts", "lithium"],
      raw: { via: "feed" },
    });
    const feature = entry({
      id: "node:feature:26.12.1",
      type: "feature",
      version: "26.12.1",
      summary: "Feature",
    });
    const [merged, kept] = dedupeEntries([lts, security, feature]);
    expect(dedupeEntries([lts, security, feature])).toHaveLength(2);
    expect(merged?.type).toBe("security");
    expect(merged?.id).toBe("node:security:26.12.1");
    expect(merged?.summary).toContain("longer");
    expect(merged?.tags).toEqual(["lithium", "lts", "security"]);
    expect(merged?.raw).toEqual({ mergedFrom: [lts.raw, security.raw] });
    expect(kept?.type).toBe("feature");
    expect(dedupeEntries([])).toEqual([]);
  });
});

describe("github and rss edges", () => {
  it("fills fallback title, url, date, and summary for each release source", () => {
    for (const source of ["nextjs", "typescript", "node", "mdn-bcd"] as const) {
      const [draft] = parseGithubReleases(source, { tag_name: "v1.2.3", published_at: null, body: "  ", name: "  " });
      expect(draft?.version).toBe("1.2.3");
      expect(draft?.date).toBe(new Date(0).toISOString());
      expect(draft?.url).toContain("/releases/tag/v1.2.3");
      expect(draft?.summary).toMatch(/was published/);
      expect(draft?.title).toMatch(/1\.2\.3/);
    }
  });

  it("classifies security, LTS, beta, and rc tags and skips drafts", () => {
    const [security] = parseGithubReleases("node", {
      tag_name: "v9.0.0",
      name: "Security update",
      body: "This is an LTS line",
      html_url: "https://example.com/security",
    });
    expect(security?.type).toBe("security");
    expect(security?.tags).toEqual(["node", "security"]);

    const [lts] = parseGithubReleases("node", { tag_name: "v8.0.0", name: "LTS", body: "ok" });
    expect(lts?.type).toBe("lts");
    expect(lts?.tags).toEqual(expect.arrayContaining(["lts"]));

    const [beta] = parseGithubReleases("typescript", {
      tag_name: "v5.1.0-beta",
      prerelease: true,
      published_at: "2026-10-01T00:00:00.000Z",
    });
    expect(beta?.tags).toContain("beta");
    expect(beta?.tags).not.toContain("stable");

    const [rc] = parseGithubReleases("typescript", { tag_name: "v5.1.0-rc", prerelease: true });
    expect(rc?.tags).toContain("rc");

    expect(parseGithubReleases("typescript", { tag_name: "v5.0.0-insiders.1", prerelease: true })).toEqual([]);
    expect(parseGithubReleases("nextjs", [null, { draft: true, tag_name: "v1.0.0" }, "nope"])).toEqual([]);
    expect(parseGithubReleases("mdn-bcd", { tag_name: "v8.0.0" })[0]?.tags).toContain("mdn");
  });

  it("parses Atom links, drops incomplete items, and rejects broken XML", () => {
    const items = parseFeed(fixture("typescript/feed.xml"));
    expect(items).toHaveLength(1);
    expect(items[0]?.url).toBe("https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/");
    expect(parseFeed(fixture("shared/not-xml.txt"))).toEqual([]);
    expect(parseFeed("")).toEqual([]);
    expect(() => parseFeed(fixture("shared/unclosed.xml"))).toThrow();
    expect(slugKey("Hello, TypeScript 7.0!")).toBe("hello-typescript-7-0");
    expect(slugKey("***")).toBe("untitled");
    expect(slugKey("a".repeat(200))).toHaveLength(80);

    const attributed = parseFeed(`<?xml version="1.0"?>
      <rss version="2.0"><channel><item>
        <title type="html">Cache Components</title>
        <link>https://example.com/cache</link>
        <pubDate>Wed, 28 Oct 2026 00:00:00 GMT</pubDate>
        <description type="html">Notes</description>
      </item></channel></rss>`);
    expect(attributed[0]?.title).toBe("Cache Components");
    expect(attributed[0]?.summary).toBe("Notes");
  });
});

describe("source diff helpers", () => {
  it("covers Can I Use branches that are not support flips", () => {
    const drafts = diffCaniuse(
      null,
      { data: { grid: { title: "  ", stats: { firefox: { "1": "y" } } } } },
      meta,
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.title).toBe("grid");
    expect(
      diffCaniuse(
        { data: { grid: { title: "Grid", stats: { firefox: { "1": "y", "2": "p" } } } } },
        { data: { grid: { title: "Grid", stats: { firefox: { "1": "n", "2": "n", "3": "y" } } } } },
        meta,
      ),
    ).toEqual([]);
  });

  it("covers BCD section, collection, and non-ship diffs", () => {
    expect(sectionItems("no headings here", "Additions")).toEqual([]);
    expect(collectCompat(null)).toEqual([]);
    expect(collectCompat({ skip: "text", child: { "__compat": { support: {} } } })).toHaveLength(1);
    const drafts = diffBcd(
      { api: { Example: { __compat: { support: { chrome: { version_added: "1" }, firefox: { version_added: false } } } } } },
      {
        api: {
          Example: {
            __compat: {
              support: {
                chrome: { version_added: "2" },
                firefox: { version_added: "" },
                safari: { version_added: true },
              },
            },
          },
        },
      },
      meta,
    );
    expect(drafts).toEqual([]);
  });

  it("selects Node releases and the active LTS codename", () => {
    const releases: NodeDistRelease[] = [
      { version: "v2.0.0", date: "2026-02-01", lts: false },
      { version: "v1.0.0", date: "2026-01-01", lts: false },
    ];
    expect(selectNewNodeReleases(releases, "v9.9.9", 1).map((release) => release.version)).toEqual(["v2.0.0"]);
    expect(selectNewNodeReleases(releases, "v2.0.0")).toEqual([]);
    expect(() => parseNodeIndex({ nope: true })).toThrow(/must be an array/);
    const [security] = parseNodeIndex([{ version: "v1.2.3", date: "2026-01-01", lts: false, security: true }], {
      previousVersion: null,
      firstRunLimit: 5,
    });
    expect(security?.type).toBe("security");
    expect(security?.summary).not.toContain("npm");
    expect(security?.summary).toContain("Security release.");
    expect(currentLts(null)).toBeNull();
    expect(currentLts({ v1: "nope", v2: { codename: "X" } })).toBeNull();
    expect(
      currentLts(
        { v30: { lts: "2027-01-01", end: "2028-01-01", codename: "Future" } },
        new Date("2026-10-31T00:00:00.000Z"),
      ),
    ).toBeNull();
    expect(
      currentLts(
        {
          ended: { lts: "2020-01-01", end: "2021-01-01", codename: "Old" },
          open: { lts: "2026-01-01", codename: "Open" },
        },
        new Date("2026-10-31T00:00:00.000Z"),
      )?.codename,
    ).toBe("Open");
  });

  it("ignores nightly TypeScript builds and missing publish times", () => {
    expect(isNightlyTypeScript("7.1.0-dev.20261031.1")).toBe(true);
    expect(isNightlyTypeScript("7.0.2")).toBe(false);
    expect(() => parseTypeScriptPackument(null)).toThrow(/must be an object/);
    const [only] = parseTypeScriptPackument({ "dist-tags": { latest: "1.0.0", beta: "1.0.0" } });
    expect(only?.version).toBe("1.0.0");
    expect(only?.date).toBe(new Date(0).toISOString());
    expect(parseTypeScriptPackument({ "dist-tags": { next: "1.0.0-dev.1" } })).toEqual([]);
  });
});
