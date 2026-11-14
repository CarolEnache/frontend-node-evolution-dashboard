import type { Entry, SkillsProfile } from "@evolution/shared-types";
import { NeuronBudgetError } from "./neurons";
import { sha256, type VectorCache } from "./cache";
import { classifyGap, type ZeroShotVote } from "./classify";
import { maxSimilarity } from "./cosine";
import type { Embedder } from "./embed";
import { AiCreditsError, type Summarizer, type ZeroShotClassifier } from "./hf";
import { SUMMARY_MODEL } from "./models";
import { entryCacheKey } from "./tags";
import type { Tagger } from "./zero-shot";

export interface EnrichDeps {
  embedder: Embedder;
  cache: VectorCache;
  profile: SkillsProfile;
  profileVectors?: number[][];
  zeroShot?: ZeroShotClassifier | null;
  tagger?: Tagger | null;
  summarizer?: Summarizer | null;
  log?: (line: string) => void;
}

export { entryCacheKey } from "./tags";

interface Vote {
  label: string;
  score: number;
}

export async function embedProfile(skills: string[], embedder: Embedder, cache: VectorCache): Promise<number[][]> {
  const hash = sha256(skills.join("\n"));
  const provider = embedder.provider ?? "local";
  const vectors: number[][] = new Array(skills.length);
  const missing: Array<{ index: number; text: string }> = [];
  for (let index = 0; index < skills.length; index += 1) {
    const skill = skills[index] ?? "";
    const key = `${provider}:profile:${hash}:${index}`;
    const cached = await cache.getVector(key, embedder.modelId);
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
      await cache.setVector(`${provider}:profile:${hash}:${item.index}`, embedder.modelId, vector);
    }
  }
  return vectors.map((vector) => vector ?? []);
}

/**
 * Embed, then tag, then summarise. Each model is disposed before the next one
 * loads, so bart-large-mnli (fp32) is never resident with Llama.
 */
export async function enrichEntries(
  entries: Entry[],
  deps: EnrichDeps,
): Promise<{ entries: Entry[]; paused: boolean; reason?: "budget" | "credits" }> {
  const log = deps.log ?? ((line: string) => console.error(line));
  let paused = false;
  let reason: "budget" | "credits" | undefined;
  const profileVectors = deps.profileVectors ?? (await embedProfile(deps.profile.skills, deps.embedder, deps.cache));
  const embedded: Entry[] = [];
  for (const entry of entries) {
    if (paused) {
      embedded.push(entry);
      continue;
    }
    try {
      embedded.push(await applyEmbedding(entry, deps, profileVectors));
    } catch (error) {
      const stop = pauseReason(error);
      if (stop) {
        paused = true;
        reason = stop;
        embedded.push(entry);
        continue;
      }
      log(enrichmentLine(entry.id, error));
      embedded.push(entry);
    }
  }
  await deps.embedder.dispose?.();

  const tagged: Entry[] = [];
  for (const entry of embedded) {
    if (paused || entry.similarity === undefined) {
      tagged.push(entry);
      continue;
    }
    try {
      tagged.push(await applyTags(entry, deps));
    } catch (error) {
      const stop = pauseReason(error);
      if (stop) {
        paused = true;
        reason = stop;
        tagged.push(entry);
        continue;
      }
      log(enrichmentLine(entry.id, error));
      tagged.push(entry);
    }
  }
  await deps.tagger?.dispose?.();
  await deps.zeroShot?.dispose?.();

  const finished: Entry[] = [];
  for (const entry of tagged) {
    if (paused) {
      finished.push(entry);
      continue;
    }
    try {
      finished.push(await applySummary(entry, deps));
    } catch (error) {
      const stop = pauseReason(error);
      if (stop) {
        paused = true;
        reason = stop;
        finished.push(entry);
        continue;
      }
      log(enrichmentLine(entry.id, error));
      finished.push(entry);
    }
  }
  await deps.summarizer?.dispose?.();
  return { entries: finished, paused, ...(reason ? { reason } : {}) };
}

async function applyEmbedding(entry: Entry, deps: EnrichDeps, profileVectors: number[][]): Promise<Entry> {
  const provider = deps.embedder.provider ?? "local";
  const cacheKey = entryCacheKey(provider, entry);
  let vector = await deps.cache.getVector(cacheKey, deps.embedder.modelId);
  if (!vector) {
    const [embedded] = await deps.embedder.embed([`${entry.title}\n${entry.summary}`]);
    vector = embedded ?? [];
    await deps.cache.setVector(cacheKey, deps.embedder.modelId, vector);
  }
  return { ...entry, similarity: round(maxSimilarity(vector, profileVectors)) };
}

async function applyTags(entry: Entry, deps: EnrichDeps): Promise<Entry> {
  const text = `${entry.title}\n${entry.summary}`;
  const vote = await cachedVote(text, entry, deps);
  const gap = classifyGap(entry.similarity ?? 0, vote);
  if (deps.tagger && deps.tagger.writesTags !== false) {
    const provider = deps.tagger.provider ?? "local";
    const cacheKey = entryCacheKey(provider, entry);
    const cached = await deps.cache.getJson(cacheKey, deps.tagger.modelId, "tags");
    if (!Array.isArray(cached)) {
      const tags = await deps.tagger.tag({ text, source: entry.source, parserTags: entry.tags });
      await deps.cache.setJson(cacheKey, deps.tagger.modelId, "tags", tags);
    }
  }
  return { ...entry, gap };
}

async function applySummary(entry: Entry, deps: EnrichDeps): Promise<Entry> {
  if (entry.gap !== "adjacent" && entry.gap !== "new") {
    return { ...entry, worthLearning: undefined };
  }
  const cacheKey = entryCacheKey(deps.embedder.provider ?? "local", entry);
  const summaryModel = deps.summarizer?.modelId ?? SUMMARY_MODEL;
  const cached = await deps.cache.getSummary(cacheKey, summaryModel);
  if (cached) return { ...entry, worthLearning: cached };
  if (!deps.summarizer) return { ...entry, worthLearning: undefined };
  const worthLearning = await deps.summarizer.summarize(entry, deps.profile.skills);
  if (worthLearning) await deps.cache.setSummary(cacheKey, summaryModel, worthLearning);
  return { ...entry, ...(worthLearning ? { worthLearning } : { worthLearning: undefined }) };
}

async function cachedVote(text: string, entry: Entry, deps: EnrichDeps): Promise<ZeroShotVote | null> {
  const classifier = deps.zeroShot;
  if (!classifier) return null;
  const provider = classifier.provider ?? "local";
  const cacheKey = entryCacheKey(provider, entry);
  const model = classifier.modelId ?? "local:zero-shot";
  const cached = await deps.cache.getJson(cacheKey, model, "vote");
  if (isVote(cached)) return cached;
  const vote = await classifier.classify(text);
  await deps.cache.setJson(cacheKey, model, "vote", vote);
  return vote;
}

function isVote(value: unknown): value is Vote {
  if (!value || typeof value !== "object") return false;
  const record = value as { label?: unknown; score?: unknown };
  return typeof record.label === "string" && typeof record.score === "number" && Number.isFinite(record.score);
}

function pauseReason(error: unknown): "budget" | "credits" | null {
  if (error instanceof NeuronBudgetError) return "budget";
  if (error instanceof AiCreditsError) return "credits";
  return null;
}

export function enrichmentLine(id: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `[enrich] ${id}: ${message}`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
