import { estimateTokens, NeuronBudgetError, tryReserveModel, type NeuronBudget } from "./neurons";
import { assertEmbeddingDimensions, type Embedder } from "./embed";
import {
  CLOUDFLARE_EMBEDDING_CACHE_MODEL,
  CLOUDFLARE_EMBEDDING_MODEL,
  CLOUDFLARE_MAX_BYTES,
  CLOUDFLARE_TIMEOUT_MS,
  EMBED_BATCH_LIMIT,
  EMBEDDING_DIMENSIONS,
} from "./models";

export interface CloudflareCredentials {
  accountId: string;
  apiToken: string;
}

export function readCloudflareCredentials(
  env: { CLOUDFLARE_ACCOUNT_ID?: string | null; CLOUDFLARE_API_TOKEN?: string | null } = process.env,
): CloudflareCredentials | null {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "";
  const apiToken = env.CLOUDFLARE_API_TOKEN?.trim() ?? "";
  if (!accountId || !apiToken) return null;
  return { accountId, apiToken };
}

/** Off unless this is exactly `1`. Credentials alone do not turn Cloudflare on. */
export function cloudflareFallbackEnabled(env: { CLOUDFLARE_FALLBACK?: string | null } = process.env): boolean {
  return env.CLOUDFLARE_FALLBACK?.trim() === "1";
}

export function activeCloudflareCredentials(
  env: {
    CLOUDFLARE_FALLBACK?: string | null;
    CLOUDFLARE_ACCOUNT_ID?: string | null;
    CLOUDFLARE_API_TOKEN?: string | null;
  } = process.env,
): CloudflareCredentials | null {
  if (!cloudflareFallbackEnabled(env)) return null;
  return readCloudflareCredentials(env);
}

export function resolveInferenceProvider(value: string | undefined): "local" | "cloudflare" {
  return value?.trim().toLowerCase() === "cloudflare" ? "cloudflare" : "local";
}

export function cloudflareRunUrl(accountId: string, model: string): string {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;
}

export function l2Normalize(vector: number[]): number[] {
  let norm = 0;
  for (const value of vector) norm += value * value;
  const magnitude = Math.sqrt(norm);
  if (magnitude === 0) return vector;
  return vector.map((value) => value / magnitude);
}

export function vectorsFromCloudflareBody(body: unknown, count: number): number[][] {
  const data = cloudflareData(body);
  if (count === 1 && Array.isArray(data) && data.length > 0 && typeof data[0] === "number") {
    return [data as number[]];
  }
  if (!Array.isArray(data) || data.length !== count || data.some((row) => !Array.isArray(row))) {
    throw new Error("Cloudflare Workers AI returned no embeddings");
  }
  return data as number[][];
}

function cloudflareData(body: unknown): unknown {
  if (!body || typeof body !== "object") return undefined;
  const record = body as { result?: unknown; data?: unknown };
  const result = record.result && typeof record.result === "object" ? (record.result as { data?: unknown }) : record;
  return result.data;
}

export async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`Cloudflare Workers AI response exceeded ${maxBytes} bytes`);
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (text.length > maxBytes) throw new Error(`Cloudflare Workers AI response exceeded ${maxBytes} bytes`);
    return JSON.parse(text) as unknown;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Cloudflare Workers AI response exceeded ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const text = new TextDecoder().decode(concatBytes(chunks));
  return JSON.parse(text) as unknown;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export async function runCloudflareModel(options: {
  accountId: string;
  apiToken: string;
  model: string;
  body: unknown;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
  budget?: NeuronBudget;
  inputTokens?: number;
  outputTokens?: number;
}): Promise<unknown> {
  if (options.budget) {
    const reserved = await tryReserveModel(
      options.budget,
      options.model,
      options.inputTokens ?? 0,
      options.outputTokens ?? 0,
    );
    if (!reserved) throw new NeuronBudgetError();
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? CLOUDFLARE_TIMEOUT_MS;
  const response = await fetchImpl(cloudflareRunUrl(options.accountId, options.model), {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.apiToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(options.body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Cloudflare Workers AI failed with ${response.status}`);
  return readBoundedJson(response, options.maxBytes ?? CLOUDFLARE_MAX_BYTES);
}

export function createCloudflareEmbedder(options: {
  accountId: string;
  apiToken: string;
  model?: string;
  dimensions?: number;
  fetchImpl?: typeof fetch;
  budget?: NeuronBudget;
  timeoutMs?: number;
  maxBytes?: number;
}): Embedder {
  const model = options.model ?? CLOUDFLARE_EMBEDDING_MODEL;
  const dimensions = options.dimensions ?? EMBEDDING_DIMENSIONS;
  return {
    modelId: CLOUDFLARE_EMBEDDING_CACHE_MODEL,
    provider: "cloudflare",
    async embed(texts: string[]) {
      if (texts.length === 0) return [];
      const vectors: number[][] = [];
      for (let index = 0; index < texts.length; index += EMBED_BATCH_LIMIT) {
        const batch = texts.slice(index, index + EMBED_BATCH_LIMIT);
        const body = await runCloudflareModel({
          accountId: options.accountId,
          apiToken: options.apiToken,
          model,
          fetchImpl: options.fetchImpl,
          timeoutMs: options.timeoutMs,
          maxBytes: options.maxBytes,
          budget: options.budget,
          inputTokens: batch.reduce((sum, text) => sum + estimateTokens(text), 0),
          outputTokens: 0,
          // Mean pooling matches the local bge-small vectors. CLS would need a new cache model.
          body: { text: batch, pooling: "mean" },
        });
        vectors.push(...vectorsFromCloudflareBody(body, batch.length).map(l2Normalize));
      }
      assertEmbeddingDimensions(vectors, dimensions);
      return vectors;
    },
  };
}

