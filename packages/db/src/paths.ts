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

export function sqliteFilePath(url: string): string {
  const raw = url.replace(/^file:/, "");
  return path.resolve(raw);
}

export function defaultDatabaseUrl(): string {
  return `file:${path.join(findRepoRoot(), "data", "dev.sqlite")}`;
}

export function resolveDatabaseUrl(input?: string): string {
  const configured = input ?? process.env.DATABASE_URL;
  if (!configured || configured.trim() === "") return defaultDatabaseUrl();
  return configured.trim();
}
