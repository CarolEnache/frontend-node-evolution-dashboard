import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Entry } from "@evolution/shared-types";
import { assertNotNeonDatabase, cleanupNodeAlphaEntries } from "../src/cleanup-node-alphas";
import { createDb } from "../src/index";

function entry(overrides: Partial<Entry> & Pick<Entry, "id" | "title" | "date">): Entry {
  return {
    source: "node",
    type: "release",
    url: "https://nodejs.org/en/blog/release/v27.0.0-alpha",
    summary: overrides.title,
    tags: ["node"],
    raw: null,
    ...overrides,
  };
}

async function tempDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "evolution-alpha-"));
  return createDb(`file:${path.join(dir, "test.sqlite")}`);
}

describe("node alpha id cleanup", () => {
  it("refuses Neon urls and hosted app environments", () => {
    expect(() => assertNotNeonDatabase("postgresql://user:pw@ep-prod.us-east-2.aws.neon.tech/neondb")).toThrow(/Neon/);
    expect(() => assertNotNeonDatabase("postgresql://user:pw@127.0.0.1/evolution", "production")).toThrow(/Neon/);
    expect(() => assertNotNeonDatabase("file:/tmp/local.sqlite")).not.toThrow();
    expect(() => assertNotNeonDatabase("postgresql://user:pw@127.0.0.1:5432/evolution")).not.toThrow();
  });

  it("merges orphaned alpha builds into the canonical row on SQLite and keeps enrichment", async () => {
    const db = await tempDb();
    try {
      await db.upsertEntries([
        entry({
          id: "node:release:27.0.0-alpha",
          version: "27.0.0-alpha",
          title: "Node.js 27.0.0-alpha",
          date: "2026-11-12T00:00:00.000Z",
          gap: "already-know",
          similarity: 0.8,
          worthLearning: "Note the alpha only.",
          tags: ["node"],
        }),
        entry({
          id: "node:release:27.0.0-alpha.0.0.0",
          version: "27.0.0-alpha.0.0.0",
          title: "Node.js v27.0.0-alpha.0.0.0",
          date: "2026-10-29T00:00:00.000Z",
          gap: "new",
          worthLearning: "from the orphan",
          tags: ["node", "old"],
        }),
        entry({
          id: "node:release:27.0.0-alpha.0.1.0",
          version: "27.0.0-alpha.0.1.0",
          title: "Node.js v27.0.0-alpha.0.1.0",
          date: "2026-11-12T00:00:00.000Z",
          similarity: 0.2,
        }),
        entry({
          id: "node:security:26.13.1",
          type: "security",
          version: "26.13.1",
          title: "Node.js 26.13.1",
          date: "2026-11-10T00:00:00.000Z",
          gap: "new",
        }),
      ]);

      const preview = await cleanupNodeAlphaEntries(db);
      expect(preview.dryRun).toBe(true);
      expect(preview.changes.map((change) => change.from).sort()).toEqual([
        "node:release:27.0.0-alpha.0.0.0",
        "node:release:27.0.0-alpha.0.1.0",
      ]);
      expect((await db.listEntries({ source: "node", limit: 20 })).map((row) => row.id)).toContain(
        "node:release:27.0.0-alpha.0.0.0",
      );

      const applied = await cleanupNodeAlphaEntries(db, { apply: true });
      expect(applied.dryRun).toBe(false);
      const rows = await db.listEntries({ source: "node", limit: 20 });
      const alpha = rows.find((row) => row.id === "node:release:27.0.0-alpha");
      expect(rows.map((row) => row.id).sort()).toEqual(["node:release:27.0.0-alpha", "node:security:26.13.1"]);
      expect(alpha?.gap).toBe("already-know");
      expect(alpha?.similarity).toBe(0.8);
      expect(alpha?.worthLearning).toBe("Note the alpha only.");
      expect(alpha?.tags).toEqual(expect.arrayContaining(["node", "old"]));
    } finally {
      await db.close();
    }
  });

  it("renames a lone orphan when the canonical id is missing", async () => {
    const db = await tempDb();
    try {
      await db.upsertEntries([
        entry({
          id: "node:release:27.0.0-alpha.0.1.0",
          version: "27.0.0-alpha.0.1.0",
          title: "Node.js v27.0.0-alpha.0.1.0",
          date: "2026-11-12T00:00:00.000Z",
          gap: "new",
          worthLearning: "kept from the build id",
        }),
      ]);
      await cleanupNodeAlphaEntries(db, { apply: true });
      const [row] = await db.listEntries({ source: "node", limit: 10 });
      expect(row?.id).toBe("node:release:27.0.0-alpha");
      expect(row?.version).toBe("27.0.0-alpha");
      expect(row?.title).toBe("Node.js v27.0.0-alpha");
      expect(row?.worthLearning).toBe("kept from the build id");
      expect(row?.gap).toBe("new");
    } finally {
      await db.close();
    }
  });
});
