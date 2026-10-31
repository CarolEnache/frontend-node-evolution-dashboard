import type { Entry } from "@evolution/shared-types";
import { buildSummaryMessages, oneLine, type ChatRequest, type Summarizer } from "./hf";
import {
  CLOUDFLARE_SUMMARY_MODEL,
  LOCAL_SUMMARY_MODEL,
  LOCAL_SUMMARY_MODEL_LIGHT,
} from "./models";

export type SummaryProviderName = "local" | "cloudflare" | "huggingface";

export function resolveSummaryProvider(value = process.env.SUMMARY_PROVIDER): SummaryProviderName {
  const name = value?.trim().toLowerCase();
  if (name === "cloudflare") return "cloudflare";
  if (name === "huggingface" || name === "hf") return "huggingface";
  return "local";
}

/** `light` or `qwen` selects the smaller local model. Any other value is used as a model id. */
export function resolveLocalSummaryModel(value = process.env.LOCAL_SUMMARY_MODEL): string {
  const configured = value?.trim();
  if (!configured) return LOCAL_SUMMARY_MODEL;
  if (configured === "light" || configured === "qwen") return LOCAL_SUMMARY_MODEL_LIGHT;
  return configured;
}

type LocalGenerate = (messages: ChatRequest["messages"], model: string) => Promise<string>;

export function createLocalSummarizer(options?: { model?: string; generate?: LocalGenerate }): Summarizer {
  const model = options?.model ?? resolveLocalSummaryModel();
  return {
    modelId: model,
    async summarize(entry, skills) {
      const messages = buildSummaryMessages(entry, skills);
      const text = options?.generate ? await options.generate(messages, model) : await defaultLocalGenerate(messages, model);
      return oneLine(text);
    },
  };
}

export function createCloudflareSummarizer(options: {
  accountId: string;
  apiToken: string;
  model?: string;
  fetchImpl?: typeof fetch;
}): Summarizer {
  const model = options.model ?? CLOUDFLARE_SUMMARY_MODEL;
  return {
    modelId: model,
    async summarize(entry: Entry, skills: string[]) {
      const fetchImpl = options.fetchImpl ?? fetch;
      const response = await fetchImpl(
        `https://api.cloudflare.com/client/v4/accounts/${options.accountId}/ai/run/${model}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.apiToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ messages: buildSummaryMessages(entry, skills) }),
        },
      );
      if (!response.ok) throw new Error(`Cloudflare Workers AI failed with ${response.status}`);
      const body = (await response.json()) as { result?: { response?: unknown } };
      const text = typeof body.result?.response === "string" ? body.result.response : "";
      return oneLine(text);
    },
  };
}

const generators = new Map<string, Promise<LocalGenerate>>();

async function defaultLocalGenerate(messages: ChatRequest["messages"], model: string): Promise<string> {
  let pending = generators.get(model);
  if (!pending) {
    pending = loadLocalGenerator(model);
    generators.set(model, pending);
  }
  return (await pending)(messages, model);
}

async function loadLocalGenerator(model: string): Promise<LocalGenerate> {
  const transformers = (await import("@huggingface/transformers")) as {
    pipeline: (
      task: "text-generation",
      model: string,
    ) => Promise<(input: ChatRequest["messages"], options?: Record<string, unknown>) => Promise<unknown>>;
  };
  const generator = await transformers.pipeline("text-generation", model);
  return async (messages) => extractGenerated(await generator(messages, { max_new_tokens: 80, temperature: 0.2, do_sample: false }));
}

function extractGenerated(output: unknown): string {
  const first = Array.isArray(output) ? output[0] : output;
  if (!first || typeof first !== "object") return "";
  const text = (first as { generated_text?: unknown }).generated_text;
  if (typeof text === "string") return text;
  if (Array.isArray(text)) {
    const last = text.at(-1) as { content?: unknown } | undefined;
    return typeof last?.content === "string" ? last.content : "";
  }
  return "";
}
