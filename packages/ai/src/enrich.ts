import type { Entry, SkillsProfile } from "@evolution/shared-types";
import { sha256, type VectorCache } from "./cache";
import { classifyGap } from "./classify";
import { maxSimilarity } from "./cosine";
import type { Embedder } from "./embed";
import { AiCreditsError, type Summarizer, type ZeroShotClassifier } from "./hf";
import { CLOUDFLARE_SUMMARY_MODEL, SUMMARY_MODEL } from "./models";
import { summaryCacheModel } from "./summary";

export interface EnrichDeps {
  embedder: Embedder;
  cache: VectorCache;
  profile: SkillsProfile;
  profileVectors?: number[][];
  zeroShot?: ZeroShotClassifier | null;
  summarizer?: Summarizer | null;
  /** Tried only after the local model misses and throws. Cached under its own provider and model id. */
  summaryFallback?: Summarizer | null;
}

export async function embedProfile(skills: string[], embedder: Embedder, cache: VectorCache): Promise<number[][]> {
  const hash = sha256(skills.join("\n"));
  const vectors: number[][] = new Array(skills.length);
  const missing: Array<{ index: number; text: string }> = [];
  for (let index = 0; index < skills.length; index += 1) {
    const skill = skills[index] ?? "";
    const cached = await cache.getVector(`profile:${hash}:${index}`, embedder.modelId);
    if (cached) vectors[index] = cached;
    else missing.push({ index, text: skill });
  }
  if (missing.length > 0) {
    const embedded = await embedder.embed(missing.map((item) => item.text));
    for (let index = 0; index < missing.length; index += 1) {
      const item = missing[index];
      if (!item) continue;
      const vector = embedded[index] ?? [];
      vectors[item.index] = vector;
      await cache.setVector(`profile:${hash}:${item.index}`, embedder.modelId, vector);
    }
  }
  return vectors.map((vector) => vector ?? []);
}

export function entryCacheKey(entry: Pick<Entry, "id" | "title" | "summary">): string {
  return `${entry.id}:${sha256(`${entry.title}\n${entry.summary}`)}`;
}

export async function enrichEntry(entry: Entry, deps: EnrichDeps & { profileVectors: number[][] }): Promise<Entry> {
  const classified = await classifyEntry(entry, deps);
  if (classified.gap !== "adjacent" && classified.gap !== "new") return classified;
  return (await applySummary(classified, deps)).entry;
}

export async function enrichEntries(
  entries: Entry[],
  deps: EnrichDeps,
): Promise<{ entries: Entry[]; paused: boolean }> {
  const profileVectors = deps.profileVectors ?? (await embedProfile(deps.profile.skills, deps.embedder, deps.cache));
  const classified: Entry[] = [];
  let paused = false;
  try {
    for (const entry of entries) {
      if (paused) {
        classified.push(entry);
        continue;
      }
      try {
        classified.push(await classifyEntry(entry, { ...deps, profileVectors }));
      } catch (error) {
        if (error instanceof AiCreditsError) {
          paused = true;
          classified.push(entry);
          continue;
        }
        throw error;
      }
    }
    // bge and bart (fp32) are finished. Drop them before Llama q4 loads.
    await disposeQuietly(deps.embedder);
    await disposeQuietly(deps.zeroShot);
    if (paused) return { entries: classified, paused };
    const summarized: Entry[] = [];
    let stopSummaries = false;
    for (const entry of classified) {
      if (stopSummaries || (entry.gap !== "adjacent" && entry.gap !== "new")) {
        summarized.push(entry);
        continue;
      }
      try {
        const result = await applySummary(entry, deps);
        summarized.push(result.entry);
        if (result.stop) stopSummaries = true;
      } catch (error) {
        logSummarySkip(entry.id, error);
        summarized.push(entry);
      }
    }
    return { entries: summarized, paused: false };
  } finally {
    await disposeQuietly(deps.embedder);
    await disposeQuietly(deps.zeroShot);
    await disposeQuietly(deps.summarizer);
    await disposeQuietly(deps.summaryFallback);
  }
}

async function classifyEntry(entry: Entry, deps: EnrichDeps & { profileVectors: number[][] }): Promise<Entry> {
  const text = `${entry.title}\n${entry.summary}`;
  const cacheKey = entryCacheKey(entry);
  let vector = await deps.cache.getVector(cacheKey, deps.embedder.modelId);
  if (!vector) {
    const [embedded] = await deps.embedder.embed([text]);
    vector = embedded ?? [];
    await deps.cache.setVector(cacheKey, deps.embedder.modelId, vector);
  }
  const similarity = round(maxSimilarity(vector, deps.profileVectors));
  const zeroShot = deps.zeroShot ? await deps.zeroShot.classify(text) : null;
  const gap = classifyGap(similarity, zeroShot);
  if (gap === "already-know") {
    return { ...entry, similarity, gap, worthLearning: undefined };
  }
  return { ...entry, similarity, gap };
}

async function applySummary(entry: Entry, deps: EnrichDeps): Promise<{ entry: Entry; stop: boolean }> {
  const cacheKey = entryCacheKey(entry);
  let worthLearning = entry.worthLearning;
  let stop = false;
  const primary = deps.summarizer;
  if (primary) {
    const provider = primary.provider ?? "local";
    const modelId = primary.modelId ?? SUMMARY_MODEL;
    const cacheModel = summaryCacheModel(provider, modelId);
    const cached = await deps.cache.getSummary(cacheKey, cacheModel);
    if (cached) worthLearning = cached;
    else {
      try {
        const generated = await primary.summarize(entry, deps.profile.skills);
        if (generated) {
          worthLearning = generated;
          await deps.cache.setSummary(cacheKey, cacheModel, generated);
        }
      } catch (error) {
        logSummarySkip(entry.id, error);
        stop = error instanceof AiCreditsError;
        if (!stop) {
          const fallbackText = await fallbackSummary(entry, deps, cacheKey);
          if (fallbackText) worthLearning = fallbackText;
        }
      }
    }
  }
  return {
    stop,
    entry: { ...entry, ...(worthLearning ? { worthLearning } : { worthLearning: undefined }) },
  };
}

async function fallbackSummary(entry: Entry, deps: EnrichDeps, cacheKey: string): Promise<string | undefined> {
  const fallback = deps.summaryFallback;
  if (!fallback) return undefined;
  const modelId = fallback.modelId ?? CLOUDFLARE_SUMMARY_MODEL;
  const cacheModel = summaryCacheModel(fallback.provider ?? "cloudflare", modelId);
  const cached = await deps.cache.getSummary(cacheKey, cacheModel);
  if (cached) return cached;
  try {
    const generated = await fallback.summarize(entry, deps.profile.skills);
    if (!generated) return undefined;
    await deps.cache.setSummary(cacheKey, cacheModel, generated);
    return generated;
  } catch (error) {
    logSummarySkip(entry.id, error);
    return undefined;
  }
}

function logSummarySkip(id: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[summary] ${id} left unchanged: ${message}`);
}

async function disposeQuietly(model: { dispose?: () => Promise<void> } | null | undefined): Promise<void> {
  if (!model?.dispose) return;
  try {
    await model.dispose();
  } catch {
    // Unloading is best-effort. The next step still continues.
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
