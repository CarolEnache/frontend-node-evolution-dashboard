import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { findRepoRoot } from "./paths";

/**
 * Load `<repo>/.env` without replacing variables that are already set.
 * `process.loadEnvFile` is used for the process environment. A caller-supplied
 * object uses Node's `parseEnv` with the same non-overriding rule.
 */
export function loadRepoEnv(env: NodeJS.ProcessEnv = process.env, root = findRepoRoot()): void {
  const file = path.join(root, ".env");
  if (!existsSync(file)) return;
  if (env === process.env) {
    process.loadEnvFile(file);
    return;
  }
  for (const [key, value] of Object.entries(parseEnv(readFileSync(file, "utf8")))) {
    if (env[key] === undefined) env[key] = value;
  }
}
