import { createLocalEmbedder, type Embedder } from "./embed";
import { createHfSummarizer, createHfZeroShot, type ChatRequest, type HfClientLike, type Summarizer, type ZeroShotClassifier } from "./hf";
import { createCloudflareSummarizer, createLocalSummarizer, resolveLocalSummaryModel, resolveSummaryProvider } from "./summary";

export { createMemoryCache, sha256, type VectorCache } from "./cache";
export { classifyGap, gapFromSimilarity, type ZeroShotVote } from "./classify";
export { cosineSimilarity, maxSimilarity } from "./cosine";
export { createLocalEmbedder, type Embedder } from "./embed";
export { embedProfile, enrichEntries, enrichEntry, type EnrichDeps } from "./enrich";
export {
  AiCreditsError,
  backoffMs,
  buildSummaryMessages,
  createHfSummarizer,
  createHfZeroShot,
  normaliseZeroShot,
  oneLine,
  readHttpStatus,
  textFromCompletion,
  withHfRetry,
  type HfClientLike,
  type Summarizer,
  type ZeroShotClassifier,
} from "./hf";
export {
  CLOUDFLARE_SUMMARY_MODEL,
  EMBEDDING_MODEL,
  HF_SUMMARY_MODEL,
  LOCAL_EMBEDDING_MODEL,
  LOCAL_SUMMARY_MODEL,
  LOCAL_SUMMARY_MODEL_LIGHT,
  SIMILARITY_ADJACENT,
  SIMILARITY_ALREADY_KNOW,
  SUMMARY_MODEL,
  ZERO_SHOT_LABELS,
  ZERO_SHOT_MODEL,
} from "./models";
export {
  createCloudflareSummarizer,
  createLocalSummarizer,
  resolveLocalSummaryModel,
  resolveSummaryProvider,
  type SummaryProviderName,
} from "./summary";

export interface AiBindings {
  embedder: Embedder;
  zeroShot: ZeroShotClassifier | null;
  summarizer: Summarizer | null;
}

/**
 * Embeddings always run locally. Summaries default to a local ONNX model.
 * `SUMMARY_PROVIDER=cloudflare` uses Workers AI when the account id and token
 * are set, and falls back to local otherwise. `SUMMARY_PROVIDER=huggingface`
 * is the only path that calls Inference Providers, and only when `HF_TOKEN` is set.
 */
export async function createDefaultAi(options?: {
  token?: string;
  provider?: string;
  localModel?: string;
  fetchImpl?: typeof fetch;
  generateLocal?: (messages: ChatRequest["messages"], model: string) => Promise<string>;
}): Promise<AiBindings> {
  const provider = resolveSummaryProvider(options?.provider ?? process.env.SUMMARY_PROVIDER);
  const token = (options?.token ?? process.env.HF_TOKEN ?? "").trim();
  const embedder = createLocalEmbedder();
  if (provider === "huggingface" && token) {
    const { InferenceClient } = await import("@huggingface/inference");
    const client = new InferenceClient(token) as unknown as HfClientLike;
    return {
      embedder,
      zeroShot: createHfZeroShot(client),
      summarizer: createHfSummarizer(client),
    };
  }
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (provider === "cloudflare" && accountId && apiToken) {
    return {
      embedder,
      zeroShot: null,
      summarizer: createCloudflareSummarizer({ accountId, apiToken, fetchImpl: options?.fetchImpl }),
    };
  }
  return {
    embedder,
    zeroShot: null,
    summarizer: createLocalSummarizer({
      model: options?.localModel ?? resolveLocalSummaryModel(),
      generate: options?.generateLocal,
    }),
  };
}
