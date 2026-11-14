import { describe, expect, it, vi } from "vitest";
import type { Entry } from "@evolution/shared-types";
import {
  AiCreditsError,
  backoffMs,
  buildSummaryMessages,
  classifyGap,
  cosineSimilarity,
  createCloudflareSummarizer,
  createHfSummarizer,
  createHfZeroShot,
  createLocalEmbedder,
  createMemoryCache,
  embedProfile,
  enrichEntries,
  maxSimilarity,
  normaliseZeroShot,
  oneLine,
  readHttpStatus,
  sha256,
  stripSummaryBoilerplate,
  SUMMARY_INPUT_CHARS,
  SUMMARY_SYSTEM_PROMPT,
  textFromCompletion,
  trimSummaryInput,
  withHfRetry,
} from "../src/index";

const sample = (overrides: Partial<Entry> = {}): Entry => ({
  id: "nextjs:article:cache",
  source: "nextjs",
  type: "article",
  title: "Cache Components",
  date: "2026-10-28T00:00:00.000Z",
  url: "https://example.com",
  summary: "A new caching model.",
  tags: ["nextjs"],
  raw: null,
  ...overrides,
});

function embedderReturning(vectorFor: (text: string) => number[]) {
  return createLocalEmbedder({
    load: async () => async (texts: string[]) => ({ tolist: () => texts.map((text) => vectorFor(text)) }),
  });
}

describe("retry, parsing, and cloudflare helpers", () => {
  it("reads status codes and backs off only for 429 and 503", async () => {
    expect(readHttpStatus(null)).toBeUndefined();
    expect(readHttpStatus("boom")).toBeUndefined();
    expect(readHttpStatus({ status: 400, httpResponse: { status: 429 } })).toBe(429);
    expect(readHttpStatus({ response: { status: 503 } })).toBe(503);
    expect(backoffMs(2, 0.5)).toBe(200 * 4 + 50);

    const sleeps: number[] = [];
    await expect(
      withHfRetry(async () => {
        throw Object.assign(new Error("no"), { status: 400 });
      }, { sleep: async () => undefined, maxAttempts: 4 }),
    ).rejects.toThrow("no");
    expect(sleeps).toEqual([]);

    let attempts = 0;
    await expect(
      withHfRetry(
        async () => {
          attempts += 1;
          throw Object.assign(new Error("slow"), { status: 429 });
        },
        { sleep: async (ms) => { sleeps.push(ms); }, maxAttempts: 2, random: () => 0 },
      ),
    ).rejects.toThrow("slow");
    expect(attempts).toBe(2);
    expect(sleeps).toEqual([backoffMs(0, 0)]);

    await expect(
      withHfRetry(async () => {
        throw Object.assign(new Error("payment"), { status: 402 });
      }),
    ).rejects.toBeInstanceOf(AiCreditsError);
  });

  it("normalises model payloads and clamps one line", () => {
    expect(normaliseZeroShot("nope")).toEqual([]);
    expect(normaliseZeroShot([{ label: "new" }, null, { label: "adjacent", score: 0.2 }])).toEqual([
      { label: "adjacent", score: 0.2 },
    ]);
    expect(normaliseZeroShot({ labels: ["new", 1], scores: [0.4, "x"] })).toEqual([{ label: "new", score: 0.4 }]);
    expect(textFromCompletion("  hi  ")).toBe("hi");
    expect(textFromCompletion(1)).toBe("");
    expect(textFromCompletion(["a", { text: "b" }, { text: 1 }, null])).toBe("ab");
    expect(oneLine("  too   much\nspace  ")).toBe("too much space");
    expect(oneLine("abcdef", 4)).toBe("abc…");
    const messages = buildSummaryMessages(sample(), ["React", "GraphQL"]);
    expect(messages[0]?.content).toBe(SUMMARY_SYSTEM_PROMPT);
    expect(messages[1]?.content).toContain("Cache Components");
    expect(messages[1]?.content).toContain("React, GraphQL");
    const huge = sample({ summary: `${"A".repeat(4_000)}TAILMARKER` });
    const trimmed = buildSummaryMessages(huge, ["React"]);
    expect(trimmed[1]?.content.length).toBeLessThanOrEqual(SUMMARY_INPUT_CHARS);
    expect(trimmed[1]?.content.endsWith("…")).toBe(true);
    expect(trimmed[1]?.content).not.toContain("TAILMARKER");
    expect(trimSummaryInput("  a \n b  ", 10)).toBe("a b");
    expect(stripSummaryBoilerplate("Summary: Learn the patch.")).toBe("Learn the patch.");
    expect(stripSummaryBoilerplate("Here's a one-line summary: Learn the patch.")).toBe("Learn the patch.");
    expect(stripSummaryBoilerplate("<|start_header_id|>assistant<|end_header_id|>\nLearn the patch.<|eot_id|>")).toBe(
      "Learn the patch.",
    );
    expect(stripSummaryBoilerplate('"Learn the patch."')).toBe("Learn the patch.");
  });

  it("returns the top zero-shot label and a one-line summary", async () => {
    const classifier = createHfZeroShot({
      zeroShotClassification: async () => [{ label: "adjacent", score: 0.4 }, { label: "new", score: 0.8 }],
    });
    await expect(classifier.classify("text")).resolves.toEqual({ label: "new", score: 0.8 });
    const empty = createHfZeroShot({ zeroShotClassification: async () => [] });
    await expect(empty.classify("text")).rejects.toThrow(/no labels/);

    const summarizer = createHfSummarizer({
      chatCompletion: async () => ({ choices: [{ message: { content: [{ text: "Learn this." }, " Now."] } }] }),
    });
    await expect(summarizer.summarize(sample(), ["React"])).resolves.toBe("Learn this. Now.");
    const blank = createHfSummarizer({ chatCompletion: async () => ({ choices: [] }) });
    await expect(blank.summarize(sample(), [])).resolves.toBe("");
  });

  it("rejects a failed Cloudflare response and ignores a non-string body", async () => {
    const failing = createCloudflareSummarizer({
      accountId: "acct",
      apiToken: "token",
      enabled: true,
      fetchImpl: async () => new Response("no", { status: 500 }),
    });
    await expect(failing.summarize(sample(), ["React"])).rejects.toThrow(/failed with 500/);
    const empty = createCloudflareSummarizer({
      accountId: "acct",
      apiToken: "token",
      enabled: true,
      fetchImpl: async () => new Response(JSON.stringify({ result: { response: 12 } }), { status: 200 }),
    });
    await expect(empty.summarize(sample(), ["React"])).resolves.toBe("");
  });
});

