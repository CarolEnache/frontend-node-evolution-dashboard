import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLOUDFLARE_EMBEDDING_MODEL,
  CLOUDFLARE_NEURON_BUDGET,
  CLOUDFLARE_SUMMARY_MODEL,
  cloudflareSummaryNeuronCost,
  createFileNeuronBudget,
  createMemoryNeuronBudget,
  neuronCost,
  resolveNeuronBudget,
  tryReserveModel,
} from "../src/index";

describe("shared Cloudflare neuron budget", () => {
  it("prices embeddings and summaries from one table and refuses an unknown model", () => {
    expect(neuronCost(CLOUDFLARE_EMBEDDING_MODEL, 4_000, 0)).toBe(Math.ceil((4_000 * 1_841) / 1_000_000));
    expect(neuronCost(CLOUDFLARE_SUMMARY_MODEL, 1_000, 80)).toBe(
      Math.ceil((1_000 * 4_119 + 80 * 34_868) / 1_000_000),
    );
    expect(cloudflareSummaryNeuronCost(CLOUDFLARE_SUMMARY_MODEL, 1_000, 80)).toBe(
      neuronCost(CLOUDFLARE_SUMMARY_MODEL, 1_000, 80),
    );
    expect(neuronCost("other", 10, 10)).toBeNull();
    expect(neuronCost(CLOUDFLARE_SUMMARY_MODEL, -1, 0)).toBeNull();
  });

  it("clamps the env override to 8000 and shares one UTC-day counter across models", async () => {
    expect(resolveNeuronBudget(undefined)).toBe(CLOUDFLARE_NEURON_BUDGET);
    expect(resolveNeuronBudget("20000")).toBe(8000);
    expect(resolveNeuronBudget("100")).toBe(100);
    expect(resolveNeuronBudget("nope")).toBe(8000);

    const budget = createMemoryNeuronBudget({ limit: 8 });
    const today = new Date("2026-11-14T12:00:00.000Z");
    const tomorrow = new Date("2026-11-15T00:30:00.000Z");
    expect(await tryReserveModel(budget, CLOUDFLARE_EMBEDDING_MODEL, 4_000, 0, today)).toBe(true);
    expect(await budget.spent(today)).toBe(8);
    expect(await tryReserveModel(budget, CLOUDFLARE_SUMMARY_MODEL, 1_000, 80, today)).toBe(false);
    expect(await budget.spent(today)).toBe(8);
    expect(await tryReserveModel(budget, "other", 10, 10, today)).toBe(false);
    expect(await tryReserveModel(budget, CLOUDFLARE_EMBEDDING_MODEL, 4_000, 0, tomorrow)).toBe(true);
    expect(await budget.spent(tomorrow)).toBe(8);
  });

  it("persists the same day total in a file budget", () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "neurons-")), "budget.json");
    const budget = createFileNeuronBudget(file, 8);
    const now = new Date("2026-11-14T01:00:00.000Z");
    expect(budget.tryReserve(3, now)).toBe(true);
    expect(budget.tryReserve(6, now)).toBe(false);
    expect(budget.spent(now)).toBe(3);
    const again = createFileNeuronBudget(file, 8);
    expect(again.spent(now)).toBe(3);
    expect(again.tryReserve(5, now)).toBe(true);
    expect(again.spent(now)).toBe(8);
  });
});
