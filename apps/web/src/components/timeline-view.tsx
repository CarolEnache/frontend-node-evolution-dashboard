import {
  ENTRY_TYPE_LABELS,
  SOURCE_LABELS,
  formatDay,
  groupEntriesByWeek,
  type Entry,
  type Source,
} from "@evolution/shared-types";
import { EmptyState } from "@/components/empty-state";
import { GapBadge } from "@/components/gap-badge";
import { Badge } from "@/components/ui/badge";

const SOURCE_MARK: Record<Source, string> = {
  "mdn-bcd": "MDN",
  caniuse: "CIU",
  node: "Node",
  typescript: "TS",
  nextjs: "Next",
  tc39: "TC39",
  v8: "V8",
  "2ality": "2al",
  "javascript-weekly": "JSWk",
  bytes: "Byte",
  webdev: "web",
  mcp: "MCP",
};

export function TimelineView({
  entries,
  emptyDatabase,
  invalid,
}: {
  entries: Entry[];
  emptyDatabase: boolean;
  invalid: boolean;
}) {
  return (
    <section aria-label="Timeline" className="flex flex-col gap-8">
      {invalid ? (
        <EmptyState
          title="Those filters are not recognised"
          body="Choose a source from the list and a from/to date in YYYY-MM-DD."
        />
      ) : emptyDatabase ? (
        <EmptyState
          title="The timeline is empty"
          body="Run pnpm db:setup to load the local seed, or pnpm ingest once the sources are reachable."
        />
      ) : entries.length === 0 ? (
        <EmptyState
          title="Nothing in this slice"
          body="Widen the source or date range. Worth learning keeps its own window when no range is set."
        />
      ) : (
        groupEntriesByWeek(entries).map((group) => (
          <div key={group.week} className="flex flex-col gap-3">
            <h2 className="font-mono text-xs tracking-wide text-muted-foreground uppercase">{group.label}</h2>
            <ol className="flex flex-col gap-3">
              {group.entries.map((entry) => (
                <EntryRow key={entry.id} entry={entry} />
              ))}
            </ol>
          </div>
        ))
      )}
    </section>
  );
}

function EntryRow({ entry }: { entry: Entry }) {
  return (
    <li className="rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className="mt-0.5 inline-flex h-7 shrink-0 items-center rounded-md bg-secondary px-1.5 font-mono text-[10px] tracking-wide text-secondary-foreground">
            {SOURCE_MARK[entry.source]}
          </span>
          <div className="min-w-0">
            <a href={entry.url} className="font-medium hover:underline focus-visible:underline">
              {entry.title}
            </a>
            <p className="text-sm text-muted-foreground">{entry.summary}</p>
            <p className="sr-only">{SOURCE_LABELS[entry.source]}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
          <Badge variant="outline">{ENTRY_TYPE_LABELS[entry.type]}</Badge>
          <GapBadge gap={entry.gap} similarity={entry.similarity} />
          <time dateTime={entry.date} className="font-mono text-xs text-muted-foreground">
            {formatDay(entry.date)}
          </time>
        </div>
      </div>
      {entry.tags.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1.5 pl-0 sm:pl-12">
          {entry.tags.map((tag) => (
            <li key={tag}>
              <Badge variant="secondary">{tag}</Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
