import { describe, expect, it } from "vitest";
import { buildSeedEntries, isSourceCatalogEntry, SEED_ENTRY_COUNT } from "../src/seed-data";

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

  it("gives every entry an https URL", () => {
    for (const entry of entries) {
      expect(entry.url.startsWith("https://"), entry.id).toBe(true);
    }
  });
});
