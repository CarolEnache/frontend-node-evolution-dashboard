import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiCreditsError, entryCacheKey, sha256 } from "@evolution/ai";
import { createDb } from "@evolution/db";
import { SOURCE_URLS } from "@evolution/ingest";
import { runOnce } from "../apps/worker/src/run";

const ai = vi.hoisted(() => ({ createDefaultAi: vi.fn() }));

vi.mock("@evolution/ai", async () => {
  const actual = await vi.importActual<typeof import("@evolution/ai")>("@evolution/ai");
  return { ...actual, createDefaultAi: ai.createDefaultAi };
});

function databaseUrl(): string {
  return `file:${path.join(mkdtempSync(path.join(tmpdir(), "evolution-worker-")), "test.sqlite")}`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { etag: '"v"' } });
}

const nodeRelease = {
  version: "v26.13.0",
  date: "2026-10-28",
  lts: "Lithium",
  security: false,
  npm: "11.5.0",
  v8: "13.9",
};

describe("ingestion run", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    ai.createDefaultAi.mockReset();
    ai.createDefaultAi.mockResolvedValue({
      embedder: {
        modelId: "BAAI/bge-small-en-v1.5",
        embed: async (texts: string[]) => texts.map((text) => (text.includes("Node.js") ? [0, 1] : [1, 0])),
      },
      zeroShot: null,
      summarizer: { modelId: "test-summary", summarize: async () => "Learn the release." },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("saves successes, skips unchanged sources, and continues after a failure", async () => {
    vi.stubEnv("GITHUB_TOKEN", "github-test-token");
    vi.stubEnv("WEB_REVALIDATE_URL", "https://example.test/api/revalidate");
    vi.stubEnv("REVALIDATE_SECRET", "secret");
    const url = databaseUrl();
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const target = String(input);
      if (target === "https://example.test/api/revalidate") {
        expect(init?.method).toBe("POST");
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer secret");
        return new Response(null, { status: 200 });
      }
      if (target === SOURCE_URLS.nodeIndex) return json([nodeRelease, { version: "v26.12.0", date: "2026-10-01", lts: false }]);
      if (target === SOURCE_URLS.nodeSchedule || target === SOURCE_URLS.nodeRss) return new Response(null, { status: 304 });
      if (target === SOURCE_URLS.tsMeta || target === SOURCE_URLS.tsReleases || target === SOURCE_URLS.tsFeed) {
        if (target === SOURCE_URLS.tsReleases) {
          expect(new Headers(init?.headers).get("authorization")).toBe("Bearer github-test-token");
        }
        return new Response(null, { status: 304 });
      }
      if (target === SOURCE_URLS.caniuseMeta) return new Response("down", { status: 503 });
      throw new Error(`Unexpected fetch ${target}`);
    });
    const result = await runOnce({
      databaseUrl: url,
      sources: ["node", "typescript", "caniuse"],
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(result).toEqual({ upserted: 2, skipped: ["typescript"], failed: ["caniuse"] });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("[ingest] caniuse failed"));
    const nodeCall = fetchImpl.mock.calls.find((call) => String(call[0]) === SOURCE_URLS.nodeIndex);
    expect(new Headers(nodeCall?.[1]?.headers).get("authorization")).toBeNull();
    const db = await createDb(url);
    try {
      const saved = await db.listEntries();
      expect(saved.map((entry) => entry.version).sort()).toEqual(["26.12.0", "26.13.0"]);
      expect(await db.listSourceStates("typescript")).toHaveLength(3);
      expect(await db.listSourceStates("caniuse")).toEqual([]);
    } finally {
      await db.close();
    }
  });

  it("records timeouts and malformed payloads as failed sources", async () => {
    const url = databaseUrl();
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const target = String(input);
      if (target === SOURCE_URLS.nodeIndex) {
        const error = new Error("The operation was aborted due to timeout");
        error.name = "TimeoutError";
        throw error;
      }
      if (target === SOURCE_URLS.caniuseMeta) return new Response("{", { status: 200 });
      throw new Error(`Unexpected fetch ${target}`);
    });
    const result = await runOnce({
      databaseUrl: url,
      sources: ["node", "caniuse"],
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(result.failed.sort()).toEqual(["caniuse", "node"]);
    expect(result.upserted).toBe(0);
    expect(result.skipped).toEqual([]);
  });

  it("logs a failed revalidate and skips the call when the secret is missing", async () => {
    const url = databaseUrl();
    const fetchImpl = vi.fn(async (input: string | URL) => {
      if (String(input) === "https://example.test/api/revalidate") return new Response("no", { status: 502 });
      return new Response(null, { status: 304 });
    });
    vi.stubEnv("WEB_REVALIDATE_URL", "https://example.test/api/revalidate");
    vi.stubEnv("REVALIDATE_SECRET", "secret");
    const failed = await runOnce({ databaseUrl: url, sources: ["node"], fetchImpl: fetchImpl as typeof fetch });
    expect(failed.skipped).toEqual(["node"]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("revalidate failed with 502"));

    fetchImpl.mockClear();
    vi.stubEnv("REVALIDATE_SECRET", "");
    await runOnce({ databaseUrl: url, sources: [], fetchImpl: fetchImpl as typeof fetch });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("enriches new entries and can keep vectors in memory", async () => {
    const url = databaseUrl();
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const target = String(input);
      if (target === SOURCE_URLS.nodeIndex) return json([nodeRelease]);
      return new Response(null, { status: 304 });
    });
    vi.stubEnv("EMBED_CACHE", "memory");
    const result = await runOnce({
      databaseUrl: url,
      sources: ["node"],
      enrich: true,
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(result.upserted).toBe(1);
    expect(ai.createDefaultAi).toHaveBeenCalledOnce();
    const db = await createDb(url);
    try {
      const [saved] = await db.listEntries();
      expect(saved?.gap).toBe("new");
      expect(saved?.worthLearning).toBe("Learn the release.");
      const cacheKey = `${saved?.id}:${sha256(`${saved?.title}\n${saved?.summary}`)}`;
      expect(await db.getVector(cacheKey, "BAAI/bge-small-en-v1.5")).toBeNull();
    } finally {
      await db.close();
    }
  });

  it("pauses enrichment after an out-of-credits error and still saves the rows", async () => {
    ai.createDefaultAi.mockResolvedValue({
      embedder: {
        modelId: "BAAI/bge-small-en-v1.5",
        embed: async (texts: string[]) => texts.map(() => [0, 1]),
      },
      zeroShot: { classify: async () => { throw new AiCreditsError(); } },
      summarizer: null,
    });
    const url = databaseUrl();
    const fetchImpl = vi.fn(async (input: string | URL) => {
      if (String(input) === SOURCE_URLS.nodeIndex) {
        return json([nodeRelease, { version: "v26.12.0", date: "2026-10-01", lts: false }]);
      }
      return new Response(null, { status: 304 });
    });
    vi.stubEnv("ENRICH", "1");
    const result = await runOnce({ databaseUrl: url, sources: ["node"], fetchImpl: fetchImpl as typeof fetch });
    expect(result.upserted).toBe(2);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("paused"));
    const db = await createDb(url);
    try {
      const saved = await db.listEntries();
      expect(saved).toHaveLength(2);
      expect(saved.every((entry) => entry.gap === undefined)).toBe(true);
    } finally {
      await db.close();
    }
  });

  it("persists the local vector and dashboard tag, then keeps both without enrichment", async () => {
    const vector = Array.from({ length: 384 }, (_, index) => (index === 0 ? 1 : 0));
    const embed = vi.fn(async (texts: string[]) => texts.map(() => vector));
    ai.createDefaultAi.mockResolvedValue({
      embedder: { modelId: "BAAI/bge-small-en-v1.5", embed },
      zeroShot: { modelId: "facebook/bart-large-mnli", classify: async () => ({ label: "new", score: 0.2 }) },
      tagger: { modelId: "facebook/bart-large-mnli", tag: async () => ["baseline"] },
      summarizer: { modelId: "test-summary", summarize: async () => "Learn the release." },
    });
    const url = databaseUrl();
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const target = String(input);
      if (target === SOURCE_URLS.nodeIndex) return json([nodeRelease]);
      return new Response(null, { status: 304 });
    });
    await runOnce({ databaseUrl: url, sources: ["node"], enrich: true, fetchImpl: fetchImpl as typeof fetch });
    const enrichedDb = await createDb(url);
    let cacheKey = "";
    try {
      const [saved] = await enrichedDb.listEntries();
      expect(saved?.tags).toContain("baseline");
      cacheKey = entryCacheKey(saved!);
      expect(await enrichedDb.getVector(cacheKey, "BAAI/bge-small-en-v1.5")).toEqual(vector);
      expect(embed.mock.calls.length).toBeGreaterThan(0);
    } finally {
      await enrichedDb.close();
    }

    const callsAfterEnrich = embed.mock.calls.length;
    ai.createDefaultAi.mockClear();
    const seeded = await createDb(url);
    await seeded.setVector("profile:kept", "BAAI/bge-small-en-v1.5", [0.2, 0.3]);
    await seeded.close();
    await runOnce({
      databaseUrl: url,
      sources: ["node"],
      enrich: false,
      fetchImpl: (async (input: string | URL) => {
        const target = String(input);
        if (target === SOURCE_URLS.nodeIndex) return json([{ version: "v26.14.0", date: "2026-11-02", lts: false }]);
        return new Response(null, { status: 304 });
      }) as typeof fetch,
    });
    const plain = await createDb(url);
    try {
      const kept = (await plain.listEntries()).find((item) => item.id === "node:lts:26.13.0");
      expect(kept?.tags).toContain("baseline");
      expect(await plain.getVector(cacheKey, "BAAI/bge-small-en-v1.5")).toEqual(vector);
      expect(await plain.getVector("profile:kept", "BAAI/bge-small-en-v1.5")).toEqual([0.2, 0.3]);
      expect(ai.createDefaultAi).not.toHaveBeenCalled();
      expect(embed.mock.calls.length).toBe(callsAfterEnrich);
    } finally {
      await plain.close();
    }
  });

  it("does not drop a model tag when an unenriched ingest rewrites the row", async () => {
    const url = databaseUrl();
    const seeded = await createDb(url);
    await seeded.upsertEntries([
      {
        id: "node:lts:26.13.0",
        source: "node",
        type: "lts",
        title: "Node.js 26.13.0",
        version: "26.13.0",
        date: "2026-10-28T00:00:00.000Z",
        url: "https://example.com",
        summary: "Already tagged.",
        tags: ["baseline", "kept-by-model", "node"],
        raw: null,
        gap: "new",
        similarity: 0.2,
      },
    ]);
    await seeded.setVector(sha256("stored"), "BAAI/bge-small-en-v1.5", [0.4, 0.5]);
    await seeded.close();
    ai.createDefaultAi.mockClear();
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const target = String(input);
      if (target === SOURCE_URLS.nodeIndex) return json([nodeRelease]);
      return new Response(null, { status: 304 });
    });
    const result = await runOnce({ databaseUrl: url, sources: ["node"], fetchImpl: fetchImpl as typeof fetch });
    expect(result.upserted).toBeGreaterThan(0);
    expect(ai.createDefaultAi).not.toHaveBeenCalled();
    const db = await createDb(url);
    try {
      const saved = (await db.listEntries()).find((item) => item.id === "node:lts:26.13.0");
      expect(saved?.tags).toEqual(expect.arrayContaining(["baseline", "kept-by-model", "node"]));
      expect(await db.getVector(sha256("stored"), "BAAI/bge-small-en-v1.5")).toEqual([0.4, 0.5]);
    } finally {
      await db.close();
    }
  });

  it("does not load a model when every source is unchanged", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 304 }));
    const result = await runOnce({
      databaseUrl: databaseUrl(),
      sources: ["node"],
      enrich: true,
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(result).toEqual({ upserted: 0, skipped: ["node"], failed: [] });
    expect(ai.createDefaultAi).not.toHaveBeenCalled();
  });

  it("uses the global fetch when no implementation is injected", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const target = String(input);
      if (target === SOURCE_URLS.nodeIndex) return json([nodeRelease]);
      if (target === SOURCE_URLS.nodeSchedule || target === SOURCE_URLS.nodeRss) return new Response(null, { status: 304 });
      throw new Error(`Unexpected fetch ${target}`);
    });
    vi.stubGlobal("fetch", fetchImpl);
    const result = await runOnce({ databaseUrl: databaseUrl(), sources: ["node"] });
    expect(result.upserted).toBe(1);
    expect(fetchImpl).toHaveBeenCalled();
  });
});
