import { describe, expect, it, vi } from "vitest";
import type { Entry } from "@evolution/shared-types";
import {
  AiCreditsError,
  CLOUDFLARE_SUMMARY_MODEL,
  LOCAL_SUMMARY_MODEL,
  LOCAL_SUMMARY_MODEL_LIGHT,
  backoffMs,
  classifyGap,
  cosineSimilarity,
  createCloudflareSummarizer,
  createDefaultAi,
  createHfSummarizer,
  createLocalEmbedder,
  createLocalSummarizer,
  createMemoryCache,
  enrichEntries,
  gapFromSimilarity,
  normaliseZeroShot,
  resolveSummaryProvider,
  withHfRetry,
} from "../src/index";

const entry = (overrides: Partial<Entry> = {}): Entry => ({
  id: "nextjs:release:16.4.3",
  source: "nextjs",
  type: "release",
  title: "Next.js 16.4.3",
  version: "16.4.3",
  date: "2026-10-28T00:00:00.000Z",
  url: "https://example.com",
  summary: "Turbopack is the default bundler.",
  tags: ["nextjs"],
  raw: null,
  ...overrides,
});

describe("similarity and gaps", () => {
  it("computes cosine similarity and the documented thresholds", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([], [1])).toBe(0);
    expect(gapFromSimilarity(0.75)).toBe("already-know");
    expect(gapFromSimilarity(0.749)).toBe("adjacent");
    expect(gapFromSimilarity(0.55)).toBe("adjacent");
    expect(gapFromSimilarity(0.549)).toBe("new");
  });

  it("lets a confident zero-shot label nudge only near a boundary", () => {
    expect(classifyGap(0.86, { label: "new", score: 0.99 })).toBe("already-know");
    expect(classifyGap(0.73, { label: "already know", score: 0.91 })).toBe("already-know");
    expect(classifyGap(0.73, { label: "already know", score: 0.4 })).toBe("adjacent");
    expect(classifyGap(0.2, { label: "adjacent", score: 0.95 })).toBe("new");
  });

  it("normalises both zero-shot response shapes", () => {
    expect(normaliseZeroShot([{ label: "new", score: 0.8 }])).toEqual([{ label: "new", score: 0.8 }]);
    expect(normaliseZeroShot({ labels: ["adjacent"], scores: [0.6] })).toEqual([{ label: "adjacent", score: 0.6 }]);
  });
});

describe("mocked model wrappers", () => {
  it("embeds through an injected pipeline and caches by content", async () => {
    let embedCalls = 0;
    const load = vi.fn(async () => {
      return async (texts: string[]) => {
        embedCalls += 1;
        return { tolist: () => texts.map(() => [1, 0, 0]) };
      };
    });
    const embedder = createLocalEmbedder({ load });
    const cache = createMemoryCache();
    const profile = { role: "Lead", skills: ["React", "Next.js App Router"] };
    const summarizer = { summarize: vi.fn(async () => "Learn the cache component model before the upgrade.") };
    const zeroShot = { classify: vi.fn(async () => ({ label: "new", score: 0.4 })) };
    const first = await enrichEntries([entry({ summary: "Brand new runtime API." })], {
      embedder,
      cache,
      profile,
      zeroShot,
      summarizer,
    });
    const second = await enrichEntries([entry({ summary: "Brand new runtime API." })], {
      embedder,
      cache,
      profile,
      zeroShot,
      summarizer,
    });
    expect(load).toHaveBeenCalledTimes(1);
    expect(embedCalls).toBe(2);
    expect(embedder.modelId).toContain("Xenova/bge-small-en-v1.5");
    expect(first.entries[0]?.gap).toBe("already-know");
    expect(first.entries[0]?.worthLearning).toBeUndefined();
    expect(summarizer.summarize).not.toHaveBeenCalled();
    expect(second.entries[0]?.similarity).toBe(first.entries[0]?.similarity);
    expect(embedCalls).toBe(2);
  });

  it("summarises adjacent and new items only, then reuses the cached line", async () => {
    const embedder = createLocalEmbedder({
      load: async () => async (texts: string[]) => ({
        tolist: () => texts.map((text) => (text.includes("SQLite") ? [0, 1] : [1, 0])),
      }),
    });
    const cache = createMemoryCache();
    const summarize = vi.fn(async () => "Worth a look: built-in SQLite changes the data story.");
    const fresh = entry({ id: "node:release:22.0.0", title: "Node.js built-in SQLite", summary: "A new built-in module." });
    const result = await enrichEntries([fresh], {
      embedder,
      cache,
      profile: { role: "Lead", skills: ["GraphQL"] },
      summarizer: { summarize },
    });
    expect(result.entries[0]?.gap).toBe("new");
    expect(result.entries[0]?.worthLearning).toContain("SQLite");
    await enrichEntries([fresh], {
      embedder,
      cache,
      profile: { role: "Lead", skills: ["GraphQL"] },
      summarizer: { summarize },
    });
    expect(summarize).toHaveBeenCalledTimes(1);
  });

  it("retries 429 and 503, and pauses on 402 without a token", async () => {
    const sleeps: number[] = [];
    const zeroShot = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("slow"), { httpResponse: { status: 429 } }))
      .mockRejectedValueOnce(Object.assign(new Error("loading"), { status: 503 }))
      .mockResolvedValueOnce([{ label: "adjacent", score: 0.88 }]);
    const classifier = {
      async classify(text: string) {
        void text;
        const result = await withHfRetry(
          () => zeroShot(),
          { sleep: async (ms) => { sleeps.push(ms); }, random: () => 0 },
        );
        const top = normaliseZeroShot(result).sort((a, b) => b.score - a.score)[0];
        if (!top) throw new Error("Zero-shot classification returned no labels");
        return top;
      },
    };
    await expect(classifier.classify("Node.js adds SQLite")).resolves.toEqual({ label: "adjacent", score: 0.88 });
    expect(sleeps).toEqual([backoffMs(0, 0), backoffMs(1, 0)]);

    const credits = createHfSummarizer({
      chatCompletion: vi.fn(async () => {
        throw Object.assign(new Error("payment"), { response: { status: 402 } });
      }),
    });
    await expect(credits.summarize(entry(), ["React"])).rejects.toBeInstanceOf(AiCreditsError);

    const embedder = createLocalEmbedder({
      load: async () => async () => ({ tolist: () => [[0, 1]] }),
    });
    let calls = 0;
    const paused = await enrichEntries(
      [entry({ id: "a", title: "A" }), entry({ id: "b", title: "B" })],
      {
        embedder,
        cache: createMemoryCache(),
        profile: { role: "Lead", skills: ["GraphQL"] },
        zeroShot: {
          classify: async () => {
            calls += 1;
            throw new AiCreditsError();
          },
        },
      },
    );
    expect(paused.paused).toBe(true);
    expect(calls).toBe(1);
    expect(paused.entries[1]?.gap).toBeUndefined();
  });

  it("does not require a live client to exercise the retry helper", async () => {
    await expect(withHfRetry(async () => "ok")).resolves.toBe("ok");
  });
});

