import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createDb } from "@evolution/db";

vi.mock("@evolution/ai", async (orig) => {
  const real = await orig<typeof import("@evolution/ai")>();
  return {
    ...real,
    // Out of credits on the first entry: enrichEntries pauses and returns the raw entries.
    enrichEntries: async (entries: unknown[]) => ({ entries, paused: true }),
    createDefaultAi: async () => ({ embedder: {}, zeroShot: undefined, summarizer: undefined }),
  };
});

import { runOnce } from "../../apps/worker/src/run";
import { SOURCE_URLS } from "@evolution/ingest";

describe("FNED-16 with ENRICH=1 when the AI step pauses", () => {
  it("keeps stored classification for rows the paused enrich did not classify", async () => {
    const url = `file:${path.join(mkdtempSync(path.join(tmpdir(), "r19p-")), "t.sqlite")}`;
    const nodeRelease = { version: "v26.13.0", date: "2026-10-28", lts: "Krypton", security: false, files: [] };
    const db = await createDb(url);
    const fetchImpl = vi.fn(async (input: string | URL) => {
      if (String(input) === SOURCE_URLS.nodeIndex) return new Response(JSON.stringify([nodeRelease]), { status: 200 });
      return new Response(null, { status: 304 });
    });
    await runOnce({ databaseUrl: url, sources: ["node"], fetchImpl: fetchImpl as typeof fetch, enrich: false });
    const [first] = await db.listEntries();
    await db.upsertEntries([{ ...first!, gap: "new", similarity: 0.1, worthLearning: "keep me" }]);
    // Force a re-fetch: 200 again for the index
    await db.close();
    const db2 = await createDb(url);
    for (const s of await db2.listSourceStates("node")) await db2.upsertSourceState({ ...s, etag: null, lastModified: null, version: null });
    await db2.close();
    await runOnce({ databaseUrl: url, sources: ["node"], fetchImpl: fetchImpl as typeof fetch, enrich: true });
    const db3 = await createDb(url);
    const row = (await db3.listEntries()).find((x) => x.id === first!.id);
    await db3.close();
    expect(row).toMatchObject({ gap: "new", similarity: 0.1, worthLearning: "keep me" });
  });
});
