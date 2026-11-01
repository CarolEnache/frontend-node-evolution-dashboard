import { describe, expect, it, vi } from "vitest";
import { INIT_SQL } from "../src/sql";

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
    const db = createPostgresDb("postgresql://localhost/evolution");
    expect(db.dialect).toBe("postgres");
    const before = pgMock.queries.length;
    await db.upsertEntries([]);
    expect(pgMock.queries.length).toBe(before);

    await db.migrate();
    expect(pgMock.queries[0]?.text).toBe(INIT_SQL);
    expect(pgMock.queries[1]?.text).toMatch(/schema_migrations/);
    expect(pgMock.queries[1]?.params).toEqual(["0001_init", expect.any(String)]);

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
