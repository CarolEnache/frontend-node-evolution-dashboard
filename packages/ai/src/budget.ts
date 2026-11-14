/** Cloudflare bge-small: 1,841 neurons per million input tokens. Free tier is 10,000 neurons/day. */
export const NEURONS_PER_MILLION_TOKENS = 1841;
export const DEFAULT_NEURON_BUDGET = 8000;
/** Stay strictly under the free 10,000 neuron daily allocation. */
export const MAX_NEURON_BUDGET = 9999;

export class NeuronBudgetError extends Error {
  constructor() {
    super("Cloudflare neuron budget reached");
    this.name = "NeuronBudgetError";
  }
}

export function estimateTokens(texts: string[]): number {
  return texts.reduce((sum, text) => sum + Math.max(1, Math.ceil(text.length / 4)), 0);
}

export function tokensToNeurons(tokens: number): number {
  return (tokens * NEURONS_PER_MILLION_TOKENS) / 1_000_000;
}

/** Empty or invalid values use the default. Anything above the free tier is clamped. */
export function resolveNeuronBudget(value = process.env.CLOUDFLARE_NEURON_BUDGET): number {
  if (value === undefined || value.trim() === "") return DEFAULT_NEURON_BUDGET;
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_NEURON_BUDGET;
  return Math.min(Math.floor(parsed), MAX_NEURON_BUDGET);
}

export interface NeuronLedger {
  /** Reserve neurons for this batch. False means the daily budget would be exceeded. */
  tryConsume(texts: string[]): Promise<boolean>;
}

export function createMemoryLedger(limit: number, used = 0): NeuronLedger & { spent: () => number } {
  let total = used;
  return {
    spent: () => total,
    async tryConsume(texts) {
      const next = total + tokensToNeurons(estimateTokens(texts));
      if (next > limit) return false;
      total = next;
      return true;
    },
  };
}
