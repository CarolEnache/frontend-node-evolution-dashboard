import { readFileSync } from "node:fs";
import type { PoolConfig } from "pg";
import { describe, expect, it, vi } from "vitest";
import { DatabaseUnavailableError } from "../src/env";
import { createPostgresDb, type PostgresPoolFactory } from "../src/postgres";
import { POSTGRES_TIMEOUTS, postgresPoolConfig } from "../src/timeouts";

const DATABASE_URL = "postgresql://user:super-secret@ep-staging.region.aws.neon.tech/neondb?sslmode=require";

describe("postgres pool", () => {
  it("sets connection and query timeouts without opening a socket", () => {
    const config = postgresPoolConfig(DATABASE_URL);
    expect(config.connectionTimeoutMillis).toBe(POSTGRES_TIMEOUTS.connectionTimeoutMillis);
    expect(config.query_timeout).toBe(POSTGRES_TIMEOUTS.queryTimeoutMillis);
    expect(config.statement_timeout).toBe(POSTGRES_TIMEOUTS.statementTimeoutMillis);
    expect(config.idleTimeoutMillis).toBe(POSTGRES_TIMEOUTS.idleTimeoutMillis);
    expect(config.idle_in_transaction_session_timeout).toBe(POSTGRES_TIMEOUTS.idleInTransactionTimeoutMillis);
    expect(config.max).toBe(POSTGRES_TIMEOUTS.max);
    for (const value of [
      config.connectionTimeoutMillis,
      config.query_timeout,
      config.statement_timeout,
    ]) {
      expect(value).toBeGreaterThanOrEqual(5_000);
      expect(value).toBeLessThanOrEqual(60_000);
    }
    expect(config.ssl).toEqual({ rejectUnauthorized: true });
    expect(config.connectionString).toBe(DATABASE_URL);
  });

  it("leaves ssl off for a non-Neon URL that does not request it", () => {
    expect(postgresPoolConfig("postgresql://USER:PASSWORD@127.0.0.1:5432/evolution").ssl).toBeUndefined();
  });

  it("reports an unreachable database and closes the client", async () => {
    const pool = recordingPool(async () => {
      throw Object.assign(new Error("timeout exceeded when trying to connect"), { code: "ETIMEDOUT" });
    });
    await expect(createPostgresDb(DATABASE_URL, { appEnv: "staging", Pool: pool.Factory })).rejects.toThrow(
      DatabaseUnavailableError,
    );
    await expect(createPostgresDb(DATABASE_URL, { appEnv: "staging", Pool: pool.Factory })).rejects.toThrow(
      /APP_ENV=staging/,
    );
    await expect(createPostgresDb(DATABASE_URL, { appEnv: "staging", Pool: pool.Factory })).rejects.toThrow(
      /unreachable/,
    );
    const message = await createPostgresDb(DATABASE_URL, { appEnv: "staging", Pool: pool.Factory }).catch(
      (error: unknown) => (error instanceof Error ? error.message : ""),
    );
    expect(message).not.toContain("super-secret");
    expect(pool.instances.every((instance) => instance.ended)).toBe(true);
    expect(pool.instances[0]?.config.connectionTimeoutMillis).toBe(POSTGRES_TIMEOUTS.connectionTimeoutMillis);
  });

  it("applies the Postgres migration through the injected client", async () => {
    const pool = recordingPool(async () => ({ rows: [] }));
    const db = await createPostgresDb(DATABASE_URL, { appEnv: "development", Pool: pool.Factory });
    try {
      await db.migrate();
      const sql = pool.instances[0]?.queries.join("\n") ?? "";
      expect(sql).toContain("SELECT 1");
      expect(sql).toContain('CREATE TABLE "entries"');
      expect(sql).toContain('CREATE TABLE "source_state"');
      expect(sql).toContain('CREATE TABLE "embeddings"');
      expect(sql).toContain('ADD COLUMN "last_error"');
      expect(sql).toContain('ADD COLUMN "status"');
      expect(sql.toLowerCase()).not.toContain("drop ");
      expect(sql).not.toContain("super-secret");
    } finally {
      await db.close();
    }
    expect(pool.instances[0]?.ended).toBe(true);
  });

  it("checks the generated Postgres migration in for the same tables", () => {
    const sql = readFileSync(new URL("../migrations/postgres/0000_init.sql", import.meta.url), "utf8");
    const journal = JSON.parse(
      readFileSync(new URL("../migrations/postgres/meta/_journal.json", import.meta.url), "utf8"),
    ) as { dialect: string; entries: unknown[] };
    expect(journal.dialect).toBe("postgresql");
    expect(journal.entries).toHaveLength(2);
    const added = readFileSync(new URL("../migrations/postgres/0001_source_check.sql", import.meta.url), "utf8");
    expect(added).toContain('ADD COLUMN "last_error"');
    expect(added).toContain('ADD COLUMN "status"');
    expect(added.toLowerCase()).not.toContain("drop ");
    expect(sql).toContain('CREATE TABLE "entries"');
    expect(sql).toContain("USING btree");
  });
});

