import { EMBEDDING_MODEL, LOCAL_EMBEDDING_MODEL } from "./models";

export function assertEmbeddingDimensions(vectors: number[][], dimensions: number): void {
  for (const vector of vectors) {
    if (vector.length !== dimensions || vector.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
      throw new Error(`Expected ${dimensions}-dimensional embeddings`);
    }
  }
}

export interface Embedder {
  modelId: string;
  embed(texts: string[]): Promise<number[][]>;
}

interface ExtractionTensor {
  tolist: () => number[] | number[][];
}

type ExtractionPipeline = (
  texts: string[],
  options?: { pooling?: "mean" | "none"; normalize?: boolean },
) => Promise<ExtractionTensor>;

/**
 * Local bge-small-en-v1.5 via Transformers.js. Tests inject `load` so the
 * ONNX model is never downloaded. The default loader is the only path that
 * imports `@huggingface/transformers`.
 */
export function createLocalEmbedder(options?: {
  model?: string;
  /** When set, a vector of any other length is a failed inference. */
  dimensions?: number;
  load?: (model: string) => Promise<ExtractionPipeline>;
}): Embedder {
  const model = options?.model ?? LOCAL_EMBEDDING_MODEL;
  let pending: Promise<ExtractionPipeline> | null = null;
  return {
    modelId: EMBEDDING_MODEL,
    async embed(texts: string[]) {
      if (texts.length === 0) return [];
      pending ??= (options?.load ?? defaultLoad)(model);
      const extractor = await pending;
      const output = await extractor(texts, { pooling: "mean", normalize: true });
      const vectors = normaliseVectors(output.tolist(), texts.length);
      if (options?.dimensions) assertEmbeddingDimensions(vectors, options.dimensions);
      return vectors;
    },
  };
}

async function defaultLoad(model: string): Promise<ExtractionPipeline> {
  const transformers = (await import("@huggingface/transformers")) as {
    pipeline: (
      task: "feature-extraction",
      model: string,
    ) => Promise<ExtractionPipeline>;
  };
  return transformers.pipeline("feature-extraction", model);
}

function normaliseVectors(value: number[] | number[][], count: number): number[][] {
  if (count === 1 && value.length > 0 && typeof value[0] === "number") {
    return [value as number[]];
  }
  return value as number[][];
}
