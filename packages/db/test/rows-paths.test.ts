import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Entry, SourceState } from "@evolution/shared-types";
import { resolveDatabaseUrl } from "../src/env";
import {
  defaultDatabaseUrl,
  findRepoRoot,
  isPostgresUrl,
  sqliteFilePath,
} from "../src/paths";
import { fromEntryRow, fromStateRow, toEntryRow, toStateRow, type EntryRow } from "../src/rows";

const entry: Entry = {
  id: "node:release:22.0.0",
  source: "node",
  type: "release",
  title: "Node.js 22",
  version: "22.0.0",
  date: "2026-10-28T00:00:00.000Z",
  url: "https://example.com",
  summary: "A release.",
  tags: ["node", "lts"],
  raw: { ok: true },
  similarity: 0,
  gap: "new",
  worthLearning: "Read the notes.",
};

describe("row mapping", () => {
  it("round-trips entries and source state", () => {
    const row = toEntryRow(entry, "2026-10-31T00:00:00.000Z");
    expect(fromEntryRow(row)).toEqual(entry);
    const state: SourceState = {
      source: "mdn-bcd",
      url: "https://example.com/meta",
      etag: null,
      lastModified: null,
      version: null,
      lastFetchedAt: null,
      lastSuccessAt: null,
    };
    expect(fromStateRow(toStateRow(state))).toEqual(state);
  });

  it("drops invalid optional fields and rejects corrupt identities", () => {
    const row = toEntryRow({ ...entry, version: undefined, similarity: undefined, gap: undefined, worthLearning: undefined, raw: null }, "t");
    const parsed = fromEntryRow({ ...row, gap: "nope", tags: JSON.stringify(["ok", 1, null]) });
    expect(parsed.version).toBeUndefined();
    expect(parsed.similarity).toBeUndefined();
    expect(parsed.gap).toBeUndefined();
    expect(parsed.worthLearning).toBeUndefined();
    expect(parsed.raw).toBeNull();
    expect(parsed.tags).toEqual(["ok"]);
    expect(fromEntryRow({ ...row, tags: "null" }).tags).toEqual([]);
    expect(() => fromEntryRow({ ...row, source: "nope" })).toThrow(/Corrupt entry/);
    expect(() => fromEntryRow({ ...row, type: "nope" })).toThrow(/Corrupt entry/);
    expect(() => fromEntryRow({ ...row, tags: "{" })).toThrow();
    expect(() => fromStateRow({ ...toStateRow({ source: "node", url: "https://example.com" }), source: "nope" })).toThrow(
      /Corrupt source state/,
    );
  });

  it("keeps a numeric similarity of zero", () => {
    const row: EntryRow = toEntryRow(entry, "t");
    expect(fromEntryRow({ ...row, similarity: 0 }).similarity).toBe(0);
  });
});

describe("database paths", () => {
  it("detects postgres URLs and resolves sqlite file paths", () => {
    expect(isPostgresUrl("postgres://localhost/db")).toBe(true);
    expect(isPostgresUrl("postgresql://localhost/db")).toBe(true);
    expect(isPostgresUrl("POSTGRES://localhost/db")).toBe(false);
    expect(isPostgresUrl("file:./data/dev.sqlite")).toBe(false);
    expect(isPostgresUrl("")).toBe(false);
    expect(sqliteFilePath("file:./data/dev.sqlite")).toBe(path.resolve("data/dev.sqlite"));
    expect(sqliteFilePath("file:/tmp/evolution.sqlite")).toBe("/tmp/evolution.sqlite");
    expect(sqliteFilePath(":memory:")).toBe(":memory:");
    expect(sqliteFilePath("file::memory:")).toBe(":memory:");
  });

  it("finds the repo root and falls back when DATABASE_URL is blank", () => {
    vi.stubEnv("APP_ENV", "");
    expect(findRepoRoot(path.join(findRepoRoot(), "packages", "db", "src"))).toBe(findRepoRoot());
    expect(defaultDatabaseUrl()).toBe(`file:${path.join(findRepoRoot(), "data", "dev.sqlite")}`);
    expect(() => findRepoRoot(mkdtempSync(path.join(tmpdir(), "evolution-root-")))).toThrow(/pnpm-workspace.yaml/);
    expect(resolveDatabaseUrl("")).toBe(defaultDatabaseUrl());
    expect(resolveDatabaseUrl("   ")).toBe(defaultDatabaseUrl());
    expect(resolveDatabaseUrl("  file:/tmp/custom.sqlite  ")).toBe("file:/tmp/custom.sqlite");
    vi.stubEnv("DATABASE_URL", "postgresql://localhost/evolution");
    expect(resolveDatabaseUrl()).toBe("postgresql://localhost/evolution");
    vi.stubEnv("DATABASE_URL", "  ");
    expect(resolveDatabaseUrl()).toBe(defaultDatabaseUrl());
  });
});
