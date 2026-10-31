import { isPostgresUrl, resolveDatabaseUrl } from "./paths";
import type { DashboardDb } from "./types";

export { findRepoRoot, isPostgresUrl, resolveDatabaseUrl, sqliteFilePath } from "./paths";
export { buildSeedEntries, buildSeedStates } from "./seed-data";
export type { DashboardDb } from "./types";

export async function createDb(databaseUrl?: string): Promise<DashboardDb> {
  const url = resolveDatabaseUrl(databaseUrl);
  if (isPostgresUrl(url)) {
    const { createPostgresDb } = await import("./postgres");
    return createPostgresDb(url);
  }
  const { createSqliteDb } = await import("./sqlite");
  const db = createSqliteDb(url);
  await db.migrate();
  return db;
}
