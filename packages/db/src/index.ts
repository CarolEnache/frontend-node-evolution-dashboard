import { resolveDatabaseTarget } from "./env";
import type { DashboardDb } from "./types";

export {
  DatabaseConfigError,
  DatabaseUnavailableError,
  NEON_ENVIRONMENTS,
  redactDatabaseUrl,
  resolveAppEnv,
  resolveDatabaseTarget,
  resolveDatabaseUrl,
} from "./env";
export type { AppEnvironment, DatabaseDialect, DatabaseTarget, NeonEnvironment } from "./env";
export { findRepoRoot, isPostgresUrl, sqliteFilePath } from "./paths";
export { buildSeedEntries, buildSeedStates, SEED_ENTRY_COUNT, isSourceCatalogEntry } from "./seed-data";
export { syncSeedContent, type SyncSeedResult } from "./sync-seed";
export { POSTGRES_TIMEOUTS } from "./timeouts";
export type { DashboardDb } from "./types";

export async function createDb(databaseUrl?: string): Promise<DashboardDb> {
  const explicit = databaseUrl !== undefined && databaseUrl.trim() !== "";
  const target = resolveDatabaseTarget({
    appEnv: process.env.APP_ENV,
    databaseUrl: explicit ? databaseUrl : process.env.DATABASE_URL,
    explicitUrl: explicit,
  });
  if (target.dialect === "postgres") {
    const { createPostgresDb } = await import("./postgres");
    return createPostgresDb(target.url, { appEnv: target.appEnv });
  }
  const { createSqliteDb } = await import("./sqlite");
  const db = createSqliteDb(target.url);
  await db.migrate();
  return db;
}
