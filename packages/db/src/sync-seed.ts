import type { Entry } from "@evolution/shared-types";
import { buildSeedEntries, buildSeedStates } from "./seed-data";
import type { DashboardDb } from "./types";

export interface SyncSeedResult {
  inserted: number;
  updated: number;
  unchanged: number;
}

function contentChanged(current: Entry, seed: Entry): boolean {
  return (
    current.url !== seed.url ||
    current.title !== seed.title ||
    current.summary !== seed.summary ||
    current.version !== seed.version ||
    JSON.stringify(current.tags) !== JSON.stringify(seed.tags) ||
    current.worthLearning !== seed.worthLearning
  );
}

/**
 * Idempotent content sync for existing databases.
 * Inserts missing seed rows. Updates URL and copy on existing ids.
 * Leaves the stored date, gap and similarity of existing rows alone.
 * Never deletes rows, and only writes source_state rows that do not exist yet,
 * so real ingest state (etag, version, last success) is never overwritten.
 */
export async function syncSeedContent(db: DashboardDb, now = new Date()): Promise<SyncSeedResult> {
  const seeds = buildSeedEntries(now);
  // Read every row so a seed id beyond the default list cap is not mistaken for a missing one.
  const existing = await db.listEntries({ limit: Math.max(1000, await db.countEntries()) });
  const byId = new Map(existing.map((entry) => [entry.id, entry]));
  const toUpsert: Entry[] = [];
  const result: SyncSeedResult = { inserted: 0, updated: 0, unchanged: 0 };

  for (const seed of seeds) {
    const current = byId.get(seed.id);
    if (!current) {
      toUpsert.push(seed);
      result.inserted += 1;
      continue;
    }
    if (contentChanged(current, seed)) {
      toUpsert.push({
        ...seed,
        date: current.date,
        similarity: current.similarity,
        gap: current.gap,
      });
      result.updated += 1;
      continue;
    }
    result.unchanged += 1;
  }

  if (toUpsert.length > 0) await db.upsertEntries(toUpsert);
  const stateKeys = new Set((await db.listSourceStates()).map((state) => `${state.source}\n${state.url}`));
  for (const state of buildSeedStates(now)) {
    if (!stateKeys.has(`${state.source}\n${state.url}`)) await db.upsertSourceState(state);
  }
  return result;
}
