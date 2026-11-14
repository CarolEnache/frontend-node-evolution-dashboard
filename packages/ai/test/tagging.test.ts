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
  CLOUDFLARE_EMBEDDING_MODEL,
  CLOUDFLARE_TAG_SCORE_MIN,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  LOCAL_EMBEDDING_MODEL,
  LOCAL_ZERO_SHOT_MODEL,
  ZERO_SHOT_LABELS,
  ZERO_SHOT_MODEL,
  createCloudflareEmbedder,
  createDefaultAi,
  createLocalEmbedder,
  createLocalTagger,
  createLocalZeroShot,
  createMemoryCache,
  createResilientEmbedder,
  createResilientTagger,
  createResilientZeroShot,
  enrichEntries,
  entryCacheKey,
  l2Normalize,
  preserveEntryTags,
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
      return async (text: string, labels: string[], options?: { multi_label?: boolean }) => {
        calls.push({ model, labels, multi: options?.multi_label });
        expect(text).toContain("security");
        if (options?.multi_label) {
          return { labels, scores: labels.map((label) => (label === "security" || label === "node" ? 0.8 : 0.1)) };
        }
        return { labels: ["new", "already know"], scores: [0.91, 0.04] };
      };
    });
    const tagger = createLocalTagger({ load });
    const zeroShot = createLocalZeroShot({ load });
    await expect(tagger.tag("A security fix for node")).resolves.toEqual(["node", "security"]);
    await expect(zeroShot.classify("A security fix for node")).resolves.toEqual({ label: "new", score: 0.91 });
    expect(tagger.modelId).toBe(ZERO_SHOT_MODEL);
    expect(calls[0]?.model).toBe(LOCAL_ZERO_SHOT_MODEL);
    expect(calls[0]?.labels).toEqual([...DASHBOARD_TAGS]);
    expect(calls[0]?.multi).toBe(true);
    expect(calls[1]?.labels).toEqual([...ZERO_SHOT_LABELS]);
    expect(calls[1]?.multi).toBeUndefined();
    expect(scoresFromZeroShot([{ labels: ["css"], scores: [0.2] }])).toEqual({ labels: ["css"], scores: [0.2] });
    expect(scoresFromZeroShot(null)).toEqual({ labels: [], scores: [] });
  });

  it("keeps a stored tag when a later ingest did not enrich", () => {
    const stored = entry({ tags: ["baseline", "node"], gap: "new" });
    const incoming = entry({ tags: ["lts", "node"], summary: "Refreshed from the feed." });
    expect(preserveEntryTags(incoming, stored).tags).toEqual(["baseline", "lts", "node"]);
    expect(preserveEntryTags(incoming, undefined).tags).toEqual(["lts", "node"]);
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
      modelId: ZERO_SHOT_MODEL,
      tag: vi.fn(async () => ["baseline"]),
    };
    const cache = createMemoryCache();
    const profile = { role: "Lead", skills: ["React"] };
    const sample = entry({ summary: "A security release." });
    const first = await enrichEntries([sample], { embedder, cache, profile, tagger });
    const second = await enrichEntries([sample], { embedder, cache, profile, tagger });
    expect(first.entries[0]?.tags).toEqual(["baseline", "node"]);
    expect(second.entries[0]?.tags).toEqual(first.entries[0]?.tags);
    expect(tagger.tag).toHaveBeenCalledTimes(1);
    expect(embedCalls).toBe(2);
    expect(seen[0]).toEqual({ pooling: "mean", normalize: true });
    expect(await cache.getVector(entryCacheKey(sample), EMBEDDING_MODEL)).toHaveLength(EMBEDDING_DIMENSIONS);

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
      const body = JSON.parse(String(init?.body)) as { text: string[]; pooling?: string };
      expect(body.pooling).toBe("mean");
      return cloudflareResponse(body.text.map(() => ones()));
    });
    const localLoad = vi.fn(async () => async (texts: string[]) => ({
      tolist: () => texts.map(() => ones().slice(0, 3)),
    }));
    const fallback = createResilientEmbedder({
      provider: "local",
      accountId: "acct",
      apiToken: "cf-token",
      fetchImpl: fetchImpl as typeof fetch,
      load: localLoad,
    });
    const vectors = await fallback.embed(["Node.js"]);
    expect(vectors[0]).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(localLoad).toHaveBeenCalledWith(LOCAL_EMBEDDING_MODEL);
    expect(fetchImpl).toHaveBeenCalledOnce();

    fetchImpl.mockClear();
    localLoad.mockClear();
    const direct = createResilientEmbedder({
      provider: " CLOUDFLARE ",
      accountId: "acct",
      apiToken: "cf-token",
      fetchImpl: fetchImpl as typeof fetch,
      load: localLoad,
    });
    await direct.embed(["Node.js"]);
    expect(localLoad).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledOnce();

    const quietFetch = vi.fn();
    const healthy = createResilientEmbedder({
      provider: "local",
      accountId: "acct",
      apiToken: "cf-token",
      fetchImpl: quietFetch as typeof fetch,
      load: async () => async (texts: string[]) => ({ tolist: () => texts.map(() => ones()) }),
    });
    await healthy.embed(["ok"]);
    expect(healthy.modelId).toBe(EMBEDDING_MODEL);
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
    expect(CLOUDFLARE_TAG_SCORE_MIN).toBeGreaterThan(0);
  });

  it("falls back to Cloudflare label scoring when local tagging throws", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { text: string[] };
      return cloudflareResponse(
        body.text.map((text, index) => {
          const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
          if (index === 0 || text.includes("security")) vector[0] = 1;
          else vector[1] = 1;
          return vector;
        }),
      );
    });
    const tagger = createResilientTagger({
      provider: "local",
      accountId: "acct",
      apiToken: "cf-token",
      fetchImpl: fetchImpl as typeof fetch,
      load: async () => {
        throw new Error("local model failed");
      },
    });
    await expect(tagger.tag("security release")).resolves.toEqual(["security"]);

    const localLoader = vi.fn();
    const forced = createResilientZeroShot({
      provider: "cloudflare",
      accountId: "acct",
      apiToken: "cf-token",
      fetchImpl: (async (_input: string | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { text: string[] };
        return cloudflareResponse(
          body.text.map((text) => {
            const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
            vector[text.includes("new to the reader") || text === "entry" ? 0 : 1] = 1;
            return vector;
          }),
        );
      }) as typeof fetch,
      load: localLoader,
    });
    await expect(forced.classify("entry")).resolves.toMatchObject({ label: "new" });
    expect(localLoader).not.toHaveBeenCalled();
  });

  it("does not send tagging through Hugging Face when summaries do", async () => {
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
    await ai.tagger.tag("Node.js");
    expect(ai.embedder.modelId).toBe(EMBEDDING_MODEL);
    expect(ai.summarizer?.modelId).not.toBe(ZERO_SHOT_MODEL);
    expect(loadEmbedder).not.toHaveBeenCalled();
    expect(loadZeroShot).not.toHaveBeenCalled();
    expect(hf.zeroShotCalls).toBe(0);
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(0);
  });
});
