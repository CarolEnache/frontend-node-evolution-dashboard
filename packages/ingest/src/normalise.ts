import {
  buildEntryId,
  stripVersionPrefix,
  type Entry,
  type EntryType,
  type Source,
} from "@evolution/shared-types";

export interface EntryDraft {
  source: Source;
  type: EntryType;
  title: string;
  date: string;
  url: string;
  summary: string;
  tags?: string[];
  raw?: unknown;
  version?: string;
  key?: string;
  id?: string;
}

const KEYWORDS: Array<[RegExp, string]> = [
  [/\bcss\b/i, "css"],
  [/\bhtml\b/i, "html"],
  [/\btypescript\b/i, "typescript"],
  [/\bapp router\b/i, "app-router"],
  [/\breact\b/i, "react"],
  [/\blts\b/i, "lts"],
  [/\bsecurity\b/i, "security"],
  [/\bbaseline\b/i, "baseline"],
  [/\bnode(?:\.js)?\b/i, "node"],
  [/\bnext(?:\.js)?\b/i, "nextjs"],
];

export function inferTags(text: string, extra: string[] = []): string[] {
  const tags = new Set(extra.map((tag) => tag.trim().toLowerCase()).filter(Boolean));
  for (const [pattern, tag] of KEYWORDS) {
    if (pattern.test(text)) tags.add(tag);
  }
  return [...tags].sort();
}

export function clampSummary(input: string, max = 1000): string {
  const text = input.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

export function toIso(input: string): string {
  const trimmed = input.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed}T00:00:00.000Z`;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: ${input}`);
  }
  return parsed.toISOString();
}

export function normaliseEntry(draft: EntryDraft): Entry {
  const version = draft.version ? stripVersionPrefix(draft.version) : undefined;
  const key = version ?? draft.key;
  const id = draft.id ?? (key ? buildEntryId(draft.source, draft.type, key) : "");
  if (!id) {
    throw new Error(`Entry "${draft.title}" is missing a version or key`);
  }
  return {
    id,
    source: draft.source,
    type: draft.type,
    title: draft.title.trim(),
    ...(version ? { version } : {}),
    date: toIso(draft.date),
    url: draft.url,
    summary: clampSummary(draft.summary || draft.title),
    tags: inferTags(`${draft.title} ${draft.summary}`, draft.tags ?? []),
    raw: draft.raw ?? null,
  };
}

export function parseJson(body: string, label: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}
