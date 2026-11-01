import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDb } from "@evolution/db";
import { SOURCE_URLS } from "@evolution/ingest";
import { describe, expect, it } from "vitest";
import { runOnce } from "../src/run";

const LAST_MODIFIED = "Fri, 31 Oct 2026 00:00:00 GMT";

function databaseUrl(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "evolution-ingest-"));
  return `file:${path.join(dir, "test.sqlite")}`;
}

function nodeBodies(): Record<string, { body: string; etag: string }> {
  return {
    [SOURCE_URLS.nodeIndex]: {
      etag: '"node-index"',
      body: JSON.stringify([
        { version: "v22.21.0", date: "2026-10-28", lts: false, security: false, npm: "10.9.4", v8: "12.4.0" },
      ]),
    },
    [SOURCE_URLS.nodeSchedule]: { etag: '"node-schedule"', body: "{}" },
    [SOURCE_URLS.nodeRss]: {
      etag: '"node-feed"',
      body: `<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>`,
    },
  };
}

function conditionalNodeFetch(extra?: (url: string) => Response | undefined) {
  const routes = nodeBodies();
  return async (url: string, init?: RequestInit) => {
    const special = extra?.(url);
    if (special) return special;
    const route = routes[url];
    if (!route) return new Response(`missing ${url}`, { status: 404 });
    const headers = new Headers(init?.headers);
    if (headers.get("if-none-match") === route.etag) {
      return new Response(null, { status: 304, headers: { etag: route.etag } });
    }
    return new Response(route.body, {
      status: 200,
      headers: { etag: route.etag, "last-modified": LAST_MODIFIED },
    });
  };
}

describe("worker run", () => {
  it("persists entries and validators, then skips a 304 without duplicating rows", async () => {
    const url = databaseUrl();
    const fetchImpl = conditionalNodeFetch();
    const first = await runOnce({
      databaseUrl: url,
      sources: ["node"],
      fetchImpl: fetchImpl as typeof fetch,
      enrich: false,
      maxAttempts: 1,
      sleep: async () => {},
    });
    expect(first.failed).toEqual([]);
    expect(first.skipped).toEqual([]);
    expect(first.upserted).toBe(1);

    const db = await createDb(url);
    try {
      expect(await db.countEntries()).toBe(1);
      const stored = await db.listSourceStates("node");
      expect(stored.find((state) => state.url === SOURCE_URLS.nodeIndex)?.etag).toBe('"node-index"');
      expect(stored.find((state) => state.url === SOURCE_URLS.nodeIndex)?.version).toBe("v22.21.0");
    } finally {
      await db.close();
    }

    const second = await runOnce({
      databaseUrl: url,
      sources: ["node"],
      fetchImpl: fetchImpl as typeof fetch,
      enrich: false,
      maxAttempts: 1,
      sleep: async () => {},
    });
    expect(second.skipped).toEqual(["node"]);
    expect(second.upserted).toBe(0);
    const after = await createDb(url);
    try {
      expect(await after.countEntries()).toBe(1);
      const entries = await after.listEntries({ source: "node" });
      expect(entries.map((entry) => entry.id)).toEqual(["node:release:22.21.0"]);
    } finally {
      await after.close();
    }
  });

  it("keeps going when one source fails", async () => {
    const url = databaseUrl();
    const fetchImpl = conditionalNodeFetch((requestUrl) => {
      if (requestUrl === SOURCE_URLS.caniuseMeta) return new Response("nope", { status: 500 });
      return undefined;
    });
    const result = await runOnce({
      databaseUrl: url,
      sources: ["node", "caniuse"],
      fetchImpl: fetchImpl as typeof fetch,
      enrich: false,
      maxAttempts: 1,
      sleep: async () => {},
    });
    expect(result.failed).toEqual(["caniuse"]);
    expect(result.skipped).toEqual([]);
    expect(result.upserted).toBe(1);
    const db = await createDb(url);
    try {
      const entries = await db.listEntries();
      expect(entries.map((entry) => entry.source)).toEqual(["node"]);
      expect(await db.listSourceStates("caniuse")).toEqual([]);
    } finally {
      await db.close();
    }
  });

  it("records a null TypeScript packument as that source's error and still stores Node", async () => {
    const url = databaseUrl();
    const fetchImpl = conditionalNodeFetch((requestUrl) => {
      if (requestUrl === SOURCE_URLS.tsMeta) return new Response("null", { status: 200, headers: { etag: '"ts"' } });
      if (requestUrl === SOURCE_URLS.tsReleases) return new Response("[]", { status: 200 });
      if (requestUrl === SOURCE_URLS.tsFeed) {
        return new Response(`<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>`, { status: 200 });
      }
      return undefined;
    });
    const result = await runOnce({
      databaseUrl: url,
      sources: ["typescript", "node"],
      fetchImpl: fetchImpl as typeof fetch,
      enrich: false,
      maxAttempts: 1,
      sleep: async () => {},
    });
    expect(result.failed).toEqual(["typescript"]);
    expect(result.upserted).toBe(1);
    const db = await createDb(url);
    try {
      expect((await db.listEntries()).map((entry) => entry.id)).toEqual(["node:release:22.21.0"]);
      expect(await db.listSourceStates("typescript")).toEqual([]);
    } finally {
      await db.close();
    }
  });
});
