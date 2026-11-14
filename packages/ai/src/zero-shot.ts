import { DASHBOARD_TAGS } from "@evolution/shared-types";
import type { Embedder } from "./embed";
import type { ZeroShotClassifier } from "./hf";
import {
  CLOUDFLARE_TAG_SCORE_MIN,
  LOCAL_ZERO_SHOT_MODEL,
  TAG_SCORE_MIN,
  ZERO_SHOT_LABELS,
  ZERO_SHOT_MODEL,
} from "./models";
import { gapHypothesis, labelsAboveSimilarity, tagHypothesis, topLabelBySimilarity } from "./tags";

export interface Tagger {
  modelId: string;
  tag(text: string): Promise<string[]>;
}

export interface ZeroShotScores {
  labels: string[];
  scores: number[];
}

type ZeroShotPipeline = (
  text: string,
  labels: string[],
  options?: { multi_label?: boolean },
) => Promise<unknown>;

const pipelines = new Map<string, Promise<ZeroShotPipeline>>();

export function scoresFromZeroShot(result: unknown): ZeroShotScores {
  const record = Array.isArray(result) ? result[0] : result;
  if (!record || typeof record !== "object") return { labels: [], scores: [] };
  const labels = (record as { labels?: unknown }).labels;
  const scores = (record as { scores?: unknown }).scores;
  if (!Array.isArray(labels) || !Array.isArray(scores)) return { labels: [], scores: [] };
  const paired = labels.flatMap((label, index) => {
    const score = scores[index];
    return typeof label === "string" && typeof score === "number" ? [{ label, score }] : [];
  });
  return { labels: paired.map((item) => item.label), scores: paired.map((item) => item.score) };
}

export function createLocalZeroShot(options?: {
  model?: string;
  labels?: readonly string[];
  load?: (model: string) => Promise<ZeroShotPipeline>;
}): ZeroShotClassifier {
  const model = options?.model ?? LOCAL_ZERO_SHOT_MODEL;
  const labels = [...(options?.labels ?? ZERO_SHOT_LABELS)];
  let pending: Promise<ZeroShotPipeline> | null = null;
  return {
    modelId: ZERO_SHOT_MODEL,
    async classify(text: string) {
      pending ??= (options?.load ?? defaultLoadZeroShot)(model);
      const classifier = await pending;
      const scored = scoresFromZeroShot(await classifier(text, labels));
      const top = scored.labels
        .map((label, index) => ({ label, score: scored.scores[index] ?? 0 }))
        .sort((a, b) => b.score - a.score)[0];
      if (!top) throw new Error("Zero-shot classification returned no labels");
      return top;
    },
  };
}

export function createLocalTagger(options?: {
  model?: string;
  labels?: readonly string[];
  minScore?: number;
  load?: (model: string) => Promise<ZeroShotPipeline>;
}): Tagger {
  const model = options?.model ?? LOCAL_ZERO_SHOT_MODEL;
  const labels = [...(options?.labels ?? DASHBOARD_TAGS)];
  const minScore = options?.minScore ?? TAG_SCORE_MIN;
  let pending: Promise<ZeroShotPipeline> | null = null;
  return {
    modelId: ZERO_SHOT_MODEL,
    async tag(text: string) {
      pending ??= (options?.load ?? defaultLoadZeroShot)(model);
      const classifier = await pending;
      const scored = scoresFromZeroShot(await classifier(text, labels, { multi_label: true }));
      const allowed = new Set(labels);
      return scored.labels
        .filter((label, index) => allowed.has(label) && (scored.scores[index] ?? 0) >= minScore)
        .sort();
    },
  };
}

export function createEmbeddingTagger(options: {
  embedder: Embedder;
  labels?: readonly string[];
  minScore?: number;
  hypothesis?: (label: string) => string;
}): Tagger {
  const labels = [...(options.labels ?? DASHBOARD_TAGS)];
  const minScore = options.minScore ?? CLOUDFLARE_TAG_SCORE_MIN;
  const hypothesis = options.hypothesis ?? tagHypothesis;
  return {
    modelId: ZERO_SHOT_MODEL,
    async tag(text: string) {
      const vectors = await options.embedder.embed([text, ...labels.map(hypothesis)]);
      const [query, ...labelVectors] = vectors;
      if (!query || labelVectors.length !== labels.length) throw new Error("Cloudflare Workers AI returned no embeddings");
      return labelsAboveSimilarity(query, labels, labelVectors, minScore);
    },
  };
}

export function createEmbeddingZeroShot(options: {
  embedder: Embedder;
  labels?: readonly string[];
  hypothesis?: (label: string) => string;
}): ZeroShotClassifier {
  const labels = [...(options.labels ?? ZERO_SHOT_LABELS)];
  const hypothesis = options.hypothesis ?? gapHypothesis;
  return {
    modelId: ZERO_SHOT_MODEL,
    async classify(text: string) {
      const vectors = await options.embedder.embed([text, ...labels.map(hypothesis)]);
      const [query, ...labelVectors] = vectors;
      if (!query || labelVectors.length !== labels.length) throw new Error("Cloudflare Workers AI returned no embeddings");
      return topLabelBySimilarity(query, labels, labelVectors);
    },
  };
}

async function defaultLoadZeroShot(model: string): Promise<ZeroShotPipeline> {
  let pending = pipelines.get(model);
  if (!pending) {
    pending = loadZeroShotPipeline(model);
    pipelines.set(model, pending);
  }
  return pending;
}

async function loadZeroShotPipeline(model: string): Promise<ZeroShotPipeline> {
  const transformers = (await import("@huggingface/transformers")) as {
    pipeline: (task: "zero-shot-classification", model: string) => Promise<ZeroShotPipeline>;
  };
  return transformers.pipeline("zero-shot-classification", model);
}
