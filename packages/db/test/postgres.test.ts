import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import type { PoolConfig } from "pg";
import { describe, expect, it, vi } from "vitest";
import { DatabaseUnavailableError } from "../src/env";
import { createPostgresDb, type PostgresPoolFactory } from "../src/postgres";
import { POSTGRES_TIMEOUTS, postgresPoolConfig } from "../src/timeouts";
import { postgresIntegrationAction } from "./postgres-gate";

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

  it("logs an idle client error instead of crashing", async () => {
    const instances: EventEmitter[] = [];
    const Factory = class extends EventEmitter {
      constructor(public config: PoolConfig) {
        super();
        instances.push(this);
      }
      async query() {
        return { rows: [] };
      }
      async end() {
        return undefined;
      }
    } as unknown as PostgresPoolFactory;
    const db = await createPostgresDb(DATABASE_URL, { appEnv: "staging", Pool: Factory });
    const uncaught: unknown[] = [];
    const onUncaught = (error: unknown) => {
      uncaught.push(error);
    };
    process.on("uncaughtException", onUncaught);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const idleError = Object.assign(new Error(`terminating connection due to administrator command ${DATABASE_URL}`), {
        code: "57P01",
      });
      expect(() => instances[0]?.emit("error", idleError)).not.toThrow();
      await new Promise((resolve) => setImmediate(resolve));
      expect(uncaught).toEqual([]);
      const logged = errorSpy.mock.calls.flat().map(String).join("\n");
      expect(logged).toContain("idle client error");
      expect(logged).toContain("57P01");
      expect(logged).toContain("***");
      expect(logged).not.toContain("super-secret");
    } finally {
      process.off("uncaughtException", onUncaught);
      errorSpy.mockRestore();
      await db.close();
    }
  });

  it("logs a checked-out client error once when connect fires again", async () => {
    const instances: EventEmitter[] = [];
    const Factory = class extends EventEmitter {
      constructor(public config: PoolConfig) {
        super();
        instances.push(this);
      }
      async query() {
        return { rows: [] };
      }
      async end() {
        return undefined;
      }
    } as unknown as PostgresPoolFactory;
    const url = `${DATABASE_URL}&password=query-secret&sslpassword=ssl-secret`;
    const db = await createPostgresDb(url, { appEnv: "staging", Pool: Factory });
    const checkedOut = new EventEmitter();
    const uncaught: unknown[] = [];
    const onUncaught = (error: unknown) => {
      uncaught.push(error);
    };
    process.on("uncaughtException", onUncaught);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const pool = instances[0];
      pool?.emit("connect", checkedOut);
      pool?.emit("connect", checkedOut);
      expect(checkedOut.listenerCount("error")).toBe(1);
      const dropped = Object.assign(new Error(`connection terminated ${url}`), { code: "57P01" });
      expect(() => checkedOut.emit("error", dropped)).not.toThrow();
      await new Promise((resolve) => setImmediate(resolve));
      expect(uncaught).toEqual([]);
      const logged = errorSpy.mock.calls.flat().map(String).join("\n");
      expect(logged).toContain("checked-out client error");
      expect(logged).not.toContain("idle client error");
      expect(logged).toContain("57P01");
      expect(logged).toContain("***");
      expect(logged).not.toContain("super-secret");
      expect(logged).not.toContain("query-secret");
      expect(logged).not.toContain("ssl-secret");
    } finally {
      process.off("uncaughtException", onUncaught);
      errorSpy.mockRestore();
      await db.close();
    }
  });

  it("logs one shared error object once, as an idle error when the pool sees it", async () => {
    const instances: EventEmitter[] = [];
    const Factory = class extends EventEmitter {
      constructor(public config: PoolConfig) {
        super();
        instances.push(this);
      }
      async query() {
        return { rows: [] };
      }
      async end() {
        return undefined;
      }
    } as unknown as PostgresPoolFactory;
    const db = await createPostgresDb(DATABASE_URL, { appEnv: "staging", Pool: Factory });
    const checkedOut = new EventEmitter();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const pool = instances[0];
      pool?.emit("connect", checkedOut);
      const shared = Object.assign(new Error(`idle disconnect ${DATABASE_URL}`), { code: "57P01" });
      checkedOut.emit("error", shared);
      pool?.emit("error", shared);
      await new Promise((resolve) => setImmediate(resolve));
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const logged = errorSpy.mock.calls.flat().map(String).join("\n");
      expect(logged).toContain("idle client error");
      expect(logged).not.toContain("checked-out client error");
      expect(logged).not.toContain("super-secret");
    } finally {
      errorSpy.mockRestore();
      await db.close();
    }
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
    on() {
      return this;
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
    on() {
      return this;
    }
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

describe("postgres integration gate", () => {
  it("fails in CI when the URL is missing and skips only outside CI", () => {
    expect(postgresIntegrationAction({})).toBe("skip");
    expect(postgresIntegrationAction({ CI: "true" })).toBe("fail");
    expect(postgresIntegrationAction({ CI: "true", POSTGRES_TEST_URL: "  " })).toBe("fail");
    expect(postgresIntegrationAction({ POSTGRES_TEST_URL: "postgresql://localhost/evolution" })).toBe("run");
    expect(
      postgresIntegrationAction({ CI: "true", POSTGRES_TEST_URL: " postgresql://localhost/evolution " }),
    ).toBe("run");
  });
});

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
