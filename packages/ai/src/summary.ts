import path from "node:path";
import type { Entry } from "@evolution/shared-types";
import { createLimitedFetch, SUMMARY_HTTP_MAX_BYTES, SUMMARY_HTTP_TIMEOUT_MS } from "./http";
import { buildSummaryMessages, stripSummaryBoilerplate, type ChatRequest, type Summarizer } from "./hf";
import {
  CLOUDFLARE_SUMMARY_MODEL,
  LOCAL_SUMMARY_DTYPE,
  LOCAL_SUMMARY_LIGHT_REVISION,
  LOCAL_SUMMARY_MAX_NEW_TOKENS,
  LOCAL_SUMMARY_MODEL,
  LOCAL_SUMMARY_MODEL_LIGHT,
  LOCAL_SUMMARY_REVISION,
  LOCAL_SUMMARY_TEMPERATURE,
} from "./models";
import { cloudflareSummaryNeuronCost, defaultNeuronBudget, estimateTokens, type NeuronBudget } from "./neurons";

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

/** Blank means the default q4 quant. The value is lower-cased and never read from a file. */
export function resolveLocalSummaryDtype(value = process.env.LOCAL_SUMMARY_DTYPE): string {
  const configured = value?.trim().toLowerCase();
  return configured || LOCAL_SUMMARY_DTYPE;
}

/** Cache id is the repository id plus the quant, so a dtype change does not reuse old lines. */
export function localSummaryModelId(model: string, dtype = resolveLocalSummaryDtype()): string {
  return `${model}@${dtype}`;
}

/** Provider plus model id. Combined with the content hash, this is the summary cache identity. */
export function summaryCacheModel(provider: string, modelId: string): string {
  return `${provider}:${modelId}`;
}

/** Workers AI stays off unless this is exactly `1`. Credentials alone do not enable it. */
export function cloudflareFallbackEnabled(value = process.env.CLOUDFLARE_FALLBACK): boolean {
  return value?.trim() === "1";
}

export function summaryModelCacheDir(value = process.env.SUMMARY_CACHE_DIR): string {
  const configured = value?.trim();
  return path.resolve(configured || ".cache/models");
}

export function resolveLocalSummaryRevision(model: string, value = process.env.LOCAL_SUMMARY_REVISION): string {
  const configured = value?.trim();
  if (configured) return configured;
  if (model === LOCAL_SUMMARY_MODEL) return LOCAL_SUMMARY_REVISION;
  if (model === LOCAL_SUMMARY_MODEL_LIGHT) return LOCAL_SUMMARY_LIGHT_REVISION;
  return "main";
}

const LOCAL_SUMMARY_TIMEOUT_MS = 60_000;

export function localSummaryLoadOptions(
  dtype: string,
  model: string,
): { dtype: string; device: "cpu"; revision: string; cache_dir: string } {
  return { dtype, device: "cpu", revision: resolveLocalSummaryRevision(model), cache_dir: summaryModelCacheDir() };
}

export function localSummaryGenerateOptions(): {
  max_new_tokens: number;
  temperature: number;
  do_sample: false;
} {
  return {
    max_new_tokens: LOCAL_SUMMARY_MAX_NEW_TOKENS,
    temperature: LOCAL_SUMMARY_TEMPERATURE,
    do_sample: false,
  };
}

type LocalGenerate = (messages: ChatRequest["messages"], model: string) => Promise<string>;

export function createLocalSummarizer(options?: {
  model?: string;
  dtype?: string;
  generate?: LocalGenerate;
  timeoutMs?: number;
}): Summarizer {
  const model = options?.model ?? resolveLocalSummaryModel();
  const dtype = options?.dtype ?? resolveLocalSummaryDtype();
  const timeoutMs = options?.timeoutMs ?? LOCAL_SUMMARY_TIMEOUT_MS;
  const key = `${dtype}\0${model}`;
  return {
    provider: "local",
    modelId: localSummaryModelId(model, dtype),
    async summarize(entry, skills) {
      const messages = buildSummaryMessages(entry, skills);
      const text = await withTimeout(
        options?.generate ? options.generate(messages, model) : defaultLocalGenerate(messages, model, dtype),
        timeoutMs,
      );
      return stripSummaryBoilerplate(text);
    },
    async dispose() {
      const pending = generators.get(key);
      generators.delete(key);
      if (!pending) return;
      try {
        await (await pending).dispose();
      } catch {
        // A failed load is dropped so the next run can try the local model again.
      }
    },
  };
}

