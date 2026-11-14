import {
  buildEntryId,
  decodeHtmlEntities,
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

const RELEASE_FAMILY = new Set<EntryType>(["release", "lts", "security"]);

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

function plainSummary(input: string): string {
  return decodeHtmlEntities(input.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const SUMMARY_CODE_POINT_CAP = 4000;
const ELLIPSIS = "…";

function codePointCount(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

/**
 * Keep at most `maxGraphemes` graphemes and `maxCodePoints` code points.
 * The walk stops at the first segment that would pass either limit, and a
 * truncated summary ends on the previous grapheme so a cluster is not split.
 */
function clampGraphemes(text: string, maxGraphemes: number, maxCodePoints: number): string {
  const kept: Array<{ end: number; points: number }> = [];
  let codePoints = 0;
  for (const part of graphemes.segment(text)) {
    const points = codePointCount(part.segment);
    if (kept.length + 1 > maxGraphemes || codePoints + points > maxCodePoints) {
      return truncateAtGrapheme(text, kept, codePoints, maxGraphemes, maxCodePoints);
    }
    kept.push({ end: part.index + part.segment.length, points });
    codePoints += points;
  }
  return text;
}

function truncateAtGrapheme(
  text: string,
  kept: Array<{ end: number; points: number }>,
  codePoints: number,
  maxGraphemes: number,
  maxCodePoints: number,
): string {
  while (kept.length > 0 && (kept.length + 1 > maxGraphemes || codePoints + 1 > maxCodePoints)) {
    const removed = kept.pop();
    if (removed) codePoints -= removed.points;
  }
  const end = kept.length === 0 ? 0 : kept[kept.length - 1]!.end;
  return `${text.slice(0, end).trimEnd()}${ELLIPSIS}`;
}

export function clampSummary(input: string, max = 1000): string {
  return clampGraphemes(plainSummary(input), max, SUMMARY_CODE_POINT_CAP);
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
  const identity = RELEASE_FAMILY.has(draft.type) ? (version ?? draft.key) : (draft.key ?? version);
  const id = draft.id ?? (identity ? buildEntryId(draft.source, draft.type, identity) : "");
  if (!id) {
    throw new Error(`Entry "${draft.title}" is missing a version or key`);
  }
  const title = decodeHtmlEntities(draft.title).trim();
  const fullSummary = plainSummary(draft.summary || draft.title);
  const summary = clampGraphemes(fullSummary, 1000, SUMMARY_CODE_POINT_CAP);
  return {
    id,
    source: draft.source,
    type: draft.type,
    title,
    ...(version ? { version } : {}),
    date: toIso(draft.date),
    url: draft.url,
    summary,
    tags: inferTags(`${title} ${fullSummary}`, draft.tags ?? []),
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
