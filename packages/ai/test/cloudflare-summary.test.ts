import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Entry } from "@evolution/shared-types";
import {
  createCloudflareSummarizer,
  createLimitedFetch,
  createLocalEmbedder,
  createMemoryCache,
  createMemoryNeuronBudget,
  enrichEntries,
  SUMMARY_HTTP_MAX_BYTES,
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

describe("existing Cloudflare summarizer guards", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("does not call Workers AI unless CLOUDFLARE_FALLBACK=1", async () => {
    const fetchImpl = vi.fn();
    const off = createCloudflareSummarizer({
      accountId: "acct",
      apiToken: "token",
      fetchImpl: fetchImpl as typeof fetch,
    });
    await expect(off.summarize(entry(), ["React"])).rejects.toThrow(/CLOUDFLARE_FALLBACK=1/);
    expect(fetchImpl).not.toHaveBeenCalled();

    vi.stubEnv("CLOUDFLARE_FALLBACK", "1");
    const on = createCloudflareSummarizer({
      accountId: "acct",
      apiToken: "token",
      fetchImpl: async (_input, init) => {
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        expect(init?.signal?.aborted).toBe(false);
        return new Response(JSON.stringify({ result: { response: "From Workers AI." } }), { status: 200 });
      },
      budget: createMemoryNeuronBudget(),
    });
    await expect(on.summarize(entry(), ["React"])).resolves.toBe("From Workers AI.");
  });

  it("aborts a hung Cloudflare response and limits the body", async () => {
    const hung = createCloudflareSummarizer({
      accountId: "acct",
      apiToken: "token",
      enabled: true,
      timeoutMs: 20,
      budget: createMemoryNeuronBudget(),
      fetchImpl: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(init.signal?.reason ?? new Error("aborted"));
          });
        }),
    });
    await expect(hung.summarize(entry(), ["React"])).rejects.toThrow();

    const oversized = createCloudflareSummarizer({
      accountId: "acct",
      apiToken: "token",
      enabled: true,
      maxBytes: 32,
      budget: createMemoryNeuronBudget(),
      fetchImpl: async () => new Response("x".repeat(200), { status: 200 }),
    });
    await expect(oversized.summarize(entry(), ["React"])).rejects.toThrow(/exceeds 32 bytes/);

    const limited = createLimitedFetch({
      maxBytes: 8,
      fetchImpl: async () => new Response("x".repeat(SUMMARY_HTTP_MAX_BYTES), { status: 200 }),
    });
    await expect(limited("https://example.test")).rejects.toThrow(/exceeds 8 bytes/);
  });

  it("skips the request when the daily neuron budget is spent", async () => {
    const fetchImpl = vi.fn();
    const summarizer = createCloudflareSummarizer({
      accountId: "acct",
      apiToken: "token",
      enabled: true,
      budget: createMemoryNeuronBudget({ limit: 0 }),
      fetchImpl: fetchImpl as typeof fetch,
    });
    await expect(summarizer.summarize(entry(), ["React"])).rejects.toThrow(/budget is spent/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps each stored summary when Cloudflare returns 429 or times out", async () => {
    let calls = 0;
    const summarizer = createCloudflareSummarizer({
      accountId: "acct",
      apiToken: "token",
      enabled: true,
      timeoutMs: 30,
      budget: createMemoryNeuronBudget(),
      fetchImpl: () => {
        calls += 1;
        if (calls === 1) return Promise.resolve(new Response("slow", { status: 429 }));
        return new Promise((_resolve, reject) => {
          setTimeout(() => reject(new Error("timed out")), 40);
        });
      },
    });
    const result = await enrichEntries(
      [entry({ id: "a", title: "SQLite a" }), entry({ id: "b", title: "SQLite b" })],
      {
        embedder: orthogonalEmbedder(),
        cache: createMemoryCache(),
        profile: { role: "Lead", skills: ["GraphQL"] },
        summarizer,
      },
    );
    expect(result.paused).toBe(false);
    expect(result.entries.map((item) => item.worthLearning)).toEqual(["Keep this.", "Keep this."]);
    expect(result.entries.every((item) => item.gap === "new")).toBe(true);
    expect(calls).toBe(2);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("left unchanged"));
  });
});
