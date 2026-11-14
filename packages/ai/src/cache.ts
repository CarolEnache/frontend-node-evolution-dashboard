import { createHash } from "node:crypto";

export interface VectorCache {
  getVector(key: string, model: string): Promise<number[] | null>;
  setVector(key: string, model: string, vector: number[]): Promise<void>;
  getSummary(key: string, model: string): Promise<string | null>;
  setSummary(key: string, model: string, summary: string): Promise<void>;
  getJson(key: string, model: string, kind: string): Promise<unknown | null>;
  setJson(key: string, model: string, kind: string, value: unknown): Promise<void>;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function createMemoryCache(): VectorCache {
  const vectors = new Map<string, number[]>();
  const summaries = new Map<string, string>();
  const json = new Map<string, unknown>();
  const vectorKey = (key: string, model: string, kind = "") => `${kind}\0${model}\0${key}`;
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
    async getJson(key, model, kind) {
      return json.has(vectorKey(key, model, kind)) ? json.get(vectorKey(key, model, kind)) ?? null : null;
    },
    async setJson(key, model, kind, value) {
      json.set(vectorKey(key, model, kind), value);
    },
  };
}