describe("summary provider", () => {
  it("defaults to the local Llama ONNX model and keeps Hugging Face opt-in", async () => {
    expect(resolveSummaryProvider(undefined)).toBe("local");
    expect(resolveSummaryProvider("huggingface")).toBe("huggingface");
    const local = await createDefaultAi({
      provider: "local",
      token: "hf_not_used",
      generateLocal: async () => "Learn the local summary path.",
    });
    expect(local.zeroShot.modelId).toContain("bart-large-mnli");
    expect(local.tagger.modelId).toContain("bart-large-mnli");
    expect(local.summarizer?.modelId).toBe(LOCAL_SUMMARY_MODEL);
    await expect(local.summarizer?.summarize(entry(), ["React"])).resolves.toBe("Learn the local summary path.");

    const light = createLocalSummarizer({
      model: LOCAL_SUMMARY_MODEL_LIGHT,
      generate: async () => "Shorter model.",
    });
    expect(light.modelId).toBe(LOCAL_SUMMARY_MODEL_LIGHT);

    const cloudflare = createCloudflareSummarizer({
      accountId: "acct",
      apiToken: "token",
      fetchImpl: async () => new Response(JSON.stringify({ result: { response: "From Workers AI." } }), { status: 200 }),
    });
    expect(cloudflare.modelId).toBe(CLOUDFLARE_SUMMARY_MODEL);
    await expect(cloudflare.summarize(entry(), ["React"])).resolves.toBe("From Workers AI.");

    const previousAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
    const previousApiToken = process.env.CLOUDFLARE_API_TOKEN;
    const previousLocalModel = process.env.LOCAL_SUMMARY_MODEL;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.LOCAL_SUMMARY_MODEL;
    try {
      const missingCredentials = await createDefaultAi({
        provider: "cloudflare",
        token: "",
        generateLocal: async () => "Local fallback.",
      });
      expect(missingCredentials.summarizer?.modelId).toBe(LOCAL_SUMMARY_MODEL);
      const withoutToken = await createDefaultAi({ provider: "huggingface", token: "" });
      expect(withoutToken.zeroShot.modelId).toContain("bart-large-mnli");
      expect(withoutToken.summarizer?.modelId).toBe(LOCAL_SUMMARY_MODEL);
    } finally {
      if (previousAccount === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;
      else process.env.CLOUDFLARE_ACCOUNT_ID = previousAccount;
      if (previousApiToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
      else process.env.CLOUDFLARE_API_TOKEN = previousApiToken;
      if (previousLocalModel === undefined) delete process.env.LOCAL_SUMMARY_MODEL;
      else process.env.LOCAL_SUMMARY_MODEL = previousLocalModel;
    }
  });
});
