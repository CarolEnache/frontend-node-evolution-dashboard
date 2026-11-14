import { readFileSync } from "node:fs";
import path from "node:path";
import {
  createDefaultAi,
  createMemoryCache,
  ENRICH_MAX_PER_RUN,
  enrichEntries,
  estimateTokens,
  reconcileStoredTags,
  resolveNeuronBudget,
  tokensToNeurons,
  type NeuronLedger,
  type VectorCache,
} from "@evolution/ai";
import { createDb, findRepoRoot, type DashboardDb } from "@evolution/db";
import { dedupeEntries, ingestSource, SOURCE_CADENCE_HOURS } from "@evolution/ingest";
import { parseSkillsProfile, type Entry, type Source, type SourceState } from "@evolution/shared-types";

export interface RunOptions {
  sources?: Source[];
  fetchImpl?: typeof fetch;
  databaseUrl?: string;
  enrich?: boolean;
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
    // Model tags live in the embeddings table, keyed by content hash. This only
    // keeps parser tags when the text is unchanged. Gap, similarity, and
    // worth-learning preservation is FNED-16 (`preserveEnrichment` on upsert)
    // and is intentionally not added here.
    const prepared = shouldEnrich ? await enrichIfPossible(db, entries) : await retainStoredTags(db, entries);
    await db.upsertEntries(prepared);
    for (const state of pendingStates) await db.upsertSourceState(state);
    upserted = prepared.length;
    await notifyRevalidate(options.fetchImpl);
  } finally {
    await db.close();
  }
  return { upserted, skipped, failed };
}

async function enrichIfPossible(db: DashboardDb, entries: ReturnType<typeof dedupeEntries>) {
  if (entries.length === 0) return entries;
  const max = positiveInt(process.env.ENRICH_MAX_PER_RUN, ENRICH_MAX_PER_RUN);
  const batch = entries.slice(0, max);
  const rest = entries.slice(max);
  if (rest.length > 0) {
    console.log(`[ingest] Enriching ${batch.length} of ${entries.length} entries (ENRICH_MAX_PER_RUN=${max}).`);
  }
  const profile = parseSkillsProfile(
    JSON.parse(readFileSync(path.join(findRepoRoot(), "profile", "skills.json"), "utf8")),
  );
  const ledger = createNeuronLedger(db, resolveNeuronBudget());
  const ai = await createDefaultAi({ ledger });
  const cache: VectorCache = {
    getVector: (key, model) => db.getVector(key, model),
    setVector: (key, model, vector) => db.setVector(key, model, vector),
    getSummary: (key, model) => db.getSummary(key, model),
    setSummary: (key, model, summary) => db.setSummary(key, model, summary),
    getJson: (key, model, kind) => db.getJson(key, model, kind),
    setJson: (key, model, kind, value) => db.setJson(key, model, kind, value),
  };
  console.log(
    "[ingest] Embeddings and tags run locally. Cloudflare runs only when CLOUDFLARE_FALLBACK=1 and credentials are set, and it does not write tags. Summaries follow SUMMARY_PROVIDER.",
  );
  const result = await enrichEntries(batch, {
    embedder: ai.embedder,
    cache: process.env.EMBED_CACHE === "memory" ? createMemoryCache() : cache,
    profile,
    zeroShot: ai.zeroShot,
    tagger: ai.tagger,
    summarizer: ai.summarizer,
  });
  if (result.reason === "budget") {
    console.error("[ingest] Cloudflare neuron budget reached; skipping remaining enrichment.");
  } else if (result.paused) {
    console.error("[ingest] AI step paused after an out-of-credits response. Entries were still saved.");
  }
  return [...result.entries, ...rest];
}

function createNeuronLedger(db: DashboardDb, limit: number): NeuronLedger {
  return {
    async tryConsume(texts) {
      const amount = tokensToNeurons(estimateTokens(texts));
      const day = new Date().toISOString().slice(0, 10);
      const used = await db.getNeurons(day);
      if (used + amount > limit) return false;
      await db.addNeurons(day, amount);
      return true;
    },
  };
}

async function retainStoredTags(db: DashboardDb, entries: Entry[]): Promise<Entry[]> {
  if (entries.length === 0) return entries;
  const stored = await db.listEntryFields(entries.map((entry) => entry.id));
  const byId = new Map(stored.map((entry) => [entry.id, entry]));
  return entries.map((entry) => reconcileStoredTags(entry, byId.get(entry.id)));
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
