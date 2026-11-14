import type { ReactNode } from "react";
import { headers } from "next/headers";
import { connection } from "next/server";
import {
  ENTRY_TYPE_LABELS,
  GAP_LABELS,
  SOURCE_LABELS,
  formatDay,
  readAppEnv,
  snapshotSources,
  type Entry,
  type SourceState,
} from "@evolution/shared-types";
import profile from "../../../../profile/skills.json";
import { FilterForm } from "@/components/filter-form";
import { FilterLink } from "@/components/filter-link";
import { TimelineView } from "@/components/timeline-view";
import { WorthLearningView } from "@/components/worth-learning-view";
import { TagSelect } from "@/components/tag-select";
import { Input } from "@/components/ui/input";
import {
  currentTimeMs,
  dashboardCacheKey,
  loadDashboard,
  loadFilteredEntries,
  loadSourceCardEntries,
} from "@/lib/entries";
import {
  GAP_ORDER,
  SOURCE_ORDER,
  TYPE_ORDER,
  hrefWith,
  isoDay,
  parseQuery,
  uniqueTags,
  type ParsedQuery,
  type QueryValue,
} from "@/lib/filters";
import { queryTimeline, queryWorthLearning } from "@/lib/queries";

/**
 * Lets the e2e suite observe the Suspense fallback. Off unless both
 * E2E_SUSPEND_HEADER=1 and APP_ENV is local (unset counts as local).
 * A Neon APP_ENV does not wait, even if the header flag is set. This is not
 * a NODE_ENV check: local plus the flag still waits.
 */
async function suspendForEndToEnd(): Promise<void> {
  if (process.env.E2E_SUSPEND_HEADER !== "1") return;
  if (readAppEnv() !== "local") return;
  const raw = (await headers()).get("x-e2e-suspend") ?? "";
  if (!/^\d+$/.test(raw)) return;
  const requested = Number(raw);
  if (requested <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, Math.min(requested, 5_000)));
}

export async function TimelineScreen({
  searchParams,
}: {
  searchParams: Promise<Record<string, QueryValue>>;
}) {
  const model = await loadModel(searchParams);
  const timeline = model.parsed.invalid ? [] : queryTimeline(model.entries, model.parsed.filter);
  return (
    <DashboardShell model={model} view="timeline" countLabel={`${timeline.length} in view`}>
      <TimelineView entries={timeline} emptyDatabase={model.allEntries.length === 0} invalid={model.parsed.invalid} />
    </DashboardShell>
  );
}

export async function WorthLearningScreen({
  searchParams,
}: {
  searchParams: Promise<Record<string, QueryValue>>;
}) {
  const model = await loadModel(searchParams);
  const worth = model.parsed.invalid ? [] : queryWorthLearning(model.entries, model.parsed.filter, model.nowMs);
  return (
    <DashboardShell model={model} view="worth-learning" countLabel={`${worth.length} flagged`}>
      <WorthLearningView items={worth} emptyDatabase={model.allEntries.length === 0} invalid={model.parsed.invalid} />
    </DashboardShell>
  );
}

interface DashboardModel {
  parsed: ParsedQuery;
  entries: Entry[];
  allEntries: Entry[];
  cardEntries: Entry[];
  states: SourceState[];
  nowMs: number;
}

async function loadModel(searchParams: Promise<Record<string, QueryValue>>): Promise<DashboardModel> {
  await connection();
  await suspendForEndToEnd();
  const params = await searchParams;
  const parsed = parseQuery(params);
  const cacheKey = dashboardCacheKey();
  const filter = parsed.filter;
  const hasFilter = Boolean(filter.source || filter.type || filter.gap || filter.tag || filter.from || filter.to);
  const [data, cardEntries] = await Promise.all([
    loadDashboard(cacheKey),
    loadSourceCardEntries(cacheKey),
  ]);
  const entries = parsed.invalid
    ? []
    : hasFilter
      ? await loadFilteredEntries(`${cacheKey}:${JSON.stringify(filter)}`, filter)
      : data.entries;
  return { parsed, entries, allEntries: data.entries, cardEntries, states: data.states, nowMs: currentTimeMs() };
}

