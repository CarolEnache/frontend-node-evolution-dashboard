import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, CLOUDFLARE_EMBEDDING_MODEL } from "./models";
import { assertEmbeddingDimensions, type Embedder } from "./embed";

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

export async function runCloudflareModel(options: {
  accountId: string;
  apiToken: string;
  model: string;
  body: unknown;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(cloudflareRunUrl(options.accountId, options.model), {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.apiToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(options.body),
  });
  if (!response.ok) throw new Error(`Cloudflare Workers AI failed with ${response.status}`);
  return response.json();
}

export function createCloudflareEmbedder(options: {
  accountId: string;
  apiToken: string;
  model?: string;
  dimensions?: number;
  fetchImpl?: typeof fetch;
}): Embedder {
  const model = options.model ?? CLOUDFLARE_EMBEDDING_MODEL;
  const dimensions = options.dimensions ?? EMBEDDING_DIMENSIONS;
  return {
    modelId: EMBEDDING_MODEL,
    async embed(texts: string[]) {
      if (texts.length === 0) return [];
      const body = await runCloudflareModel({
        accountId: options.accountId,
        apiToken: options.apiToken,
        model,
        fetchImpl: options.fetchImpl,
        body: { text: texts, pooling: "mean" },
      });
      const vectors = vectorsFromCloudflareBody(body, texts.length).map(l2Normalize);
      assertEmbeddingDimensions(vectors, dimensions);
      return vectors;
    },
  };
}
