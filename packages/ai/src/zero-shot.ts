import { DASHBOARD_TAGS, type Source } from "@evolution/shared-types";
import type { ZeroShotClassifier } from "./hf";
import {
  LOCAL_TAG_CACHE_MODEL,
  LOCAL_ZERO_SHOT_DTYPE,
  LOCAL_ZERO_SHOT_MODEL,
  LOCAL_ZERO_SHOT_REVISION,
  TAG_HYPOTHESIS_TEMPLATE,
  ZERO_SHOT_LABELS,
} from "./models";
import { configureModelRuntime } from "./runtime";
import { selectModelTags, type TagScore } from "./tags";

export interface TagInput {
  text: string;
  source: Source;
  parserTags: string[];
}

export interface Tagger {
  modelId: string;
  provider: "local" | "cloudflare";
  /** False for the Cloudflare path: it may embed, but it must not write tags. */
  writesTags: boolean;
  tag(input: TagInput): Promise<string[]>;
  dispose?(): Promise<void>;
}

export interface ZeroShotScores {
  labels: string[];
  scores: number[];
}

export type ZeroShotPipeline = {
  (
    text: string,
    labels: string[],
    options?: { multi_label?: boolean; hypothesis_template?: string },
  ): Promise<unknown>;
  dispose?: () => Promise<void>;
};

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
  let pipeline: ZeroShotPipeline | null = null;
  return {
    modelId: LOCAL_TAG_CACHE_MODEL,
    provider: "local",
    async classify(text: string) {
      try {
        pipeline ??= await (options?.load ?? defaultLoadZeroShot)(model);
        const scored = scoresFromZeroShot(
          await pipeline(text, labels, { hypothesis_template: "The reader's relationship to this change is {}." }),
        );
        const top = scored.labels
          .map((label, index) => ({ label, score: scored.scores[index] ?? 0 }))
          .sort((left, right) => right.score - left.score)[0];
        if (!top) throw new Error("Zero-shot classification returned no labels");
        return top;
      } catch (error) {
        pipeline = null;
        throw error;
      }
    },
    async dispose() {
      const current = pipeline;
      pipeline = null;
      pipelines.delete(model);
      await current?.dispose?.();
    },
  };
}

export function createLocalTagger(options?: {
  model?: string;
  labels?: readonly string[];
  load?: (model: string) => Promise<ZeroShotPipeline>;
}): Tagger {
  const model = options?.model ?? LOCAL_ZERO_SHOT_MODEL;
  const labels = [...(options?.labels ?? DASHBOARD_TAGS)];
  let pipeline: ZeroShotPipeline | null = null;
  return {
    modelId: LOCAL_TAG_CACHE_MODEL,
    provider: "local",
    writesTags: true,
    async tag(input: TagInput) {
      try {
        pipeline ??= await (options?.load ?? defaultLoadZeroShot)(model);
        const scored = scoresFromZeroShot(
          await pipeline(input.text, labels, { multi_label: true, hypothesis_template: TAG_HYPOTHESIS_TEMPLATE }),
        );
        const scores: TagScore[] = scored.labels.map((label, index) => ({ label, score: scored.scores[index] ?? 0 }));
        return selectModelTags({ source: input.source, parserTags: input.parserTags, scores });
      } catch (error) {
        pipeline = null;
        throw error;
      }
    },
    async dispose() {
      const current = pipeline;
      pipeline = null;
      pipelines.delete(model);
      await current?.dispose?.();
    },
  };
}

/** Cloudflare has no calibrated MNLI model, so this tagger never writes tags. */
export function createSilentTagger(): Tagger {
  return {
    modelId: LOCAL_TAG_CACHE_MODEL,
    provider: "cloudflare",
    writesTags: false,
    async tag() {
      return [];
    },
  };
}

async function defaultLoadZeroShot(model: string): Promise<ZeroShotPipeline> {
  let pending = pipelines.get(model);
  if (!pending) {
    pending = loadZeroShotPipeline(model).catch((error: unknown) => {
      pipelines.delete(model);
      throw error;
    });
    pipelines.set(model, pending);
  }
  return pending;
}

async function loadZeroShotPipeline(model: string): Promise<ZeroShotPipeline> {
  await configureModelRuntime();
  const transformers = (await import("@huggingface/transformers")) as {
    pipeline: (
      task: "zero-shot-classification",
      model: string,
      options: { dtype: string; revision: string },
    ) => Promise<ZeroShotPipeline>;
  };
  return transformers.pipeline("zero-shot-classification", model, {
    dtype: LOCAL_ZERO_SHOT_DTYPE,
    revision: LOCAL_ZERO_SHOT_REVISION,
  });
}
