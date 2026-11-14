import { findRepoRoot, loadRepoEnv } from "@evolution/db";

/** Load `<repo>/.env` into the worker environment. Existing variables win. */
export function loadWorkerEnv(env: NodeJS.ProcessEnv = process.env, root = findRepoRoot()): void {
  loadRepoEnv(env, root);
}
