import { execFileSync } from "node:child_process";
import { rmSync, utimesSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { e2eDatabasePath, e2eDatabaseUrl, repoRoot } from "./constants";

interface SqliteStatement {
  run(params: Record<string, string | null>): void;
}

interface SqliteHandle {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  transaction(fn: () => void): () => void;
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
    env: { ...process.env, APP_ENV: "local", DATABASE_URL: e2eDatabaseUrl },
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

const FLOOD_PREFIX = "e2e-flood:";
/** One more than the timeline cap, so newer filler rows push every other source out of it. */
const FLOOD_COUNT = 1001;

export function floodOlderSources(): void {
  const db = new Database(e2eDatabasePath);
  try {
    const insert = db.prepare(`INSERT INTO entries (
      id, source, type, title, version, date, url, summary, tags, raw, gap, updated_at
    ) VALUES (
      @id, @source, @type, @title, @version, @date, @url, @summary, @tags, @raw, @gap, @updatedAt
    )`);
    const write = db.transaction(() => {
      const newer = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      for (let index = 0; index < FLOOD_COUNT; index += 1) {
        insert.run({
          id: `${FLOOD_PREFIX}mdn:${index}`,
          source: "mdn-bcd",
          type: "feature",
          title: `Flooded MDN feature ${index}`,
          version: null,
          date: newer,
          url: "https://example.com/flood",
          summary: "Newer than the timeline cap.",
          tags: "[]",
          raw: "null",
          gap: null,
          updatedAt: newer,
        });
      }
      insert.run({
        id: `${FLOOD_PREFIX}node`,
        source: "node",
        type: "lts",
        title: "Node.js 12.22.12 buried release",
        version: "12.22.12",
        date: "2019-06-01T00:00:00.000Z",
        url: "https://example.com/node-12",
        summary: "Old Node.js release hidden behind newer rows.",
        tags: JSON.stringify(["lts", "node"]),
        raw: "null",
        gap: null,
        updatedAt: "2019-06-01T00:00:00.000Z",
      });
    });
    write();
  } finally {
    db.close();
  }
  touchDatabase();
}

export function drainFlood(): void {
  const db = new Database(e2eDatabasePath);
  try {
    db.exec(`DELETE FROM entries WHERE id LIKE '${FLOOD_PREFIX}%'`);
  } finally {
    db.close();
  }
  touchDatabase();
}
