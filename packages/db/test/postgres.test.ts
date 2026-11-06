import { describe, expect, it, vi } from "vitest";

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
import { createPostgresDb } from "../src/postgres";

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
    // Main runs INIT_SQL plus a schema_migrations insert. FNED-9 replaces that
    // with the drizzle postgres migration and deletes sql.ts.
    expect(migrationSql.toLowerCase()).toContain("entries");
    expect(migrationSql.toLowerCase()).toContain("source_state");
    expect(migrationSql.toLowerCase()).toContain("embeddings");
    const recordedId = migrated.find((query) => /insert into schema_migrations/i.test(query.text));
    if (recordedId) {
      expect(recordedId.params).toEqual(["0001_init", expect.any(String)]);
    } else {
      expect(migrationSql).toContain('CREATE TABLE "entries"');
      expect(migrationSql).toContain('CREATE TABLE "source_state"');
      expect(migrationSql).toContain('CREATE TABLE "embeddings"');
    }

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
