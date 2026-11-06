import { describe, expect, it } from "vitest";
import {
  activeWorthLearningStrategy,
  enrichmentWorthLearningStrategy,
  heuristicWorthLearningStrategy,
  type Entry,
  type WorthLearningStrategy,
} from "../src/index";

const NOW = Date.parse("2026-10-31T00:00:00.000Z");

function entry(overrides: Partial<Entry> & Pick<Entry, "id" | "title" | "date">): Entry {
  return {
    source: "node",
    type: "release",
    url: "https://example.com",
    summary: overrides.title,
    tags: [],
    raw: null,
    ...overrides,
  };
}

function ids(strategy: WorthLearningStrategy, entries: Entry[], windowDays?: number | null) {
  return strategy
    .select(entries, { now: NOW, ...(windowDays === undefined ? {} : { windowDays }) })
    .map((item) => item.entry.id);
}

describe("heuristic worth-learning strategy", () => {
  it("is the active strategy until enrichment replaces it", () => {
    expect(heuristicWorthLearningStrategy.id).toBe("heuristic");
    expect(enrichmentWorthLearningStrategy.id).toBe("enrichment");
    expect(activeWorthLearningStrategy).toBe(heuristicWorthLearningStrategy);
  });

  it("flags security, LTS, baseline, support changes, and stable major or minor releases", () => {
    const security = entry({
      id: "security",
      title: "Security",
      type: "security",
      date: "2026-10-23T00:00:00.000Z",
    });
    const lts = entry({
      id: "lts",
      title: "LTS",
      type: "lts",
      tags: ["lts"],
      date: "2026-10-28T00:00:00.000Z",
    });
    const baseline = entry({
      id: "baseline",
      title: "Baseline",
      source: "mdn-bcd",
      type: "feature",
      tags: ["Baseline"],
      date: "2026-10-25T00:00:00.000Z",
    });
    const support = entry({
      id: "support",
      title: "Support",
      source: "caniuse",
      type: "support-change",
      date: "2026-10-19T00:00:00.000Z",
    });
    const major = entry({
      id: "major",
      title: "Major",
      source: "nextjs",
      type: "release",
      version: "16.0.0",
      tags: ["stable"],
      date: "2026-10-30T00:00:00.000Z",
    });
    const minor = entry({
      id: "minor",
      title: "Minor",
      source: "typescript",
      type: "release",
      version: "7.1.0",
      date: "2026-10-27T00:00:00.000Z",
    });
    const patch = entry({
      id: "patch",
      title: "Patch",
      source: "nextjs",
      type: "release",
      version: "16.4.3",
      tags: ["stable"],
      date: "2026-10-28T00:00:00.000Z",
    });
    const preview = entry({
      id: "preview",
      title: "Preview",
      source: "typescript",
      type: "release",
      version: "7.1.0-beta",
      tags: ["beta"],
      date: "2026-10-29T00:00:00.000Z",
    });
    const article = entry({
      id: "article",
      title: "Article",
      source: "nextjs",
      type: "article",
      date: "2026-10-26T00:00:00.000Z",
    });

    const ranked = heuristicWorthLearningStrategy.select(
      [patch, article, preview, minor, major, support, baseline, lts, security],
      { now: NOW },
    );

    expect(ranked.map((item) => item.entry.id)).toEqual([
      "baseline",
      "security",
      "major",
      "lts",
      "minor",
      "support",
    ]);
    expect(ranked.map((item) => item.score)).toEqual([72, 52, 50, 49, 38, 36]);
    expect(ranked.find((item) => item.entry.id === "baseline")?.reasons).toEqual([
      "Baseline status",
      "Platform feature",
    ]);
    expect(ranked.find((item) => item.entry.id === "security")?.reasons).toEqual(["Security release"]);
    expect(ranked.find((item) => item.entry.id === "major")?.reasons).toEqual(["Stable major release"]);
    expect(ranked.find((item) => item.entry.id === "lts")?.reasons).toEqual(["LTS release"]);
    expect(ranked.find((item) => item.entry.id === "minor")?.reasons).toEqual(["Stable minor release"]);
    expect(ranked.find((item) => item.entry.id === "support")?.reasons).toEqual(["Browser support change"]);
  });

  it("uses source weight only to order entries that already cleared the signal bar", () => {
    const mdn = entry({
      id: "mdn",
      title: "MDN support",
      source: "mdn-bcd",
      type: "support-change",
      date: "2026-10-20T00:00:00.000Z",
    });
    const next = entry({
      id: "next",
      title: "Next support",
      source: "nextjs",
      type: "support-change",
      date: "2026-10-20T00:00:00.000Z",
    });
    const ranked = heuristicWorthLearningStrategy.select([next, mdn], { now: NOW });
    expect(ranked.map((item) => item.entry.id)).toEqual(["mdn", "next"]);
    expect(ranked[0]?.score).toBe(ranked[1]!.score + 3);
  });

  it("keeps the 30-day window inclusive and lets the caller turn it off", () => {
    const onEdge = entry({
      id: "edge",
      title: "Edge",
      type: "security",
      date: "2026-10-01T00:00:00.000Z",
    });
    const outside = entry({
      id: "outside",
      title: "Outside",
      type: "security",
      date: "2026-09-30T00:00:00.000Z",
    });
    expect(ids(heuristicWorthLearningStrategy, [outside, onEdge])).toEqual(["edge"]);
    expect(ids(heuristicWorthLearningStrategy, [outside, onEdge], null)).toEqual(["edge", "outside"]);
  });

  it("ignores gap and similarity so rows from ingestion still rank", () => {
    const untagged = entry({
      id: "untagged",
      title: "Untagged security",
      type: "security",
      date: "2026-10-30T00:00:00.000Z",
    });
    const familiar = entry({
      id: "familiar",
      title: "Familiar security",
      type: "security",
      date: "2026-10-29T00:00:00.000Z",
      gap: "already-know",
      similarity: 0.99,
      worthLearning: "This copy comes from a later summary step.",
    });
    const ranked = heuristicWorthLearningStrategy.select([familiar, untagged], { now: NOW });
    expect(ranked.map((item) => item.entry.id)).toEqual(["untagged", "familiar"]);
    expect(ranked.every((item) => item.reasons.includes("Security release"))).toBe(true);
    expect(enrichmentWorthLearningStrategy.select([familiar, untagged], { now: NOW })).toEqual([]);
  });

  it("stacks security with a stable major and treats an LTS tag as LTS once", () => {
    const stacked = entry({
      id: "stacked",
      title: "Stacked",
      type: "security",
      version: "22.0.0",
      date: "2026-10-31T00:00:00.000Z",
    });
    const tagged = entry({
      id: "tagged",
      title: "Tagged LTS",
      type: "release",
      version: "26.13.1",
      tags: ["lts"],
      date: "2026-10-31T00:00:00.000Z",
    });
    const ranked = heuristicWorthLearningStrategy.select([tagged, stacked], { now: NOW });
    expect(ranked.find((item) => item.entry.id === "stacked")?.reasons).toEqual([
      "Security release",
      "Stable major release",
    ]);
    expect(ranked.find((item) => item.entry.id === "stacked")?.score).toBe(83);
    expect(ranked.find((item) => item.entry.id === "tagged")?.reasons).toEqual(["LTS release"]);
    expect(ranked.find((item) => item.entry.id === "tagged")?.score).toBe(51);
  });

  it("does not mutate the input list", () => {
    const first = entry({ id: "a", title: "A", type: "security", date: "2026-10-01T00:00:00.000Z" });
    const second = entry({ id: "b", title: "B", type: "security", date: "2026-10-30T00:00:00.000Z" });
    const input = [first, second];
    heuristicWorthLearningStrategy.select(input, { now: NOW });
    expect(input.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("breaks remaining ties by newer date, then title", () => {
    const older = entry({
      id: "older",
      title: "Same",
      type: "security",
      date: "2026-10-20T00:00:00.000Z",
    });
    const alpha = entry({
      id: "alpha",
      title: "Alpha title",
      type: "security",
      date: "2026-10-20T00:00:00.000Z",
    });
    const zeta = entry({
      id: "zeta",
      title: "Zeta title",
      type: "security",
      date: "2026-10-21T00:00:00.000Z",
    });
    const sameDay = heuristicWorthLearningStrategy.select([zeta, alpha, older], { now: NOW });
    expect(sameDay.map((item) => item.entry.id)).toEqual(["zeta", "alpha", "older"]);
  });
});
