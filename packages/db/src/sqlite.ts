import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { and, count, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { endOfUtcDay, startOfUtcDay, type Entry, type EntryFilter, type Source, type SourceState } from "@evolution/shared-types";
import { sqliteFilePath } from "./paths";
import { fromEntryRow, fromStateRow, toEntryRow, toStateRow, type EntryRow, type StateRow } from "./rows";
import { embeddings, entries, sourceState } from "./schema.sqlite";
import { buildSeedEntries, buildSeedStates } from "./seed-data";
import { INIT_SQL } from "./sql";
import type { DashboardDb } from "./types";

type SqliteDb = BetterSQLite3Database<{
  entries: typeof entries;
  sourceState: typeof sourceState;
  embeddings: typeof embeddings;
}>;

export function createSqliteDb(databaseUrl: string): DashboardDb {
  const file = sqliteFilePath(databaseUrl);
  mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite, { schema: { entries, sourceState, embeddings } });
  return {
    dialect: "sqlite",
    async migrate() {
      sqlite.exec(INIT_SQL);
      sqlite
        .prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?) ON CONFLICT (id) DO NOTHING")
        .run("0001_init", new Date().toISOString());
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

export type { Entry, Source, SourceState };
