import { ENTRY_TYPE_LABELS, SOURCE_LABELS, formatDay, type RankedWorthLearning } from "@evolution/shared-types";
import { EmptyState } from "@/components/empty-state";
import { EntryCard, EntrySourceLink } from "@/components/entry-card";
import { Badge } from "@/components/ui/badge";

/**
 * Renders ranked rows. The intro describes `heuristicWorthLearningStrategy`.
 * Update this copy when `activeWorthLearningStrategy` changes.
 */
export function WorthLearningView({
  items,
  emptyDatabase,
  invalid,
}: {
  items: RankedWorthLearning[];
  emptyDatabase: boolean;
  invalid: boolean;
}) {
  return (
    <section aria-label="Worth learning" data-strategy="heuristic" className="flex flex-col gap-4">
      <div>
        <h2 className="font-[family-name:var(--font-heading)] text-2xl">Worth learning</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Flagged by a stand-in heuristic: security and LTS releases, baseline and support changes, and stable major or
          minor versions. Source weight and recency set the order. With no date range, the window is the last 30 days.
          A profile match can replace this ranking later.
        </p>
      </div>
      {invalid ? (
        <EmptyState
          title="Those filters are not recognised"
          body="Choose a source from the list and a from/to date in YYYY-MM-DD."
        />
      ) : emptyDatabase ? (
        <EmptyState
          title="Nothing to rank yet"
          body="Run pnpm db:setup to load the local seed, or pnpm ingest once the sources are reachable."
        />
      ) : items.length === 0 ? (
        <EmptyState
          title="Nothing worth learning in this slice"
          body="The heuristic skips prereleases and routine patches. Clear the date range to use the last 30 days, or widen the source."
        />
      ) : (
        <ol className="flex flex-col gap-3">
          {items.map((item, index) => (
            <EntryCard key={item.entry.id}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 gap-3">
                  <span aria-hidden="true" className="mt-0.5 font-mono text-xs text-muted-foreground">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <EntrySourceLink href={item.entry.url}>{item.entry.title}</EntrySourceLink>
                    <p className="text-sm text-muted-foreground">
                      {SOURCE_LABELS[item.entry.source]} · {formatDay(item.entry.date)}
                    </p>
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {item.reasons.map((reason) => (
                        <li key={reason}>
                          <Badge>{reason}</Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                  <Badge variant="outline">{ENTRY_TYPE_LABELS[item.entry.type]}</Badge>
                  <span className="font-mono text-xs text-muted-foreground">Score {item.score}</span>
                </div>
              </div>
            </EntryCard>
          ))}
        </ol>
      )}
    </section>
  );
}
