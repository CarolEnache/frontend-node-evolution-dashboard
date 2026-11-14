import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CLOUDFLARE_EMBEDDING_MODEL, CLOUDFLARE_SUMMARY_MODEL } from "./models";

/**
 * One daily cap for the whole Cloudflare account. Embeddings, tags, and
 * summaries share it. The free Workers AI allocation is 10,000 neurons/day,
 * so this stays at 8,000 or below.
 * Rates: https://developers.cloudflare.com/workers-ai/platform/pricing/
 */
export const CLOUDFLARE_NEURON_BUDGET = 8_000;

export const CLOUDFLARE_EMBEDDING_INPUT_NEURONS_PER_MILLION = 1_841;
export const CLOUDFLARE_SUMMARY_INPUT_NEURONS_PER_MILLION = 4_119;
export const CLOUDFLARE_SUMMARY_OUTPUT_NEURONS_PER_MILLION = 34_868;

export interface NeuronRate {
  inputPerMillion: number;
  outputPerMillion: number;
}

/** Published neuron prices. A model that is missing here must not be called. */
export const CLOUDFLARE_NEURON_RATES: Record<string, NeuronRate> = {
  [CLOUDFLARE_EMBEDDING_MODEL]: {
    inputPerMillion: CLOUDFLARE_EMBEDDING_INPUT_NEURONS_PER_MILLION,
    outputPerMillion: 0,
  },
  [CLOUDFLARE_SUMMARY_MODEL]: {
    inputPerMillion: CLOUDFLARE_SUMMARY_INPUT_NEURONS_PER_MILLION,
    outputPerMillion: CLOUDFLARE_SUMMARY_OUTPUT_NEURONS_PER_MILLION,
  },
};

export class NeuronBudgetError extends Error {
  constructor() {
    super("Cloudflare neuron budget reached");
    this.name = "NeuronBudgetError";
  }
}

export interface NeuronBudget {
  tryReserve(neurons: number, now?: Date): boolean | Promise<boolean>;
  spent(now?: Date): number | Promise<number>;
}

/** Characters divided by 4, matching the FNED-7 estimator. Empty text still costs one token. */
export function estimateTokens(text: string): number {
  const chars = text.trim().length;
  if (chars === 0) return 1;
  return Math.ceil(chars / 4);
}

/**
 * Null when this model has no published neuron rate. Callers must skip the request.
 * `cloudflareSummaryNeuronCost` is the same function, kept so summary.ts can call it.
 */
export function neuronCost(model: string, inputTokens: number, outputTokens: number): number | null {
  const rate = CLOUDFLARE_NEURON_RATES[model];
  if (!rate) return null;
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens) || inputTokens < 0 || outputTokens < 0) return null;
  return Math.ceil((inputTokens * rate.inputPerMillion + outputTokens * rate.outputPerMillion) / 1_000_000);
}

export function cloudflareSummaryNeuronCost(model: string, inputTokens: number, outputTokens: number): number | null {
  return neuronCost(model, inputTokens, outputTokens);
}

/** Reserve the priced cost before a fetch. False means skip the request. */
export async function tryReserveModel(
  budget: NeuronBudget,
  model: string,
  inputTokens: number,
  outputTokens: number,
  now?: Date,
): Promise<boolean> {
  const cost = neuronCost(model, inputTokens, outputTokens);
  if (cost === null) return false;
  return budget.tryReserve(cost, now);
}

export function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Empty or invalid values use 8000. Larger values are clamped to 8000. */
export function resolveNeuronBudget(value = process.env.CLOUDFLARE_NEURON_BUDGET): number {
  if (value === undefined || value.trim() === "") return CLOUDFLARE_NEURON_BUDGET;
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || parsed < 0) return CLOUDFLARE_NEURON_BUDGET;
  return Math.min(Math.floor(parsed), CLOUDFLARE_NEURON_BUDGET);
}

export function createMemoryNeuronBudget(options?: { limit?: number; spent?: number }): NeuronBudget {
  const limit = resolveNeuronBudget(options?.limit === undefined ? undefined : String(options.limit));
  const byDay = new Map<string, number>();
  if (options?.spent) byDay.set(utcDay(), options.spent);
  return {
    spent(now = new Date()) {
      return byDay.get(utcDay(now)) ?? 0;
    },
    tryReserve(neurons, now = new Date()) {
      if (!Number.isFinite(neurons) || neurons < 0) return false;
      const day = utcDay(now);
      const used = byDay.get(day) ?? 0;
      if (used + neurons > limit) return false;
      byDay.set(day, used + neurons);
      return true;
    },
  };
}

/** Process-wide ledger used when a caller does not pass its own. */
export function defaultNeuronBudget(): NeuronBudget {
  sharedBudget ??= createMemoryNeuronBudget();
  return sharedBudget;
}

let sharedBudget: NeuronBudget | undefined;

export function createFileNeuronBudget(file: string, limit = CLOUDFLARE_NEURON_BUDGET): NeuronBudget {
  const cap = resolveNeuronBudget(String(limit));
  return {
    spent(now = new Date()) {
      return readDay(file, utcDay(now)) ?? Number.POSITIVE_INFINITY;
    },
    tryReserve(neurons, now = new Date()) {
      if (!Number.isFinite(neurons) || neurons < 0) return false;
      const day = utcDay(now);
      const used = readDay(file, day);
      if (used === null || used + neurons > cap) return false;
      try {
        const all = readAll(file);
        all[day] = used + neurons;
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify(all));
        return true;
      } catch {
        return false;
      }
    },
  };
}

export interface NeuronStore {
  /** Add `amount` to the UTC day only when the new total is within `limit`. */
  reserve(day: string, amount: number, limit: number): Promise<boolean>;
  spent(day: string): Promise<number>;
}

/** Database-backed budget. Embeddings and summaries must share one store. */
export function createStoredNeuronBudget(store: NeuronStore, limit = resolveNeuronBudget()): NeuronBudget {
  const cap = resolveNeuronBudget(String(limit));
  return {
    spent(now = new Date()) {
      return store.spent(utcDay(now));
    },
    tryReserve(neurons, now = new Date()) {
      if (!Number.isFinite(neurons) || neurons < 0) return false;
      return store.reserve(utcDay(now), neurons, cap);
    },
  };
}

function readDay(file: string, day: string): number | null {
  try {
    const value = readAll(file)[day];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  } catch {
    return null;
  }
}

function readAll(file: string): Record<string, number> {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, number>;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return {};
    throw error;
  }
}
