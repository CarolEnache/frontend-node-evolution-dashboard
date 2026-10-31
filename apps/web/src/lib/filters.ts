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

export interface ParsedQuery {
  filter: EntryFilter;
  flat: Record<string, string | undefined>;
  invalid: boolean;
}

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
    ...(from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? { from } : {}),
    ...(to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? { to } : {}),
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

export function hrefWith(current: Record<string, string | undefined>, patch: Record<string, string | null>): string {
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
  return query ? `/?${query}` : "/";
}

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export const SOURCE_ORDER: Source[] = ["mdn-bcd", "caniuse", "node", "typescript", "nextjs"];
export const GAP_ORDER: Gap[] = ["already-know", "adjacent", "new"];
export const TYPE_ORDER: EntryType[] = ["release", "lts", "security", "feature", "support-change", "article"];
