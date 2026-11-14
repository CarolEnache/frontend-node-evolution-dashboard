import "server-only";
import { statSync } from "node:fs";
import { cacheLife, cacheTag } from "next/cache";
import { createDb, isPostgresUrl, resolveDatabaseUrl, sqliteFilePath } from "@evolution/db";
import type { Entry, EntryFilter, SourceState } from "@evolution/shared-types";

export interface DashboardData {
  entries: Entry[];
  states: SourceState[];
}

/**
 * Hour-long cache. Next.js 16 Cache Components reject `export const revalidate`,
 * so this is the `cacheLife('hours')` equivalent of a 3600s ISR window.
 * The worker drops the tag through POST /api/revalidate.
 */
/** Includes the SQLite mtime so a seed is visible without waiting out the hour cache. */
export function dashboardCacheKey(): string {
  const url = resolveDatabaseUrl();
  if (isPostgresUrl(url)) return url;
  try {
    return `${url}:${statSync(sqliteFilePath(url)).mtimeMs}`;
  } catch {
    return url;
  }
}

export function currentTimeMs(): number {
  return Date.now();
}

export async function loadDashboard(cacheKey: string): Promise<DashboardData> {
  "use cache";
  cacheLife("hours");
  cacheTag("entries");
  void cacheKey;
  const db = await createDb();
  try {
    const [entries, states] = await Promise.all([
      db.listEntries({ limit: 1000 }),
      db.listSourceStates(),
    ]);
    return { entries, states };
  } finally {
    await db.close();
  }
}

export async function loadFilteredEntries(cacheKey: string, filter: EntryFilter): Promise<Entry[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("entries");
  void cacheKey;
  const db = await createDb();
  try {
    return await db.listEntries({ ...filter, limit: 1000 });
  } finally {
    await db.close();
  }
}
