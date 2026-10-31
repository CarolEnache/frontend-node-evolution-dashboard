import { isEntryType, isGap, isSource, type Entry, type SourceState } from "@evolution/shared-types";

export interface EntryRow {
  id: string;
  source: string;
  type: string;
  title: string;
  version: string | null;
  date: string;
  url: string;
  summary: string;
  tags: string;
  raw: string;
  similarity: number | null;
  gap: string | null;
  worthLearning: string | null;
  updatedAt: string;
}

export interface StateRow {
  source: string;
  url: string;
  etag: string | null;
  lastModified: string | null;
  version: string | null;
  lastFetchedAt: string | null;
  lastSuccessAt: string | null;
}

export function toEntryRow(entry: Entry, updatedAt: string): EntryRow {
  return {
    id: entry.id,
    source: entry.source,
    type: entry.type,
    title: entry.title,
    version: entry.version ?? null,
    date: entry.date,
    url: entry.url,
    summary: entry.summary,
    tags: JSON.stringify(entry.tags),
    raw: JSON.stringify(entry.raw ?? null),
    similarity: entry.similarity ?? null,
    gap: entry.gap ?? null,
    worthLearning: entry.worthLearning ?? null,
    updatedAt,
  };
}

export function fromEntryRow(row: EntryRow): Entry {
  if (!isSource(row.source) || !isEntryType(row.type)) {
    throw new Error(`Corrupt entry ${row.id}`);
  }
  const tags = JSON.parse(row.tags) as unknown;
  return {
    id: row.id,
    source: row.source,
    type: row.type,
    title: row.title,
    ...(row.version ? { version: row.version } : {}),
    date: row.date,
    url: row.url,
    summary: row.summary,
    tags: Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === "string") : [],
    raw: JSON.parse(row.raw) as unknown,
    ...(typeof row.similarity === "number" ? { similarity: row.similarity } : {}),
    ...(row.gap && isGap(row.gap) ? { gap: row.gap } : {}),
    ...(row.worthLearning ? { worthLearning: row.worthLearning } : {}),
  };
}

export function toStateRow(state: SourceState): StateRow {
  return {
    source: state.source,
    url: state.url,
    etag: state.etag ?? null,
    lastModified: state.lastModified ?? null,
    version: state.version ?? null,
    lastFetchedAt: state.lastFetchedAt ?? null,
    lastSuccessAt: state.lastSuccessAt ?? null,
  };
}

export function fromStateRow(row: StateRow): SourceState {
  if (!isSource(row.source)) throw new Error(`Corrupt source state for ${row.url}`);
  return {
    source: row.source,
    url: row.url,
    etag: row.etag,
    lastModified: row.lastModified,
    version: row.version,
    lastFetchedAt: row.lastFetchedAt,
    lastSuccessAt: row.lastSuccessAt,
  };
}
