import { existsSync } from "node:fs";
import path from "node:path";

export function findRepoRoot(start = process.cwd()): string {
  let dir = path.resolve(start);
  for (let hop = 0; hop < 8; hop += 1) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not find pnpm-workspace.yaml from ${start}`);
}

export function isPostgresUrl(url: string): boolean {
  return url.startsWith("postgres://") || url.startsWith("postgresql://");
}

/** URL scheme, or undefined for a filesystem path. A Windows drive letter is not a scheme. */
export function databaseScheme(url: string): string | undefined {
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(url.trim());
  if (!match) return undefined;
  if (match[1].length === 1 && /^[A-Za-z]:[\\/]/.test(url.trim())) return undefined;
  return match[1].toLowerCase();
}

export function sqliteFilePath(url: string): string {
  const raw = url.startsWith("file:") ? url.slice("file:".length) : url;
  if (raw === ":memory:") return ":memory:";
  return path.resolve(raw);
}

export function defaultDatabaseUrl(): string {
  return `file:${path.join(findRepoRoot(), "data", "dev.sqlite")}`;
}
