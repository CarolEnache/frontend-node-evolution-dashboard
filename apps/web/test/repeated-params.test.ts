import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDb } from "@evolution/db";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../src/app/api/entries/route";
import { parseQuery, queryRecord } from "../src/lib/filters";

const REPEATED =
  "source=node&source=typescript&type=lts&type=security&gap=already-know&gap=new&tag=css&tag=node&from=2026-01-02&from=2026-06-01&to=2026-01-31&to=2026-12-31";

describe("repeated filter params", () => {
  it("keeps the first value of every single-value filter param", () => {
    const parsed = parseQuery({
      source: ["node", "typescript"],
      type: ["lts", "security"],
      gap: ["already-know", "new"],
      tag: [" css ", "node"],
      from: ["2026-01-02", "2026-06-01"],
      to: ["2026-01-31", "2026-12-31"],
    });

    expect(parsed.invalid).toBe(false);
    expect(parsed.filter).toEqual({
      source: "node",
      type: "lts",
      gap: "already-know",
      tag: "css",
      from: "2026-01-02",
      to: "2026-01-31",
    });
    expect(parsed.flat).toEqual(parsed.filter);
  });

  it("does not consult a later value when the first occurrence is blank", () => {
    const parsed = parseQuery({
      source: ["  ", "node"],
      type: ["", "lts"],
      gap: [" ", "new"],
      tag: ["", "css"],
      from: ["", "2026-01-02"],
      to: ["  ", "2026-01-31"],
    });

    expect(parsed.invalid).toBe(false);
    expect(parsed.filter).toEqual({});
    expect(parsed.flat).toEqual({});
  });

  it("applies the first value even when that value is not a known enum or date", () => {
    const parsed = parseQuery({
      source: ["nope", "node"],
      type: ["Release", "security"],
      gap: ["soon", "new"],
      from: ["yesterday", "2026-01-02"],
      to: ["2026-13-40", "2026-01-31"],
    });

    expect(parsed.invalid).toBe(true);
    expect(parsed.filter).toEqual({});
    expect(parsed.flat).toEqual({});
  });

  it("preserves repeated URLSearchParams in order so parseQuery can take the first", () => {
    const search = new URLSearchParams(REPEATED);

    expect(queryRecord(search)).toEqual({
      source: ["node", "typescript"],
      type: ["lts", "security"],
      gap: ["already-know", "new"],
      tag: ["css", "node"],
      from: ["2026-01-02", "2026-06-01"],
      to: ["2026-01-31", "2026-12-31"],
    });
    expect(queryRecord(new URLSearchParams("tag=css&source=node"))).toEqual({
      tag: "css",
      source: "node",
    });
    expect(queryRecord(new URLSearchParams("tag=css&tag=node&tag=lts")).tag).toEqual(["css", "node", "lts"]);

    const shared = parseQuery(queryRecord(search));
    expect(shared.filter).toEqual({
      source: "node",
      type: "lts",
      gap: "already-know",
      tag: "css",
      from: "2026-01-02",
      to: "2026-01-31",
    });
    expect(parseQuery(Object.fromEntries(search.entries())).filter.tag).toBe("node");
  });

  it("stores __proto__ and constructor as data instead of changing the prototype", () => {
    const record = queryRecord(new URLSearchParams("__proto__=a&__proto__=b&constructor=c&constructor=d"));

    expect(Object.getPrototypeOf(record)).toBeNull();
    expect(Object.hasOwn(record, "__proto__")).toBe(true);
    expect(record["__proto__"]).toEqual(["a", "b"]);
    expect(Object.hasOwn(record, "constructor")).toBe(true);
    expect(record.constructor).toEqual(["c", "d"]);
    expect(parseQuery(record).filter).toEqual({});
  });
});

describe("GET /api/entries repeated params", () => {
  let databaseUrl = "";

  beforeAll(async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "evolution-repeated-")), "entries.sqlite");
    databaseUrl = `file:${file}`;
    const db = await createDb(databaseUrl);
    await db.seed(new Date("2026-10-31T00:00:00.000Z"));
    await db.close();
  });

  beforeEach(() => {
    vi.stubEnv("APP_ENV", "local");
    vi.stubEnv("DATABASE_URL", databaseUrl);
  });

  async function body(query: string): Promise<{ entries: Array<{ title: string }> }> {
    const response = await GET(new Request(`http://localhost/api/entries?${query}`));
    expect(response.status).toBe(200);
    return response.json() as Promise<{ entries: Array<{ title: string }> }>;
  }

  it("uses the first tag when tag is repeated, matching a single tag=css", async () => {
    const repeated = await body("tag=css&tag=node");
    const first = await body("tag=css");
    const last = await body("tag=node");

    expect(repeated.entries.map((entry) => entry.title).sort()).toEqual([
      "CSS Grid support in Firefox",
      "CSS overflow-clip-margin",
    ]);
    expect(repeated).toEqual(first);
    expect(repeated).not.toEqual(last);
  });

  it("uses the first value for source, type, gap, from, and to", async () => {
    const cases = [
      ["source", "node", "typescript"],
      ["type", "lts", "security"],
      ["gap", "already-know", "new"],
      ["from", "2020-01-01", "2999-01-01"],
      ["to", "2099-12-31", "1999-01-01"],
    ] as const;

    for (const [key, firstValue, lastValue] of cases) {
      const repeated = await body(`${key}=${firstValue}&${key}=${lastValue}`);
      const first = await body(`${key}=${firstValue}`);
      const last = await body(`${key}=${lastValue}`);
      expect(repeated, key).toEqual(first);
      expect(repeated.entries.length, key).toBeGreaterThan(0);
      expect(repeated, key).not.toEqual(last);
    }
  });
});
