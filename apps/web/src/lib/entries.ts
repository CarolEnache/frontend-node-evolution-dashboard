import "server-only";
import { statSync } from "node:fs";
import { cacheLife, cacheTag } from "next/cache";
import { createDb, isPostgresUrl, resolveDatabaseUrl, sqliteFilePath } from "@evolution/db";
import { SOURCES, type Entry, type EntryFilter, type SourceState } from "@evolution/shared-types";

/** Newest matching rows for the timeline and /api/entries. Applied after filters. */
export const TIMELINE_LIMIT = 1000;

/** Newest rows read for each source when resolving the summary-card version. */
export const SOURCE_CARD_LIMIT = 100;

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
      db.listEntries({ limit: TIMELINE_LIMIT }),
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
    return await db.listEntries({ ...filter, limit: TIMELINE_LIMIT });
  } finally {
    await db.close();
  }
}

/** Newest rows of every source, so summary cards are not taken from the timeline cap. */
export async function loadSourceCardEntries(cacheKey: string): Promise<Entry[]> {
  "use cache";
  cacheLife("hours");
  cacheTag("entries");
  void cacheKey;
  const db = await createDb();
  try {
    const groups = await Promise.all(
      SOURCES.map((source) => db.listEntries({ source, limit: SOURCE_CARD_LIMIT })),
    );
    return groups.flat();
  } finally {
    await db.close();
  }
}
