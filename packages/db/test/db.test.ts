import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/index";
import { SEED_ENTRY_COUNT } from "../src/seed-data";
import { syncSeedContent } from "../src/sync-seed";

/** The pre-Drizzle SQLite migration. Existing files still have these tables and rows. */
const LEGACY_SQLITE_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  version TEXT,
  date TEXT NOT NULL,
  url TEXT NOT NULL,
  summary TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  raw TEXT NOT NULL DEFAULT 'null',
  similarity REAL,
  gap TEXT,
  worth_learning TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS entries_source_date_idx ON entries (source, date);
CREATE INDEX IF NOT EXISTS entries_gap_date_idx ON entries (gap, date);
CREATE TABLE IF NOT EXISTS source_state (
  source TEXT NOT NULL,
  url TEXT NOT NULL,
  etag TEXT,
  last_modified TEXT,
  version TEXT,
  last_fetched_at TEXT,
  last_success_at TEXT,
  PRIMARY KEY (source, url)
);
CREATE TABLE IF NOT EXISTS embeddings (
  cache_key TEXT NOT NULL,
  model TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (cache_key, model, kind)
);
`;

function columnNames(sql: string, table: string): string[] {
  const match = sql.match(new RegExp(`CREATE TABLE [\`"]${table}[\`"] \\(([\\s\\S]*?)\\);`));
  if (!match?.[1]) return [];
  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("`") || line.startsWith('"'))
    .map((line) => line.slice(1, line.indexOf(line[0], 1)));
}

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

    const postgres = readFileSync(new URL("../migrations/postgres/0000_init.sql", import.meta.url), "utf8");
    const postgresJournal = JSON.parse(
      readFileSync(new URL("../migrations/postgres/meta/_journal.json", import.meta.url), "utf8"),
    ) as { dialect: string; entries: Array<{ tag: string }> };
    expect(postgresJournal.dialect).toBe("postgresql");
    expect(postgresJournal.entries.map((entry) => entry.tag)).toEqual(journal.entries.map((entry) => entry.tag));
    for (const table of ["entries", "source_state", "embeddings"] as const) {
      expect(columnNames(postgres, table)).toEqual(columnNames(sql, table));
    }
    expect(postgres).toContain('CREATE INDEX "entries_source_date_idx"');
    expect(postgres).toContain('CREATE INDEX "entries_gap_date_idx"');
    expect(sql).toContain("CREATE INDEX `entries_source_date_idx`");
    expect(sql).toContain("CREATE INDEX `entries_gap_date_idx`");
  });

  it("migrates, seeds, filters, and round-trips an embedding cache", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "evolution-"));
    const db = await createDb(`file:${path.join(dir, "test.sqlite")}`);
    try {
      await db.migrate();
      await db.seed(new Date("2026-10-31T00:00:00.000Z"));
      expect(await db.countEntries()).toBe(SEED_ENTRY_COUNT);
      const css = await db.listEntries({ tag: "css" });
      expect(css.map((entry) => entry.source).sort()).toEqual(["caniuse", "mdn-bcd"]);
      const node = await db.listEntries({ source: "node", gap: "new" });
      expect(node.every((entry) => entry.source === "node" && entry.gap === "new")).toBe(true);
      await db.setVector("entry:1", "BAAI/bge-small-en-v1.5", [0.1, 0.2]);
      await db.setSummary("entry:1", "meta-llama/Llama-3.1-8B-Instruct", "Learn this.");
      expect(await db.getVector("entry:1", "BAAI/bge-small-en-v1.5")).toEqual([0.1, 0.2]);
      expect(await db.getSummary("entry:1", "meta-llama/Llama-3.1-8B-Instruct")).toBe("Learn this.");
      await db.seed(new Date("2026-10-31T00:00:00.000Z"));
      expect(await db.countEntries()).toBe(SEED_ENTRY_COUNT);
      await db.migrate();
      expect(await db.countEntries()).toBe(SEED_ENTRY_COUNT);
    } finally {
      await db.close();
    }
  });

  it("baselines an existing SQLite file without deleting its rows", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "evolution-legacy-"));
    const file = path.join(dir, "legacy.sqlite");
    const { default: Database } = await import("better-sqlite3");
    const raw = new Database(file);
    raw.exec(LEGACY_SQLITE_SQL);
    raw
      .prepare(
        `INSERT INTO entries (id, source, type, title, date, url, summary, tags, raw, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "kept",
        "node",
        "release",
        "Kept release",
        "2026-10-28T00:00:00.000Z",
        "https://example.com/kept",
        "Still here after the baseline.",
        "[]",
        "null",
        "2026-10-28T00:00:00.000Z",
      );
    raw.prepare(`INSERT INTO schema_migrations (id, applied_at) VALUES ('0001_init', ?)`).run("2026-10-01T00:00:00.000Z");
    raw.close();

    const db = await createDb(`file:${file}`);
    try {
      expect((await db.listEntries()).map((entry) => entry.id)).toEqual(["kept"]);
      await db.migrate();
      expect((await db.listEntries()).map((entry) => entry.id)).toEqual(["kept"]);
      expect(await db.countEntries()).toBe(1);
    } finally {
      await db.close();
    }

    const check = new Database(file, { readonly: true });
    try {
      expect(check.prepare(`SELECT id FROM entries`).all()).toEqual([{ id: "kept" }]);
      expect(check.prepare(`SELECT hash FROM "__drizzle_migrations"`).all()).toHaveLength(1);
      expect(check.prepare(`SELECT id FROM schema_migrations`).all()).toEqual([{ id: "0001_init" }]);
    } finally {
      check.close();
    }
  });

  it("migrates an in-memory database", async () => {
    const db = await createDb(":memory:");
    try {
      expect(db.dialect).toBe("sqlite");
      await db.seed(new Date("2026-10-31T00:00:00.000Z"));
      expect(await db.countEntries()).toBe(SEED_ENTRY_COUNT);
      const states = await db.listSourceStates("node");
      expect(states.length).toBeGreaterThan(0);
    } finally {
      await db.close();
    }
  });
});

describe("syncSeedContent", () => {
  it("inserts missing seed rows and is idempotent", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "evolution-sync-"));
    const db = await createDb(`file:${path.join(dir, "test.sqlite")}`);
    try {
      await db.migrate();
      const first = await syncSeedContent(db, new Date("2026-10-31T00:00:00.000Z"));
      expect(first.inserted).toBe(SEED_ENTRY_COUNT);
      expect(first.updated).toBe(0);
      expect(await db.countEntries()).toBe(SEED_ENTRY_COUNT);

      const second = await syncSeedContent(db, new Date("2026-10-31T00:00:00.000Z"));
      expect(second.inserted).toBe(0);
      expect(second.updated).toBe(0);
      expect(second.unchanged).toBe(SEED_ENTRY_COUNT);

      const cache = (await db.listEntries()).find((entry) => entry.id === "nextjs:article:cache-components");
      expect(cache?.url).toBe("https://nextjs.org/blog/next-16#cache-components");
    } finally {
      await db.close();
    }
  });

  it("updates the URL of an existing row without changing its date", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "evolution-sync-url-"));
    const db = await createDb(`file:${path.join(dir, "test.sqlite")}`);
    try {
      await db.migrate();
      await db.upsertEntries([
        {
          id: "nextjs:article:cache-components",
          source: "nextjs",
          type: "article",
          title: "Cache Components in Next.js 16",
          date: "2026-01-01T00:00:00.000Z",
          url: "https://nextjs.org/blog",
          summary: "Cache Components change how a dashboard keeps a server-rendered timeline fresh.",
          tags: ["app-router", "caching", "nextjs"],
          raw: { seed: true },
        },
      ]);
      const result = await syncSeedContent(db, new Date("2026-10-31T00:00:00.000Z"));
      expect(result.updated).toBe(1);
      expect(result.inserted).toBe(SEED_ENTRY_COUNT - 1);
      const cache = (await db.listEntries()).find((entry) => entry.id === "nextjs:article:cache-components");
      expect(cache?.url).toBe("https://nextjs.org/blog/next-16#cache-components");
      expect(cache?.date).toBe("2026-01-01T00:00:00.000Z");
    } finally {
      await db.close();
    }
  });
});

