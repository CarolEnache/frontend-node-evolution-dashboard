import type { Gap } from "@evolution/shared-types";
import { SIMILARITY_ADJACENT, SIMILARITY_ALREADY_KNOW } from "./models";

export interface ZeroShotVote {
  label: string;
  score: number;
}

const LABEL_TO_GAP: Record<string, Gap> = {
  "already know": "already-know",
  "already-know": "already-know",
  adjacent: "adjacent",
  new: "new",
};

export function gapFromSimilarity(score: number): Gap {
  if (score >= SIMILARITY_ALREADY_KNOW) return "already-know";
  if (score >= SIMILARITY_ADJACENT) return "adjacent";
  return "new";
}

/**
 * Similarity thresholds decide the gap. A confident zero-shot label can
 * nudge the result only when the score sits within 0.05 of a threshold.
 */
export function classifyGap(similarity: number, zeroShot?: ZeroShotVote | null): Gap {
  const fromSimilarity = gapFromSimilarity(similarity);
  if (!zeroShot) return fromSimilarity;
  const mapped = LABEL_TO_GAP[zeroShot.label.trim().toLowerCase()];
  if (!mapped || mapped === fromSimilarity) return fromSimilarity;
  const nearBoundary =
    Math.abs(similarity - SIMILARITY_ALREADY_KNOW) <= 0.05 ||
    Math.abs(similarity - SIMILARITY_ADJACENT) <= 0.05;
  if (nearBoundary && zeroShot.score >= 0.7) return mapped;
  return fromSimilarity;
}
