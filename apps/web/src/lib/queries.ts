import {
  activeWorthLearningStrategy,
  filterEntries,
  type Entry,
  type EntryFilter,
  type RankedWorthLearning,
  type WorthLearningStrategy,
} from "@evolution/shared-types";

/** Newest first. Honours source, type, gap, tag, and the inclusive date range. */
export function queryTimeline(entries: readonly Entry[], filter: EntryFilter): Entry[] {
  return filterEntries([...entries], filter);
}

/**
 * Rank the filtered entries with the active worth-learning strategy.
 * A from/to range replaces the strategy's default window. Pass another
 * `WorthLearningStrategy` to swap the heuristic for the enrichment rank.
 */
export function queryWorthLearning(
  entries: readonly Entry[],
  filter: EntryFilter,
  now: number,
  strategy: WorthLearningStrategy = activeWorthLearningStrategy,
): RankedWorthLearning[] {
  const hasRange = Boolean(filter.from || filter.to);
  const filtered = filterEntries([...entries], {
    source: filter.source,
    tag: filter.tag,
    type: filter.type,
    gap: filter.gap,
    ...(hasRange ? { from: filter.from, to: filter.to } : {}),
  });
  return strategy.select(filtered, {
    now,
    ...(hasRange ? { windowDays: null } : {}),
  });
}
