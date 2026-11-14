import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { Entry, SourceState } from "@evolution/shared-types";
import { createDb } from "../src/index";

function entry(overrides: Partial<Entry> & Pick<Entry, "id" | "date" | "title">): Entry {
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

async function tempDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "evolution-sqlite-"));
  const file = path.join(dir, "nested", "test.sqlite");
  const db = await createDb(`file:${file}`);
  return { db, file };
}

describe("sqlite queries", () => {
  it("filters, limits, overwrites, and ignores an empty upsert", async () => {
    const { db } = await tempDb();
    try {
      await db.upsertEntries([]);
      expect(await db.countEntries()).toBe(0);
      await db.upsertEntries([
        entry({ id: "old", title: "Old", date: "2026-10-01T00:00:00.000Z", tags: ["CSS"], gap: "new", type: "release" }),
        entry({
          id: "mid",
          title: "Mid",
          date: "2026-10-15T12:00:00.000Z",
          source: "typescript",
          type: "security",
          tags: ["css", "typescript"],
          gap: "adjacent",
          similarity: 0,
          worthLearning: "Read it.",
        }),
        entry({
          id: "new",
          title: "New",
          date: "2026-10-28T23:59:59.999Z",
          tags: ["node"],
          gap: "already-know",
        }),
      ]);
      await db.upsertEntries([]);
      expect(await db.countEntries()).toBe(3);
      const ranged = await db.listEntries({ from: "2026-10-15", to: "2026-10-28" });
      expect(ranged.map((row) => row.id)).toEqual(["new", "mid"]);
      expect(await db.listEntries({ source: "node", type: "release" })).toHaveLength(2);
      expect((await db.listEntries({ gap: "adjacent" })).map((row) => row.id)).toEqual(["mid"]);
      expect((await db.listEntries({ tag: "css_" })).map((row) => row.id).sort()).toEqual(["mid", "old"]);
      expect((await db.listEntries({ limit: 1 })).map((row) => row.id)).toEqual(["new"]);
      const mid = (await db.listEntries({ type: "security" }))[0];
      expect(mid?.similarity).toBe(0);
      expect(mid?.worthLearning).toBe("Read it.");
      await db.upsertEntries([entry({ ...mid!, title: "Updated", date: mid!.date })]);
      expect((await db.listEntries({ type: "security" }))[0]?.title).toBe("Updated");
      expect(await db.listEntries({ from: "2026-10-29" })).toEqual([]);
    } finally {
      await db.close();
    }
  });

  it("stores source state, separates embedding kinds, and records the migration", async () => {
    const { db, file } = await tempDb();
    try {
      const nodeState: SourceState = {
        source: "node",
        url: "https://nodejs.org/dist/index.json",
        etag: '"1"',
        lastModified: "Wed, 28 Oct 2026 00:00:00 GMT",
        version: "v26.13.0",
        lastFetchedAt: "2026-10-31T00:00:00.000Z",
        lastSuccessAt: "2026-10-31T00:00:00.000Z",
      };
      await db.upsertSourceState(nodeState);
      await db.upsertSourceState({ ...nodeState, etag: '"2"' });
      await db.upsertSourceState({ source: "nextjs", url: "https://nextjs.org/feed.xml", version: "16.4.3" });
      expect(await db.listSourceStates()).toHaveLength(2);
      expect(await db.listSourceStates("node")).toEqual([{ ...nodeState, etag: '"2"' }]);
      expect(await db.listSourceStates("caniuse")).toEqual([]);
      await db.setVector("entry:1", "model", [0.1, 0.2]);
      await db.setVector("entry:1", "model", [0.3]);
      await db.setSummary("entry:1", "model", "Learn this.");
      expect(await db.getVector("entry:1", "model")).toEqual([0.3]);
      expect(await db.getSummary("entry:1", "model")).toBe("Learn this.");
      expect(await db.getVector("missing", "model")).toBeNull();
      expect(await db.getSummary("entry:1", "other")).toBeNull();
      await db.migrate();
      expect(await db.getVector("entry:1", "model")).toEqual([0.3]);
      await db.migrate();
      expect(await db.getVector("entry:1", "model")).toEqual([0.3]);
    } finally {
      await db.close();
    }
    const raw = new Database(file, { readonly: true });
    try {
      const mode = raw.pragma("journal_mode", { simple: true });
      expect(mode).toBe("wal");
      const journal = raw.prepare(`SELECT hash FROM "__drizzle_migrations"`).all() as Array<{ hash: string }>;
      expect(journal).toHaveLength(1);
      expect(journal[0]?.hash).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      raw.close();
    }
  });

  it("loads only the requested entry ids", async () => {
    const { db } = await tempDb();
    try {
      await db.upsertEntries([
        entry({ id: "a", title: "A", date: "2026-10-01T00:00:00.000Z", worthLearning: "Keep A." }),
        entry({ id: "b", title: "B", date: "2026-10-02T00:00:00.000Z", worthLearning: "Keep B." }),
      ]);
      expect(await db.listEntriesByIds([])).toEqual([]);
      expect(await db.listEntriesByIds(["missing", "a"])).toMatchObject([{ id: "a", worthLearning: "Keep A." }]);
    } finally {
      await db.close();
    }
  });

  it("surfaces a corrupt stored entry", async () => {
    const { db, file } = await tempDb();
    await db.close();
    const raw = new Database(file);
    raw.prepare(
      `INSERT INTO entries (id, source, type, title, date, url, summary, tags, raw, gap, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "bad",
      "nope",
      "release",
      "Bad",
      "2026-10-01T00:00:00.000Z",
      "https://example.com",
      "x",
      '["ok", 1]',
      "null",
      "nope",
      "2026-10-01T00:00:00.000Z",
    );
    raw.close();
    const again = await createDb(`file:${file}`);
    try {
      await expect(again.listEntries()).rejects.toThrow(/Corrupt entry bad/);
    } finally {
      await again.close();
    }
  });
});
