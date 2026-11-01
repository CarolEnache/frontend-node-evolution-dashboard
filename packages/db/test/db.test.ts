import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/index";

describe("sqlite database", () => {
  it("ships a drizzle migration that creates the shared tables", () => {
    const sql = readFileSync(new URL("../migrations/sqlite/0000_init.sql", import.meta.url), "utf8");
    const journal = JSON.parse(
      readFileSync(new URL("../migrations/sqlite/meta/_journal.json", import.meta.url), "utf8"),
    ) as { dialect: string; entries: Array<{ tag: string }> };
    expect(journal.dialect).toBe("sqlite");
    expect(journal.entries.map((entry) => entry.tag)).toEqual(["0000_init"]);
    expect(sql).toContain("CREATE TABLE `entries`");
    expect(sql).toContain("CREATE TABLE `source_state`");
    expect(sql).toContain("CREATE TABLE `embeddings`");
    expect(sql).not.toContain("USING btree");
  });

  it("migrates, seeds, filters, and round-trips an embedding cache", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "evolution-"));
    const db = await createDb(`file:${path.join(dir, "test.sqlite")}`);
    try {
      await db.migrate();
      await db.seed(new Date("2026-10-31T00:00:00.000Z"));
      expect(await db.countEntries()).toBe(10);
      const css = await db.listEntries({ tag: "css" });
      expect(css.map((entry) => entry.source).sort()).toEqual(["caniuse", "mdn-bcd"]);
      const node = await db.listEntries({ source: "node", gap: "new" });
      expect(node.every((entry) => entry.source === "node" && entry.gap === "new")).toBe(true);
      await db.setVector("entry:1", "BAAI/bge-small-en-v1.5", [0.1, 0.2]);
      await db.setSummary("entry:1", "meta-llama/Llama-3.1-8B-Instruct", "Learn this.");
      expect(await db.getVector("entry:1", "BAAI/bge-small-en-v1.5")).toEqual([0.1, 0.2]);
      expect(await db.getSummary("entry:1", "meta-llama/Llama-3.1-8B-Instruct")).toBe("Learn this.");
      await db.seed(new Date("2026-10-31T00:00:00.000Z"));
      expect(await db.countEntries()).toBe(10);
    } finally {
      await db.close();
    }
  });

  it("migrates an in-memory database", async () => {
    const db = await createDb(":memory:");
    try {
      expect(db.dialect).toBe("sqlite");
      await db.seed(new Date("2026-10-31T00:00:00.000Z"));
      expect(await db.countEntries()).toBe(10);
      const states = await db.listSourceStates("node");
      expect(states.length).toBeGreaterThan(0);
    } finally {
      await db.close();
    }
  });
});
