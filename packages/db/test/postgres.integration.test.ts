import { randomBytes } from "node:crypto";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { resolveDatabaseTarget } from "../src/env";
import { migrationsDir } from "../src/migrations";
import { createPostgresDb } from "../src/postgres";
import { SEED_ENTRY_COUNT } from "../src/seed-data";

/**
 * Real Postgres check for packages/db/migrations/postgres.
 * Skipped unless POSTGRES_TEST_URL is set, so the default `pnpm test` stays offline.
 * That URL is an admin connection. Each run creates a database and drops it afterwards.
 */
const postgresTestUrl = process.env.POSTGRES_TEST_URL?.trim() ?? "";

describe.skipIf(postgresTestUrl === "")("postgres integration", () => {
  it("migrates the shared tables, seeds, filters, and round-trips an embedding cache", async () => {
    const database = `fned9_${randomBytes(8).toString("hex")}`;
    const admin = new pg.Client({ connectionString: postgresTestUrl });
    await admin.connect();
    let created = false;
    try {
      await admin.query(`CREATE DATABASE ${quoteIdent(database)}`);
      created = true;
      const isolatedUrl = withDatabase(postgresTestUrl, database);
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

        const applied = await migrationJournal(isolatedUrl);
        expect(applied).toHaveLength(1);
        await db.migrate();
        expect(await db.countEntries()).toBe(SEED_ENTRY_COUNT);
        expect(await db.getVector("entry:1", "BAAI/bge-small-en-v1.5")).toEqual([0.1, 0.2]);
        expect(await publicTables(isolatedUrl)).toEqual(["embeddings", "entries", "source_state"]);
        expect(await migrationJournal(isolatedUrl)).toEqual(applied);
      } finally {
        await db.close();
      }
    } finally {
      if (created) {
        await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(database)} WITH (FORCE)`);
      }
      await admin.end();
    }
  });
});

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
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query<T>(text);
    return result.rows;
  } finally {
    await client.end();
  }
}
