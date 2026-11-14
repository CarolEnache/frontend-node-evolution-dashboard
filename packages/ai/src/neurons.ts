import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CLOUDFLARE_SUMMARY_MODEL } from "./models";

/**
 * Stay under the Workers AI free allocation of 10,000 neurons/day.
 * `@cf/meta/llama-3.1-8b-instruct-fp8-fast` is 4119 neurons per million input
 * tokens and 34868 per million output tokens.
 * https://developers.cloudflare.com/workers-ai/platform/pricing/
 */
export const CLOUDFLARE_NEURON_BUDGET = 8_000;
export const CLOUDFLARE_SUMMARY_INPUT_NEURONS_PER_MILLION = 4_119;
export const CLOUDFLARE_SUMMARY_OUTPUT_NEURONS_PER_MILLION = 34_868;

export interface NeuronBudget {
  tryReserve(neurons: number, now?: Date): boolean;
  spent(now?: Date): number;
}

export function estimateTokens(text: string): number {
  const chars = text.trim().length;
  if (chars === 0) return 1;
  return Math.ceil(chars / 4);
}

/** Null when this model has no published neuron rate. Callers must skip the request. */
export function cloudflareSummaryNeuronCost(model: string, inputTokens: number, outputTokens: number): number | null {
  if (model !== CLOUDFLARE_SUMMARY_MODEL) return null;
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens) || inputTokens < 0 || outputTokens < 0) return null;
  return Math.ceil(
    (inputTokens * CLOUDFLARE_SUMMARY_INPUT_NEURONS_PER_MILLION +
      outputTokens * CLOUDFLARE_SUMMARY_OUTPUT_NEURONS_PER_MILLION) /
      1_000_000,
  );
}

export function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function createMemoryNeuronBudget(options?: { limit?: number; spent?: number }): NeuronBudget {
  const limit = options?.limit ?? CLOUDFLARE_NEURON_BUDGET;
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
  return {
    spent(now = new Date()) {
      return readDay(file, utcDay(now)) ?? Number.POSITIVE_INFINITY;
    },
    tryReserve(neurons, now = new Date()) {
      if (!Number.isFinite(neurons) || neurons < 0) return false;
      const day = utcDay(now);
      const used = readDay(file, day);
      if (used === null || used + neurons > limit) return false;
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
