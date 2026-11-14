import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { and, count, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate as migrateSqlite } from "drizzle-orm/better-sqlite3/migrator";
import { endOfUtcDay, startOfUtcDay, type Entry, type EntryFilter, type Source, type SourceState } from "@evolution/shared-types";
import { migrationRecords, shouldRecordBaseline } from "./baseline";
import { migrationsDir } from "./migrations";
import { sqliteFilePath } from "./paths";
import { fromEntryRow, fromStateRow, toEntryRow, toStateRow, type EntryRow, type StateRow } from "./rows";
import { embeddings, entries, sourceState } from "./schema.sqlite";
import { buildSeedEntries, buildSeedStates } from "./seed-data";
import type { DashboardDb } from "./types";

type SqliteDb = BetterSQLite3Database<{
  entries: typeof entries;
  sourceState: typeof sourceState;
  embeddings: typeof embeddings;
}>;

export function createSqliteDb(databaseUrl: string): DashboardDb {
  const file = sqliteFilePath(databaseUrl);
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite, { schema: { entries, sourceState, embeddings } });
  return {
    dialect: "sqlite",
    async migrate() {
      baselineExistingSqlite(sqlite);
      migrateSqlite(db, { migrationsFolder: migrationsDir("sqlite") });
    },
    async seed(now = new Date()) {
      await this.upsertEntries(buildSeedEntries(now));
      for (const state of buildSeedStates(now)) await this.upsertSourceState(state);
    },
    async close() {
      sqlite.close();
    },
    async upsertEntries(items) {
      if (items.length === 0) return;
      const now = new Date().toISOString();
      db.transaction((tx) => {
        for (const entry of items) {
          const row = toEntryRow(entry, now);
          tx.insert(entries)
            .values(row)
            .onConflictDoUpdate({ target: entries.id, set: row })
            .run();
        }
      });
    },
    async deleteEntries(ids) {
      if (ids.length === 0) return;
      db.delete(entries).where(inArray(entries.id, ids)).run();
    },
    async listEntries(filter: EntryFilter = {}) {
      return selectEntries(db, filter).map(fromEntryRow);
    },
    async countEntries() {
      const [row] = db.select({ value: count() }).from(entries).all();
      return row?.value ?? 0;
    },
    async upsertSourceState(state) {
      const row = toStateRow(state);
      db.insert(sourceState).values(row).onConflictDoUpdate({
        target: [sourceState.source, sourceState.url],
        set: row,
      }).run();
    },
    async listSourceStates(source) {
      const query = source
        ? db.select().from(sourceState).where(eq(sourceState.source, source))
        : db.select().from(sourceState);
      return query.all().map((row) => fromStateRow(row as StateRow));
    },
    async getVector(key, model) {
      const payload = readPayload(db, key, model, "vector");
      return Array.isArray(payload) ? payload : null;
    },
    async setVector(key, model, vector) {
      writePayload(db, key, model, "vector", JSON.stringify(vector));
    },
    async getSummary(key, model) {
      const payload = readPayload(db, key, model, "summary");
      return typeof payload === "string" ? payload : null;
    },
    async setSummary(key, model, summary) {
      writePayload(db, key, model, "summary", JSON.stringify(summary));
    },
  };
}

function selectEntries(db: SqliteDb, filter: EntryFilter): EntryRow[] {
  const conditions = entryConditions(filter);
  const limit = filter.limit ?? 500;
  const base = db.select().from(entries);
  const filtered = conditions.length > 0 ? base.where(and(...conditions)) : base;
  return filtered.orderBy(desc(entries.date)).limit(limit).all();
}

function entryConditions(filter: EntryFilter): SQL[] {
  const tag = filter.tag?.trim().toLowerCase().replace(/[%_]/g, "");
  return [
    filter.source ? eq(entries.source, filter.source) : undefined,
    filter.type ? eq(entries.type, filter.type) : undefined,
    filter.gap ? eq(entries.gap, filter.gap) : undefined,
    filter.from ? gte(entries.date, startOfUtcDay(filter.from)) : undefined,
    filter.to ? lte(entries.date, endOfUtcDay(filter.to)) : undefined,
    tag ? sql`${entries.tags} like ${`%"${tag}"%`}` : undefined,
  ].filter((part): part is SQL => Boolean(part));
}

function readPayload(db: SqliteDb, key: string, model: string, kind: string): number[] | string | null {
  const row = db
    .select()
    .from(embeddings)
    .where(and(eq(embeddings.cacheKey, key), eq(embeddings.model, model), eq(embeddings.kind, kind)))
    .get();
  if (!row) return null;
  return JSON.parse(row.payload) as number[] | string;
}

function writePayload(db: SqliteDb, key: string, model: string, kind: string, payload: string) {
  const row = { cacheKey: key, model, kind, payload, updatedAt: new Date().toISOString() };
  db.insert(embeddings)
    .values(row)
    .onConflictDoUpdate({ target: [embeddings.cacheKey, embeddings.model, embeddings.kind], set: row })
    .run();
}

const SHARED_TABLES = ["entries", "source_state", "embeddings"] as const;

function baselineExistingSqlite(sqlite: InstanceType<typeof Database>): void {
  const present = new Set(
    (
      sqlite
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('entries', 'source_state', 'embeddings')`,
        )
        .all() as Array<{ name: string }>
    ).map((row) => row.name),
  );
  if (!SHARED_TABLES.every((name) => present.has(name))) return;
  const [first] = migrationRecords("sqlite");
  if (!first) return;
  sqlite.exec(`CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at numeric
  )`);
  const last = sqlite
    .prepare(`SELECT created_at FROM "__drizzle_migrations" ORDER BY created_at DESC LIMIT 1`)
    .get() as { created_at: number | string } | undefined;
  if (!shouldRecordBaseline(last ? Number(last.created_at) : undefined, first.folderMillis)) return;
  sqlite.prepare(`INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)`).run(first.hash, first.folderMillis);
}

export type { Entry, Source, SourceState };
