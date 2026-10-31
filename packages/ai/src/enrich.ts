import type { Entry, SkillsProfile } from "@evolution/shared-types";
import { sha256, type VectorCache } from "./cache";
import { classifyGap } from "./classify";
import { maxSimilarity } from "./cosine";
import type { Embedder } from "./embed";
import { AiCreditsError, type Summarizer, type ZeroShotClassifier } from "./hf";
import { SUMMARY_MODEL } from "./models";

export interface EnrichDeps {
  embedder: Embedder;
  cache: VectorCache;
  profile: SkillsProfile;
  profileVectors?: number[][];
  zeroShot?: ZeroShotClassifier | null;
  summarizer?: Summarizer | null;
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

export async function enrichEntry(entry: Entry, deps: EnrichDeps & { profileVectors: number[][] }): Promise<Entry> {
  const text = `${entry.title}\n${entry.summary}`;
  const hash = sha256(text);
  const cacheKey = `${entry.id}:${hash}`;
  let vector = await deps.cache.getVector(cacheKey, deps.embedder.modelId);
  if (!vector) {
    const [embedded] = await deps.embedder.embed([text]);
    vector = embedded ?? [];
    await deps.cache.setVector(cacheKey, deps.embedder.modelId, vector);
  }
  const similarity = round(maxSimilarity(vector, deps.profileVectors));
  const zeroShot = deps.zeroShot ? await deps.zeroShot.classify(text) : null;
  const gap = classifyGap(similarity, zeroShot);
  let worthLearning: string | undefined;
  if (gap === "adjacent" || gap === "new") {
    const summaryModel = deps.summarizer?.modelId ?? SUMMARY_MODEL;
    const cached = await deps.cache.getSummary(cacheKey, summaryModel);
    if (cached) worthLearning = cached;
    else if (deps.summarizer) {
      worthLearning = await deps.summarizer.summarize(entry, deps.profile.skills);
      if (worthLearning) await deps.cache.setSummary(cacheKey, summaryModel, worthLearning);
    }
  }
  return {
    ...entry,
    similarity,
    gap,
    ...(worthLearning ? { worthLearning } : { worthLearning: undefined }),
  };
}

export async function enrichEntries(
  entries: Entry[],
  deps: EnrichDeps,
): Promise<{ entries: Entry[]; paused: boolean }> {
  const profileVectors = deps.profileVectors ?? (await embedProfile(deps.profile.skills, deps.embedder, deps.cache));
  const enriched: Entry[] = [];
  let paused = false;
  for (const entry of entries) {
    if (paused) {
      enriched.push(entry);
      continue;
    }
    try {
      enriched.push(await enrichEntry(entry, { ...deps, profileVectors }));
    } catch (error) {
      if (error instanceof AiCreditsError) {
        paused = true;
        enriched.push(entry);
        continue;
      }
      throw error;
    }
  }
  return { entries: enriched, paused };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
