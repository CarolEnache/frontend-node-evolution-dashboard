export { decodeHtmlEntities } from "./html-text";

export const SOURCES = [
  "mdn-bcd",
  "caniuse",
  "node",
  "typescript",
  "nextjs",
  "tc39",
  "v8",
  "2ality",
  "javascript-weekly",
  "bytes",
  "webdev",
  "mcp",
] as const;
export type Source = (typeof SOURCES)[number];

export const ENTRY_TYPES = [
  "release",
  "feature",
  "support-change",
  "article",
  "lts",
  "security",
] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

export const GAPS = ["already-know", "adjacent", "new"] as const;
export type Gap = (typeof GAPS)[number];

/** Neon Postgres environments. Unset or `local` stays on SQLite. */
export const NEON_ENVIRONMENTS = ["development", "integration", "staging", "production"] as const;
export type NeonEnvironment = (typeof NEON_ENVIRONMENTS)[number];
export type AppEnvironment = "local" | NeonEnvironment;
/** Remote names only. `local` is the default and is not a member of this list. */
export const APP_ENVIRONMENTS = NEON_ENVIRONMENTS;

/** Values Node itself understands. `integration` and `staging` are APP_ENV names, not NODE_ENV. */
export const NODE_ENVIRONMENTS = ["development", "production", "test"] as const;
export type NodeEnvironment = (typeof NODE_ENVIRONMENTS)[number];

export function readAppEnv(env: NodeJS.ProcessEnv | { APP_ENV?: string | null } = process.env): AppEnvironment {
  const raw = env.APP_ENV?.trim().toLowerCase() ?? "";
  if (raw === "" || raw === "local") return "local";
  if ((NEON_ENVIRONMENTS as readonly string[]).includes(raw)) return raw as NeonEnvironment;
  throw new Error(
    `Unknown APP_ENV "${env.APP_ENV?.trim()}". Expected local, development, integration, staging, or production.`,
  );
}

export function readNodeEnv(env: NodeJS.ProcessEnv | { NODE_ENV?: string | null } = process.env): NodeEnvironment | "" {
  const raw = env.NODE_ENV?.trim() ?? "";
  if (raw === "") return "";
  if ((NODE_ENVIRONMENTS as readonly string[]).includes(raw)) return raw as NodeEnvironment;
  throw new Error(`NODE_ENV must be development, production, or test. Received "${raw}".`);
}

export const SOURCE_LABELS: Record<Source, string> = {
  "mdn-bcd": "MDN",
  caniuse: "Can I Use",
  node: "Node.js",
  typescript: "TypeScript",
  nextjs: "Next.js",
  tc39: "TC39",
  v8: "V8",
  "2ality": "2ality",
  "javascript-weekly": "JavaScript Weekly",
  bytes: "Bytes",
  webdev: "web.dev",
  mcp: "MCP",
};

export const ENTRY_TYPE_LABELS: Record<EntryType, string> = {
  release: "Release",
  feature: "Feature",
  "support-change": "Support change",
  article: "Article",
  lts: "LTS",
  security: "Security",
};

export const GAP_LABELS: Record<Gap, string> = {
  "already-know": "Already know",
  adjacent: "Adjacent",
  new: "New",
};

/** One normalised change from any source. `id` is the upsert key. */
export interface Entry {
  id: string;
  source: Source;
  type: EntryType;
  title: string;
  version?: string;
  date: string;
  url: string;
  summary: string;
  tags: string[];
  raw: unknown;
  similarity?: number;
  gap?: Gap;
  worthLearning?: string;
}

export interface SourceState {
  source: Source;
  url: string;
  etag?: string | null;
  lastModified?: string | null;
  version?: string | null;
  lastFetchedAt?: string | null;
  lastSuccessAt?: string | null;
}

export interface SkillsProfile {
  role: string;
  skills: string[];
}

export interface EntryFilter {
  source?: Source;
  tag?: string;
  type?: EntryType;
  gap?: Gap;
  from?: string;
  to?: string;
  limit?: number;
}

export interface SourceSnapshot {
  source: Source;
  label: string;
  version: string | null;
  lastSuccessAt: string | null;
}

const RELEASE_FAMILY = new Set<EntryType>(["release", "lts", "security"]);

export function isSource(value: string): value is Source {
  return (SOURCES as readonly string[]).includes(value);
}

export function isEntryType(value: string): value is EntryType {
  return (ENTRY_TYPES as readonly string[]).includes(value);
}

export function isGap(value: string): value is Gap {
  return (GAPS as readonly string[]).includes(value);
}

export function stripVersionPrefix(version: string): string {
  return version.trim().replace(/^v(?=\d)/i, "");
}

export function buildEntryId(source: Source, type: EntryType, versionOrKey: string): string {
  const key = RELEASE_FAMILY.has(type) ? stripVersionPrefix(versionOrKey) : versionOrKey.trim();
  if (!key) {
    throw new Error(`Cannot build an id for ${source}/${type} without a key`);
  }
  return `${source}:${type}:${key}`;
}

