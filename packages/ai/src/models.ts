/** Canonical model ids. Embeddings and the default summary run locally. */
export const EMBEDDING_MODEL = "BAAI/bge-small-en-v1.5";
export const LOCAL_EMBEDDING_MODEL = "Xenova/bge-small-en-v1.5";
export const LOCAL_EMBEDDING_REVISION = "ea104dacec62c0de699686887e3f920caeb4f3e3";
/**
 * bge-small-en-v1.5 hidden size. Mean pooling matches Cloudflare's default
 * (cosine about 0.94–0.95 against CLS). Switching pooling needs a new model key.
 */
export const EMBEDDING_DIMENSIONS = 384;
/** q8 file is about 34 MB. fp32 is about 133 MB. */
export const LOCAL_EMBEDDING_DTYPE = "q8";
export const ZERO_SHOT_MODEL = "facebook/bart-large-mnli";
export const LOCAL_ZERO_SHOT_MODEL = "Xenova/bart-large-mnli";
export const LOCAL_ZERO_SHOT_REVISION = "71a9d2a7c389b1a812afc3cc1668f8c877681b00";
/**
 * fp32 weights are about 1.63 GB. The 411 MB quantized build tagged 6–9 of 10
 * labels per entry, so zero-shot stays at fp32.
 */
export const LOCAL_ZERO_SHOT_DTYPE = "fp32";
/** Same 384-d bge-small model on the Workers AI free neuron allocation. */
export const CLOUDFLARE_EMBEDDING_MODEL = "@cf/baai/bge-small-en-v1.5";
export const LOCAL_SUMMARY_MODEL = "onnx-community/Llama-3.2-1B-Instruct-ONNX";
export const LOCAL_SUMMARY_REVISION = "82ac69368916173bad498ad390290faab92d4fb0";
export const LOCAL_SUMMARY_MODEL_LIGHT = "onnx-community/Qwen2.5-0.5B-Instruct";
export const LOCAL_SUMMARY_LIGHT_REVISION = "22942cb7d7ba4cc81bb4673549ca4d4614469b5e";
/** q4 weights are about 1.7 GB for Llama 3.2 1B, loaded only after bart is disposed. */
export const LOCAL_SUMMARY_DTYPE = "q4";
export const CLOUDFLARE_SUMMARY_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8-fast";
export const HF_SUMMARY_MODEL = "meta-llama/Llama-3.1-8B-Instruct";
/** Cache key used when a summarizer does not name its own model. */
export const SUMMARY_MODEL = LOCAL_SUMMARY_MODEL;
export const EMBED_BATCH_LIMIT = 100;
export const LOCAL_ATTEMPTS = 2;
export const CLOUDFLARE_TIMEOUT_MS = 20_000;
export const CLOUDFLARE_MAX_BYTES = 1_000_000;
export const MODEL_FETCH_TIMEOUT_MS = 120_000;
export const ENRICH_MAX_PER_RUN = 20;
/** Passed to bart as `hypothesis_template`. `{}` is the label. */
export const TAG_HYPOTHESIS_TEMPLATE = "This frontend platform change is about {}.";
export const TAG_TOP_K = 3;

export const ZERO_SHOT_LABELS = ["already know", "adjacent", "new"] as const;

/** Sticky labels need a higher sigmoid score, and still have to agree with the source or parser. */
export const TAG_SCORE_MIN: Record<string, number> = {
  react: 0.9,
  node: 0.9,
  lts: 0.9,
  css: 0.8,
  html: 0.8,
  typescript: 0.8,
  "app-router": 0.8,
  nextjs: 0.8,
  security: 0.8,
  baseline: 0.8,
};
export const DEFAULT_TAG_SCORE_MIN = 0.85;

export function cacheModelId(provider: "local" | "cloudflare", model: string, revision?: string): string {
  return revision ? `${provider}:${model}@${revision}` : `${provider}:${model}`;
}

export const LOCAL_EMBEDDING_CACHE_MODEL = cacheModelId("local", LOCAL_EMBEDDING_MODEL, LOCAL_EMBEDDING_REVISION);
export const CLOUDFLARE_EMBEDDING_CACHE_MODEL = cacheModelId("cloudflare", CLOUDFLARE_EMBEDDING_MODEL);
export const LOCAL_TAG_CACHE_MODEL = cacheModelId("local", LOCAL_ZERO_SHOT_MODEL, LOCAL_ZERO_SHOT_REVISION);

export const SIMILARITY_ALREADY_KNOW = 0.75;
export const SIMILARITY_ADJACENT = 0.55;
