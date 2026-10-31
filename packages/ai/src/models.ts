/** Canonical model ids. Embeddings and the default summary run locally. */
export const EMBEDDING_MODEL = "BAAI/bge-small-en-v1.5";
export const LOCAL_EMBEDDING_MODEL = "Xenova/bge-small-en-v1.5";
export const ZERO_SHOT_MODEL = "facebook/bart-large-mnli";
export const LOCAL_SUMMARY_MODEL = "onnx-community/Llama-3.2-1B-Instruct-ONNX";
export const LOCAL_SUMMARY_MODEL_LIGHT = "onnx-community/Qwen2.5-0.5B-Instruct";
export const CLOUDFLARE_SUMMARY_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8-fast";
export const HF_SUMMARY_MODEL = "meta-llama/Llama-3.1-8B-Instruct";
/** Cache key used when a summarizer does not name its own model. */
export const SUMMARY_MODEL = LOCAL_SUMMARY_MODEL;

export const ZERO_SHOT_LABELS = ["already know", "adjacent", "new"] as const;

export const SIMILARITY_ALREADY_KNOW = 0.75;
export const SIMILARITY_ADJACENT = 0.55;
