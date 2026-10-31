import { createHash } from "node:crypto";

export interface VectorCache {
  getVector(key: string, model: string): Promise<number[] | null>;
  setVector(key: string, model: string, vector: number[]): Promise<void>;
  getSummary(key: string, model: string): Promise<string | null>;
  setSummary(key: string, model: string, summary: string): Promise<void>;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function createMemoryCache(): VectorCache {
  const vectors = new Map<string, number[]>();
  const summaries = new Map<string, string>();
  const vectorKey = (key: string, model: string) => `${model}\0${key}`;
  return {
    async getVector(key, model) {
      return vectors.get(vectorKey(key, model)) ?? null;
    },
    async setVector(key, model, vector) {
      vectors.set(vectorKey(key, model), vector);
    },
    async getSummary(key, model) {
      return summaries.get(vectorKey(key, model)) ?? null;
    },
    async setSummary(key, model, summary) {
      summaries.set(vectorKey(key, model), summary);
    },
  };
}
