import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Entry } from "@evolution/shared-types";
import {
  AiCreditsError,
  LOCAL_SUMMARY_MODEL,
  createDefaultAi,
  createLocalEmbedder,
  createMemoryCache,
  createMemoryNeuronBudget,
  enrichEntries,
  entryCacheKey,
  localSummaryModelId,
  sha256,
  summaryCacheModel,
} from "../src/index";

const entry = (overrides: Partial<Entry> = {}): Entry => ({
  id: "node:release:22.0.0",
  source: "node",
  type: "release",
  title: "Node.js built-in SQLite",
  version: "22.0.0",
  date: "2026-10-28T00:00:00.000Z",
  url: "https://example.com",
  summary: "A new built-in module.",
  tags: ["node"],
  raw: null,
  worthLearning: "Keep this.",
  ...overrides,
});

function orthogonalEmbedder() {
  return createLocalEmbedder({
    load: async () => async (texts: string[]) => ({
      tolist: () => texts.map((text) => (text.includes("SQLite") ? [0, 1] : [1, 0])),
    }),
  });
}

const profile = { role: "Lead", skills: ["GraphQL"] };

describe("summarization pipeline", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("skips a second summary for the same content hash and model id", async () => {
    const summarize = vi.fn(async () => "Learn the built-in SQLite module.");
    const cache = createMemoryCache();
    const fresh = entry({ worthLearning: undefined });
    const deps = {
      embedder: orthogonalEmbedder(),
      cache,
      profile,
      summarizer: { modelId: "model-a", summarize },
    };
    const first = await enrichEntries([fresh], deps);
    expect(entryCacheKey(fresh)).toBe(`${fresh.id}:${sha256(`${fresh.title}\n${fresh.summary}`)}`);
    expect(summaryCacheModel("local", "model-a")).toBe("local:model-a");
    expect(await cache.getSummary(entryCacheKey(fresh), summaryCacheModel("local", "model-a"))).toContain("SQLite");
    expect(first.entries[0]?.worthLearning).toBe("Learn the built-in SQLite module.");
    await enrichEntries([fresh], deps);
    expect(summarize).toHaveBeenCalledTimes(1);
    await enrichEntries([entry({ ...fresh, summary: "Changed notes." })], deps);
    expect(summarize).toHaveBeenCalledTimes(2);
    await enrichEntries([fresh], { ...deps, summarizer: { modelId: "model-b", summarize } });
    expect(summarize).toHaveBeenCalledTimes(3);
  });

  it("keeps the stored line when local inference fails and no Cloudflare credentials are set", async () => {
    const summarize = vi.fn(async () => {
      throw new Error("onnx failed");
    });
    const result = await enrichEntries([entry()], {
      embedder: orthogonalEmbedder(),
      cache: createMemoryCache(),
      profile,
      summarizer: { modelId: localSummaryModelId(LOCAL_SUMMARY_MODEL), summarize },
    });
    expect(result.paused).toBe(false);
    expect(result.entries[0]?.worthLearning).toBe("Keep this.");
    await enrichEntries([entry()], {
      embedder: orthogonalEmbedder(),
      cache: createMemoryCache(),
      profile,
      summarizer: { modelId: localSummaryModelId(LOCAL_SUMMARY_MODEL), summarize },
    });
    expect(summarize).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("left unchanged"));
  });

  it("retries the local model later instead of keeping a Cloudflare result as the local summary", async () => {
    vi.stubEnv("CLOUDFLARE_FALLBACK", "1");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "acct");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "cf-token");
    let localCalls = 0;
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ result: { response: "Summary: From the edge." } }), { status: 200 }),
    );
    const budget = createMemoryNeuronBudget();
    const ai = await createDefaultAi({
      provider: "local",
      token: "hf_not_used",
      budget,
      fetchImpl: fetchImpl as typeof fetch,
      generateLocal: async () => {
        localCalls += 1;
        if (localCalls === 1) throw new Error("weights missing");
        return "Local again.";
      },
    });
    const cache = createMemoryCache();
    const fresh = entry({ worthLearning: "Keep this." });
    const deps = {
      embedder: orthogonalEmbedder(),
      cache,
      profile,
      summarizer: ai.summarizer,
      summaryFallback: ai.summaryFallback,
    };
    const first = await enrichEntries([fresh], deps);
    expect(first.entries[0]?.worthLearning).toBe("From the edge.");
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(await cache.getSummary(entryCacheKey(fresh), summaryCacheModel("local", ai.summarizer?.modelId ?? ""))).toBeNull();
    const second = await enrichEntries([fresh], deps);
    expect(second.entries[0]?.worthLearning).toBe("Local again.");
    expect(localCalls).toBe(2);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("stops further summary calls after credits run out and keeps each stored line", async () => {
    let calls = 0;
    const result = await enrichEntries(
      [entry({ id: "a", title: "SQLite a" }), entry({ id: "b", title: "SQLite b" })],
      {
        embedder: orthogonalEmbedder(),
        cache: createMemoryCache(),
        profile,
        summarizer: {
          provider: "huggingface",
          summarize: async () => {
            calls += 1;
            throw new AiCreditsError();
          },
        },
      },
    );
    expect(result.paused).toBe(false);
    expect(calls).toBe(1);
    expect(result.entries[0]?.worthLearning).toBe("Keep this.");
    expect(result.entries[1]?.worthLearning).toBe("Keep this.");
    expect(result.entries[1]?.gap).toBe("new");
  });

  it("disposes the embedding pipeline before the summary step", async () => {
    const order: string[] = [];
    const embedder = orthogonalEmbedder();
    const original = embedder.dispose?.bind(embedder);
    embedder.dispose = async () => {
      order.push("dispose-embed");
      await original?.();
    };
    await enrichEntries([entry({ worthLearning: undefined })], {
      embedder,
      cache: createMemoryCache(),
      profile,
      summarizer: {
        summarize: async () => {
          order.push("summary");
          return "Learn the built-in SQLite module.";
        },
      },
    });
    expect(order[0]).toBe("dispose-embed");
    expect(order.indexOf("summary")).toBeGreaterThan(0);
  });
});
