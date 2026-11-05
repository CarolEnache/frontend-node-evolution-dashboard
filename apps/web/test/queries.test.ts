import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDb } from "@evolution/db";
import type { Entry, WorthLearningOptions, WorthLearningStrategy } from "@evolution/shared-types";
import { describe, expect, it } from "vitest";
import { hrefWith } from "../src/lib/filters";
import { queryTimeline, queryWorthLearning } from "../src/lib/queries";

const NOW = Date.parse("2026-10-31T00:00:00.000Z");

function entry(overrides: Partial<Entry> & Pick<Entry, "id" | "title" | "date">): Entry {
  return {
    source: "node",
    type: "security",
    url: "https://example.com",
    summary: overrides.title,
    tags: [],
    raw: null,
    ...overrides,
  };
}

describe("timeline and worth-learning queries", () => {
  const recent = entry({ id: "recent", title: "Recent security", date: "2026-10-20T00:00:00.000Z" });
  const stale = entry({ id: "stale", title: "Stale security", date: "2026-08-01T00:00:00.000Z" });
  const other = entry({
    id: "other",
    title: "Other security",
    source: "typescript",
    date: "2026-10-21T00:00:00.000Z",
  });

  it("returns the timeline newest first for a source and inclusive date range", () => {
    const timeline = queryTimeline([stale, other, recent], {
      source: "node",
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(timeline.map((item) => item.id)).toEqual(["recent"]);
  });

  it("keeps the heuristic window unless the caller set a date range", () => {
    expect(queryWorthLearning([recent, stale, other], { source: "node" }, NOW).map((item) => item.entry.id)).toEqual([
      "recent",
    ]);

    let seen: WorthLearningOptions | undefined;
    const strategy: WorthLearningStrategy = {
      id: "stub",
      select(entries, options) {
        seen = options;
        return entries.map((item) => ({ entry: item, score: 1, signal: 1, reasons: ["Stub"] }));
      },
    };
    const ranked = queryWorthLearning([recent, stale], { from: "2026-08-01", to: "2026-08-02" }, NOW, strategy);
    expect(ranked.map((item) => item.entry.id)).toEqual(["stale"]);
    expect(seen).toMatchObject({ now: NOW, windowDays: null });
  });

  it("leaves the strategy window untouched when no date range is set", () => {
    let seen: WorthLearningOptions | undefined;
    const strategy: WorthLearningStrategy = {
      id: "stub",
      select(_entries, options) {
        seen = options;
        return [];
      },
    };
    queryWorthLearning([recent], {}, NOW, strategy);
    expect(seen?.windowDays).toBeUndefined();
    expect(seen?.now).toBe(NOW);
  });

  it("builds filter links that stay on the current view", () => {
    expect(hrefWith({ source: "node" }, { from: "2026-10-01" }, "/worth-learning")).toBe(
      "/worth-learning?source=node&from=2026-10-01",
    );
    expect(hrefWith({ source: "node" }, { source: null })).toBe("/");
  });

  it("reads a seeded sqlite file into both views", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "evolution-dashboard-"));
    const db = await createDb(`file:${path.join(dir, "dashboard.sqlite")}`);
    try {
      await db.seed(new Date(NOW));
      const entries = await db.listEntries({ limit: 1000 });
      const timeline = queryTimeline(entries, {});
      expect(new Set(timeline.map((item) => item.source))).toEqual(
        new Set(["mdn-bcd", "caniuse", "node", "typescript", "nextjs"]),
      );
      expect(timeline.map((item) => item.id)[0]).toBe("node:release:27.0.0-alpha");
      expect(timeline.at(-1)?.id).toBe("nextjs:release:15.5.0");
      expect(timeline.every((item, index) => index === 0 || item.date <= timeline[index - 1]!.date)).toBe(true);

      const worth = queryWorthLearning(entries, {}, NOW);
      expect(worth.map((item) => item.entry.id)).toEqual([
        "mdn-bcd:feature:css.properties.overflow-clip-margin",
        "node:lts:26.13.0",
        "node:security:26.12.1",
        "caniuse:support-change:css-grid:firefox:120",
      ]);
      expect(worth.map((item) => item.entry.id)).not.toContain("nextjs:release:15.5.0");
      expect(worth.map((item) => item.entry.id)).not.toContain("typescript:release:7.1.0-beta");
      expect(worth.map((item) => item.entry.id)).not.toContain("nextjs:release:16.4.3");
    } finally {
      await db.close();
    }
  });
});
