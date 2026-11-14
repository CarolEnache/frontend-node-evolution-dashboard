import { describe, expect, it, vi } from "vitest";

const hf = vi.hoisted(() => ({ zeroShotCalls: 0 }));

vi.mock("@huggingface/inference", () => ({
  InferenceClient: class {
    zeroShotClassification() {
      hf.zeroShotCalls += 1;
      return Promise.resolve([{ label: "new", score: 0.99 }]);
    }
    chatCompletion() {
      return Promise.resolve({ choices: [{ message: { content: "note" } }] });
    }
  },
}));
import type { Entry } from "@evolution/shared-types";
import { DASHBOARD_TAGS } from "@evolution/shared-types";
import {
  CLOUDFLARE_EMBEDDING_CACHE_MODEL,
  CLOUDFLARE_EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  LOCAL_EMBEDDING_CACHE_MODEL,
  LOCAL_EMBEDDING_MODEL,
  LOCAL_TAG_CACHE_MODEL,
  LOCAL_ZERO_SHOT_MODEL,
  TAG_HYPOTHESIS_TEMPLATE,
  ZERO_SHOT_LABELS,
  selectModelTags,
  createCloudflareEmbedder,
  createDefaultAi,
  createLocalEmbedder,
  createLocalTagger,
  createLocalZeroShot,
  createMemoryCache,
  NeuronBudgetError,
  createResilientEmbedder,
  createResilientTagger,
  enrichEntries,
  entryCacheKey,
  l2Normalize,
  reconcileStoredTags,
  readCloudflareCredentials,
  resolveInferenceProvider,
  scoresFromZeroShot,
  vectorsFromCloudflareBody,
} from "../src/index";

const entry = (overrides: Partial<Entry> = {}): Entry => ({
  id: "node:lts:26.13.0",
  source: "node",
  type: "lts",
  title: "Node.js 26.13.0",
  version: "26.13.0",
  date: "2026-10-28T00:00:00.000Z",
  url: "https://example.com",
  summary: "Lithium LTS.",
  tags: ["node"],
  raw: null,
  ...overrides,
});

function ones(length = EMBEDDING_DIMENSIONS): number[] {
  return Array.from({ length }, () => 1 / Math.sqrt(length));
}

function cloudflareResponse(vectors: number[][]): Response {
  return new Response(JSON.stringify({ result: { data: vectors, shape: [vectors.length, vectors[0]?.length ?? 0] } }), {
    status: 200,
  });
}

describe("local zero-shot tags", () => {
  it("classifies with bart-large-mnli over the dashboard tags and the gap labels", async () => {
    const calls: Array<{ model: string; labels: string[]; multi?: boolean }> = [];
    const load = vi.fn(async (model: string) => {
      return async (text: string, labels: string[], options?: { multi_label?: boolean; hypothesis_template?: string }) => {
        calls.push({ model, labels, multi: options?.multi_label });
        expect(text).toContain("security");
        if (options?.multi_label) {
          expect(options.hypothesis_template).toBe(TAG_HYPOTHESIS_TEMPLATE);
          return { labels, scores: labels.map((label) => (label === "security" || label === "node" ? 0.95 : 0.1)) };
        }
        return { labels: ["new", "already know"], scores: [0.91, 0.04] };
      };
    });
    const tagger = createLocalTagger({ load });
    const zeroShot = createLocalZeroShot({ load });
    await expect(
      tagger.tag({ text: "A security fix for node", source: "node", parserTags: ["node", "security"] }),
    ).resolves.toEqual(["node", "security"]);
    await expect(zeroShot.classify("A security fix for node")).resolves.toEqual({ label: "new", score: 0.91 });
    expect(tagger.modelId).toBe(LOCAL_TAG_CACHE_MODEL);
    expect(calls[0]?.model).toBe(LOCAL_ZERO_SHOT_MODEL);
    expect(calls[0]?.labels).toEqual([...DASHBOARD_TAGS]);
    expect(calls[0]?.multi).toBe(true);
    expect(calls[1]?.labels).toEqual([...ZERO_SHOT_LABELS]);
    expect(calls[1]?.multi).toBeUndefined();
    expect(scoresFromZeroShot([{ labels: ["css"], scores: [0.2] }])).toEqual({ labels: ["css"], scores: [0.2] });
    expect(scoresFromZeroShot(null)).toEqual({ labels: [], scores: [] });
  });

  it("drops stale model tags when the text changes and keeps parser tags", () => {
    const stored = entry({ tags: ["baseline", "node"], summary: "Old text." });
    const changed = entry({ tags: ["node"], summary: "A rewritten release note." });
    expect(reconcileStoredTags(changed, stored).tags).toEqual(["node"]);
    expect(reconcileStoredTags(changed, stored).tags).not.toContain("baseline");
    const same = entry({ tags: ["node"], summary: stored.summary, title: stored.title });
    expect(reconcileStoredTags(same, stored).tags).toEqual(["baseline", "node"]);
  });

  it("does not tag Node LTS as react or a CSS entry as node or lts", () => {
    expect(
      selectModelTags({
        source: "node",
        parserTags: ["lts", "lithium", "node"],
        scores: [
          { label: "react", score: 0.93 },
          { label: "node", score: 0.96 },
          { label: "lts", score: 0.94 },
          { label: "css", score: 0.7 },
        ],
      }),
    ).toEqual(["lts", "node"]);
    expect(
      selectModelTags({
        source: "caniuse",
        parserTags: ["caniuse", "css", "firefox"],
        scores: [
          { label: "node", score: 0.91 },
          { label: "lts", score: 0.9 },
          { label: "css", score: 0.97 },
          { label: "react", score: 0.8 },
        ],
      }),
    ).toEqual(["css"]);
  });
});