function DashboardShell({
  model,
  view,
  countLabel,
  children,
}: {
  model: DashboardModel;
  view: "timeline" | "worth-learning";
  countLabel: string;
  children: ReactNode;
}) {
  const path = view === "timeline" ? "/" : "/worth-learning";
  const snapshots = snapshotSources(model.cardEntries, model.states);
  const now = new Date(model.nowMs);
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
          <p className="font-mono text-xs text-muted-foreground">{countLabel}</p>
        </div>
        <nav aria-label="Views" className="flex flex-wrap gap-2">
          <FilterLink href={hrefWith(model.parsed.flat, {}, "/")} active={view === "timeline"}>
            Timeline
          </FilterLink>
          <FilterLink href={hrefWith(model.parsed.flat, {}, "/worth-learning")} active={view === "worth-learning"}>
            Worth learning
          </FilterLink>
        </nav>
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
        <Filters
          parsed={model.parsed}
          path={path}
          from30={from30}
          from90={from90}
          tags={uniqueTags([...model.cardEntries, ...model.allEntries])}
        />
      </header>
      <main>{children}</main>
    </div>
  );
}

function Filters({
  parsed,
  path,
  from30,
  from90,
  tags,
}: {
  parsed: ParsedQuery;
  path: string;
  from30: string;
  from90: string;
  tags: string[];
}) {
  const { filter, flat } = parsed;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Source">
        <FilterLink href={hrefWith(flat, { source: null }, path)} active={!filter.source}>
          All sources
        </FilterLink>
        {SOURCE_ORDER.map((source) => (
          <FilterLink
            key={source}
            href={hrefWith(flat, { source: filter.source === source ? null : source }, path)}
            active={filter.source === source}
          >
            {SOURCE_LABELS[source]}
          </FilterLink>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <FilterLink href={hrefWith(flat, { gap: null }, path)} active={!filter.gap}>
          Any gap
        </FilterLink>
        {GAP_ORDER.map((gap) => (
          <FilterLink
            key={gap}
            href={hrefWith(flat, { gap: filter.gap === gap ? null : gap }, path)}
            active={filter.gap === gap}
          >
            {GAP_LABELS[gap]}
          </FilterLink>
        ))}
        <FilterLink href={hrefWith(flat, { type: null }, path)} active={!filter.type}>
          Any type
        </FilterLink>
        {TYPE_ORDER.map((type) => (
          <FilterLink
            key={type}
            href={hrefWith(flat, { type: filter.type === type ? null : type }, path)}
            active={filter.type === type}
          >
            {ENTRY_TYPE_LABELS[type]}
          </FilterLink>
        ))}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Date range">
        <FilterLink href={hrefWith(flat, { from: null, to: null }, path)} active={!filter.from && !filter.to}>
          All dates
        </FilterLink>
        <FilterLink href={hrefWith(flat, { from: from30, to: null }, path)} active={filter.from === from30 && !filter.to}>
          30 days
        </FilterLink>
        <FilterLink href={hrefWith(flat, { from: from90, to: null }, path)} active={filter.from === from90 && !filter.to}>
          90 days
        </FilterLink>
      </div>
      <FilterForm action={path}>
        <Hidden name="source" value={filter.source} />
        <Hidden name="type" value={filter.type} />
        <Hidden name="gap" value={filter.gap} />
        <TagSelect tags={tags} value={filter.tag} />
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          From
          <Input className="w-40" type="date" name="from" defaultValue={filter.from ?? ""} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          To
          <Input className="w-40" type="date" name="to" defaultValue={filter.to ?? ""} />
        </label>
      </FilterForm>
    </div>
  );
}

function Hidden({ name, value }: { name: string; value?: string }) {
  if (!value) return null;
  return <input type="hidden" name={name} value={value} />;
}
