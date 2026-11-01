import { execFileSync } from "node:child_process";
import { rmSync, utimesSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { e2eDatabasePath, e2eDatabaseUrl, repoRoot } from "./constants";

interface SqliteHandle {
  exec(sql: string): void;
  close(): void;
}

const require = createRequire(path.join(repoRoot, "packages/db/package.json"));
const Database = require("better-sqlite3") as new (filename: string) => SqliteHandle;

function touchDatabase(): void {
  const stamp = new Date(Date.now() + 2000);
  utimesSync(e2eDatabasePath, stamp, stamp);
}

function removeSidecars(): void {
  rmSync(`${e2eDatabasePath}-wal`, { force: true });
  rmSync(`${e2eDatabasePath}-shm`, { force: true });
}

export function seedDatabase(): void {
  rmSync(e2eDatabasePath, { force: true });
  removeSidecars();
  execFileSync("pnpm", ["db:setup"], {
    cwd: repoRoot,
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: e2eDatabaseUrl },
  });
}

export function emptyDatabase(): void {
  const db = new Database(e2eDatabasePath);
  try {
    db.exec("DELETE FROM entries; DELETE FROM source_state;");
  } finally {
    db.close();
  }
  touchDatabase();
}

export function corruptDatabase(): void {
  removeSidecars();
  writeFileSync(e2eDatabasePath, "not a sqlite database");
  touchDatabase();
}