describe("embedding persistence and fallback", () => {
  it("asks the local model for 384-d mean-pooled normalised vectors and skips a repeat", async () => {
    const seen: Array<{ pooling?: string; normalize?: boolean }> = [];
    let embedCalls = 0;
    const load = async () => async (texts: string[], options?: { pooling?: string; normalize?: boolean }) => {
      embedCalls += 1;
      seen.push({ pooling: options?.pooling, normalize: options?.normalize });
      return { tolist: () => texts.map(() => ones()) };
    };
    const embedder = createLocalEmbedder({ load, dimensions: EMBEDDING_DIMENSIONS });
    const tagger = {
      modelId: LOCAL_TAG_CACHE_MODEL,
      provider: "local" as const,
      writesTags: true,
      tag: vi.fn(async () => ["baseline"]),
    };
    const cache = createMemoryCache();
    const profile = { role: "Lead", skills: ["React"] };
    const sample = entry({ summary: "A security release." });
    const first = await enrichEntries([sample], { embedder, cache, profile, tagger });
    const second = await enrichEntries([sample], { embedder, cache, profile, tagger });
    expect(first.entries[0]?.tags).toEqual(["node"]);
    expect(second.entries[0]?.tags).toEqual(["node"]);
    expect(await cache.getJson(entryCacheKey("local", sample), LOCAL_TAG_CACHE_MODEL, "tags")).toEqual(["baseline"]);
    expect(tagger.tag).toHaveBeenCalledTimes(1);
    expect(embedCalls).toBe(2);
    expect(seen[0]).toEqual({ pooling: "mean", normalize: true });
    expect(await cache.getVector(entryCacheKey("local", sample), embedder.modelId)).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(embedder.modelId).toBe(LOCAL_EMBEDDING_CACHE_MODEL);

    embedCalls = 0;
    await enrichEntries([entry({ summary: "A different security note." })], { embedder, cache, profile, tagger });
    expect(embedCalls).toBe(1);
    expect(tagger.tag).toHaveBeenCalledTimes(2);
  });

  it("uses Cloudflare only when local inference fails or the provider is cloudflare", async () => {
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        `https://api.cloudflare.com/client/v4/accounts/acct/ai/run/${CLOUDFLARE_EMBEDDING_MODEL}`,
      );
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer cf-token");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      const body = JSON.parse(String(init?.body)) as { text: string[]; pooling?: string };
      expect(body.pooling).toBe("mean");
      return cloudflareResponse(body.text.map(() => ones()));
    });
    const localLoad = vi.fn(async () => async (texts: string[]) => ({
      tolist: () => texts.map(() => ones().slice(0, 3)),
    }));
    const fallback = createResilientEmbedder({
      provider: "local",
      fallback: true,
      accountId: "acct",
      apiToken: "cf-token",
      fetchImpl: fetchImpl as typeof fetch,
      load: localLoad,
      sleep: async () => undefined,
    });
    const vectors = await fallback.embed(["Node.js"]);
    expect(vectors[0]).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(localLoad).toHaveBeenCalledWith(LOCAL_EMBEDDING_MODEL);
    expect(localLoad.mock.calls.length).toBeGreaterThan(1);
    expect(fetchImpl).toHaveBeenCalledOnce();

    fetchImpl.mockClear();
    localLoad.mockClear();
    const direct = createResilientEmbedder({
      provider: " CLOUDFLARE ",
      fallback: true,
      accountId: "acct",
      apiToken: "cf-token",
      fetchImpl: fetchImpl as typeof fetch,
      load: localLoad,
    });
    await direct.embed(["Node.js"]);
    expect(localLoad).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledOnce();
    fetchImpl.mockClear();
    await direct.embed(Array.from({ length: 101 }, (_, index) => `text ${index}`));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const limited = createCloudflareEmbedder({
      accountId: "acct",
      apiToken: "cf-token",
      fetchImpl: vi.fn() as typeof fetch,
      budget: { tryReserve: async () => false, spent: () => 0 },
    });
    await expect(limited.embed(["Node.js"])).rejects.toBeInstanceOf(NeuronBudgetError);

    const quietFetch = vi.fn();
    const healthy = createResilientEmbedder({
      provider: "local",
      fallback: true,
      accountId: "acct",
      apiToken: "cf-token",
      fetchImpl: quietFetch as typeof fetch,
      load: async () => async (texts: string[]) => ({ tolist: () => texts.map(() => ones()) }),
    });
    await healthy.embed(["ok"]);
    expect(healthy.modelId).toBe(LOCAL_EMBEDDING_CACHE_MODEL);
    expect(quietFetch).not.toHaveBeenCalled();
  });

  it("stays local when Cloudflare credentials are blank and rejects a bad payload", async () => {
    expect(readCloudflareCredentials({})).toBeNull();
    expect(readCloudflareCredentials({ CLOUDFLARE_ACCOUNT_ID: " acct ", CLOUDFLARE_API_TOKEN: " " })).toBeNull();
    expect(resolveInferenceProvider("local")).toBe("local");
    expect(resolveInferenceProvider(undefined)).toBe("local");
    const load = vi.fn(async () => async (texts: string[]) => ({ tolist: () => texts.map(() => ones()) }));
    const embedder = createResilientEmbedder({ provider: "cloudflare", accountId: "", apiToken: "", load });
    await expect(embedder.embed(["Node.js"])).resolves.toHaveLength(1);
    expect(load).toHaveBeenCalledOnce();

    const failing = createCloudflareEmbedder({
      accountId: "acct",
      apiToken: "cf-token",
      fetchImpl: async () => new Response("no", { status: 503 }),
    });
    await expect(failing.embed(["x"])).rejects.toThrow(/failed with 503/);
    expect(vectorsFromCloudflareBody({ data: [0.5, 0] }, 1)[0]).toEqual([0.5, 0]);
    expect(() => vectorsFromCloudflareBody({ result: {} }, 1)).toThrow(/no embeddings/);
    expect(l2Normalize([0, 0])).toEqual([0, 0]);
    expect(l2Normalize([3, 4])[0]).toBeCloseTo(0.6);
    const blocked = createResilientEmbedder({
      provider: "cloudflare",
      accountId: "acct",
      apiToken: "cf-token",
      fetchImpl: vi.fn() as typeof fetch,
      load,
    });
    await blocked.embed(["Node.js"]);
    expect(load).toHaveBeenCalled();
  });

  it("retries local tagging and does not write Cloudflare tags", async () => {
    const fetchImpl = vi.fn();
    let loads = 0;
    const tagger = createResilientTagger({
      provider: "local",
      fallback: true,
      accountId: "acct",
      apiToken: "cf-token",
      fetchImpl: fetchImpl as typeof fetch,
      sleep: async () => undefined,
      load: async () => {
        loads += 1;
        throw new Error("local model failed");
      },
    });
    const input = { text: "security release", source: "node" as const, parserTags: ["node", "security"] };
    await expect(tagger.tag(input)).rejects.toThrow(/local model failed/);
    await expect(tagger.tag(input)).rejects.toThrow(/local model failed/);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(loads).toBeGreaterThan(2);
    expect(tagger.writesTags).toBe(true);
  });

  it("does not send tagging through Hugging Face when summaries do", async () => {
    vi.stubEnv("CLOUDFLARE_FALLBACK", "1");
    vi.stubEnv("EMBEDDINGS_PROVIDER", "cloudflare");
    vi.stubEnv("TAGGING_PROVIDER", "cloudflare");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "acct");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "cf-token");
    const fetchImpl = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { text?: string[] };
      return cloudflareResponse((body.text ?? ["x"]).map(() => ones()));
    });
    const loadEmbedder = vi.fn();
    const loadZeroShot = vi.fn();
    const ai = await createDefaultAi({
      provider: "huggingface",
      token: "hf_test",
      fetchImpl: fetchImpl as typeof fetch,
      loadEmbedder,
      loadZeroShot,
    });
    await ai.embedder.embed(["Node.js"]);
    await expect(ai.tagger.tag({ text: "Node.js", source: "node", parserTags: ["node"] })).resolves.toEqual([]);
    expect(ai.embedder.modelId).toBe(CLOUDFLARE_EMBEDDING_CACHE_MODEL);
    expect(ai.tagger.writesTags).toBe(false);
    expect(ai.summarizer?.modelId).toContain("Llama");
    expect(loadEmbedder).not.toHaveBeenCalled();
    expect(loadZeroShot).not.toHaveBeenCalled();
    expect(hf.zeroShotCalls).toBe(0);
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(0);
  });
});
