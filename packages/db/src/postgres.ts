import { and, count, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { endOfUtcDay, startOfUtcDay, type EntryFilter, type Source } from "@evolution/shared-types";
import { fromEntryRow, fromStateRow, toEntryRow, toStateRow, type EntryRow, type StateRow } from "./rows";
import { embeddings, entries, sourceState } from "./schema.postgres";
import { buildSeedEntries, buildSeedStates } from "./seed-data";
import { INIT_SQL } from "./sql";
import type { DashboardDb } from "./types";

type PostgresDb = NodePgDatabase<{
  entries: typeof entries;
  sourceState: typeof sourceState;
  embeddings: typeof embeddings;
}>;

export function createPostgresDb(databaseUrl: string): DashboardDb {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema: { entries, sourceState, embeddings } });
  return {
    dialect: "postgres",
    async migrate() {
      await pool.query(INIT_SQL);
      await pool.query(
        "INSERT INTO schema_migrations (id, applied_at) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
        ["0001_init", new Date().toISOString()],
      );
    },
    async seed(now = new Date()) {
      await this.upsertEntries(buildSeedEntries(now));
      for (const state of buildSeedStates(now)) await this.upsertSourceState(state);
    },
    async close() {
      await pool.end();
    },
    async upsertEntries(items) {
      if (items.length === 0) return;
      const now = new Date().toISOString();
      await db.transaction(async (tx) => {
        for (const entry of items) {
          const row = toEntryRow(entry, now);
          await tx.insert(entries).values(row).onConflictDoUpdate({ target: entries.id, set: row });
        }
      });
    },
    async listEntries(filter: EntryFilter = {}) {
      return (await selectEntries(db, filter)).map(fromEntryRow);
    },
    async countEntries() {
      const [row] = await db.select({ value: count() }).from(entries);
      return row?.value ?? 0;
    },
    async upsertSourceState(state) {
      const row = toStateRow(state);
      await db.insert(sourceState).values(row).onConflictDoUpdate({
        target: [sourceState.source, sourceState.url],
        set: row,
      });
    },
    async listSourceStates(source?: Source) {
      const rows = source
        ? await db.select().from(sourceState).where(eq(sourceState.source, source))
        : await db.select().from(sourceState);
      return rows.map((row) => fromStateRow(row as StateRow));
    },
    async getVector(key, model) {
      const payload = await readPayload(db, key, model, "vector");
      return Array.isArray(payload) ? payload : null;
    },
    async setVector(key, model, vector) {
      await writePayload(db, key, model, "vector", JSON.stringify(vector));
    },
    async getSummary(key, model) {
      const payload = await readPayload(db, key, model, "summary");
      return typeof payload === "string" ? payload : null;
    },
    async setSummary(key, model, summary) {
      await writePayload(db, key, model, "summary", JSON.stringify(summary));
    },
  };
}

async function selectEntries(db: PostgresDb, filter: EntryFilter): Promise<EntryRow[]> {
  const conditions = entryConditions(filter);
  const limit = filter.limit ?? 500;
  const base = db.select().from(entries);
  const filtered = conditions.length > 0 ? base.where(and(...conditions)) : base;
  return filtered.orderBy(desc(entries.date)).limit(limit);
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

async function readPayload(db: PostgresDb, key: string, model: string, kind: string): Promise<number[] | string | null> {
  const [row] = await db
    .select()
    .from(embeddings)
    .where(and(eq(embeddings.cacheKey, key), eq(embeddings.model, model), eq(embeddings.kind, kind)))
    .limit(1);
  if (!row) return null;
  return JSON.parse(row.payload) as number[] | string;
}

async function writePayload(db: PostgresDb, key: string, model: string, kind: string, payload: string) {
  const row = { cacheKey: key, model, kind, payload, updatedAt: new Date().toISOString() };
  await db
    .insert(embeddings)
    .values(row)
    .onConflictDoUpdate({ target: [embeddings.cacheKey, embeddings.model, embeddings.kind], set: row });
}
