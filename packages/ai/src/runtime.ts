import { existsSync } from "node:fs";
import path from "node:path";
import { MODEL_FETCH_TIMEOUT_MS } from "./models";

function repoRoot(start: string): string {
  let dir = path.resolve(start);
  for (let hop = 0; hop < 8; hop += 1) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(start);
}

const MODEL_HOSTS = ["huggingface.co", "hf.co", "cdn-lfs.huggingface.co", "cas-bridge.xethub.hf.co"];

let configured = false;
let fetchPatched = false;

/** On-disk Transformers.js cache. Kept out of node_modules so CI can restore it. */
export function resolveModelCacheDir(
  env: { TRANSFORMERS_CACHE?: string | null } = process.env,
  cwd = process.cwd(),
): string {
  const configuredDir = env.TRANSFORMERS_CACHE?.trim();
  if (configuredDir) return configuredDir;
  return path.join(repoRoot(cwd), ".cache", "models");
}

export function isModelDownloadUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return MODEL_HOSTS.some((item) => host === item || host.endsWith(`.${item}`));
  } catch {
    return false;
  }
}

/**
 * Point Transformers.js at `.cache/models` and abort hung model downloads.
 * Unit tests inject pipelines and never call this.
 */
export async function configureModelRuntime(): Promise<void> {
  if (configured) return;
  configured = true;
  installModelDownloadTimeout(MODEL_FETCH_TIMEOUT_MS);
  try {
    const transformers = (await import("@huggingface/transformers")) as {
      env?: { cacheDir?: string; useFSCache?: boolean };
    };
    if (!transformers.env) return;
    transformers.env.cacheDir = resolveModelCacheDir();
    transformers.env.useFSCache = true;
  } catch {
    // Unit tests mock the module without `env`. The real package always has it.
  }
}

export function modelDownloadFetch(base: typeof fetch, timeoutMs: number): typeof fetch {
  return (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = requestUrl(input);
    if (!isModelDownloadUrl(url)) return base(input, init);
    const signal = init?.signal ?? AbortSignal.timeout(timeoutMs);
    return base(input, { ...init, signal });
  };
}

export function installModelDownloadTimeout(timeoutMs: number): void {
  if (fetchPatched) return;
  fetchPatched = true;
  globalThis.fetch = modelDownloadFetch(globalThis.fetch.bind(globalThis), timeoutMs);
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}
