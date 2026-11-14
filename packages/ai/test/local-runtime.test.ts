import { describe, expect, it, vi } from "vitest";
import type { Entry } from "@evolution/shared-types";
import {
  LOCAL_SUMMARY_DTYPE,
  LOCAL_SUMMARY_MAX_NEW_TOKENS,
  LOCAL_SUMMARY_TEMPERATURE,
  createLocalEmbedder,
  createLocalSummarizer,
  localSummaryModelId,
  summaryModelCacheDir,
} from "../src/index";

const runtime = vi.hoisted(() => ({
  pipeline: vi.fn(),
  env: { cacheDir: "" },
}));

vi.mock("@huggingface/transformers", () => ({
  pipeline: runtime.pipeline,
  env: runtime.env,
}));

const pipeline = runtime.pipeline;

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
    const generated: Array<{ model: string; load?: unknown; generate?: unknown }> = [];
    pipeline.mockImplementation(async (task: string, model: string, load?: unknown) => {
      if (task === "feature-extraction") {
        return async (texts: string[]) => ({
          tolist: () => (texts.length === 1 ? [0.2, 0.3, 0.4] : texts.map(() => [0.2, 0.3])),
        });
      }
      const respond = () => {
        if (model.endsWith("/string")) return [{ generated_text: "  plain text  " }];
        if (model.endsWith("/array")) {
          return [{ generated_text: [{ role: "user", content: "q" }, { role: "assistant", content: "answer" }] }];
        }
        if (model.endsWith("/empty")) return [{ generated_text: { nope: true } }];
        if (model.endsWith("/preamble")) return [{ generated_text: "Summary: Learn the patch.<|eot_id|>" }];
        return [{}];
      };
      return async (_messages: unknown, generate?: unknown) => {
        generated.push({ model, load, generate });
        return respond();
      };
    });

    expect(pipeline).not.toHaveBeenCalled();
    expect(runtime.env.cacheDir).toBe("");
    const plain = createLocalSummarizer({ model: "test/string" });
    expect(pipeline).not.toHaveBeenCalled();
    expect(plain.modelId).toBe(localSummaryModelId("test/string"));
    await expect(plain.summarize(entry(), ["React"])).resolves.toBe("plain text");
    expect(runtime.env.cacheDir).toBe(summaryModelCacheDir());
    await plain.summarize(entry(), ["React"]);
    expect(generated.filter((call) => call.model === "test/string")).toEqual([
      {
        model: "test/string",
        load: {
          dtype: LOCAL_SUMMARY_DTYPE,
          device: "cpu",
          revision: "main",
          cache_dir: summaryModelCacheDir(),
        },
        generate: {
          max_new_tokens: LOCAL_SUMMARY_MAX_NEW_TOKENS,
          temperature: LOCAL_SUMMARY_TEMPERATURE,
          do_sample: false,
        },
      },
      {
        model: "test/string",
        load: {
          dtype: LOCAL_SUMMARY_DTYPE,
          device: "cpu",
          revision: "main",
          cache_dir: summaryModelCacheDir(),
        },
        generate: {
          max_new_tokens: LOCAL_SUMMARY_MAX_NEW_TOKENS,
          temperature: LOCAL_SUMMARY_TEMPERATURE,
          do_sample: false,
        },
      },
    ]);
    const preamble = createLocalSummarizer({ model: "test/preamble", dtype: "q8" });
    await expect(preamble.summarize(entry(), ["React"])).resolves.toBe("Learn the patch.");
    expect(preamble.modelId).toBe("test/preamble@q8");
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
    expect(
      generationLoads.filter((call) => call[1] === "test/preamble" && (call[2] as { dtype?: string }).dtype === "q8"),
    ).toHaveLength(1);
    expect(pipeline.mock.calls.some((call) => call[0] === "feature-extraction")).toBe(true);
  });
});
