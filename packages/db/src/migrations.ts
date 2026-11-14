import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseDialect } from "./env";
import { findRepoRoot } from "./paths";

export function migrationsDir(dialect: DatabaseDialect): string {
  const besideSource = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations", dialect);
  if (existsSync(path.join(besideSource, "meta", "_journal.json"))) return besideSource;
  return path.join(findRepoRoot(), "packages", "db", "migrations", dialect);
}
