import { readFileSync } from "node:fs";
import path from "node:path";
import {
  cloudflareFallbackEnabled,
  createDefaultAi,
  createFileNeuronBudget,
  createMemoryCache,
  enrichEntries,
  summaryModelCacheDir,
  type VectorCache,
} from "@evolution/ai";
import { createDb, findRepoRoot, type DashboardDb } from "@evolution/db";
import { dedupeEntries, ingestSource, SOURCE_CADENCE_HOURS } from "@evolution/ingest";
import { parseSkillsProfile, type Source, type SourceState } from "@evolution/shared-types";

export interface RunOptions {
  sources?: Source[];
  fetchImpl?: typeof fetch;
  databaseUrl?: string;
  enrich?: boolean;
  enrichMax?: number;
  timeoutMs?: number;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export async function runOnce(options: RunOptions = {}): Promise<{ upserted: number; skipped: Source[]; failed: Source[] }> {
  const timeoutMs = options.timeoutMs ?? positiveInt(process.env.FETCH_TIMEOUT_MS, 20_000);
  const maxAttempts = options.maxAttempts ?? positiveInt(process.env.FETCH_MAX_ATTEMPTS, 3);
  const db = await createDb(options.databaseUrl);
  const skipped: Source[] = [];
  const failed: Source[] = [];
  let upserted = 0;
  try {
    const sources = options.sources ?? (Object.keys(SOURCE_CADENCE_HOURS) as Source[]);
    const fresh = [];
    const pendingStates: SourceState[] = [];
    for (const source of sources) {
      try {
        const states = await db.listSourceStates(source);
        const result = await ingestSource(source, {
          fetchImpl: options.fetchImpl,
          githubToken: process.env.GITHUB_TOKEN,
          states,
          timeoutMs,
          maxAttempts,
          sleep: options.sleep,
          random: options.random,
        });
        pendingStates.push(...result.states);
        if (result.skipped) {
          skipped.push(source);
          console.log(`[ingest] ${source} unchanged`);
          continue;
        }
        fresh.push(...result.entries);
        console.log(`[ingest] ${source} produced ${result.entries.length} entries`);
      } catch (error) {
        failed.push(source);
        console.error(`[ingest] ${source} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const entries = dedupeEntries(fresh);
    const shouldEnrich = options.enrich ?? process.env.ENRICH === "1";
    const cap = options.enrichMax ?? resolveEnrichMax(process.env.ENRICH_MAX_PER_RUN);
    const selected = cap === undefined ? entries : entries.slice(0, cap);
    const deferred = cap === undefined ? [] : entries.slice(cap);
    // Worth-learning is copied from the rows in this batch only.
    // FNED-16 (PR #19) preserves gap, similarity, and worth-learning in SQL.
    // FNED-6 (PR #31) unions stored tags on this same non-enrich branch.
    const enriched = shouldEnrich ? await enrichIfPossible(db, selected) : await retainStoredSummaries(db, entries);
    const held = shouldEnrich ? await retainStoredSummaries(db, deferred) : [];
    await db.upsertEntries([...enriched, ...held]);
    for (const state of pendingStates) await db.upsertSourceState(state);
    upserted = enriched.length + held.length;
    await notifyRevalidate(options.fetchImpl);
  } finally {
    await db.close();
  }
  return { upserted, skipped, failed };
}

async function enrichIfPossible(db: DashboardDb, entries: ReturnType<typeof dedupeEntries>) {
  if (entries.length === 0) return entries;
  const withSummaries = await retainStoredSummaries(db, entries);
  const profile = parseSkillsProfile(
    JSON.parse(readFileSync(path.join(findRepoRoot(), "profile", "skills.json"), "utf8")),
  );
  const cache: VectorCache = {
    getVector: (key, model) => db.getVector(key, model),
    setVector: (key, model, vector) => db.setVector(key, model, vector),
    getSummary: (key, model) => db.getSummary(key, model),
    setSummary: (key, model, summary) => db.setSummary(key, model, summary),
  };
  console.log(
    "[ingest] Summaries use the local ONNX model. Cloudflare runs only when CLOUDFLARE_FALLBACK=1 and credentials are set. Hugging Face runs only when SUMMARY_PROVIDER=huggingface and HF_TOKEN is set. A failed summary leaves the stored line unchanged.",
  );
  const budget = cloudflareFallbackEnabled()
    ? createFileNeuronBudget(path.join(path.dirname(summaryModelCacheDir()), "neuron-budget.json"))
    : undefined;
  const ai = await createDefaultAi({ budget });
  const result = await enrichEntries(withSummaries, {
    embedder: ai.embedder,
    cache: process.env.EMBED_CACHE === "memory" ? createMemoryCache() : cache,
    profile,
    zeroShot: ai.zeroShot,
    summarizer: ai.summarizer,
    summaryFallback: ai.summaryFallback,
  });
  if (result.paused) console.error("[ingest] AI step paused after an out-of-credits response. Entries were still saved.");
  return result.entries;
}

async function retainStoredSummaries<T extends { id: string; worthLearning?: string }>(
  db: DashboardDb,
  entries: T[],
): Promise<T[]> {
  if (entries.length === 0) return entries;
  const stored = await db.listEntriesByIds(entries.map((entry) => entry.id));
  const byId = new Map(stored.map((entry) => [entry.id, entry.worthLearning]));
  return entries.map((entry) => {
    if (entry.worthLearning) return entry;
    const worthLearning = byId.get(entry.id);
    return worthLearning ? { ...entry, worthLearning } : entry;
  });
}

function resolveEnrichMax(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  if (!/^\d+$/.test(value.trim())) {
    throw new Error(`ENRICH_MAX_PER_RUN must be a non-negative integer, received "${value}"`);
  }
  return Number(value.trim());
}

function positiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed) || Number(trimmed) < 1) {
    throw new Error(`Expected a positive integer, received "${value}"`);
  }
  return Number(trimmed);
}

async function notifyRevalidate(fetchImpl: typeof fetch = fetch) {
  const url = process.env.WEB_REVALIDATE_URL;
  const secret = process.env.REVALIDATE_SECRET;
  if (!url || !secret) return;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });
  if (!response.ok) console.error(`[ingest] revalidate failed with ${response.status}`);
}
