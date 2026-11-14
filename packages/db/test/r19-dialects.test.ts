import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { describe, expect, it } from "vitest";
import type { Entry } from "@evolution/shared-types";
import { createDb } from "../src/index";

const PG = process.env.R_PG_URL;
const e = (o: Partial<Entry>): Entry => ({
  id: "node:security:26.12.1",
  source: "node",
  type: "security",
  title: "Node 26.12.1",
  date: "2026-10-23T00:00:00.000Z",
  url: "https://example.com",
  summary: "s",
  tags: ["node"],
  raw: null,
  ...o,
});

async function fresh(dialect: string) {
  if (dialect === "sqlite") return createDb(`file:${path.join(mkdtempSync(path.join(tmpdir(), "r19-")), "t.sqlite")}`);
  if (!PG) throw new Error("R_PG_URL is required for the postgres case");
  const admin = new pg.Client({ connectionString: PG });
  await admin.connect();
  const name = `r19_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await admin.query(`create database ${name}`);
  await admin.end();
  const db = await createDb(PG.replace(/\/[^/]*$/, `/${name}`));
  await db.migrate();
  return db;
}

const dialects = ["sqlite", ...(PG ? (["postgres"] as const) : [])];

describe.each(dialects)("%s preserveEnrichment", (dialect) => {
  it("keeps gap/similarity/worthLearning on unenriched upsert and replaces on enriched", async () => {
    const db = await fresh(dialect);
    try {
      await db.upsertEntries([e({ gap: "new", similarity: 0, worthLearning: "keep me" })]);
      await db.upsertEntries([e({ summary: "refreshed" })], { preserveEnrichment: true });
      let [row] = await db.listEntries();
      expect(row).toMatchObject({ summary: "refreshed", gap: "new", similarity: 0, worthLearning: "keep me" });
      await db.upsertEntries([e({ gap: "adjacent", similarity: 0.4, worthLearning: "new text" })]);
      [row] = await db.listEntries();
      expect(row).toMatchObject({ gap: "adjacent", similarity: 0.4, worthLearning: "new text" });
      // a later enrich that reclassifies to "known" drops worthLearning (legit null)
      await db.upsertEntries([e({ gap: "already-know", similarity: 0.9 })]);
      [row] = await db.listEntries();
      expect(row?.gap).toBe("already-know");
      expect(row?.worthLearning).toBeUndefined();
      // A paused enrich writes the raw row with no classification and no preserve flag.
      await db.upsertEntries([e({ summary: "paused refresh" })]);
      [row] = await db.listEntries();
      expect(row?.summary).toBe("paused refresh");
      expect(row?.gap).toBe("already-know");
      expect(row?.similarity).toBe(0.9);
      expect(row?.worthLearning).toBeUndefined();
      // brand new row through the preserve path inserts cleanly
      await db.upsertEntries([e({ id: "node:release:1.0.0", summary: "new row" })], { preserveEnrichment: true });
      expect(await db.countEntries()).toBe(2);
    } finally {
      await db.close();
    }
  });
});