export function createCloudflareSummarizer(options: {
  accountId: string;
  apiToken: string;
  model?: string;
  fetchImpl?: typeof fetch;
  /** Defaults to CLOUDFLARE_FALLBACK=1. Anything else refuses the request before the network. */
  enabled?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
  budget?: NeuronBudget;
  now?: () => Date;
}): Summarizer {
  const model = options.model ?? CLOUDFLARE_SUMMARY_MODEL;
  const enabled = options.enabled ?? cloudflareFallbackEnabled();
  const budget = options.budget ?? defaultNeuronBudget();
  const fetchImpl = createLimitedFetch({
    fetchImpl: options.fetchImpl ?? fetch,
    timeoutMs: options.timeoutMs ?? SUMMARY_HTTP_TIMEOUT_MS,
    maxBytes: options.maxBytes ?? SUMMARY_HTTP_MAX_BYTES,
  });
  return {
    provider: "cloudflare",
    modelId: model,
    async summarize(entry: Entry, skills: string[]) {
      if (!enabled) {
        throw new Error("Cloudflare summary is off until CLOUDFLARE_FALLBACK=1");
      }
      const messages = buildSummaryMessages(entry, skills);
      const inputTokens = estimateTokens(messages.map((message) => message.content).join("\n"));
      const outputTokens = LOCAL_SUMMARY_MAX_NEW_TOKENS;
      const cost = cloudflareSummaryNeuronCost(model, inputTokens, outputTokens);
      if (cost === null || !budget.tryReserve(cost, options.now?.() ?? new Date())) {
        throw new Error(cost === null ? "Cloudflare neuron cost is unknown" : "Cloudflare daily neuron budget is spent");
      }
      const response = await fetchImpl(
        `https://api.cloudflare.com/client/v4/accounts/${options.accountId}/ai/run/${model}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.apiToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ messages, max_tokens: outputTokens, temperature: LOCAL_SUMMARY_TEMPERATURE }),
        },
      );
      if (!response.ok) throw new Error(`Cloudflare Workers AI failed with ${response.status}`);
      const body = (await response.json()) as { result?: { response?: unknown } };
      const text = typeof body.result?.response === "string" ? body.result.response : "";
      return stripSummaryBoilerplate(text);
    },
  };
}

interface LoadedGenerator {
  generate: (messages: ChatRequest["messages"]) => Promise<string>;
  dispose: () => Promise<void>;
}

const generators = new Map<string, Promise<LoadedGenerator>>();

async function defaultLocalGenerate(
  messages: ChatRequest["messages"],
  model: string,
  dtype: string,
): Promise<string> {
  const key = `${dtype}\0${model}`;
  let pending = generators.get(key);
  if (!pending) {
    pending = loadLocalGenerator(model, dtype);
    generators.set(key, pending);
  }
  // A rejected load stays cached for this process step so one download failure
  // is not repeated per entry. dispose() drops it and the next run tries again.
  return (await pending).generate(messages);
}

/**
 * Dynamic import so constructing a summarizer, starting the worker, and
 * building the web app do not load Transformers.js or the ONNX weights.
 * Llama is loaded only when summarize() runs, after bge and bart are disposed.
 */
async function loadLocalGenerator(model: string, dtype: string): Promise<LoadedGenerator> {
  const transformers = (await import("@huggingface/transformers")) as {
    env?: { cacheDir: string };
    pipeline: (
      task: "text-generation",
      model: string,
      options: { dtype: string; device: "cpu"; revision: string; cache_dir: string },
    ) => Promise<(input: ChatRequest["messages"], options?: Record<string, unknown>) => Promise<unknown>>;
  };
  const loadOptions = localSummaryLoadOptions(dtype, model);
  if (transformers.env) transformers.env.cacheDir = loadOptions.cache_dir;
  const generator = await transformers.pipeline("text-generation", model, loadOptions);
  const generation = localSummaryGenerateOptions();
  return {
    generate: async (messages) => extractGenerated(await generator(messages, generation)),
    dispose: async () => {
      const disposable = generator as { dispose?: () => Promise<void> };
      if (disposable.dispose) await disposable.dispose();
    },
  };
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`summary timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
