import { describe, expect, it } from "vitest";
import { buildSeedEntries, isSourceCatalogEntry, NEXTJS_RELEASE_SUMMARY_MARKDOWN, SEED_ENTRY_COUNT } from "../src/seed-data";

const GENERIC_INDEX_PATHS = new Set(["", "/", "/blog", "/en/blog", "/releases"]);

function pathnameOf(url: string): string {
  const path = new URL(url).pathname.replace(/\/+$/, "");
  return path === "" ? "/" : path;
}

describe("seed entry links", () => {
  const entries = buildSeedEntries(new Date("2026-10-31T00:00:00.000Z"));

  it("keeps a stable seed size with unique ids", () => {
    expect(entries).toHaveLength(SEED_ENTRY_COUNT);
    expect(SEED_ENTRY_COUNT).toBe(23);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
  });

  it("does not point feature or release cards at a bare generic index", () => {
    const generic = entries.filter((entry) => {
      if (isSourceCatalogEntry(entry)) return false;
      return GENERIC_INDEX_PATHS.has(pathnameOf(entry.url));
    });
    expect(generic.map((entry) => `${entry.id} ${entry.url}`)).toEqual([]);
  });

  it("stores the Next.js release note as the plain text ingest would keep", () => {
    const release = entries.find((entry) => entry.id === "nextjs:release:16.4.3");
    expect(NEXTJS_RELEASE_SUMMARY_MARKDOWN).toContain("> [!NOTE]");
    expect(NEXTJS_RELEASE_SUMMARY_MARKDOWN).toContain("**not**");
    expect(NEXTJS_RELEASE_SUMMARY_MARKDOWN).toContain("[upgrade guide](https://nextjs.org/");
    expect(release?.summary).toBe(
      "This release is backporting bug fixes. It does not include all pending features/changes on canary. Core Changes Stable Next.js 16.4.3. Turbopack is the default for dev and build. Fix RSC navigation and runtime prefetches in next start. See the upgrade guide.",
    );
  });

  it("gives every entry an https URL", () => {
    for (const entry of entries) {
      expect(entry.url.startsWith("https://"), entry.id).toBe(true);
    }
  });
});
