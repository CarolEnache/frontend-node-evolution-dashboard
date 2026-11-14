import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDb } from "@evolution/db";
import { snapshotSources, type Entry } from "@evolution/shared-types";
import { describe, expect, it, vi } from "vitest";
import { GET } from "../src/app/api/entries/route";
import {
  SOURCE_CARD_LIMIT,
  TIMELINE_LIMIT,
  dashboardCacheKey,
  loadDashboard,
  loadFilteredEntries,
  loadSourceCardEntries,
} from "../src/lib/entries";
import { queryTimeline, queryWorthLearning } from "../src/lib/queries";

const NOW = Date.parse("2026-11-14T00:00:00.000Z");

function entry(overrides: Partial<Entry> & Pick<Entry, "id" | "source" | "title" | "date">): Entry {
  return {
    type: "feature",
    url: "https://example.com/entry",
    summary: overrides.title,
    tags: [],
    raw: null,
    ...overrides,
  };
}

describe("rows behind the timeline cap", () => {
  it("returns old source rows from filtered views, the entries API, and per-source summary cards", async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "evolution-cap-")), "dashboard.sqlite");
    vi.stubEnv("DATABASE_URL", `file:${file}`);
    const db = await createDb(`file:${file}`);
    const fillers = Array.from({ length: TIMELINE_LIMIT + 1 }, (_, index) =>
      entry({
        id: `mdn-bcd:feature:filler-${index}`,
        source: "mdn-bcd",
        title: `Filler feature ${index}`,
        date: new Date(Date.parse("2026-11-01T00:00:00.000Z") + index * 1000).toISOString(),
        tags: ["filler"],
      }),
    );
    const buried = [
      entry({
        id: "node:lts:12.22.12",
        source: "node",
        type: "lts",
        title: "Node.js 12.22.12",
        version: "12.22.12",
        date: "2020-04-01T00:00:00.000Z",
        tags: ["lts", "node"],
      }),
      entry({
        id: "typescript:release:4.9.5",
        source: "typescript",
        type: "release",
        title: "TypeScript 4.9.5",
        version: "4.9.5",
        date: "2020-05-01T00:00:00.000Z",
        tags: ["stable", "typescript"],
      }),
      entry({
        id: "nextjs:release:12.3.0",
        source: "nextjs",
        type: "release",
        title: "Next.js 12.3.0",
        version: "12.3.0",
        date: "2020-06-01T00:00:00.000Z",
        tags: ["stable", "nextjs"],
      }),
    ];
    try {
      await db.upsertEntries([...fillers, ...buried]);
      expect(await db.countEntries()).toBe(TIMELINE_LIMIT + 1 + buried.length);
    } finally {
      await db.close();
    }

    const key = dashboardCacheKey();
    const capped = await loadDashboard(key);
    expect(capped.entries).toHaveLength(TIMELINE_LIMIT);
    expect(capped.entries.some((item) => item.source === "node")).toBe(false);

    const nodeFilter = { source: "node" as const, from: "2020-04-01", to: "2020-04-01" };
    const nodeEntries = await loadFilteredEntries(key, nodeFilter);
    expect(queryTimeline(nodeEntries, nodeFilter).map((item) => item.id)).toEqual(["node:lts:12.22.12"]);
    expect(queryWorthLearning(nodeEntries, nodeFilter, NOW).map((item) => item.entry.id)).toEqual(["node:lts:12.22.12"]);

    const dated = await GET(new Request("http://localhost/api/entries?from=2020-01-01&to=2020-12-31"));
    expect((await dated.json()).entries.map((item: Entry) => item.id)).toEqual([
      "nextjs:release:12.3.0",
      "typescript:release:4.9.5",
      "node:lts:12.22.12",
    ]);
    const typescript = await GET(new Request("http://localhost/api/entries?source=typescript"));
    expect((await typescript.json()).entries.map((item: Entry) => item.id)).toEqual(["typescript:release:4.9.5"]);

    const cards = snapshotSources(await loadSourceCardEntries(key), []);
    expect(cards.find((item) => item.source === "node")?.version).toBe("12.22.12");
    expect(cards.find((item) => item.source === "typescript")?.version).toBe("4.9.5");
    expect(cards.find((item) => item.source === "nextjs")?.version).toBe("12.3.0");
    expect(SOURCE_CARD_LIMIT).toBeGreaterThan(0);
    expect(SOURCE_CARD_LIMIT).toBeLessThan(TIMELINE_LIMIT);
  });
});
