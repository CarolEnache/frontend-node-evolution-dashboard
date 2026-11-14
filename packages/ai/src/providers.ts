import { createCloudflareEmbedder, readCloudflareCredentials, resolveInferenceProvider, type CloudflareCredentials } from "./cloudflare";
import { createLocalEmbedder, type Embedder } from "./embed";
import type { ZeroShotClassifier } from "./hf";
import { EMBEDDING_DIMENSIONS } from "./models";
import {
  createEmbeddingTagger,
  createEmbeddingZeroShot,
  createLocalTagger,
  createLocalZeroShot,
  type Tagger,
} from "./zero-shot";

interface ExtractionPipeline {
  (texts: string[], options?: { pooling?: "mean" | "none"; normalize?: boolean }): Promise<{ tolist: () => number[] | number[][] }>;
}

type ZeroShotPipeline = (text: string, labels: string[], options?: { multi_label?: boolean }) => Promise<unknown>;

export type EmbedderLoader = (model: string) => Promise<ExtractionPipeline>;
export type ZeroShotLoader = (model: string) => Promise<ZeroShotPipeline>;

export interface InferenceRouting {
  provider?: string;
  accountId?: string;
  apiToken?: string;
  fetchImpl?: typeof fetch;
}

function credentialsFrom(options: InferenceRouting): CloudflareCredentials | null {
  if (options.accountId !== undefined || options.apiToken !== undefined) {
    const accountId = options.accountId?.trim() ?? "";
    const apiToken = options.apiToken?.trim() ?? "";
    if (!accountId || !apiToken) return null;
    return { accountId, apiToken };
  }
  return readCloudflareCredentials();
}

export function createResilientEmbedder(
  options: InferenceRouting & {
    load?: EmbedderLoader;
  } = {},
): Embedder {
  const provider = resolveInferenceProvider(options.provider);
  const credentials = credentialsFrom(options);
  const local = createLocalEmbedder({ dimensions: EMBEDDING_DIMENSIONS, load: options.load });
  const remote = credentials
    ? createCloudflareEmbedder({ ...credentials, fetchImpl: options.fetchImpl, dimensions: EMBEDDING_DIMENSIONS })
    : null;
  return {
    modelId: local.modelId,
    async embed(texts) {
      if (provider === "cloudflare") {
        if (!remote) return local.embed(texts);
        return remote.embed(texts);
      }
      try {
        return await local.embed(texts);
      } catch (error) {
        if (!remote) throw error;
        return remote.embed(texts);
      }
    },
  };
}

export function createResilientZeroShot(
  options: InferenceRouting & {
    load?: ZeroShotLoader;
  } = {},
): ZeroShotClassifier {
  const provider = resolveInferenceProvider(options.provider);
  const credentials = credentialsFrom(options);
  const local = createLocalZeroShot({ load: options.load });
  const remote = credentials
    ? createEmbeddingZeroShot({
        embedder: createCloudflareEmbedder({ ...credentials, fetchImpl: options.fetchImpl }),
      })
    : null;
  return {
    modelId: local.modelId,
    async classify(text) {
      if (provider === "cloudflare") {
        if (!remote) return local.classify(text);
        return remote.classify(text);
      }
      try {
        return await local.classify(text);
      } catch (error) {
        if (!remote) throw error;
        return remote.classify(text);
      }
    },
  };
}

export function createResilientTagger(
  options: InferenceRouting & {
    load?: ZeroShotLoader;
  } = {},
): Tagger {
  const provider = resolveInferenceProvider(options.provider);
  const credentials = credentialsFrom(options);
  const local = createLocalTagger({ load: options.load });
  const remote = credentials
    ? createEmbeddingTagger({
        embedder: createCloudflareEmbedder({ ...credentials, fetchImpl: options.fetchImpl }),
      })
    : null;
  return {
    modelId: local.modelId,
    async tag(text) {
      if (provider === "cloudflare") {
        if (!remote) return local.tag(text);
        return remote.tag(text);
      }
      try {
        return await local.tag(text);
      } catch (error) {
        if (!remote) throw error;
        return remote.tag(text);
      }
    },
  };
}
