import type { NeuronBudget } from "./neurons";
import { cloudflareFallbackEnabled, readCloudflareCredentials } from "./cloudflare";
import type { Embedder } from "./embed";
import { createHfSummarizer, type ChatRequest, type HfClientLike, type Summarizer, type ZeroShotClassifier } from "./hf";
import { createResilientEmbedder, createResilientTagger, createResilientZeroShot, type EmbedderLoader, type ZeroShotLoader } from "./providers";
import { createCloudflareSummarizer, createLocalSummarizer, resolveLocalSummaryModel, resolveSummaryProvider } from "./summary";
import type { Tagger } from "./zero-shot";

export {
  CLOUDFLARE_NEURON_BUDGET,
  CLOUDFLARE_NEURON_RATES,
  cloudflareSummaryNeuronCost,
  createFileNeuronBudget,
  createMemoryNeuronBudget,
  createStoredNeuronBudget,
  defaultNeuronBudget,
  estimateTokens,
  neuronCost,
  NeuronBudgetError,
  resolveNeuronBudget,
  tryReserveModel,
  utcDay,
  type NeuronBudget,
  type NeuronStore,
} from "./neurons";
export { createMemoryCache, sha256, type VectorCache } from "./cache";
export { classifyGap, gapFromSimilarity, type ZeroShotVote } from "./classify";
export { cosineSimilarity, maxSimilarity } from "./cosine";
export { assertEmbeddingDimensions, createLocalEmbedder, type Embedder } from "./embed";
export { entryCacheKey, embedProfile, enrichmentLine, enrichEntries, type EnrichDeps } from "./enrich";
export {
  activeCloudflareCredentials,
  cloudflareFallbackEnabled,
  cloudflareRunUrl,
  createCloudflareEmbedder,
  l2Normalize,
  readBoundedJson,
  readCloudflareCredentials,
  resolveInferenceProvider,
  vectorsFromCloudflareBody,
} from "./cloudflare";
export { createResilientEmbedder, createResilientTagger, createResilientZeroShot } from "./providers";
export { isModelDownloadUrl, modelDownloadFetch, resolveModelCacheDir } from "./runtime";
export { contentHash, mergeEntryTags, reconcileStoredTags, selectModelTags, SOURCE_AGREED_TAGS } from "./tags";
export { createLocalTagger, createLocalZeroShot, createSilentTagger, scoresFromZeroShot, type TagInput, type Tagger } from "./zero-shot";
export {
  AiCreditsError,
  backoffMs,
  buildSummaryMessages,
  createHfSummarizer,
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
  CLOUDFLARE_EMBEDDING_CACHE_MODEL,
  CLOUDFLARE_EMBEDDING_MODEL,
  CLOUDFLARE_SUMMARY_MODEL,
  EMBED_BATCH_LIMIT,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  ENRICH_MAX_PER_RUN,
  HF_SUMMARY_MODEL,
  LOCAL_EMBEDDING_CACHE_MODEL,
  LOCAL_EMBEDDING_MODEL,
  LOCAL_EMBEDDING_REVISION,
  LOCAL_SUMMARY_MODEL,
  LOCAL_SUMMARY_MODEL_LIGHT,
  LOCAL_TAG_CACHE_MODEL,
  LOCAL_ZERO_SHOT_MODEL,
  LOCAL_ZERO_SHOT_REVISION,
  SIMILARITY_ADJACENT,
  SIMILARITY_ALREADY_KNOW,
  SUMMARY_MODEL,
  TAG_HYPOTHESIS_TEMPLATE,
  TAG_SCORE_MIN,
  TAG_TOP_K,
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
  zeroShot: ZeroShotClassifier;
  tagger: Tagger;
  summarizer: Summarizer | null;
}

/**
 * Embeddings and tags run locally. Cloudflare runs only when
 * `CLOUDFLARE_FALLBACK=1` and both credentials are set, and only for
 * embeddings or summaries. It does not write tags. A failed local embedding
 * is retried on the next call. Hugging Face only summarises, and only when
 * `SUMMARY_PROVIDER=huggingface` and `HF_TOKEN` are set.
 */
export async function createDefaultAi(options?: {
  token?: string;
  provider?: string;
  embeddingsProvider?: string;
  taggingProvider?: string;
  localModel?: string;
  fetchImpl?: typeof fetch;
  generateLocal?: (messages: ChatRequest["messages"], model: string) => Promise<string>;
  loadEmbedder?: EmbedderLoader;
  loadZeroShot?: ZeroShotLoader;
  budget?: NeuronBudget;
  sleep?: (ms: number) => Promise<void>;
  fallback?: boolean;
}): Promise<AiBindings> {
  const provider = resolveSummaryProvider(options?.provider ?? process.env.SUMMARY_PROVIDER);
  const token = (options?.token ?? process.env.HF_TOKEN ?? "").trim();
  const fallback = options?.fallback ?? cloudflareFallbackEnabled();
  const credentials = fallback ? readCloudflareCredentials() : null;
  const routing = {
    fallback: Boolean(credentials),
    accountId: credentials?.accountId,
    apiToken: credentials?.apiToken,
    fetchImpl: options?.fetchImpl,
    budget: options?.budget,
    sleep: options?.sleep,
  };
  const embedder = createResilientEmbedder({
    ...routing,
    provider: options?.embeddingsProvider ?? process.env.EMBEDDINGS_PROVIDER,
    load: options?.loadEmbedder,
  });
  const tagger = createResilientTagger({
    ...routing,
    provider: options?.taggingProvider ?? process.env.TAGGING_PROVIDER,
    load: options?.loadZeroShot,
  });
  const zeroShot = createResilientZeroShot({ ...routing, load: options?.loadZeroShot });
  if (provider === "huggingface" && token) {
    const { InferenceClient } = await import("@huggingface/inference");
    const client = new InferenceClient(token) as unknown as HfClientLike;
    return { embedder, zeroShot, tagger, summarizer: createHfSummarizer(client) };
  }
  if (provider === "cloudflare" && credentials) {
    return {
      embedder,
      zeroShot,
      tagger,
      summarizer: createCloudflareSummarizer({
        ...credentials,
        fetchImpl: options?.fetchImpl,
        budget: options?.budget,
      }),
    };
  }
  return {
    embedder,
    zeroShot,
    tagger,
    summarizer: createLocalSummarizer({
      model: options?.localModel ?? resolveLocalSummaryModel(),
      generate: options?.generateLocal,
    }),
  };
}
