import { createLocalEmbedder, type Embedder } from "./embed";
import { createHfSummarizer, createHfZeroShot, type ChatRequest, type HfClientLike, type Summarizer, type ZeroShotClassifier } from "./hf";
import { createLimitedFetch } from "./http";
import { type NeuronBudget } from "./neurons";
import {
  cloudflareFallbackEnabled,
  createCloudflareSummarizer,
  createLocalSummarizer,
  resolveLocalSummaryModel,
  resolveSummaryProvider,
} from "./summary";

export { createMemoryCache, sha256, type VectorCache } from "./cache";
export { classifyGap, gapFromSimilarity, type ZeroShotVote } from "./classify";
export { cosineSimilarity, maxSimilarity } from "./cosine";
export { createLocalEmbedder, type Embedder } from "./embed";
export { entryCacheKey, embedProfile, enrichEntries, enrichEntry, type EnrichDeps } from "./enrich";
export {
  AiCreditsError,
  backoffMs,
  buildSummaryMessages,
  createHfSummarizer,
  createHfZeroShot,
  normaliseZeroShot,
  oneLine,
  readHttpStatus,
  stripSummaryBoilerplate,
  SUMMARY_INPUT_CHARS,
  SUMMARY_SYSTEM_PROMPT,
  textFromCompletion,
  trimSummaryInput,
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
  LOCAL_SUMMARY_DTYPE,
  LOCAL_SUMMARY_MAX_NEW_TOKENS,
  LOCAL_SUMMARY_MODEL,
  LOCAL_SUMMARY_MODEL_LIGHT,
  LOCAL_SUMMARY_TEMPERATURE,
  SIMILARITY_ADJACENT,
  SIMILARITY_ALREADY_KNOW,
  SUMMARY_MODEL,
  ZERO_SHOT_LABELS,
  ZERO_SHOT_MODEL,
} from "./models";
export { createLimitedFetch, SUMMARY_HTTP_MAX_BYTES, SUMMARY_HTTP_TIMEOUT_MS } from "./http";
export {
  CLOUDFLARE_NEURON_BUDGET,
  cloudflareSummaryNeuronCost,
  createFileNeuronBudget,
  createMemoryNeuronBudget,
  estimateTokens,
  type NeuronBudget,
} from "./neurons";
export {
  cloudflareFallbackEnabled,
  createCloudflareSummarizer,
  createLocalSummarizer,
  localSummaryGenerateOptions,
  localSummaryLoadOptions,
  localSummaryModelId,
  resolveLocalSummaryDtype,
  resolveLocalSummaryModel,
  resolveLocalSummaryRevision,
  resolveSummaryProvider,
  summaryCacheModel,
  summaryModelCacheDir,
  type SummaryProviderName,
} from "./summary";

export interface AiBindings {
  embedder: Embedder;
  zeroShot: ZeroShotClassifier | null;
  summarizer: Summarizer | null;
  /** Set only when CLOUDFLARE_FALLBACK=1 and both Cloudflare credentials are present. */
  summaryFallback: Summarizer | null;
}

/**
 * Embeddings always run locally. Summaries default to a local ONNX model.
 * Cloudflare Workers AI is off unless `CLOUDFLARE_FALLBACK=1` and both
 * credentials are set. `SUMMARY_PROVIDER=cloudflare` uses it as the primary
 * summarizer only with that flag. Otherwise a failed local summary may try it
 * once, and the result is cached under the Cloudflare model so the next run
 * tries local again. `SUMMARY_PROVIDER=huggingface` is the only path that
 * calls Inference Providers, and only when `HF_TOKEN` is set.
 */
export async function createDefaultAi(options?: {
  token?: string;
  provider?: string;
  localModel?: string;
  fetchImpl?: typeof fetch;
  generateLocal?: (messages: ChatRequest["messages"], model: string) => Promise<string>;
  budget?: NeuronBudget;
}): Promise<AiBindings> {
  const provider = resolveSummaryProvider(options?.provider ?? process.env.SUMMARY_PROVIDER);
  const token = (options?.token ?? process.env.HF_TOKEN ?? "").trim();
  const embedder = createLocalEmbedder();
  const limitedFetch = createLimitedFetch({ fetchImpl: options?.fetchImpl });
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "";
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim() ?? "";
  const cloudflare =
    cloudflareFallbackEnabled() && accountId && apiToken
      ? createCloudflareSummarizer({
          accountId,
          apiToken,
          fetchImpl: options?.fetchImpl,
          enabled: true,
          budget: options?.budget,
        })
      : null;
  if (provider === "huggingface" && token) {
    const { InferenceClient } = await import("@huggingface/inference");
    const client = new InferenceClient(token, { fetch: limitedFetch }) as unknown as HfClientLike;
    return {
      embedder,
      zeroShot: createHfZeroShot(client),
      summarizer: createHfSummarizer(client),
      summaryFallback: null,
    };
  }
  if (provider === "cloudflare" && cloudflare) {
    return { embedder, zeroShot: null, summarizer: cloudflare, summaryFallback: null };
  }
  return {
    embedder,
    zeroShot: null,
    summarizer: createLocalSummarizer({
      model: options?.localModel ?? resolveLocalSummaryModel(),
      generate: options?.generateLocal,
    }),
    summaryFallback: provider === "cloudflare" ? null : cloudflare,
  };
}
