import type { Entry } from "@evolution/shared-types";
import type { ZeroShotVote } from "./classify";
import { HF_SUMMARY_MODEL, ZERO_SHOT_LABELS, ZERO_SHOT_MODEL } from "./models";

export class AiCreditsError extends Error {
  constructor(message = "Hugging Face inference credits are exhausted") {
    super(message);
    this.name = "AiCreditsError";
  }
}

export interface ZeroShotClassifier {
  classify(text: string): Promise<ZeroShotVote>;
  /** Drop a local bart pipeline before Llama loads. The quantized bart checkpoint is not usable. */
  dispose?(): Promise<void>;
}

export interface Summarizer {
  provider?: "local" | "cloudflare" | "huggingface";
  modelId?: string;
  summarize(entry: Entry, skills: string[]): Promise<string>;
  dispose?(): Promise<void>;
}

export interface ZeroShotRequest {
  model: string;
  inputs: string;
  parameters: { candidate_labels: string[] };
}

export interface ChatRequest {
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
  max_tokens: number;
  temperature: number;
}

export interface HfClientLike {
  zeroShotClassification(args: ZeroShotRequest): Promise<unknown>;
  chatCompletion(args: ChatRequest): Promise<unknown>;
}

export function readHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const record = error as {
    status?: number;
    httpResponse?: { status?: number };
    response?: { status?: number };
  };
  return record.httpResponse?.status ?? record.response?.status ?? record.status;
}

export function backoffMs(attempt: number, random = Math.random()): number {
  return 200 * 2 ** attempt + Math.floor(random * 100);
}

export async function withHfRetry<T>(
  fn: () => Promise<T>,
  options?: { sleep?: (ms: number) => Promise<void>; maxAttempts?: number; random?: () => number },
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 4;
  const sleep = options?.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      const status = readHttpStatus(error);
      if (status === 402) throw new AiCreditsError();
      const retryable = status === 429 || status === 503;
      if (!retryable || attempt >= maxAttempts - 1) throw error;
      await sleep(backoffMs(attempt, options?.random?.() ?? Math.random()));
      attempt += 1;
    }
  }
}

export function normaliseZeroShot(result: unknown): ZeroShotVote[] {
  if (Array.isArray(result)) {
    return result
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const record = item as { label?: unknown; score?: unknown };
        if (typeof record.label !== "string" || typeof record.score !== "number") return null;
        return { label: record.label, score: record.score };
      })
      .filter((item): item is ZeroShotVote => item !== null);
  }
  if (result && typeof result === "object") {
    const record = result as { labels?: unknown; scores?: unknown };
    const labels = record.labels;
    const scores = record.scores;
    if (Array.isArray(labels) && Array.isArray(scores)) {
      return labels.flatMap((label, index) => {
        const score = scores[index];
        return typeof label === "string" && typeof score === "number" ? [{ label, score }] : [];
      });
    }
  }
  return [];
}

export function textFromCompletion(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") return part.text;
      return "";
    })
    .join("")
    .trim();
}

export function oneLine(text: string, max = 280): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= max) return line;
  return `${line.slice(0, max - 1).trimEnd()}…`;
}

/** User message cap. A 1B ONNX model stays on CPU; long release notes are cut first. */
export const SUMMARY_INPUT_CHARS = 1_200;

export const SUMMARY_SYSTEM_PROMPT =
  "Write one sentence on what a senior Next.js lead should learn. No title, no list, no preamble.";

export function trimSummaryInput(text: string, max = SUMMARY_INPUT_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trimEnd()}…`;
}

const ASSISTANT_HEADER = "assistant<|end_header_id|>";
const LEADING_CHATTER =
  /^(?:here(?:'s| is)\s+(?:a\s+|the\s+)?(?:short\s+|one-line\s+|one line\s+)?(?:summary|note|answer)(?:\s+for you)?\s*[:-]\s*)/i;
const LEADING_LABEL = /^(?:summary|one-line summary|one line summary|learning note|worth learning|note|assistant)\s*:\s*/i;

/** Drop chat-template tokens, echoed role labels, and "Summary:" preambles. */
export function stripSummaryBoilerplate(text: string): string {
  let value = text;
  const header = value.lastIndexOf(ASSISTANT_HEADER);
  if (header !== -1) value = value.slice(header + ASSISTANT_HEADER.length);
  value = value.replace(/<\|[^|>]*\|>/g, " ");
  value = oneLine(value).replace(LEADING_CHATTER, "").replace(LEADING_LABEL, "");
  value = value.replace(/^["“”']+|["“”']+$/g, "");
  return oneLine(value);
}

export function buildSummaryMessages(entry: Entry, skills: string[]): ChatRequest["messages"] {
  const content = trimSummaryInput(
    `Title: ${entry.title}\nNotes: ${entry.summary}\nSkills: ${skills.join(", ")}`,
    SUMMARY_INPUT_CHARS,
  );
  return [
    { role: "system", content: SUMMARY_SYSTEM_PROMPT },
    { role: "user", content },
  ];
}

type RetryOptions = NonNullable<Parameters<typeof withHfRetry>[1]>;

export function createHfZeroShot(
  client: Pick<HfClientLike, "zeroShotClassification">,
  options?: RetryOptions,
): ZeroShotClassifier {
  return {
    async classify(text: string) {
      const result = await withHfRetry(
        () =>
          client.zeroShotClassification({
            model: ZERO_SHOT_MODEL,
            inputs: text,
            parameters: { candidate_labels: [...ZERO_SHOT_LABELS] },
          }),
        options,
      );
      const top = normaliseZeroShot(result).sort((a, b) => b.score - a.score)[0];
      if (!top) throw new Error("Zero-shot classification returned no labels");
      return top;
    },
  };
}

export function createHfSummarizer(
  client: Pick<HfClientLike, "chatCompletion">,
  options?: RetryOptions,
): Summarizer {
  return {
    provider: "huggingface",
    modelId: HF_SUMMARY_MODEL,
    async summarize(entry, skills) {
      const result = await withHfRetry(
        () =>
          client.chatCompletion({
            model: HF_SUMMARY_MODEL,
            messages: buildSummaryMessages(entry, skills),
            max_tokens: 80,
            temperature: 0.2,
          }),
        options,
      );
      const record = result as { choices?: Array<{ message?: { content?: unknown } }> };
      return stripSummaryBoilerplate(textFromCompletion(record.choices?.[0]?.message?.content));
    },
  };
}
