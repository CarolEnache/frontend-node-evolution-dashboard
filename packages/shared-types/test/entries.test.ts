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

  it("exposes a failed check separately from the last successful fetch", () => {
    const node = snapshotSources(
      [
        entry({
          id: "lts",
          title: "LTS",
          source: "node",
          type: "lts",
          version: "26.13.0",
          date: "2026-10-28T00:00:00.000Z",
          tags: ["lts"],
        }),
      ],
      [
        {
          source: "node",
          url: "https://nodejs.org/dist/index.json",
          version: "26.13.0",
          etag: '"seed-node"',
          lastSuccessAt: "2026-10-31T00:00:00.000Z",
          lastFetchedAt: "2026-11-14T12:00:00.000Z",
          lastError: "fetch failed",
          status: "error",
        },
      ],
    ).find((item) => item.source === "node");
    expect(node?.lastSuccessAt).toBe("2026-10-31T00:00:00.000Z");
    expect(node?.version).toBe("26.13.0");
    expect(node?.lastCheckedAt).toBe("2026-11-14T12:00:00.000Z");
    expect(node?.status).toBe("error");
    expect(node?.lastError).toBe("fetch failed");
  });

  it("does not pick a prerelease as the preferred stable version", () => {
    const entries = [
      entry({
        id: "ts-beta",
        title: "TypeScript 7.1.0-beta",
        source: "typescript",
        type: "release",
        version: "7.1.0-beta",
        date: "2026-10-29T00:00:00.000Z",
        tags: ["beta", "typescript"],
      }),
      entry({
        id: "ts-stable",
        title: "TypeScript 7.0.2",
        source: "typescript",
        type: "release",
        version: "7.0.2",
        date: "2026-10-21T00:00:00.000Z",
        tags: ["stable", "typescript"],
      }),
      entry({
        id: "next-canary",
        title: "Next.js 16.5.0-canary.35",
        source: "nextjs",
        type: "release",
        version: "16.5.0-canary.35",
        date: "2026-10-30T00:00:00.000Z",
        tags: ["canary"],
      }),
      entry({
        id: "next-stable",
        title: "Next.js 16.4.3",
        source: "nextjs",
        type: "release",
        version: "16.4.3",
        date: "2026-10-20T00:00:00.000Z",
        tags: ["stable"],
      }),
      entry({
        id: "node-rc",
        title: "Node.js 27.0.0-rc.1",
        source: "node",
        type: "release",
        version: "27.0.0-rc.1",
        date: "2026-10-30T00:00:00.000Z",
      }),
      entry({
        id: "node-stable",
        title: "Node.js 26.13.0",
        source: "node",
        type: "release",
        version: "26.13.0",
        date: "2026-10-18T00:00:00.000Z",
      }),
      entry({
        id: "mdn-insiders",
        title: "browser-compat-data insiders",
        source: "mdn-bcd",
        type: "release",
        version: "9.0.0",
        date: "2026-10-30T00:00:00.000Z",
        tags: ["insiders"],
      }),
      entry({
        id: "mdn-stable",
        title: "browser-compat-data 8.1.7",
        source: "mdn-bcd",
        type: "release",
        version: "8.1.7",
        date: "2026-10-12T00:00:00.000Z",
      }),
      entry({
        id: "ciu-dev",
        title: "caniuse-db dev",
        source: "caniuse",
        type: "release",
        version: "1.0.30001821-dev.1",
        date: "2026-10-30T00:00:00.000Z",
      }),
      entry({
        id: "ciu-stable",
        title: "caniuse-db 1.0.30001820",
        source: "caniuse",
        type: "release",
        version: "1.0.30001820",
        date: "2026-10-11T00:00:00.000Z",
      }),
    ];
    const versions = Object.fromEntries(snapshotSources(entries, []).map((item) => [item.source, item.version]));
    expect(versions.typescript).toBe("7.0.2");
    expect(versions.nextjs).toBe("16.4.3");
    expect(versions.node).toBe("26.13.0");
    expect(versions["mdn-bcd"]).toBe("8.1.7");
    expect(versions.caniuse).toBe("1.0.30001820");
  });

  it("picks the highest Node LTS semver when a lower LTS was published later the same day", () => {
    const entries = [
      entry({
        id: "node-24",
        title: "Node.js 24.22.2 (Krypton LTS)",
        source: "node",
        type: "lts",
        version: "24.22.2",
        date: "2026-10-28T18:40:00.000Z",
        tags: ["lts", "krypton"],
      }),
      entry({
        id: "node-26",
        title: "Node.js 26.13.0 (Lithium LTS)",
        source: "node",
        type: "lts",
        version: "26.13.0",
        date: "2026-10-28T00:00:00.000Z",
        tags: ["lts", "lithium"],
      }),
      entry({
        id: "node-current",
        title: "Node.js 27.1.0",
        source: "node",
        type: "release",
        version: "27.1.0",
        date: "2026-10-28T20:00:00.000Z",
      }),
    ];
    expect(snapshotSources(entries, []).find((item) => item.source === "node")?.version).toBe("26.13.0");
  });

  it("orders multi-digit LTS segments numerically, so 24.22.10 outranks a later 24.22.9", () => {
    const entries = [
      entry({
        id: "patch-nine",
        title: "Node.js 24.22.9 (Krypton LTS)",
        source: "node",
        type: "lts",
        version: "24.22.9",
        date: "2026-10-28T18:40:00.000Z",
        tags: ["lts"],
      }),
      entry({
        id: "patch-ten",
        title: "Node.js 24.22.10 (Krypton LTS)",
        source: "node",
        type: "lts",
        version: "24.22.10",
        date: "2026-10-28T00:00:00.000Z",
        tags: ["lts"],
      }),
    ];
    expect(snapshotSources(entries, []).find((item) => item.source === "node")?.version).toBe("24.22.10");
  });

  it("keeps the TypeScript card on 7.0.2 when a later row is 7.1-beta", () => {
    const entries = [
      entry({
        id: "ts-beta",
        title: "TypeScript 7.1-beta",
        source: "typescript",
        type: "release",
        version: "7.1-beta",
        date: "2026-10-28T18:40:00.000Z",
        tags: ["beta", "typescript"],
      }),
      entry({
        id: "ts-stable",
        title: "TypeScript 7.0.2",
        source: "typescript",
        type: "release",
        version: "7.0.2",
        date: "2026-10-21T00:00:00.000Z",
        tags: ["stable", "typescript"],
      }),
    ];
    expect(snapshotSources(entries, []).find((item) => item.source === "typescript")?.version).toBe("7.0.2");
  });

  it("compares a v prefix as the same semver and breaks equal versions by publish time", () => {
    const prefixedLowerLine = [
      entry({
        id: "low",
        title: "Node.js v24.22.2 (Krypton LTS)",
        source: "node",
        type: "lts",
        version: "v24.22.2",
        date: "2026-10-28T18:40:00.000Z",
        tags: ["lts"],
      }),
      entry({
        id: "high",
        title: "Node.js 26.13.0 (Lithium LTS)",
        source: "node",
        type: "lts",
        version: "26.13.0",
        date: "2026-10-28T00:00:00.000Z",
        tags: ["lts"],
      }),
      entry({
        id: "short",
        title: "Node.js 26",
        source: "node",
        type: "lts",
        version: "26",
        date: "2026-10-28T21:00:00.000Z",
        tags: ["lts"],
      }),
    ];
    expect(snapshotSources(prefixedLowerLine, []).find((item) => item.source === "node")?.version).toBe("26.13.0");

    const sameSemver = [
      entry({
        id: "prefixed",
        title: "Node.js v26.13.0",
        source: "node",
        type: "lts",
        version: "v26.13.0",
        date: "2026-10-28T00:00:00.000Z",
        tags: ["lts"],
      }),
      entry({
        id: "plain",
        title: "Node.js 26.13.0",
        source: "node",
        type: "lts",
        version: "26.13.0",
        date: "2026-10-28T18:40:00.000Z",
        tags: ["lts"],
      }),
    ];
    expect(snapshotSources(sameSemver, []).find((item) => item.source === "node")?.version).toBe("26.13.0");
  });

  it("picks the highest stable semver when a lower release was published later", () => {
    const entries = [
      entry({
        id: "ts-old-line",
        title: "TypeScript 5.9.3",
        source: "typescript",
        type: "release",
        version: "5.9.3",
        date: "2026-10-28T18:40:00.000Z",
        tags: ["stable", "typescript"],
      }),
      entry({
        id: "ts-stable",
        title: "TypeScript 7.0.2",
        source: "typescript",
        type: "release",
        version: "7.0.2",
        date: "2026-10-21T00:00:00.000Z",
        tags: ["stable", "typescript"],
      }),
      entry({
        id: "next-old",
        title: "Next.js 15.5.0",
        source: "nextjs",
        type: "release",
        version: "15.5.0",
        date: "2026-10-30T00:00:00.000Z",
        tags: ["stable"],
      }),
      entry({
        id: "next-current",
        title: "Next.js 16.4.3",
        source: "nextjs",
        type: "release",
        version: "16.4.3",
        date: "2026-10-20T00:00:00.000Z",
        tags: ["stable"],
      }),
      entry({
        id: "mdn-old",
        title: "browser-compat-data 8.0.1",
        source: "mdn-bcd",
        type: "release",
        version: "8.0.1",
        date: "2026-10-30T00:00:00.000Z",
      }),
      entry({
        id: "mdn-current",
        title: "browser-compat-data 8.1.7",
        source: "mdn-bcd",
        type: "release",
        version: "8.1.7",
        date: "2026-10-12T00:00:00.000Z",
      }),
    ];
    const versions = Object.fromEntries(snapshotSources(entries, []).map((item) => [item.source, item.version]));
    expect(versions.typescript).toBe("7.0.2");
    expect(versions.nextjs).toBe("16.4.3");
    expect(versions["mdn-bcd"]).toBe("8.1.7");
  });
});
