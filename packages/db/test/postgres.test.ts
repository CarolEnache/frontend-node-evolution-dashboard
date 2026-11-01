import { readFileSync } from "node:fs";
import type { PoolConfig } from "pg";
import { describe, expect, it } from "vitest";
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
    expect(journal.entries).toHaveLength(1);
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
