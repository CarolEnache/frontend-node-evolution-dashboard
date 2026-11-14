import { sql, type AnyColumn, type SQL } from "drizzle-orm";
import type { EntryRow } from "./rows";

export interface UpsertEntriesOptions {
  /**
   * Keep stored gap, similarity, and worth-learning when this write did not
   * classify the row. A later enrich still replaces those columns.
   */
  preserveEnrichment?: boolean;
}

interface EnrichmentColumns {
  similarity: AnyColumn;
  gap: AnyColumn;
  worthLearning: AnyColumn;
}

/** Conflict update for one entry. Unenriched writes must not null out stored classification. */
export function entryConflictSet(
  row: EntryRow,
  columns: EnrichmentColumns,
  preserveEnrichment: boolean,
): { [Key in keyof EntryRow]: EntryRow[Key] | SQL } {
  if (!preserveEnrichment) return row;
  return {
    ...row,
    similarity: sql`coalesce(excluded.similarity, ${columns.similarity})`,
    gap: sql`coalesce(excluded.gap, ${columns.gap})`,
    worthLearning: sql`coalesce(excluded.worth_learning, ${columns.worthLearning})`,
  };
}
