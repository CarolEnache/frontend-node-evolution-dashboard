import type { NeuronLedger } from "./budget";
import { createCloudflareEmbedder, type CloudflareCredentials } from "./cloudflare";
import { createLocalEmbedder, type Embedder, type ExtractionPipeline } from "./embed";
import type { ZeroShotClassifier } from "./hf";
import { EMBEDDING_DIMENSIONS, LOCAL_ATTEMPTS } from "./models";
import { createLocalTagger, createLocalZeroShot, createSilentTagger, type Tagger, type ZeroShotPipeline } from "./zero-shot";

export type EmbedderLoader = (model: string) => Promise<ExtractionPipeline>;
export type ZeroShotLoader = (model: string) => Promise<ZeroShotPipeline>;

export interface InferenceRouting {
  provider?: string;
  /** Cloudflare is used only when this is true and both credentials are set. */
  fallback?: boolean;
  accountId?: string;
  apiToken?: string;
  fetchImpl?: typeof fetch;
  ledger?: NeuronLedger;
  sleep?: (ms: number) => Promise<void>;
}

function credentialsFrom(options: InferenceRouting): CloudflareCredentials | null {
  if (!options.fallback) return null;
  const accountId = options.accountId?.trim() ?? "";
  const apiToken = options.apiToken?.trim() ?? "";
  if (!accountId || !apiToken) return null;
  return { accountId, apiToken };
}

async function withLocalAttempts<T>(fn: () => Promise<T>, sleep: (ms: number) => Promise<void>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < LOCAL_ATTEMPTS; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      if (attempt < LOCAL_ATTEMPTS - 1) await sleep(200 * 2 ** attempt);
    }
  }
  throw last;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createResilientEmbedder(
  options: InferenceRouting & {
    load?: EmbedderLoader;
  } = {},
): Embedder {
  const provider = options.provider?.trim().toLowerCase() === "cloudflare" ? "cloudflare" : "local";
  const credentials = credentialsFrom(options);
  const local = createLocalEmbedder({ dimensions: EMBEDDING_DIMENSIONS, load: options.load });
  const remote = credentials
    ? createCloudflareEmbedder({
        ...credentials,
        fetchImpl: options.fetchImpl,
        dimensions: EMBEDDING_DIMENSIONS,
        ledger: options.ledger,
      })
    : null;
  const sleep = options.sleep ?? defaultSleep;
  return {
    modelId: provider === "cloudflare" && remote ? remote.modelId : local.modelId,
    provider: provider === "cloudflare" && remote ? "cloudflare" : "local",
    async embed(texts) {
      if (provider === "cloudflare" && remote) return remote.embed(texts);
      try {
        return await withLocalAttempts(() => local.embed(texts), sleep);
      } catch (error) {
        if (!remote) throw error;
        return remote.embed(texts);
      }
    },
    async dispose() {
      await local.dispose?.();
    },
  };
}

export function createResilientZeroShot(
  options: InferenceRouting & {
    load?: ZeroShotLoader;
  } = {},
): ZeroShotClassifier {
  const local = createLocalZeroShot({ load: options.load });
  const sleep = options.sleep ?? defaultSleep;
  return {
    modelId: local.modelId,
    provider: "local",
    async classify(text) {
      return withLocalAttempts(() => local.classify(text), sleep);
    },
    async dispose() {
      await local.dispose?.();
    },
  };
}

export function createResilientTagger(
  options: InferenceRouting & {
    load?: ZeroShotLoader;
  } = {},
): Tagger {
  const provider = options.provider?.trim().toLowerCase() === "cloudflare" ? "cloudflare" : "local";
  const credentials = credentialsFrom(options);
  if (provider === "cloudflare" && credentials) return createSilentTagger();
  const local = createLocalTagger({ load: options.load });
  const sleep = options.sleep ?? defaultSleep;
  return {
    modelId: local.modelId,
    provider: "local",
    writesTags: true,
    async tag(input) {
      return withLocalAttempts(() => local.tag(input), sleep);
    },
    async dispose() {
      await local.dispose?.();
    },
  };
}
