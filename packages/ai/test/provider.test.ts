import { afterEach, describe, expect, it, vi } from "vitest";
import type { Entry } from "@evolution/shared-types";
import {
  CLOUDFLARE_SUMMARY_MODEL,
  HF_SUMMARY_MODEL,
  LOCAL_SUMMARY_MODEL,
  LOCAL_SUMMARY_MODEL_LIGHT,
  createDefaultAi,
  resolveLocalSummaryModel,
  resolveSummaryProvider,
} from "../src/index";

const hf = vi.hoisted(() => ({ tokens: [] as string[], zeroShotCalls: 0 }));

vi.mock("@huggingface/inference", () => ({
  InferenceClient: class {
    constructor(token: string) {
      hf.tokens.push(token);
    }
    zeroShotClassification() {
      hf.zeroShotCalls += 1;
      return Promise.resolve([{ label: "new", score: 0.91 }]);
    }
    chatCompletion() {
      return Promise.resolve({ choices: [{ message: { content: "  Ship the note.  " } }] });
    }
  },
}));

const entry = (): Entry => ({
  id: "node:release:22.0.0",
  source: "node",
  type: "release",
  title: "Node.js 22",
  version: "22.0.0",
  date: "2026-10-28T00:00:00.000Z",
  url: "https://example.com",
  summary: "A release.",
  tags: ["node"],
  raw: null,
});

describe("summary provider switch", () => {
  afterEach(() => {
    hf.tokens.length = 0;
    hf.zeroShotCalls = 0;
  });

  it("resolves provider names and local model aliases", () => {
    expect(resolveSummaryProvider(undefined)).toBe("local");
    expect(resolveSummaryProvider("")).toBe("local");
    expect(resolveSummaryProvider(" LOCAL ")).toBe("local");
    expect(resolveSummaryProvider("cloudflare")).toBe("cloudflare");
    expect(resolveSummaryProvider("HuggingFace")).toBe("huggingface");
    expect(resolveSummaryProvider("hf")).toBe("huggingface");
    expect(resolveSummaryProvider("somewhere-else")).toBe("local");
    expect(resolveLocalSummaryModel(undefined)).toBe(LOCAL_SUMMARY_MODEL);
    expect(resolveLocalSummaryModel("  ")).toBe(LOCAL_SUMMARY_MODEL);
    expect(resolveLocalSummaryModel("light")).toBe(LOCAL_SUMMARY_MODEL_LIGHT);
    expect(resolveLocalSummaryModel(" qwen ")).toBe(LOCAL_SUMMARY_MODEL_LIGHT);
    expect(resolveLocalSummaryModel("custom/model")).toBe("custom/model");
  });

  it("uses Hugging Face only for summaries when that provider and a token are both set", async () => {
    const ai = await createDefaultAi({
      provider: "hf",
      token: "hf_test",
      loadZeroShot: async () => async () => ({ labels: ["adjacent"], scores: [0.66] }),
    });
    expect(hf.tokens).toEqual(["hf_test"]);
    expect(ai.zeroShot.modelId).toContain("bart-large-mnli");
    expect(ai.tagger.modelId).toContain("bart-large-mnli");
    expect(ai.summarizer?.modelId).toBe(HF_SUMMARY_MODEL);
    await expect(ai.zeroShot.classify("Node.js adds SQLite")).resolves.toEqual({ label: "adjacent", score: 0.66 });
    expect(hf.zeroShotCalls).toBe(0);
    await expect(ai.summarizer?.summarize(entry(), ["React"])).resolves.toBe("Ship the note.");

    hf.tokens.length = 0;
    vi.stubEnv("SUMMARY_PROVIDER", "huggingface");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "acct");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "cf-token");
    const forcedLocal = await createDefaultAi({
      provider: "local",
      token: "hf_not_used",
      generateLocal: async () => "Stay local.",
    });
    expect(hf.tokens).toEqual([]);
    expect(forcedLocal.zeroShot.modelId).toContain("bart-large-mnli");
    expect(hf.zeroShotCalls).toBe(0);
    await expect(forcedLocal.summarizer?.summarize(entry(), ["React"])).resolves.toBe("Stay local.");

    const blankToken = await createDefaultAi({
      provider: "huggingface",
      token: "   ",
      generateLocal: async () => "No token.",
    });
    expect(hf.tokens).toEqual([]);
    expect(blankToken.summarizer?.modelId).toBe(LOCAL_SUMMARY_MODEL);
  });

  it("uses Cloudflare when requested with credentials and falls back to local otherwise", async () => {
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        `https://api.cloudflare.com/client/v4/accounts/acct/ai/run/${CLOUDFLARE_SUMMARY_MODEL}`,
      );
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer cf-token");
      return new Response(JSON.stringify({ result: { response: "From the edge." } }), { status: 200 });
    });
    vi.stubEnv("CLOUDFLARE_FALLBACK", "1");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "acct");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "cf-token");
    const cloud = await createDefaultAi({ provider: "cloudflare", token: "", fetchImpl: fetchImpl as typeof fetch });
    expect(cloud.zeroShot.modelId).toContain("bart-large-mnli");
    expect(cloud.tagger.writesTags).toBe(true);
    expect(cloud.summarizer?.modelId).toBe(CLOUDFLARE_SUMMARY_MODEL);
    await expect(cloud.summarizer?.summarize(entry(), ["React"])).resolves.toBe("From the edge.");
    expect(fetchImpl).toHaveBeenCalledOnce();

    vi.stubEnv("CLOUDFLARE_API_TOKEN", "");
    const missingToken = await createDefaultAi({
      provider: "cloudflare",
      generateLocal: async () => "Missing token.",
    });
    expect(missingToken.summarizer?.modelId).toBe(LOCAL_SUMMARY_MODEL);

    vi.stubEnv("LOCAL_SUMMARY_MODEL", "light");
    const light = await createDefaultAi({
      provider: "local",
      localModel: "org/custom",
      generateLocal: async () => "Custom.",
    });
    expect(light.summarizer?.modelId).toBe("org/custom");
    const fromEnv = await createDefaultAi({ provider: "local", generateLocal: async () => "Light." });
    expect(fromEnv.summarizer?.modelId).toBe(LOCAL_SUMMARY_MODEL_LIGHT);
  });
});
