import { describe, expect, it } from "vitest";
import { createLocalSummarizer, LOCAL_SUMMARY_MODEL, localSummaryModelId } from "../src/index";

const enabled = process.env.RUN_MODEL_TESTS === "1";

describe.skipIf(!enabled)("local Llama smoke", () => {
  it("summarises one short entry with the pinned q4 model and then unloads it", async () => {
    const summarizer = createLocalSummarizer();
    expect(summarizer.modelId).toBe(localSummaryModelId(LOCAL_SUMMARY_MODEL));
    const line = await summarizer.summarize(
      {
        id: "node:release:22.0.0",
        source: "node",
        type: "release",
        title: "Node.js 22",
        version: "22.0.0",
        date: "2026-10-28T00:00:00.000Z",
        url: "https://example.com",
        summary: "Node.js 22 adds a built-in SQLite module.",
        tags: ["node"],
        raw: null,
      },
      ["TypeScript"],
    );
    expect(line.length).toBeGreaterThan(0);
    expect(line.length).toBeLessThanOrEqual(280);
    await summarizer.dispose?.();
  }, 120_000);
});
