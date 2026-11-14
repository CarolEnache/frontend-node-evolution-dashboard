import { EMBED_BATCH_LIMIT, EMBEDDING_DIMENSIONS, LOCAL_EMBEDDING_CACHE_MODEL, LOCAL_EMBEDDING_DTYPE, LOCAL_EMBEDDING_MODEL, LOCAL_EMBEDDING_REVISION } from "./models";
import { configureModelRuntime } from "./runtime";

export function assertEmbeddingDimensions(vectors: number[][], dimensions: number): void {
  for (const vector of vectors) {
    if (vector.length !== dimensions || vector.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
      throw new Error(`Expected ${dimensions}-dimensional embeddings`);
    }
  }
}

export interface ExtractionTensor {
  tolist: () => number[] | number[][];
}

export type ExtractionPipeline = {
  (texts: string[], options?: { pooling?: "mean" | "none"; normalize?: boolean }): Promise<ExtractionTensor>;
  dispose?: () => Promise<void>;
};

export interface Embedder {
  /** `provider:model@revision`. This is part of the embeddings primary key. */
  modelId: string;
  provider: "local" | "cloudflare";
  embed(texts: string[]): Promise<number[][]>;
  dispose?(): Promise<void>;
}

/**
 * Local bge-small-en-v1.5 via Transformers.js. Tests inject `load` so the
 * ONNX model is never downloaded. The default loader is the only path that
 * imports `@huggingface/transformers`.
 *
 * Pooling stays `mean` because that is what Cloudflare bge-small returns.
 * CLS vectors are not interchangeable (cosine about 0.94–0.95). A pooling
 * change needs a new `modelId`, or cached vectors will be mixed.
 */
export function createLocalEmbedder(options?: {
  model?: string;
  revision?: string;
  /** When set, a vector of any other length is a failed inference. */
  dimensions?: number;
  load?: (model: string) => Promise<ExtractionPipeline>;
}): Embedder {
  const model = options?.model ?? LOCAL_EMBEDDING_MODEL;
  const revision = options?.revision ?? LOCAL_EMBEDDING_REVISION;
  let pipeline: ExtractionPipeline | null = null;
  return {
    modelId: LOCAL_EMBEDDING_CACHE_MODEL,
    provider: "local",
    async embed(texts: string[]) {
      if (texts.length === 0) return [];
      try {
        const vectors: number[][] = [];
        for (let index = 0; index < texts.length; index += EMBED_BATCH_LIMIT) {
          const batch = texts.slice(index, index + EMBED_BATCH_LIMIT);
          vectors.push(...(await embedBatch(await loadPipeline(), batch, options?.dimensions)));
        }
        return vectors;
      } catch (error) {
        pipeline = null;
        throw error;
      }
    },
    async dispose() {
      const current = pipeline;
      pipeline = null;
      await current?.dispose?.();
    },
  };

  async function loadPipeline(): Promise<ExtractionPipeline> {
    if (!pipeline) {
      pipeline = await (options?.load ?? ((name: string) => defaultLoad(name, revision)))(model);
    }
    return pipeline;
  }
}

async function embedBatch(extractor: ExtractionPipeline, texts: string[], dimensions?: number): Promise<number[][]> {
  const output = await extractor(texts, { pooling: "mean", normalize: true });
  const vectors = normaliseVectors(output.tolist(), texts.length);
  if (dimensions) assertEmbeddingDimensions(vectors, dimensions);
  return vectors;
}

async function defaultLoad(model: string, revision: string): Promise<ExtractionPipeline> {
  await configureModelRuntime();
  const transformers = (await import("@huggingface/transformers")) as {
    pipeline: (
      task: "feature-extraction",
      model: string,
      options: { dtype: string; revision: string },
    ) => Promise<ExtractionPipeline>;
  };
  return transformers.pipeline("feature-extraction", model, { dtype: LOCAL_EMBEDDING_DTYPE, revision });
}

function normaliseVectors(value: number[] | number[][], count: number): number[][] {
  if (count === 1 && value.length > 0 && typeof value[0] === "number") {
    return [value as number[]];
  }
  return value as number[][];
}

export { EMBEDDING_DIMENSIONS };
