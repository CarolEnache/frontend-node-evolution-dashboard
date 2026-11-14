import type { Entry, Source } from "@evolution/shared-types";
import { sha256 } from "./cache";
import { DEFAULT_TAG_SCORE_MIN, TAG_SCORE_MIN, TAG_TOP_K } from "./models";

export interface TagScore {
  label: string;
  score: number;
}

/**
 * Labels a source is allowed to receive from the model. Parser tags are also
 * agreement, so a Next.js post that already says "css" can keep that tag.
 * A Node LTS row cannot grow a "react" tag, and a CSS row cannot grow "node" or "lts".
 */
export const SOURCE_AGREED_TAGS: Record<Source, readonly string[]> = {
  node: ["node", "lts", "security"],
  nextjs: ["nextjs", "react", "app-router"],
  typescript: ["typescript"],
  "mdn-bcd": ["baseline", "css", "html"],
  caniuse: ["css", "html"],
  tc39: [],
  v8: ["node"],
  "2ality": [],
  "javascript-weekly": [],
  bytes: [],
  webdev: ["baseline", "css", "html"],
  mcp: [],
};

export function contentHash(entry: Pick<Entry, "title" | "summary">): string {
  return sha256(`${entry.title}\n${entry.summary}`);
}

/** Provider is part of the key so a Cloudflare vector cannot be read as a local one. */
export function entryCacheKey(provider: string, entry: Pick<Entry, "id" | "title" | "summary">): string {
  return `${provider}:${entry.id}:${contentHash(entry)}`;
}

export function mergeEntryTags(existing: string[], added: string[]): string[] {
  return [...new Set([...existing, ...added].map((tag) => tag.trim().toLowerCase()).filter(Boolean))].sort();
}

/**
 * Parser tags on an unchanged row are kept. A new title or summary drops stored
 * tags instead of unioning them, so a model tag from the previous text cannot stick.
 */
export function reconcileStoredTags(
  incoming: Entry,
  stored: Pick<Entry, "title" | "summary" | "tags"> | undefined,
): Entry {
  if (!stored) return incoming;
  if (contentHash(incoming) !== contentHash(stored)) return incoming;
  return { ...incoming, tags: mergeEntryTags(incoming.tags, stored.tags) };
}

export function tagScoreMin(label: string): number {
  return TAG_SCORE_MIN[label] ?? DEFAULT_TAG_SCORE_MIN;
}

export function selectModelTags(input: {
  source: Source;
  parserTags: string[];
  scores: TagScore[];
}): string[] {
  const agreed = new Set([...SOURCE_AGREED_TAGS[input.source], ...input.parserTags]);
  return input.scores
    .filter((item) => agreed.has(item.label) && item.score >= tagScoreMin(item.label))
    .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label))
    .slice(0, TAG_TOP_K)
    .map((item) => item.label)
    .sort();
}
