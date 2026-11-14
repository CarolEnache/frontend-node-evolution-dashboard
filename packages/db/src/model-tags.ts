import { createHash } from "node:crypto";

export function entryContentHash(title: string, summary: string): string {
  return createHash("sha256").update(`${title}\n${summary}`).digest("hex");
}

export function localTagKey(id: string, title: string, summary: string): string {
  return `local:${id}:${entryContentHash(title, summary)}`;
}

export function parseTagList(payload: unknown): string[] {
  if (!Array.isArray(payload)) return [];
  return payload.filter((tag): tag is string => typeof tag === "string" && tag.trim() !== "");
}

export function mergeVisibleTags(parserTags: string[], modelTags: string[]): string[] {
  return [...new Set([...parserTags, ...modelTags])].sort();
}

export function chunks<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size));
  return groups;
}
