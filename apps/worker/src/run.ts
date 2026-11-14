import { readFileSync } from "node:fs";
import path from "node:path";
import { createDefaultAi, createMemoryCache, enrichEntries, type VectorCache } from "@evolution/ai";
import { createDb, findRepoRoot, type DashboardDb } from "@evolution/db";
import { dedupeEntries, ingestSource, SOURCE_CADENCE_HOURS } from "@evolution/ingest";
import { parseSkillsProfile, type Source, type SourceState } from "@evolution/shared-types";

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

export interface IngestRunResult {
  upserted: number;
  skipped: Source[];
  failed: Source[];
  /**
   * The cache refresh failed. This does not fail the process: source failures
   * still decide the exit code, and a revalidate-only outage exits 0.
   */
  revalidateFailed: boolean;
}

export function formatIngestSummary(result: IngestRunResult): string {
  const revalidate = result.revalidateFailed ? ", revalidate failed" : "";
  return `[ingest] upserted ${result.upserted}, skipped ${result.skipped.join(",") || "none"}, failed ${result.failed.join(",") || "none"}${revalidate}`;
}

export async function runOnce(options: RunOptions = {}): Promise<IngestRunResult> {
  const timeoutMs = options.timeoutMs ?? positiveInt(process.env.FETCH_TIMEOUT_MS, 20_000);
  const maxAttempts = options.maxAttempts ?? positiveInt(process.env.FETCH_MAX_ATTEMPTS, 3);
  const db = await createDb(options.databaseUrl);
  const skipped: Source[] = [];
  const failed: Source[] = [];
  let upserted = 0;
  let revalidateFailed = false;
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
    const enriched = shouldEnrich ? await enrichIfPossible(db, entries) : entries;
    await db.upsertEntries(enriched);
    for (const state of pendingStates) await db.upsertSourceState(state);
    upserted = enriched.length;
    revalidateFailed = await notifyRevalidate(options.fetchImpl ?? fetch, timeoutMs);
  } finally {
    await db.close();
  }
  return { upserted, skipped, failed, revalidateFailed };
}

async function enrichIfPossible(db: DashboardDb, entries: ReturnType<typeof dedupeEntries>) {
  if (entries.length === 0) return entries;
  const profile = parseSkillsProfile(
    JSON.parse(readFileSync(path.join(findRepoRoot(), "profile", "skills.json"), "utf8")),
  );
  const ai = await createDefaultAi();
  const cache: VectorCache = {
    getVector: (key, model) => db.getVector(key, model),
    setVector: (key, model, vector) => db.setVector(key, model, vector),
    getSummary: (key, model) => db.getSummary(key, model),
    setSummary: (key, model, summary) => db.setSummary(key, model, summary),
  };
  console.log(
    "[ingest] Summaries follow SUMMARY_PROVIDER (default local). Hugging Face runs only when SUMMARY_PROVIDER=huggingface and HF_TOKEN is set.",
  );
  const result = await enrichEntries(entries, {
    embedder: ai.embedder,
    cache: process.env.EMBED_CACHE === "memory" ? createMemoryCache() : cache,
    profile,
    zeroShot: ai.zeroShot,
    summarizer: ai.summarizer,
  });
  if (result.paused) console.error("[ingest] AI step paused after an out-of-credits response. Entries were still saved.");
  return result.entries;
}

function positiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed) || Number(trimmed) < 1) {
    throw new Error(`Expected a positive integer, received "${value}"`);
  }
  return Number(trimmed);
}

async function notifyRevalidate(fetchImpl: typeof fetch, timeoutMs: number): Promise<boolean> {
  const url = process.env.WEB_REVALIDATE_URL;
  const secret = process.env.REVALIDATE_SECRET;
  if (!url || !secret) return false;
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    await response.body?.cancel();
    if (!response.ok) {
      console.error(`[ingest] revalidate failed with ${response.status}`);
      return true;
    }
    return false;
  } catch (error) {
    console.warn(`[ingest] revalidate failed: ${revalidateErrorText(error, url)}`);
    return true;
  }
}

function revalidateErrorText(error: unknown, url: string): string {
  let message = (error instanceof Error ? error.message : String(error)).split("\n")[0] ?? "revalidate failed";
  if (url) message = message.split(url).join("WEB_REVALIDATE_URL");
  const code = causeCode(error);
  return code ? `${message} (${code})` : message;
}

function causeCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("cause" in error)) return undefined;
  const cause = error.cause;
  if (!cause || typeof cause !== "object" || !("code" in cause)) return undefined;
  return typeof cause.code === "string" && cause.code ? cause.code : undefined;
}
