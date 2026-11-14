import {
  isEntryType,
  isGap,
  isSource,
  type EntryFilter,
  type EntryType,
  type Gap,
  type Source,
} from "@evolution/shared-types";

export type QueryValue = string | string[] | undefined;

/**
 * First occurrence wins for a single-value filter param.
 *
 * `?tag=css&tag=node` is `css`. The value is trimmed. A blank or
 * whitespace-only first occurrence is unset, and later repeats are not
 * consulted. `source`, `type`, `gap`, `tag`, `from`, and `to` are all
 * single-value: `EntryFilter` stores one string for each. The dashboard
 * page and `GET /api/entries` both pass every occurrence into `parseQuery`,
 * which applies this rule.
 */
export function firstParam(value: QueryValue): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Build the record `parseQuery` reads from a URL query.
 *
 * Repeated keys stay arrays in query-string order, the same shape Next.js
 * gives the dashboard page. The record has a null prototype so a key such
 * as `__proto__` or `constructor` is stored as data and cannot replace
 * `Object.prototype`. Do not use `Object.fromEntries` on
 * `searchParams.entries()`: that keeps only the last value.
 */
export function queryRecord(searchParams: URLSearchParams): Record<string, QueryValue> {
  const record: Record<string, QueryValue> = Object.create(null);
  for (const [key, value] of searchParams.entries()) {
    const current = record[key];
    if (current === undefined) record[key] = value;
    else if (Array.isArray(current)) current.push(value);
    else record[key] = [current, value];
  }
  return record;
}

export function isValidIsoDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

export function uniqueTags(entries: readonly { tags: readonly string[] }[]): string[] {
  const tags = new Set<string>();
  for (const entry of entries) {
    for (const tag of entry.tags) {
      const value = tag.trim();
      if (value) tags.add(value);
    }
  }
  return [...tags].sort((a, b) => a.localeCompare(b));
}

export interface ParsedQuery {
  filter: EntryFilter;
  flat: Record<string, string | undefined>;
  invalid: boolean;
}

/** Read `source`, `type`, `gap`, `tag`, `from`, and `to`. Each is single-value: the first occurrence wins. */
export function parseQuery(params: Record<string, QueryValue>): ParsedQuery {
  const source = firstParam(params.source);
  const type = firstParam(params.type);
  const gap = firstParam(params.gap);
  const tag = firstParam(params.tag);
  const from = firstParam(params.from);
  const to = firstParam(params.to);
  const invalid =
    (source !== undefined && !isSource(source)) ||
    (type !== undefined && !isEntryType(type)) ||
    (gap !== undefined && !isGap(gap));
  const filter: EntryFilter = {
    ...(source && isSource(source) ? { source } : {}),
    ...(type && isEntryType(type) ? { type } : {}),
    ...(gap && isGap(gap) ? { gap } : {}),
    ...(tag ? { tag } : {}),
    ...(from && isValidIsoDay(from) ? { from } : {}),
    ...(to && isValidIsoDay(to) ? { to } : {}),
  };
  return {
    filter,
    invalid,
    flat: {
      source: filter.source,
      type: filter.type,
      gap: filter.gap,
      tag: filter.tag,
      from: filter.from,
      to: filter.to,
    },
  };
}

export function hrefWith(
  current: Record<string, string | undefined>,
  patch: Record<string, string | null>,
  path = "/",
): string {
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === "") delete next[key];
    else next[key] = value;
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(next)) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export const SOURCE_ORDER: Source[] = [
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
];
export const GAP_ORDER: Gap[] = ["already-know", "adjacent", "new"];
export const TYPE_ORDER: EntryType[] = ["release", "lts", "security", "feature", "support-change", "article"];
