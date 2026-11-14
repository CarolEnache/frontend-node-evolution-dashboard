import { afterEach, describe, expect, it, vi } from "vitest";
import type { Entry } from "@evolution/shared-types";
import {
  CLOUDFLARE_SUMMARY_MODEL,
  HF_SUMMARY_MODEL,
  LOCAL_SUMMARY_MODEL,
  LOCAL_SUMMARY_MODEL_LIGHT,
  createDefaultAi,
  localSummaryModelId,
  resolveLocalSummaryDtype,
  resolveLocalSummaryModel,
  resolveSummaryProvider,
} from "../src/index";

const hf = vi.hoisted(() => ({ tokens: [] as string[] }));

vi.mock("@huggingface/inference", () => ({
  InferenceClient: class {
    constructor(token: string) {
      hf.tokens.push(token);
    }
    zeroShotClassification() {
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
    expect(resolveLocalSummaryDtype(undefined)).toBe("q4");
    expect(resolveLocalSummaryDtype("  ")).toBe("q4");
    expect(resolveLocalSummaryDtype(" Q8 ")).toBe("q8");
    expect(localSummaryModelId("custom/model", "q4")).toBe("custom/model@q4");
  });

  it("uses Hugging Face only when that provider and a token are both set", async () => {
    const ai = await createDefaultAi({ provider: "hf", token: "hf_test" });
    expect(hf.tokens).toEqual(["hf_test"]);
    expect(ai.zeroShot).not.toBeNull();
    expect(ai.summarizer?.modelId).toBe(HF_SUMMARY_MODEL);
    await expect(ai.zeroShot?.classify("Node.js adds SQLite")).resolves.toEqual({ label: "new", score: 0.91 });
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
    expect(forcedLocal.zeroShot).toBeNull();
    await expect(forcedLocal.summarizer?.summarize(entry(), ["React"])).resolves.toBe("Stay local.");

    const blankToken = await createDefaultAi({
      provider: "huggingface",
      token: "   ",
      generateLocal: async () => "No token.",
    });
    expect(hf.tokens).toEqual([]);
    expect(blankToken.summarizer?.modelId).toBe(localSummaryModelId(LOCAL_SUMMARY_MODEL));
  });

  it("uses Cloudflare when requested with credentials and falls back to local otherwise", async () => {
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe(
        `https://api.cloudflare.com/client/v4/accounts/acct/ai/run/${CLOUDFLARE_SUMMARY_MODEL}`,
      );
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer cf-token");
      return new Response(JSON.stringify({ result: { response: "From the edge." } }), { status: 200 });
    });
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "acct");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "cf-token");
    const blocked = await createDefaultAi({
      provider: "cloudflare",
      token: "",
      fetchImpl: fetchImpl as typeof fetch,
      generateLocal: async () => "Flag off.",
    });
    expect(blocked.summarizer?.modelId).toBe(localSummaryModelId(LOCAL_SUMMARY_MODEL));
    expect(blocked.summaryFallback).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();

    vi.stubEnv("CLOUDFLARE_FALLBACK", "1");
    const cloud = await createDefaultAi({ provider: "cloudflare", token: "", fetchImpl: fetchImpl as typeof fetch });
    expect(cloud.zeroShot).toBeNull();
    expect(cloud.summarizer?.modelId).toBe(CLOUDFLARE_SUMMARY_MODEL);
    await expect(cloud.summarizer?.summarize(entry(), ["React"])).resolves.toBe("From the edge.");
    expect(fetchImpl).toHaveBeenCalledOnce();

    vi.stubEnv("CLOUDFLARE_API_TOKEN", "");
    const missingToken = await createDefaultAi({
      provider: "cloudflare",
      generateLocal: async () => "Missing token.",
    });
    expect(missingToken.summarizer?.modelId).toBe(localSummaryModelId(LOCAL_SUMMARY_MODEL));

    vi.stubEnv("LOCAL_SUMMARY_MODEL", "light");
    const light = await createDefaultAi({
      provider: "local",
      localModel: "org/custom",
      generateLocal: async () => "Custom.",
    });
    expect(light.summarizer?.modelId).toBe(localSummaryModelId("org/custom"));
    const fromEnv = await createDefaultAi({ provider: "local", generateLocal: async () => "Light." });
    expect(fromEnv.summarizer?.modelId).toBe(localSummaryModelId(LOCAL_SUMMARY_MODEL_LIGHT));
  });

  it("reads HF_TOKEN from the environment and ignores it for the local provider", async () => {
    vi.stubEnv("SUMMARY_PROVIDER", "huggingface");
    vi.stubEnv("HF_TOKEN", "hf_from_env");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "acct");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "cf-token");
    const remote = await createDefaultAi();
    expect(hf.tokens).toEqual(["hf_from_env"]);
    expect(remote.summarizer?.modelId).toBe(HF_SUMMARY_MODEL);

    hf.tokens.length = 0;
    const local = await createDefaultAi({
      provider: "local",
      generateLocal: async () => "Stay local.",
    });
    expect(hf.tokens).toEqual([]);
    await expect(local.summarizer?.summarize(entry(), ["React"])).resolves.toBe("Stay local.");
  });
});
