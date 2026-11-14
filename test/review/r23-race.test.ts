import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDb } from "@evolution/db";
import { failureSourceState, SourceFetchError } from "@evolution/ingest";

describe("source state failure writes", () => {
  it("does not roll back a success that landed after the failure was read", async () => {
    const url = `file:${path.join(mkdtempSync(path.join(tmpdir(), "r23r-")), "t.sqlite")}`;
    const db = await createDb(url);
    const sourceUrl = "https://nodejs.org/dist/index.json";
    try {
      await db.upsertSourceState({
        source: "node",
        url: sourceUrl,
        etag: '"old"',
        version: "26.12.0",
        lastFetchedAt: "2026-10-31T00:00:00.000Z",
        lastSuccessAt: "2026-10-31T00:00:00.000Z",
        status: "ok",
      });
      const previous = (await db.listSourceStates("node")).find((state) => state.url === sourceUrl);
      await db.upsertSourceState({
        source: "node",
        url: sourceUrl,
        etag: '"new"',
        version: "26.13.0",
        lastFetchedAt: "2026-11-14T12:00:00.000Z",
        lastSuccessAt: "2026-11-14T12:00:00.000Z",
        status: "ok",
        lastError: null,
      });
      await db.upsertSourceState(
        failureSourceState(
          previous,
          new SourceFetchError("node", sourceUrl, "2026-11-14T11:59:00.000Z", new Error("fetch failed")),
        ),
      );
      const after = (await db.listSourceStates("node")).find((state) => state.url === sourceUrl);
      expect(after?.etag).toBe('"new"');
      expect(after?.version).toBe("26.13.0");
      expect(after?.lastSuccessAt).toBe("2026-11-14T12:00:00.000Z");
      expect(after?.lastFetchedAt).toBe("2026-11-14T12:00:00.000Z");
      expect(after?.status).toBe("error");
      expect(after?.lastError).toMatch(/fetch failed/);
    } finally {
      await db.close();
    }
  });
});
