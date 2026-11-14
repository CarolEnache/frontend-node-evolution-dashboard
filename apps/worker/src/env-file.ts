import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { findRepoRoot } from "@evolution/db";

/**
 * Load `<repo>/.env` into the worker environment.
 * Variables already set in the process are left alone, matching Node's `--env-file`.
 */
export function loadWorkerEnv(env: NodeJS.ProcessEnv = process.env, root = findRepoRoot()): void {
  const file = path.join(root, ".env");
  if (!existsSync(file)) return;
  for (const [key, value] of parseEnvFile(readFileSync(file, "utf8"))) {
    if (env[key] === undefined) env[key] = value;
  }
}

function parseEnvFile(contents: string): Array<[string, string]> {
  const text = contents.charCodeAt(0) === 0xfeff ? contents.slice(1) : contents;
  const entries: Array<[string, string]> = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const body = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const eq = body.indexOf("=");
    if (eq <= 0) continue;
    const key = body.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    entries.push([key, parseEnvValue(body.slice(eq + 1).trim())]);
  }
  return entries;
}

function parseEnvValue(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  const comment = value.search(/\s+#/);
  return (comment === -1 ? value : value.slice(0, comment)).trim();
}
