import { readCloudflareCredentials } from "./cloudflare";
import type { Embedder } from "./embed";
import { createHfSummarizer, type ChatRequest, type HfClientLike, type Summarizer, type ZeroShotClassifier } from "./hf";
import { createResilientEmbedder, createResilientTagger, createResilientZeroShot, type EmbedderLoader, type ZeroShotLoader } from "./providers";
import { createCloudflareSummarizer, createLocalSummarizer, resolveLocalSummaryModel, resolveSummaryProvider } from "./summary";
import type { Tagger } from "./zero-shot";

export { createMemoryCache, sha256, type VectorCache } from "./cache";
export { classifyGap, gapFromSimilarity, type ZeroShotVote } from "./classify";
export { cosineSimilarity, maxSimilarity } from "./cosine";
export { assertEmbeddingDimensions, createLocalEmbedder, type Embedder } from "./embed";
export { entryCacheKey, embedProfile, enrichEntries, enrichEntry, type EnrichDeps } from "./enrich";
export {
  cloudflareRunUrl,
  createCloudflareEmbedder,
  l2Normalize,
  readCloudflareCredentials,
  resolveInferenceProvider,
  vectorsFromCloudflareBody,
} from "./cloudflare";
export { createResilientEmbedder, createResilientTagger, createResilientZeroShot } from "./providers";
export { mergeEntryTags, preserveEntryTags } from "./tags";
export { createLocalTagger, createLocalZeroShot, scoresFromZeroShot, type Tagger } from "./zero-shot";
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
  CLOUDFLARE_EMBEDDING_MODEL,
  CLOUDFLARE_SUMMARY_MODEL,
  CLOUDFLARE_TAG_SCORE_MIN,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  HF_SUMMARY_MODEL,
  LOCAL_EMBEDDING_MODEL,
  LOCAL_SUMMARY_MODEL,
  LOCAL_SUMMARY_MODEL_LIGHT,
  LOCAL_ZERO_SHOT_MODEL,
  SIMILARITY_ADJACENT,
  SIMILARITY_ALREADY_KNOW,
  SUMMARY_MODEL,
  TAG_SCORE_MIN,
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
 * Embeddings and tags run locally. `EMBEDDINGS_PROVIDER=cloudflare` or
 * `TAGGING_PROVIDER=cloudflare` uses Workers AI when the account id and token
 * are set, and so does a failed local inference. Missing credentials stay on
 * the local model. Summaries follow `SUMMARY_PROVIDER`. Hugging Face is only
 * the summary path, and only when that provider and `HF_TOKEN` are both set.
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
}): Promise<AiBindings> {
  const provider = resolveSummaryProvider(options?.provider ?? process.env.SUMMARY_PROVIDER);
  const token = (options?.token ?? process.env.HF_TOKEN ?? "").trim();
  const credentials = readCloudflareCredentials();
  const routing = {
    accountId: credentials?.accountId,
    apiToken: credentials?.apiToken,
    fetchImpl: options?.fetchImpl,
  };
  const embedder = createResilientEmbedder({
    ...routing,
    provider: options?.embeddingsProvider ?? process.env.EMBEDDINGS_PROVIDER,
    load: options?.loadEmbedder,
  });
  const taggingProvider = options?.taggingProvider ?? process.env.TAGGING_PROVIDER;
  const zeroShot = createResilientZeroShot({ ...routing, provider: taggingProvider, load: options?.loadZeroShot });
  const tagger = createResilientTagger({ ...routing, provider: taggingProvider, load: options?.loadZeroShot });
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
      summarizer: createCloudflareSummarizer({ ...credentials, fetchImpl: options?.fetchImpl }),
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