describe("cache, cosine, and enrichment edges", () => {
  it("hashes text and isolates cache entries", async () => {
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256("abc")).not.toBe(sha256("abd"));
    const cache = createMemoryCache();
    await cache.setVector("k", "model-a", [1]);
    await cache.setVector("k", "model-b", [2]);
    await cache.setSummary("k", "model-a", "line");
    expect(await cache.getVector("k", "model-a")).toEqual([1]);
    expect(await cache.getVector("k", "model-b")).toEqual([2]);
    expect(await cache.getVector("missing", "model-a")).toBeNull();
    expect(await cache.getSummary("k", "model-a")).toBe("line");
    expect(await cache.getSummary("k", "model-b")).toBeNull();
  });

  it("computes cosine over unequal and zero vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
    expect(cosineSimilarity([-1, 0], [1, 0])).toBeCloseTo(-1);
    expect(maxSimilarity([1, 0], [])).toBe(0);
    expect(maxSimilarity([1, 0], [[0, 1], [1, 0]])).toBeCloseTo(1);
  });

  it("wraps a single flat embedding and skips an empty batch", async () => {
    const load = vi.fn(async () => async (texts: string[]) => ({
      tolist: () => (texts.length === 1 ? [0.2, 0.4] : texts.map(() => [0.2, 0.4])),
    }));
    const embedder = createLocalEmbedder({ load });
    expect(await embedder.embed([])).toEqual([]);
    expect(load).not.toHaveBeenCalled();
    expect(await embedder.embed(["only"])).toEqual([[0.2, 0.4]]);
    expect(await embedder.embed(["a", "b"])).toEqual([[0.2, 0.4], [0.2, 0.4]]);
  });

  it("nudges only a recognised label near a threshold", () => {
    expect(classifyGap(0.73)).toBe("adjacent");
    expect(classifyGap(0.73, { label: "unknown", score: 0.99 })).toBe("adjacent");
    expect(classifyGap(0.73, { label: " Adjacent ", score: 0.99 })).toBe("adjacent");
    expect(classifyGap(0.73, { label: "already-know", score: 0.7 })).toBe("already-know");
    expect(classifyGap(0.52, { label: "adjacent", score: 0.7 })).toBe("adjacent");
    expect(classifyGap(0.49, { label: "adjacent", score: 0.99 })).toBe("new");
  });

  it("reuses cached profile vectors and does not cache an empty summary", async () => {
    let embeds = 0;
    const embedder = embedderReturning(() => {
      embeds += 1;
      return [0, 1];
    });
    const cache = createMemoryCache();
    const profile = { role: "Lead", skills: ["GraphQL", "React"] };
    const hash = sha256(profile.skills.join("\n"));
    await cache.setVector(`profile:${hash}:0`, embedder.modelId, [1, 0]);
    const vectors = await embedProfile(profile.skills, embedder, cache);
    expect(vectors[0]).toEqual([1, 0]);
    expect(vectors[1]).toEqual([0, 1]);
    expect(embeds).toBe(1);
    expect(await embedProfile([], embedder, cache)).toEqual([]);

    const summarize = vi.fn(async () => "");
    const fresh = sample({ title: "SQLite", summary: "Built in." });
    const orthogonal = embedderReturning((text) => (text.includes("SQLite") ? [0, 1] : [1, 0]));
    const freshCache = createMemoryCache();
    await enrichEntries([fresh], { embedder: orthogonal, cache: freshCache, profile, summarizer: { summarize } });
    await enrichEntries([fresh], { embedder: orthogonal, cache: freshCache, profile, summarizer: { summarize } });
    expect(summarize).toHaveBeenCalledTimes(2);
  });

  it("rethrows unexpected enrichment errors and drops a stale worth-learning line", async () => {
    const embedder = embedderReturning((text) => (text.includes("SQLite") ? [0, 1] : [1, 0]));
    await expect(
      enrichEntries([sample()], {
        embedder,
        cache: createMemoryCache(),
        profile: { role: "Lead", skills: ["GraphQL"] },
        zeroShot: { classify: async () => { throw new Error("boom"); } },
      }),
    ).rejects.toThrow("boom");

    const known = await enrichEntries([sample({ summary: "React server components.", worthLearning: "old" })], {
      embedder: embedderReturning(() => [1, 0]),
      cache: createMemoryCache(),
      profile: { role: "Lead", skills: ["React"] },
      summarizer: { summarize: async () => "should not run" },
    });
    expect(known.entries[0]?.gap).toBe("already-know");
    expect(known.entries[0]?.worthLearning).toBeUndefined();
  });
});