export function parseSkillsProfile(value: unknown): SkillsProfile {
  if (!value || typeof value !== "object") {
    throw new Error("Skills profile must be an object");
  }
  const record = value as { role?: unknown; skills?: unknown };
  if (typeof record.role !== "string" || record.role.trim() === "") {
    throw new Error("Skills profile needs a role");
  }
  if (!Array.isArray(record.skills) || record.skills.some((skill) => typeof skill !== "string")) {
    throw new Error("Skills profile needs a list of skill strings");
  }
  return { role: record.role.trim(), skills: record.skills.map((skill) => skill.trim()).filter(Boolean) };
}

export function startOfUtcDay(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00:00.000Z`;
  return value;
}

export function endOfUtcDay(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T23:59:59.999Z`;
  return value;
}

export function filterEntries(entries: Entry[], filter: EntryFilter = {}): Entry[] {
  const from = filter.from ? startOfUtcDay(filter.from) : undefined;
  const to = filter.to ? endOfUtcDay(filter.to) : undefined;
  const tag = filter.tag?.trim().toLowerCase();
  return entries
    .filter((entry) => {
      if (filter.source && entry.source !== filter.source) return false;
      if (filter.type && entry.type !== filter.type) return false;
      if (filter.gap && entry.gap !== filter.gap) return false;
      if (tag && !entry.tags.includes(tag)) return false;
      if (from && entry.date < from) return false;
      if (to && entry.date > to) return false;
      return true;
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.title.localeCompare(b.title)));
}

export {
  activeWorthLearningStrategy,
  enrichmentWorthLearningStrategy,
  heuristicWorthLearningStrategy,
  selectWorthLearning,
  worthLearningRank,
  type RankedWorthLearning,
  type WorthLearningOptions,
  type WorthLearningStrategy,
} from "./worth-learning";

export function weekStartKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay();
  const delta = day === 0 ? 6 : day - 1;
  utc.setUTCDate(utc.getUTCDate() - delta);
  return utc.toISOString().slice(0, 10);
}

export interface TimelineGroup {
  week: string;
  label: string;
  entries: Entry[];
}

export function groupEntriesByWeek(entries: Entry[]): TimelineGroup[] {
  const groups = new Map<string, Entry[]>();
  for (const entry of entries) {
    const key = weekStartKey(entry.date);
    const list = groups.get(key);
    if (list) list.push(entry);
    else groups.set(key, [entry]);
  }
  return [...groups.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([week, grouped]) => ({
      week,
      label: week === "unknown" ? "Undated" : `Week of ${formatDay(week)}`,
      entries: [...grouped].sort((a, b) => (a.date < b.date ? 1 : -1)),
    }));
}

export function formatDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function snapshotSources(entries: Entry[], states: SourceState[]): SourceSnapshot[] {
  return SOURCES.map((source) => {
    const relevantStates = states.filter((state) => state.source === source);
    const lastSuccessAt =
      relevantStates
        .map((state) => state.lastSuccessAt)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null;
    return {
      source,
      label: SOURCE_LABELS[source],
      version: preferredVersion(entries, source),
      lastSuccessAt,
    };
  });
}

/**
 * Prerelease markers in a version, title, or tag. `rc1` counts; `devblog` does not.
 * A `release` row is not stable just because of its type.
 */
const PRERELEASE_MARKER =
  /(?:^|[^a-z0-9])(?:alpha|beta|rc|canary|nightly|dev|insiders|preview|snapshot)(?=[^a-z]|$)/i;

function isPrereleaseEntry(entry: Entry): boolean {
  return PRERELEASE_MARKER.test([entry.version ?? "", entry.title, ...entry.tags].join(" "));
}

function preferredVersion(entries: Entry[], source: Source): string | null {
  const list = entries
    .filter((entry) => entry.source === source && entry.version && !isPrereleaseEntry(entry))
    .sort(byHighestVersion);
  if (source === "node") {
    const lts = list.find((entry) => entry.type === "lts" || entry.tags.includes("lts"));
    if (lts?.version) return lts.version;
  }
  if (source === "typescript" || source === "nextjs") {
    const stable = list.find((entry) => entry.tags.includes("stable") || entry.type === "release");
    if (stable?.version) return stable.version;
  }
  return list[0]?.version ?? null;
}

/** Highest semver first. Equal versions keep the newer publish time, then title. */
function byHighestVersion(a: Entry, b: Entry): number {
  const byVersion = compareSemver(b.version ?? "", a.version ?? "");
  if (byVersion !== 0) return byVersion;
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return a.title.localeCompare(b.title);
}

export function compareSemver(a: string, b: string): number {
  const left = stripVersionPrefix(a).split(/[.-]/);
  const right = stripVersionPrefix(b).split(/[.-]/);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const l = left[index] ?? "0";
    const r = right[index] ?? "0";
    const ln = Number(l);
    const rn = Number(r);
    const lNumeric = l !== "" && Number.isInteger(ln) && String(ln) === l;
    const rNumeric = r !== "" && Number.isInteger(rn) && String(rn) === r;
    if (lNumeric && rNumeric && ln !== rn) return ln - rn;
    if (l !== r) return l < r ? -1 : 1;
  }
  return 0;
}

export function versionsEqual(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return stripVersionPrefix(a) === stripVersionPrefix(b);
}
