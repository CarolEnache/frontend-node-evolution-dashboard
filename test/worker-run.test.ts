import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiCreditsError, sha256 } from "@evolution/ai";
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
      const caniuse = await db.listSourceStates("caniuse");
      expect(caniuse.map((state) => state.url)).toEqual([SOURCE_URLS.caniuseMeta]);
      expect(caniuse[0]).toMatchObject({ status: "error", lastSuccessAt: null, etag: null });
      expect(caniuse[0]?.lastError).toMatch(/failed with 503/);
    } finally {
      await db.close();
    }
  });

  it("records a failed fetch on source state without clearing the last success", async () => {
    const url = databaseUrl();
    const seededAt = new Date("2026-10-31T00:00:00.000Z");
    const seeded = await createDb(url);
    await seeded.seed(seededAt);
    const before = (await seeded.listSourceStates("node")).find((state) => state.url === SOURCE_URLS.nodeIndex);
    const security = (await seeded.listEntries()).find((entry) => entry.id === "node:security:26.12.1");
    await seeded.close();
    expect(before).toMatchObject({
      etag: '"seed-node"',
      version: "27.0.0-alpha",
      lastSuccessAt: seededAt.toISOString(),
      lastFetchedAt: seededAt.toISOString(),
    });
    expect(security?.gap).toBe("new");

    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const result = await runOnce({
      databaseUrl: url,
      sources: ["node"],
      fetchImpl: fetchImpl as typeof fetch,
      maxAttempts: 1,
      sleep: async () => undefined,
    });
    expect(result.failed).toEqual(["node"]);
    expect(result.upserted).toBe(0);

    const db = await createDb(url);
    try {
      const after = (await db.listSourceStates("node")).find((state) => state.url === SOURCE_URLS.nodeIndex);
      expect(after?.etag).toBe('"seed-node"');
      expect(after?.version).toBe("27.0.0-alpha");
      expect(after?.lastModified ?? null).toBe(before?.lastModified ?? null);
      expect(after?.lastSuccessAt).toBe(seededAt.toISOString());
      expect(after?.lastFetchedAt).not.toBe(seededAt.toISOString());
      expect(after?.status).toBe("error");
      expect(after?.lastError).toMatch(/fetch failed/);
      expect((await db.listEntries()).find((entry) => entry.id === "node:security:26.12.1")?.gap).toBe("new");
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
