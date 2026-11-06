import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { DatabaseDialect } from "./env";
import { migrationsDir } from "./migrations";

export interface MigrationRecord {
  hash: string;
  folderMillis: number;
}

/** Same hash and timestamp Drizzle stores, so a baselined database is not migrated again. */
export function migrationRecords(dialect: DatabaseDialect): MigrationRecord[] {
  const folder = migrationsDir(dialect);
  const journal = JSON.parse(readFileSync(path.join(folder, "meta", "_journal.json")).toString()) as {
    entries: Array<{ tag: string; when: number }>;
  };
  return journal.entries.map((entry) => {
    const sqlText = readFileSync(path.join(folder, `${entry.tag}.sql`)).toString();
    return {
      hash: createHash("sha256").update(sqlText).digest("hex"),
      folderMillis: entry.when,
    };
  });
}

export function shouldRecordBaseline(createdAt: number | undefined, firstMillis: number): boolean {
  return createdAt === undefined || Number(createdAt) < firstMillis;
}
