import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createDb, DatabaseCorruptError } from "../src/index";

const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), "../package.json"));
const Database = require("better-sqlite3") as new (filename: string) => {
  exec(sql: string): void;
  close(): void;
};

function tempFile(name: string): string {
  return path.join(mkdtempSync(path.join(tmpdir(), "evolution-corrupt-")), name);
}

describe("corrupt sqlite", () => {
  it("raises DatabaseCorruptError for a non-SQLite file", async () => {
    const file = tempFile("dev.sqlite");
    writeFileSync(file, "not a sqlite database");
    await expect(createDb(`file:${file}`)).rejects.toBeInstanceOf(DatabaseCorruptError);
    await expect(createDb(`file:${file}`)).rejects.toThrow(/database is corrupt/i);
  });

  it("raises DatabaseCorruptError when a SQLite file is truncated", async () => {
    const file = tempFile("truncated.sqlite");
    const sqlite = new Database(file);
    sqlite.exec("CREATE TABLE t (id INTEGER)");
    sqlite.close();
    const bytes = await import("node:fs").then((fs) => fs.readFileSync(file).subarray(0, 100));
    writeFileSync(file, bytes);
    await expect(createDb(`file:${file}`)).rejects.toBeInstanceOf(DatabaseCorruptError);
    await expect(createDb(`file:${file}`)).rejects.toThrow(/database is corrupt/i);
  });
});
