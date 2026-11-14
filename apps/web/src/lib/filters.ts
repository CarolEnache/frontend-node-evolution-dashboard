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

export function firstParam(value: QueryValue): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
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

export interface InvalidDate {
  field: "from" | "to";
  value: string;
}

export interface ParsedQuery {
  filter: EntryFilter;
  flat: Record<string, string | undefined>;
  /** Unknown source, type, or gap. Date problems are reported separately. */
  invalid: boolean;
  /** Supplied bounds that are not real YYYY-MM-DD calendar dates. Omitted from `filter`. */
  invalidDates: InvalidDate[];
  /** Both bounds are real dates and `from` is after `to`. `filter` keeps that order. */
  reversed: boolean;
}

export interface ResolvedDates {
  filter: EntryFilter;
  flat: Record<string, string | undefined>;
  notices: string[];
}

function flatFields(filter: EntryFilter): Record<string, string | undefined> {
  return {
    source: filter.source,
    type: filter.type,
    gap: filter.gap,
    tag: filter.tag,
    from: filter.from,
    to: filter.to,
  };
}

function readDate(field: "from" | "to", value: string | undefined, issues: InvalidDate[]): string | undefined {
  if (value === undefined) return undefined;
  if (isValidIsoDay(value)) return value;
  issues.push({ field, value });
  return undefined;
}

export function parseQuery(params: Record<string, QueryValue>): ParsedQuery {
  const source = firstParam(params.source);
  const type = firstParam(params.type);
  const gap = firstParam(params.gap);
  const tag = firstParam(params.tag);
  const invalidDates: InvalidDate[] = [];
  const from = readDate("from", firstParam(params.from), invalidDates);
  const to = readDate("to", firstParam(params.to), invalidDates);
  const invalid =
    (source !== undefined && !isSource(source)) ||
    (type !== undefined && !isEntryType(type)) ||
    (gap !== undefined && !isGap(gap));
  const reversed = Boolean(from && to && from > to);
  const filter: EntryFilter = {
    ...(source && isSource(source) ? { source } : {}),
    ...(type && isEntryType(type) ? { type } : {}),
    ...(gap && isGap(gap) ? { gap } : {}),
    ...(tag ? { tag } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
  return {
    filter,
    invalid,
    invalidDates,
    reversed,
    flat: flatFields(filter),
  };
}

/** Message for a 400 response. Null when every supplied date can be applied as given. */
export function dateFilterError(parsed: ParsedQuery): string | null {
  const parts = parsed.invalidDates.map(
    (issue) => `${issue.field} must be a calendar date in YYYY-MM-DD. Received "${issue.value}".`,
  );
  if (parsed.reversed && parsed.filter.from && parsed.filter.to) {
    parts.push(`from must be on or before to. Received from "${parsed.filter.from}" and to "${parsed.filter.to}".`);
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * Dates the dashboard actually applies. Invalid bounds are omitted. A reversed
 * range is swapped so the earlier day is From. `notices` explains either case.
 */
export function resolveDashboardDates(parsed: ParsedQuery): ResolvedDates {
  const notices = parsed.invalidDates.map((issue) => {
    const label = issue.field === "from" ? "From" : "To";
    return `${label} "${issue.value}" is not a valid date. Use YYYY-MM-DD. That bound was ignored.`;
  });
  let from = parsed.filter.from;
  let to = parsed.filter.to;
  if (parsed.reversed && from && to) {
    notices.push(`From is after To. The range was swapped to ${to} through ${from}.`);
    const earlier = to;
    to = from;
    from = earlier;
  }
  const filter: EntryFilter = { ...parsed.filter };
  if (from) filter.from = from;
  else delete filter.from;
  if (to) filter.to = to;
  else delete filter.to;
  return { filter, flat: flatFields(filter), notices };
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
