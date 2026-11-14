import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { migrationRecords } from "../src/baseline";
import { describeIdleClientError, resolveDatabaseTarget } from "../src/env";
import { migrationsDir } from "../src/migrations";
import { createPostgresDb } from "../src/postgres";
import { SEED_ENTRY_COUNT } from "../src/seed-data";
import { postgresIntegrationAction } from "./postgres-gate";

/**
 * Real Postgres check for packages/db/migrations/postgres.
 * Skipped when CI is unset and POSTGRES_TEST_URL is empty, so a local `pnpm test` stays offline.
 * In CI a missing URL fails the file instead of skipping. The URL is an admin connection.
 * Each run creates a database and drops it afterwards.
 */
const CONNECT_TIMEOUT_MS = 5_000;
const TEST_TIMEOUT_MS = 20_000;
const postgresTestUrl = process.env.POSTGRES_TEST_URL?.trim() ?? "";
const integrationAction = postgresIntegrationAction(process.env);

if (integrationAction === "fail") {
  throw new Error(
    "POSTGRES_TEST_URL is required in CI. This suite skips only when CI is unset and the URL is empty.",
  );
}

describe.skipIf(integrationAction === "skip")("postgres integration", () => {
  it(
    "migrates the shared tables, seeds, filters, and round-trips an embedding cache",
    async () => {
      await withThrowawayDatabase(async (isolatedUrl) => {
        vi.stubEnv("APP_ENV", "local");
        vi.stubEnv("DATABASE_URL", isolatedUrl);
        const target = resolveDatabaseTarget();
        expect(target).toEqual({ appEnv: "local", dialect: "postgres", url: isolatedUrl });
        const folder = migrationsDir("postgres");
        expect(folder.replaceAll("\\", "/")).toMatch(/migrations\/postgres$/);

        const db = await createPostgresDb(target.url, { appEnv: target.appEnv });
        try {
          await db.migrate();
          expect(await publicTables(isolatedUrl)).toEqual(["embeddings", "entries", "source_state"]);
          expect(await publicIndexes(isolatedUrl)).toEqual([
            "embeddings_cache_key_model_kind_pk",
            "entries_gap_date_idx",
            "entries_pkey",
            "entries_source_date_idx",
            "source_state_source_url_pk",
          ]);
          expect(await db.countEntries()).toBe(0);

          await db.seed(new Date("2026-10-31T00:00:00.000Z"));
          expect(await db.countEntries()).toBe(SEED_ENTRY_COUNT);
          const seeded = await db.listEntries();
          expect(seeded).toHaveLength(SEED_ENTRY_COUNT);
          expect(seeded.find((entry) => entry.id === "nextjs:release:16.4.3")).toMatchObject({
            source: "nextjs",
            similarity: 0.86,
            gap: "already-know",
            tags: ["app-router", "nextjs", "stable", "turbopack"],
            raw: { seed: true },
          });
          const css = await db.listEntries({ tag: "css" });
          expect(css.map((entry) => entry.source).sort()).toEqual(["caniuse", "mdn-bcd"]);
          const node = await db.listEntries({ source: "node", gap: "new" });
          expect(node.length).toBeGreaterThan(0);
          expect(node.every((entry) => entry.source === "node" && entry.gap === "new")).toBe(true);
          const states = await db.listSourceStates("node");
          expect(states.length).toBeGreaterThan(0);
          expect(states.every((state) => state.source === "node")).toBe(true);

          await db.setVector("entry:1", "BAAI/bge-small-en-v1.5", [0.1, 0.2]);
          await db.setSummary("entry:1", "meta-llama/Llama-3.1-8B-Instruct", "Learn this.");
          expect(await db.getVector("entry:1", "BAAI/bge-small-en-v1.5")).toEqual([0.1, 0.2]);
          expect(await db.getSummary("entry:1", "meta-llama/Llama-3.1-8B-Instruct")).toBe("Learn this.");

          await db.seed(new Date("2026-10-31T00:00:00.000Z"));
          expect(await db.countEntries()).toBe(SEED_ENTRY_COUNT);
          expect(await db.getSummary("entry:1", "meta-llama/Llama-3.1-8B-Instruct")).toBe("Learn this.");

          const expected = migrationRecords("postgres");
          const applied = await migrationJournal(isolatedUrl);
          expect(applied).toHaveLength(expected.length);
          expect(applied.map((row) => row.hash)).toEqual(expected.map((row) => row.hash));
          await db.migrate();
          expect(await db.countEntries()).toBe(SEED_ENTRY_COUNT);
          expect(await db.getVector("entry:1", "BAAI/bge-small-en-v1.5")).toEqual([0.1, 0.2]);
          expect(await publicTables(isolatedUrl)).toEqual(["embeddings", "entries", "source_state"]);
          expect(await migrationJournal(isolatedUrl)).toEqual(applied);
        } finally {
          await db.close();
        }
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "baselines tables that exist before the Drizzle journal",
    async () => {
      await withThrowawayDatabase(async (isolatedUrl) => {
        const sql = readFileSync(new URL("../migrations/postgres/0000_init.sql", import.meta.url), "utf8").replaceAll(
          "--> statement-breakpoint",
          "",
        );
        await query(isolatedUrl, sql);
        await query(
          isolatedUrl,
          `INSERT INTO entries (id, source, type, title, date, url, summary, tags, raw, updated_at)
           VALUES ('kept', 'node', 'release', 'Kept release', '2026-10-28T00:00:00.000Z', 'https://example.com/kept', 'Still here after the baseline.', '[]', 'null', '2026-10-28T00:00:00.000Z')`,
        );
        expect(await drizzleSchemaExists(isolatedUrl)).toBe(false);

        vi.stubEnv("APP_ENV", "local");
        vi.stubEnv("DATABASE_URL", isolatedUrl);
        const db = await createPostgresDb(isolatedUrl, { appEnv: "local" });
        try {
          await db.migrate();
          expect((await db.listEntries()).map((entry) => entry.id)).toEqual(["kept"]);
          const expected = migrationRecords("postgres");
          const applied = await migrationJournal(isolatedUrl);
          expect(applied.map((row) => row.hash)).toEqual(expected.map((row) => row.hash));
          await db.migrate();
          expect((await db.listEntries()).map((entry) => entry.id)).toEqual(["kept"]);
          expect(await migrationJournal(isolatedUrl)).toEqual(applied);
        } finally {
          await db.close();
        }
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "survives an idle connection being terminated and serves the next query",
    async () => {
      await withThrowawayDatabase(async (isolatedUrl, database) => {
        vi.stubEnv("APP_ENV", "local");
        vi.stubEnv("DATABASE_URL", isolatedUrl);
        const db = await createPostgresDb(isolatedUrl, { appEnv: "local" });
        const uncaught: unknown[] = [];
        const onUncaught = (error: unknown) => {
          uncaught.push(error);
        };
        process.on("uncaughtException", onUncaught);
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        try {
          await db.migrate();
          expect(await db.countEntries()).toBe(0);
          const watcher = client(postgresTestUrl);
          await watcher.connect();
          try {
            const activity = await watcher.query<{ pid: number }>(
              `SELECT pid FROM pg_stat_activity
               WHERE datname = $1 AND application_name = 'evolution-dashboard' AND state = 'idle' AND pid <> pg_backend_pid()`,
              [database],
            );
            expect(activity.rows.length).toBeGreaterThan(0);
            for (const row of activity.rows) {
              await watcher.query("SELECT pg_terminate_backend($1)", [row.pid]);
            }
          } finally {
            await watcher.end();
          }
          await vi.waitFor(
            () => {
              const logged = errorSpy.mock.calls.flat().map(String).join("\n");
              expect(logged.match(/Postgres idle client error/g)).toHaveLength(1);
              expect(logged).not.toContain("checked-out client error");
              expect(logged).toContain("57P01");
            },
            { timeout: 5_000 },
          );
          expect(uncaught).toEqual([]);
          expect(await db.countEntries()).toBe(0);
          expectPasswordRedacted();
        } finally {
          process.off("uncaughtException", onUncaught);
          errorSpy.mockRestore();
          await db.close();
        }
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "rolls back an open transaction when the checked-out connection is terminated",
    async () => {
      await withThrowawayDatabase(async (isolatedUrl, database) => {
        vi.stubEnv("APP_ENV", "local");
        vi.stubEnv("DATABASE_URL", isolatedUrl);
        const db = await createPostgresDb(isolatedUrl, { appEnv: "local" });
        const uncaught: unknown[] = [];
        const onUncaught = (error: unknown) => {
          uncaught.push(error);
        };
        const onRejection = (error: unknown) => {
          uncaught.push(error);
        };
        process.on("uncaughtException", onUncaught);
        process.on("unhandledRejection", onRejection);
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const watcher = client(isolatedUrl);
        try {
          await db.migrate();
          await watcher.connect();
          await watcher.query(`
            CREATE OR REPLACE FUNCTION fned_block_insert() RETURNS trigger
            LANGUAGE plpgsql AS $$
            BEGIN
              IF NEW.id = 'tx-block' THEN
                PERFORM pg_sleep(15);
              END IF;
              RETURN NEW;
            END;
            $$;
            DROP TRIGGER IF EXISTS fned_block_insert ON entries;
            CREATE TRIGGER fned_block_insert
            BEFORE INSERT ON entries
            FOR EACH ROW
            EXECUTE FUNCTION fned_block_insert();
          `);
          let failure: unknown;
          const pending = db
            .upsertEntries([interruptedEntry("tx-1"), interruptedEntry("tx-2"), interruptedEntry("tx-block")])
            .then(
              () => {
                failure = new Error("transaction committed");
              },
              (error: unknown) => {
                failure = error;
              },
            );
          const pid = await vi.waitFor(async () => sleepingPoolPid(watcher, database), { timeout: 5_000 });
          await watcher.query("SELECT pg_terminate_backend($1)", [pid]);
          await pending;
          expect(failure).toBeInstanceOf(Error);
          expect(await db.countEntries()).toBe(0);
          expect(await db.listEntries()).toEqual([]);
          await db.upsertEntries([interruptedEntry("tx-after")]);
          expect((await db.listEntries()).map((entry) => entry.id)).toEqual(["tx-after"]);
          await new Promise((resolve) => setImmediate(resolve));
          expect(uncaught).toEqual([]);
          const logged = errorSpy.mock.calls.flat().map(String).join("\n");
          expect(logged).toContain("checked-out client error");
          expect(logged).not.toContain("idle client error");
          expect(logged).toMatch(/57P01|ECONNRESET|Connection terminated/);
          expectPasswordRedacted();
        } finally {
          process.off("uncaughtException", onUncaught);
          process.off("unhandledRejection", onRejection);
          errorSpy.mockRestore();
          await watcher.end().catch(() => undefined);
          await db.close();
        }
      });
    },
    TEST_TIMEOUT_MS,
  );
});

function interruptedEntry(id: string) {
  return {
    id,
    source: "node" as const,
    type: "release" as const,
    title: "Interrupted write",
    date: "2026-10-28T00:00:00.000Z",
    url: "https://example.com/interrupted",
    summary: "This row must not commit if the connection dies mid-transaction.",
    tags: [],
    raw: null,
  };
}

async function sleepingPoolPid(watcher: pg.Client, database: string): Promise<number> {
  // PG 15+ caches pg_stat_activity for the transaction. Clear it before every poll.
  await watcher.query("SELECT pg_stat_clear_snapshot()");
  const activity = await watcher.query<{ pid: number }>(
    `SELECT pid FROM pg_stat_activity
     WHERE datname = $1
       AND application_name = 'evolution-dashboard'
       AND pid <> pg_backend_pid()
       AND state = 'active'
       AND wait_event_type = 'Timeout'
       AND wait_event = 'PgSleep'`,
    [database],
  );
  expect(activity.rows.length).toBeGreaterThan(0);
  const pid = activity.rows[0]?.pid;
  expect(pid).toEqual(expect.any(Number));
  return pid ?? 0;
}

function expectPasswordRedacted() {
  const planted =
    "postgresql://app:planted-secret@127.0.0.1:5432/evolution?password=query-secret&sslpassword=ssl-secret&sslmode=require";
  const logged = describeIdleClientError(
    "local",
    planted,
    Object.assign(new Error(`connection dropped ${planted}`), { code: "57P01" }),
  );
  expect(logged).toContain("***");
  expect(logged).toContain("57P01");
  expect(logged).not.toContain("planted-secret");
  expect(logged).not.toContain("query-secret");
  expect(logged).not.toContain("ssl-secret");
}

async function withThrowawayDatabase(run: (isolatedUrl: string, database: string) => Promise<void>): Promise<void> {
  const database = `fned9_${randomBytes(8).toString("hex")}`;
  const admin = client(postgresTestUrl);
  await admin.connect();
  let created = false;
  try {
    await admin.query(`CREATE DATABASE ${quoteIdent(database)}`);
    created = true;
    await run(withDatabase(postgresTestUrl, database), database);
  } finally {
    if (created) {
      await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(database)} WITH (FORCE)`);
    }
    await admin.end();
  }
}

function client(connectionString: string): pg.Client {
  return new pg.Client({ connectionString, connectionTimeoutMillis: CONNECT_TIMEOUT_MS });
}

function withDatabase(baseUrl: string, database: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

function quoteIdent(identifier: string): string {
  if (!/^[a-z0-9_]+$/.test(identifier)) {
    throw new Error(`Refusing to interpolate database name ${identifier}`);
  }
  return `"${identifier}"`;
}

async function publicTables(connectionString: string): Promise<string[]> {
  const rows = await query<{ table_name: string }>(
    connectionString,
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  );
  return rows.map((row) => row.table_name);
}

async function publicIndexes(connectionString: string): Promise<string[]> {
  const rows = await query<{ indexname: string }>(
    connectionString,
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`,
  );
  return rows.map((row) => row.indexname);
}

async function drizzleSchemaExists(connectionString: string): Promise<boolean> {
  const rows = await query<{ schema_name: string }>(
    connectionString,
    `SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'drizzle'`,
  );
  return rows.length > 0;
}

async function migrationJournal(connectionString: string): Promise<Array<{ id: string; hash: string; createdAt: string }>> {
  const rows = await query<{ id: unknown; hash: unknown; created_at: unknown }>(
    connectionString,
    `SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id`,
  );
  return rows.map((row) => ({
    id: String(row.id),
    hash: String(row.hash),
    createdAt: String(row.created_at),
  }));
}

async function query<T extends pg.QueryResultRow>(connectionString: string, text: string): Promise<T[]> {
  const connection = client(connectionString);
  await connection.connect();
  try {
    const result = await connection.query<T>(text);
    return result.rows;
  } finally {
    await connection.end();
  }
}
