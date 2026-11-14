import type { Entry } from "@evolution/shared-types";
import type { ZeroShotVote } from "./classify";
import { cosineSimilarity } from "./cosine";

export function mergeEntryTags(existing: string[], added: string[]): string[] {
  return [...new Set([...existing, ...added].map((tag) => tag.trim().toLowerCase()).filter(Boolean))].sort();
}

/** Keep tags already stored on the row. Parser tags are unioned in, never used to delete. */
export function preserveEntryTags(incoming: Entry, stored: Entry | undefined): Entry {
  if (!stored) return incoming;
  return { ...incoming, tags: mergeEntryTags(incoming.tags, stored.tags) };
}

export function tagHypothesis(label: string): string {
  return `This change is about ${label.replace(/-/g, " ")}.`;
}

const GAP_HYPOTHESES: Record<string, string> = {
  "already know": "The reader already knows this.",
  "already-know": "The reader already knows this.",
  adjacent: "This is adjacent to the reader's skills.",
  new: "This is new to the reader.",
};

export function gapHypothesis(label: string): string {
  return GAP_HYPOTHESES[label.trim().toLowerCase()] ?? `This change is ${label}.`;
}

export function labelsAboveSimilarity(
  query: number[],
  labels: readonly string[],
  vectors: number[][],
  minScore: number,
): string[] {
  return labels.filter((label, index) => cosineSimilarity(query, vectors[index] ?? []) >= minScore).sort();
}

export function topLabelBySimilarity(
  query: number[],
  labels: readonly string[],
  vectors: number[][],
): ZeroShotVote {
  let best: ZeroShotVote | null = null;
  labels.forEach((label, index) => {
    const score = cosineSimilarity(query, vectors[index] ?? []);
    if (!best || score > best.score || (score === best.score && label < best.label)) {
      best = { label, score };
    }
  });
  if (!best) throw new Error("Zero-shot classification returned no labels");
  return best;
}
