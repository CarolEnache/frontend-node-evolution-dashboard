import { describe, expect, it } from "vitest";
import { ingestSource } from "../src/index";

describe("ingest registry", () => {
  it("rejects a source that has no ingester", async () => {
    await expect(ingestSource("tc39")).rejects.toThrow(/No ingester registered/);
  });
});
