import { describe, expect, it } from "vitest";
import {
  buildEntryId,
  filterEntries,
  groupEntriesByWeek,
  parseSkillsProfile,
  selectWorthLearning,
  snapshotSources,
  versionsEqual,
  worthLearningRank,
  type Entry,
} from "../src/index";

function entry(overrides: Partial<Entry> & Pick<Entry, "id" | "title" | "date">): Entry {
  return {
    source: "nextjs",
    type: "release",
    url: "https://example.com",
    summary: overrides.title,
    tags: [],
    raw: null,
    ...overrides,
  };
}

describe("entry ids and filters", () => {
  it("builds a stable id and treats v-prefixed versions as the same key", () => {
    expect(buildEntryId("nextjs", "release", "v16.4.3")).toBe("nextjs:release:16.4.3");
    expect(versionsEqual("v26.13.0", "26.13.0")).toBe(true);
    expect(versionsEqual("8.1.6", "8.1.7")).toBe(false);
  });

  it("filters by source, tag, gap, and an inclusive date range", () => {
    const entries = [
      entry({
        id: "a",
        title: "CSS grid",
        date: "2026-10-10T00:00:00.000Z",
        source: "caniuse",
        tags: ["css"],
        gap: "new",
      }),
      entry({
        id: "b",
        title: "Node LTS",
        date: "2026-10-28T00:00:00.000Z",
        source: "node",
        tags: ["lts"],
        gap: "already-know",
      }),
    ];
    expect(filterEntries(entries, { source: "node" }).map((item) => item.id)).toEqual(["b"]);
    expect(filterEntries(entries, { tag: "css" }).map((item) => item.id)).toEqual(["a"]);
    expect(filterEntries(entries, { from: "2026-10-20", to: "2026-10-28" }).map((item) => item.id)).toEqual(["b"]);
  });

  it("rejects a skills profile without skills", () => {
    expect(parseSkillsProfile({ role: "Lead", skills: ["React"] }).skills).toEqual(["React"]);
    expect(() => parseSkillsProfile({ role: "Lead" })).toThrow(/skills/i);
  });
});

describe("worth learning", () => {
  const now = Date.parse("2026-10-31T00:00:00.000Z");

  it("keeps adjacent and new items from the last 30 days and ranks novelty above familiarity", () => {
    const recentNew = entry({
      id: "new",
      title: "New",
      date: "2026-10-29T00:00:00.000Z",
      gap: "new",
      similarity: 0.2,
    });
    const recentKnown = entry({
      id: "known",
      title: "Known",
      date: "2026-10-30T00:00:00.000Z",
      gap: "already-know",
      similarity: 0.9,
    });
    const oldAdjacent = entry({
      id: "old",
      title: "Old",
      date: "2026-08-01T00:00:00.000Z",
      gap: "adjacent",
      similarity: 0.1,
    });
    const recentAdjacent = entry({
      id: "adjacent",
      title: "Adjacent",
      date: "2026-10-20T00:00:00.000Z",
      gap: "adjacent",
      similarity: 0.6,
    });
    const selected = selectWorthLearning([recentKnown, oldAdjacent, recentAdjacent, recentNew], now);
    expect(selected.map((item) => item.id)).toEqual(["new", "adjacent"]);
    expect(worthLearningRank(recentNew)).toBeGreaterThan(worthLearningRank(recentAdjacent));
  });

  it("groups a week from Monday in UTC", () => {
    const groups = groupEntriesByWeek([
      entry({ id: "fri", title: "Friday", date: "2026-10-30T12:00:00.000Z" }),
      entry({ id: "mon", title: "Monday", date: "2026-10-26T01:00:00.000Z" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.week).toBe("2026-10-26");
    expect(groups[0]?.label).toBe("Week of 26 Oct 2026");
  });
});

describe("source snapshot", () => {
  it("prefers the Node LTS version over a newer alpha", () => {
    const entries = [
      entry({
        id: "alpha",
        title: "Alpha",
        source: "node",
        type: "release",
        version: "27.0.0-alpha",
        date: "2026-10-29T00:00:00.000Z",
      }),
      entry({
        id: "lts",
        title: "LTS",
        source: "node",
        type: "lts",
        version: "26.13.0",
        date: "2026-10-28T00:00:00.000Z",
        tags: ["lts"],
      }),
    ];
    const node = snapshotSources(entries, [
      {
        source: "node",
        url: "https://nodejs.org/dist/index.json",
        version: "27.0.0-alpha",
        lastSuccessAt: "2026-10-31T00:00:00.000Z",
      },
    ]).find((item) => item.source === "node");
    expect(node?.version).toBe("26.13.0");
    expect(node?.lastSuccessAt).toBe("2026-10-31T00:00:00.000Z");
  });
});
