import { describe, expect, it, vi } from "vitest";
import type { Entry } from "@evolution/shared-types";
import { createLocalEmbedder, createLocalSummarizer } from "../src/index";

const pipeline = vi.hoisted(() => vi.fn());

vi.mock("@huggingface/transformers", () => ({
  pipeline,
}));

const entry = (): Entry => ({
  id: "typescript:release:7.0.2",
  source: "typescript",
  type: "release",
  title: "TypeScript 7.0.2",
  version: "7.0.2",
  date: "2026-10-20T00:00:00.000Z",
  url: "https://example.com",
  summary: "Stable.",
  tags: ["typescript"],
  raw: null,
});

describe("local ONNX loaders", () => {
  it("loads the text-generation and embedding pipelines without a network call", async () => {
    pipeline.mockImplementation(async (task: string, model: string) => {
      if (task === "feature-extraction") {
        return async (texts: string[]) => ({
          tolist: () => (texts.length === 1 ? [0.2, 0.3, 0.4] : texts.map(() => [0.2, 0.3])),
        });
      }
      if (model.endsWith("/string")) return async () => [{ generated_text: "  plain text  " }];
      if (model.endsWith("/array")) {
        return async () => [{ generated_text: [{ role: "user", content: "q" }, { role: "assistant", content: "answer" }] }];
      }
      if (model.endsWith("/empty")) return async () => [{ generated_text: { nope: true } }];
      return async () => [{}];
    });

    const plain = createLocalSummarizer({ model: "test/string" });
    await expect(plain.summarize(entry(), ["React"])).resolves.toBe("plain text");
    await plain.summarize(entry(), ["React"]);
    const array = createLocalSummarizer({ model: "test/array" });
    await expect(array.summarize(entry(), ["React"])).resolves.toBe("answer");
    const empty = createLocalSummarizer({ model: "test/empty" });
    await expect(empty.summarize(entry(), ["React"])).resolves.toBe("");
    const missing = createLocalSummarizer({ model: "test/missing" });
    await expect(missing.summarize(entry(), ["React"])).resolves.toBe("");

    const embedder = createLocalEmbedder();
    expect(await embedder.embed(["only"])).toEqual([[0.2, 0.3, 0.4]]);
    expect(await embedder.embed(["a", "b"])).toEqual([[0.2, 0.3], [0.2, 0.3]]);
    const generationLoads = pipeline.mock.calls.filter((call) => call[0] === "text-generation");
    expect(generationLoads.filter((call) => call[1] === "test/string")).toHaveLength(1);
    expect(pipeline.mock.calls.some((call) => call[0] === "feature-extraction")).toBe(true);
  });
});
