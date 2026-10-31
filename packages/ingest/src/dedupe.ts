import { buildEntryId, stripVersionPrefix, type Entry, type EntryType } from "@evolution/shared-types";

const RELEASE_FAMILY = new Set<EntryType>(["release", "lts", "security"]);
const TYPE_RANK: Record<EntryType, number> = {
  security: 60,
  lts: 50,
  release: 40,
  feature: 30,
  "support-change": 20,
  article: 10,
};

function releaseFamilyKey(entry: Entry): string | null {
  if (!entry.version || !RELEASE_FAMILY.has(entry.type)) return null;
  return `${entry.source}:${stripVersionPrefix(entry.version)}`;
}

function mergePair(left: Entry, right: Entry): Entry {
  const winner = TYPE_RANK[left.type] >= TYPE_RANK[right.type] ? left : right;
  const loser = winner === left ? right : left;
  const version = winner.version ?? loser.version;
  const type = winner.type;
  const id =
    version && RELEASE_FAMILY.has(type) ? buildEntryId(winner.source, type, version) : winner.id;
  const tags = [...new Set([...left.tags, ...right.tags])].sort();
  const summary = left.summary.length >= right.summary.length ? left.summary : right.summary;
  return {
    ...winner,
    id,
    type,
    source: winner.source,
    title: winner.title || loser.title,
    version,
    date: winner.date || loser.date,
    url: winner.url || loser.url,
    summary,
    tags,
    raw: { mergedFrom: [left.raw, right.raw] },
    similarity: winner.similarity ?? loser.similarity,
    gap: winner.gap ?? loser.gap,
    worthLearning: winner.worthLearning ?? loser.worthLearning,
  };
}

/** Collapse rows that share an id, and release-family rows that share source + version. */
export function dedupeEntries(entries: Entry[]): Entry[] {
  const map = new Map<string, Entry>();
  for (const entry of entries) {
    const key = releaseFamilyKey(entry) ?? entry.id;
    const existing = map.get(key);
    map.set(key, existing ? mergePair(existing, entry) : entry);
  }
  return [...map.values()];
}
