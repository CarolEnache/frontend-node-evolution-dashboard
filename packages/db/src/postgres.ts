import { and, count, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate as migratePostgres } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { endOfUtcDay, startOfUtcDay, type EntryFilter, type Source } from "@evolution/shared-types";
import { migrationRecords, shouldRecordBaseline } from "./baseline";
import { DatabaseUnavailableError, describeDatabaseFailure, type AppEnvironment } from "./env";
import { migrationsDir } from "./migrations";
import { entryConflictSet } from "./entry-upsert";
import { fromEntryRow, fromStateRow, toEntryRow, toStateRow, type EntryRow, type StateRow } from "./rows";
import { embeddings, entries, sourceState } from "./schema.postgres";
import { buildSeedEntries, buildSeedStates } from "./seed-data";
import { postgresPoolConfig } from "./timeouts";
import type { DashboardDb } from "./types";

type PostgresDb = NodePgDatabase<{
  entries: typeof entries;
  sourceState: typeof sourceState;
  embeddings: typeof embeddings;
}>;

export interface PostgresQueryClient {
  query: (input: string | { text: string; values?: unknown[] }, values?: unknown[]) => Promise<{ rows: unknown[] }>;
  end: () => Promise<void>;
}

export type PostgresPoolFactory = new (config: pg.PoolConfig) => PostgresQueryClient;

const CONNECTION_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "EAI_AGAIN", "EHOSTUNREACH"]);

export async function createPostgresDb(
  databaseUrl: string,
  options?: { appEnv?: AppEnvironment; Pool?: PostgresPoolFactory },
): Promise<DashboardDb> {
  const appEnv = options?.appEnv ?? "local";
  const PoolImpl = options?.Pool ?? (pg.Pool as unknown as PostgresPoolFactory);
  const pool = new PoolImpl(postgresPoolConfig(databaseUrl));
  try {
    await pool.query("SELECT 1");
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw new DatabaseUnavailableError(describeDatabaseFailure(appEnv, databaseUrl, error), { cause: error });
  }
  const db = drizzle(pool as unknown as pg.Pool, { schema: { entries, sourceState, embeddings } });
  const database: DashboardDb = {
    dialect: "postgres",
    async migrate() {
      try {
        await baselineExistingPostgres(pool);
        await migratePostgres(db, { migrationsFolder: migrationsDir("postgres") });
      } catch (error) {
        if (isConnectionFailure(error)) {
          throw new DatabaseUnavailableError(describeDatabaseFailure(appEnv, databaseUrl, error), { cause: error });
        }
        throw error;
      }
    },
    async seed(now = new Date()) {
      await this.upsertEntries(buildSeedEntries(now));
      for (const state of buildSeedStates(now)) await this.upsertSourceState(state);
    },
    async close() {
      await pool.end();
    },
    async upsertEntries(items, options) {
      if (items.length === 0) return;
      const now = new Date().toISOString();
      const preserveEnrichment = options?.preserveEnrichment === true;
      await db.transaction(async (tx) => {
        for (const entry of items) {
          const row = toEntryRow(entry, now);
          await tx.insert(entries).values(row).onConflictDoUpdate({
            target: entries.id,
            set: entryConflictSet(row, entries, preserveEnrichment),
          });
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
  return database;
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

async function baselineExistingPostgres(pool: PostgresQueryClient): Promise<void> {
  const found = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('entries', 'source_state', 'embeddings')`,
  );
  const names = new Set(
    found.rows.map((row) => {
      if (row && typeof row === "object" && "table_name" in row) return String((row as { table_name: unknown }).table_name);
      return "";
    }),
  );
  if (!["entries", "source_state", "embeddings"].every((name) => names.has(name))) return;
  const [first] = migrationRecords("postgres");
  if (!first) return;
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
  await pool.query(`CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at bigint
  )`);
  const existing = await pool.query(
    `SELECT created_at FROM "drizzle"."__drizzle_migrations" ORDER BY created_at DESC LIMIT 1`,
  );
  const created = existing.rows[0];
  const createdAt =
    created && typeof created === "object" && "created_at" in created
      ? Number((created as { created_at: unknown }).created_at)
      : undefined;
  if (!shouldRecordBaseline(Number.isFinite(createdAt) ? createdAt : undefined, first.folderMillis)) return;
  await pool.query(`INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ($1, $2)`, [
    first.hash,
    first.folderMillis,
  ]);
}

function isConnectionFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error && typeof error.code === "string" ? error.code : "";
  if (CONNECTION_CODES.has(code)) return true;
  const message = error instanceof Error ? error.message : "";
  return /timeout|ECONNREFUSED|ENOTFOUND|getaddrinfo|connect /i.test(message);
}
