import type { ReactNode } from "react";
import Link from "next/link";
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
import { TimelineView } from "@/components/timeline-view";
import { WorthLearningView } from "@/components/worth-learning-view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { currentTimeMs, dashboardCacheKey, loadDashboard } from "@/lib/entries";
import {
  GAP_ORDER,
  SOURCE_ORDER,
  TYPE_ORDER,
  hrefWith,
  isoDay,
  parseQuery,
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
      <TimelineView entries={timeline} emptyDatabase={model.entries.length === 0} invalid={model.parsed.invalid} />
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
      <WorthLearningView items={worth} emptyDatabase={model.entries.length === 0} invalid={model.parsed.invalid} />
    </DashboardShell>
  );
}

interface DashboardModel {
  parsed: ParsedQuery;
  entries: Entry[];
  states: SourceState[];
  nowMs: number;
}

async function loadModel(searchParams: Promise<Record<string, QueryValue>>): Promise<DashboardModel> {
  await connection();
  await suspendForEndToEnd();
  const params = await searchParams;
  const parsed = parseQuery(params);
  const data = await loadDashboard(dashboardCacheKey());
  return { parsed, entries: data.entries, states: data.states, nowMs: currentTimeMs() };
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
  const snapshots = snapshotSources(model.entries, model.states);
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
        <Filters parsed={model.parsed} path={path} from30={from30} from90={from90} />
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
}: {
  parsed: ParsedQuery;
  path: string;
  from30: string;
  from90: string;
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
      <form action={path} method="get" className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
        <Hidden name="source" value={filter.source} />
        <Hidden name="type" value={filter.type} />
        <Hidden name="gap" value={filter.gap} />
        <label className="flex min-w-36 flex-1 flex-col gap-1 text-xs text-muted-foreground">
          Tag
          <Input name="tag" defaultValue={filter.tag ?? ""} placeholder="css" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          From
          <Input className="w-40" type="date" name="from" defaultValue={filter.from ?? ""} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          To
          <Input className="w-40" type="date" name="to" defaultValue={filter.to ?? ""} />
        </label>
        <Button type="submit" variant="secondary">
          Apply
        </Button>
      </form>
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