function recordingPool(query: (text: string) => Promise<{ rows: unknown[] }>) {
  const instances: Array<{ config: PoolConfig; queries: string[]; ended: boolean }> = [];
  const Factory = class {
    config: PoolConfig;
    queries: string[] = [];
    ended = false;
    constructor(config: PoolConfig) {
      this.config = config;
      instances.push(this);
    }
    async query(input: string | { text: string }) {
      const text = typeof input === "string" ? input : input.text;
      this.queries.push(text);
      return query(text);
    }
    async end() {
      this.ended = true;
    }
  } as unknown as PostgresPoolFactory;
  return { Factory, instances };
}

const pgMock = vi.hoisted(() => {
  const queries: Array<{ text: string; params: unknown }> = [];
  const end = vi.fn(async () => undefined);
  const query = vi.fn(async (config: unknown, params?: unknown) => {
    const text = typeof config === "string" ? config : ((config as { text?: string })?.text ?? "");
    const values =
      params ??
      (config && typeof config === "object" && "values" in config ? (config as { values?: unknown }).values : undefined);
    queries.push({ text, params: values });
    return { rows: [], rowCount: 0 };
  });
  class Pool {
    constructor(public config: unknown) {}
    query = query;
    end = end;
    connect = async () => ({ query, release: () => undefined });
  }
  return { queries, query, end, Pool };
});

vi.mock("pg", () => ({
  default: {
    Pool: pgMock.Pool,
    types: {
      builtins: { TIMESTAMPTZ: 1184, TIMESTAMP: 1114, DATE: 1082, INTERVAL: 1186 },
      getTypeParser: () => (value: unknown) => value,
    },
  },
}));

import { createDb } from "../src/index";

describe("postgres without a server", () => {
  it("migrates, closes, and builds filter SQL through a mocked pool", async () => {
    const db = await createPostgresDb("postgresql://localhost/evolution");
    expect(db.dialect).toBe("postgres");
    const before = pgMock.queries.length;
    await db.upsertEntries([]);
    expect(pgMock.queries.length).toBe(before);

    await db.migrate();
    const migrated = pgMock.queries.slice(before);
    const migrationSql = migrated.map((query) => query.text).join("\n");
    expect(migrationSql).toContain('CREATE TABLE "entries"');
    expect(migrationSql).toContain('CREATE TABLE "source_state"');
    expect(migrationSql).toContain('CREATE TABLE "embeddings"');
    expect(migrationSql).toContain('ADD COLUMN "last_error"');
    expect(migrationSql).toContain('ADD COLUMN "status"');
    expect(migrationSql.toLowerCase()).not.toContain("drop ");
    expect(migrationSql.toLowerCase()).not.toContain("super-secret");

    expect(await db.countEntries()).toBe(0);
    expect(await db.listEntries()).toEqual([]);
    expect(
      await db.listEntries({
        source: "node",
        type: "security",
        gap: "new",
        tag: "css%",
        from: "2026-10-01",
        to: "2026-10-31",
        limit: 5,
      }),
    ).toEqual([]);
    const filtered = pgMock.queries.at(-1);
    expect(filtered?.text.toLowerCase()).toContain("limit");
    const params = filtered?.params as unknown[];
    expect(params).toEqual(expect.arrayContaining([
      "node",
      "security",
      "new",
      "2026-10-01T00:00:00.000Z",
      "2026-10-31T23:59:59.999Z",
      '%"css"%',
      5,
    ]));

    expect(await db.listSourceStates()).toEqual([]);
    expect(await db.listSourceStates("node")).toEqual([]);
    expect(await db.getVector("missing", "model")).toBeNull();
    expect(await db.getSummary("missing", "model")).toBeNull();
    await db.setVector("entry:1", "model", [0.1]);
    await db.setSummary("entry:1", "model", "Learn this.");
    await db.upsertSourceState({ source: "node", url: "https://example.com", version: "22.0.0" });
    await db.seed(new Date("2026-10-31T00:00:00.000Z"));
    expect(pgMock.queries.some((query) => /insert into/i.test(query.text))).toBe(true);

    await db.close();
    expect(pgMock.end).toHaveBeenCalled();

    const routed = await createDb("postgresql://localhost/evolution");
    expect(routed.dialect).toBe("postgres");
    await routed.close();
  });
});
