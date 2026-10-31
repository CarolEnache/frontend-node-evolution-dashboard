import type { ReactNode } from "react";
import Link from "next/link";
import { connection } from "next/server";
import {
  ENTRY_TYPE_LABELS,
  GAP_LABELS,
  SOURCE_LABELS,
  filterEntries,
  formatDay,
  groupEntriesByWeek,
  selectWorthLearning,
  snapshotSources,
  type Entry,
  type Source,
} from "@evolution/shared-types";
import profile from "../../../../profile/skills.json";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { GapBadge } from "@/components/gap-badge";
import { currentTimeMs, dashboardCacheKey, loadDashboard } from "@/lib/entries";
import { GAP_ORDER, SOURCE_ORDER, TYPE_ORDER, hrefWith, isoDay, parseQuery, type QueryValue } from "@/lib/filters";

const SOURCE_MARK: Record<Source, string> = {
  "mdn-bcd": "MDN",
  caniuse: "CIU",
  node: "Node",
  typescript: "TS",
  nextjs: "Next",
};

export async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<Record<string, QueryValue>>;
}) {
  await connection();
  const params = await searchParams;
  const parsed = parseQuery(params);
  const data = await loadDashboard(dashboardCacheKey());
  const timeline = parsed.invalid ? [] : filterEntries(data.entries, parsed.filter);
  const worthPool = filterEntries(data.entries, {
    source: parsed.filter.source,
    tag: parsed.filter.tag,
    type: parsed.filter.type,
  });
  const nowMs = currentTimeMs();
  const worth = parsed.invalid ? [] : selectWorthLearning(worthPool, nowMs);
  const snapshots = snapshotSources(data.entries, data.states);
  const now = new Date(nowMs);
  const from30 = isoDay(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
  const from90 = isoDay(new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000));

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-6 border-b border-border pb-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-[11px] tracking-[0.22em] text-muted-foreground uppercase">Frontend platform</p>
            <h1 className="font-[family-name:var(--font-heading)] text-4xl tracking-tight sm:text-5xl">Evolution</h1>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              Releases, baseline shifts, and the short list worth learning. Tuned for a {profile.role.toLowerCase()}.
            </p>
          </div>
          <p className="font-mono text-xs text-muted-foreground">{timeline.length} in view</p>
        </div>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {snapshots.map((item) => (
            <div key={item.source} className="rounded-xl bg-card px-3 py-2 ring-1 ring-foreground/10">
              <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">{item.label}</dt>
              <dd className="font-mono text-sm">{item.version ?? "—"}</dd>
              <dd className="text-[11px] text-muted-foreground">
                {item.lastSuccessAt ? `Checked ${formatDay(item.lastSuccessAt)}` : "No successful run"}
              </dd>
            </div>
          ))}
        </dl>
        <Filters parsed={parsed} from30={from30} from90={from90} />
      </header>
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <main>
          <section aria-label="Timeline" className="flex flex-col gap-8">
            {data.entries.length === 0 ? (
              <Empty
                title="The timeline is empty"
                body="Run pnpm db:setup to load the local seed, or pnpm ingest once the sources are reachable."
              />
            ) : timeline.length === 0 ? (
              <Empty
                title="Nothing in this slice"
                body="Widen the source, tag, or date range. The worth-learning list keeps its own 30-day window."
              />
            ) : (
              groupEntriesByWeek(timeline).map((group) => (
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
        </main>
        <aside aria-label="Worth learning" className="flex flex-col gap-3 lg:sticky lg:top-6">
          <div>
            <h2 className="font-[family-name:var(--font-heading)] text-2xl">Worth learning</h2>
            <p className="text-sm text-muted-foreground">Adjacent and new from the last 30 days, ranked by recency times how unfamiliar it is.</p>
          </div>
          {worth.length === 0 ? (
            <p className="rounded-xl bg-card px-4 py-6 text-sm text-muted-foreground ring-1 ring-foreground/10">
              Nothing adjacent or new in the last 30 days for this slice.
            </p>
          ) : (
            <ol className="flex flex-col gap-3">
              {worth.map((entry) => (
                <li key={entry.id}>
                  <Card>
                    <CardHeader>
                      <CardDescription>{SOURCE_LABELS[entry.source]} · {formatDay(entry.date)}</CardDescription>
                      <CardTitle className="text-base leading-snug">
                        <a href={entry.url} className="hover:underline">{entry.title}</a>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-2">
                      <GapBadge gap={entry.gap} similarity={entry.similarity} />
                      <p className="text-sm">{entry.worthLearning ?? entry.summary}</p>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ol>
          )}
        </aside>
      </div>
    </div>
  );
}

function Filters({
  parsed,
  from30,
  from90,
}: {
  parsed: ReturnType<typeof parseQuery>;
  from30: string;
  from90: string;
}) {
  const { filter, flat } = parsed;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <FilterLink href={hrefWith(flat, { source: null })} active={!filter.source}>All sources</FilterLink>
        {SOURCE_ORDER.map((source) => (
          <FilterLink
            key={source}
            href={hrefWith(flat, { source: filter.source === source ? null : source })}
            active={filter.source === source}
          >
            {SOURCE_LABELS[source]}
          </FilterLink>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <FilterLink href={hrefWith(flat, { gap: null })} active={!filter.gap}>Any gap</FilterLink>
        {GAP_ORDER.map((gap) => (
          <FilterLink key={gap} href={hrefWith(flat, { gap: filter.gap === gap ? null : gap })} active={filter.gap === gap}>
            {GAP_LABELS[gap]}
          </FilterLink>
        ))}
        <FilterLink href={hrefWith(flat, { type: null })} active={!filter.type}>Any type</FilterLink>
        {TYPE_ORDER.map((type) => (
          <FilterLink key={type} href={hrefWith(flat, { type: filter.type === type ? null : type })} active={filter.type === type}>
            {ENTRY_TYPE_LABELS[type]}
          </FilterLink>
        ))}
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          <FilterLink href={hrefWith(flat, { from: null, to: null })} active={!filter.from && !filter.to}>All dates</FilterLink>
          <FilterLink href={hrefWith(flat, { from: from30, to: null })} active={filter.from === from30 && !filter.to}>30 days</FilterLink>
          <FilterLink href={hrefWith(flat, { from: from90, to: null })} active={filter.from === from90 && !filter.to}>90 days</FilterLink>
        </div>
        <form action="/" method="get" className="flex w-full gap-2 sm:max-w-sm">
          <Hidden name="source" value={filter.source} />
          <Hidden name="type" value={filter.type} />
          <Hidden name="gap" value={filter.gap} />
          <Hidden name="from" value={filter.from} />
          <Hidden name="to" value={filter.to} />
          <Input name="tag" defaultValue={filter.tag ?? ""} placeholder="Tag, for example css" aria-label="Tag" />
          <Button type="submit" variant="secondary">Apply</Button>
        </form>
      </div>
    </div>
  );
}

function FilterLink({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
          : "rounded-full bg-card px-3 py-1 text-xs font-medium text-foreground ring-1 ring-foreground/10 hover:bg-muted"
      }
    >
      {children}
    </Link>
  );
}

function Hidden({ name, value }: { name: string; value?: string }) {
  if (!value) return null;
  return <input type="hidden" name={name} value={value} />;
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
            <a href={entry.url} className="font-medium hover:underline">{entry.title}</a>
            <p className="text-sm text-muted-foreground">{entry.summary}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
          <Badge variant="outline">{ENTRY_TYPE_LABELS[entry.type]}</Badge>
          <GapBadge gap={entry.gap} similarity={entry.similarity} />
          <time dateTime={entry.date} className="font-mono text-xs text-muted-foreground">{formatDay(entry.date)}</time>
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

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl bg-card px-5 py-10 ring-1 ring-foreground/10">
      <h2 className="font-[family-name:var(--font-heading)] text-2xl">{title}</h2>
      <p className="mt-2 max-w-lg text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
