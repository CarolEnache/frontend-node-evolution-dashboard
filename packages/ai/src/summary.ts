import type { Entry } from "@evolution/shared-types";
import type { NeuronLedger } from "./budget";
import { runCloudflareModel } from "./cloudflare";
import { buildSummaryMessages, oneLine, type ChatRequest, type Summarizer } from "./hf";
import {
  CLOUDFLARE_SUMMARY_MODEL,
  LOCAL_SUMMARY_DTYPE,
  LOCAL_SUMMARY_LIGHT_REVISION,
  LOCAL_SUMMARY_MODEL,
  LOCAL_SUMMARY_MODEL_LIGHT,
  LOCAL_SUMMARY_REVISION,
} from "./models";
import { configureModelRuntime } from "./runtime";

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
    async dispose() {
      await disposeLocalGenerator(model);
    },
  };
}

export function createCloudflareSummarizer(options: {
  accountId: string;
  apiToken: string;
  model?: string;
  fetchImpl?: typeof fetch;
  ledger?: NeuronLedger;
}): Summarizer {
  const model = options.model ?? CLOUDFLARE_SUMMARY_MODEL;
  return {
    modelId: model,
    async summarize(entry: Entry, skills: string[]) {
      const messages = buildSummaryMessages(entry, skills);
      const body = (await runCloudflareModel({
        accountId: options.accountId,
        apiToken: options.apiToken,
        model,
        fetchImpl: options.fetchImpl,
        ledger: options.ledger,
        texts: messages.map((message) => message.content),
        body: { messages },
      })) as { result?: { response?: unknown } };
      const text = typeof body.result?.response === "string" ? body.result.response : "";
      return oneLine(text);
    },
  };
}

const generators = new Map<string, Promise<{ generate: LocalGenerate; dispose?: () => Promise<void> }>>();

async function defaultLocalGenerate(messages: ChatRequest["messages"], model: string): Promise<string> {
  let pending = generators.get(model);
  if (!pending) {
    pending = loadLocalGenerator(model).catch((error: unknown) => {
      generators.delete(model);
      throw error;
    });
    generators.set(model, pending);
  }
  return (await pending).generate(messages, model);
}

async function disposeLocalGenerator(model: string): Promise<void> {
  const pending = generators.get(model);
  generators.delete(model);
  if (!pending) return;
  const loaded = await pending.catch(() => null);
  await loaded?.dispose?.();
}

async function loadLocalGenerator(model: string): Promise<{ generate: LocalGenerate; dispose?: () => Promise<void> }> {
  await configureModelRuntime();
  const revision =
    model === LOCAL_SUMMARY_MODEL
      ? LOCAL_SUMMARY_REVISION
      : model === LOCAL_SUMMARY_MODEL_LIGHT
        ? LOCAL_SUMMARY_LIGHT_REVISION
        : undefined;
  const transformers = (await import("@huggingface/transformers")) as {
    pipeline: (
      task: "text-generation",
      model: string,
      options: { dtype: string; revision?: string },
    ) => Promise<{
      (input: ChatRequest["messages"], options?: Record<string, unknown>): Promise<unknown>;
      dispose?: () => Promise<void>;
    }>;
  };
  const generator = await transformers.pipeline("text-generation", model, { dtype: LOCAL_SUMMARY_DTYPE, revision });
  return {
    generate: async (messages) => extractGenerated(await generator(messages, { max_new_tokens: 80, temperature: 0.2, do_sample: false })),
    dispose: generator.dispose ? () => generator.dispose!() : undefined,
  };
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
