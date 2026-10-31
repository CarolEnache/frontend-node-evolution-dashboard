import type { SourceState } from "@evolution/shared-types";

export const DEFAULT_FETCH_TIMEOUT_MS = 20_000;
export const DEFAULT_FETCH_ATTEMPTS = 3;

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export interface ConditionalCache {
  etag?: string | null;
  lastModified?: string | null;
}

export interface FetchIfChangedOptions {
  fetchImpl?: typeof fetch;
  githubToken?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface FetchIfChangedResult {
  changed: boolean;
  status: number;
  body: string | null;
  etag: string | null;
  lastModified: string | null;
}

export function fetchBackoffMs(attempt: number, random = Math.random()): number {
  return 200 * 2 ** attempt + Math.floor(random * 100);
}

export function conditionalHeaders(
  url: string,
  prev?: ConditionalCache,
  options?: Pick<FetchIfChangedOptions, "githubToken" | "headers">,
): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/json, application/xml, text/xml, */*",
    "user-agent": "evolution-dashboard",
    ...options?.headers,
  };
  if (url.includes("api.github.com")) {
    headers.accept = "application/vnd.github+json";
    headers["x-github-api-version"] = "2022-11-28";
    const token = options?.githubToken?.trim();
    if (token) headers.authorization = `Bearer ${token}`;
  }
  const typescriptPackument = url.startsWith("https://registry.npmjs.org/typescript") && !url.includes("/latest");
  if (typescriptPackument) {
    headers.accept = "application/vnd.npm.install-v1+json";
  }
  if (prev?.etag) headers["if-none-match"] = prev.etag;
  if (prev?.lastModified) headers["if-modified-since"] = prev.lastModified;
  return headers;
}

export async function fetchIfChanged(
  url: string,
  prev?: ConditionalCache,
  options?: FetchIfChangedOptions,
): Promise<FetchIfChangedResult> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const maxAttempts = Math.max(1, options?.maxAttempts ?? DEFAULT_FETCH_ATTEMPTS);
  const sleep = options?.sleep ?? delay;
  const random = options?.random ?? Math.random;
  const headers = conditionalHeaders(url, prev, options);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetchWithTimeout(fetchImpl, url, headers, timeoutMs);
      if (response.status === 304) {
        return {
          changed: false,
          status: 304,
          body: null,
          etag: response.headers.get("etag") ?? prev?.etag ?? null,
          lastModified: response.headers.get("last-modified") ?? prev?.lastModified ?? null,
        };
      }
      if (!response.ok) {
        await discard(response);
        const error = new Error(`GET ${url} failed with ${response.status}`);
        if (!RETRYABLE_STATUSES.has(response.status) || attempt === maxAttempts - 1) throw error;
        await sleep(fetchBackoffMs(attempt, random()));
        continue;
      }
      return {
        changed: true,
        status: response.status,
        body: await response.text(),
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
      };
    } catch (error) {
      if (!isRetryableFailure(error) || attempt === maxAttempts - 1) throw error;
      await sleep(fetchBackoffMs(attempt, random()));
    }
  }
  throw new Error(`GET ${url} failed`);
}

export function findState(states: SourceState[] | undefined, url: string): SourceState | undefined {
  return states?.find((state) => state.url === url);
}

export function touchedState(
  previous: SourceState | undefined,
  source: SourceState["source"],
  url: string,
  result: FetchIfChangedResult,
  now: string,
  version?: string | null,
): SourceState {
  return {
    source,
    url,
    etag: result.etag,
    lastModified: result.lastModified,
    version: version ?? previous?.version ?? null,
    lastFetchedAt: now,
    lastSuccessAt: now,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { headers, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`GET ${url} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The status decides the retry. A body-cancel failure does not.
  }
}

function isRetryableFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  const match = / failed with (\d+)$/.exec(error.message);
  if (!match) return true;
  return RETRYABLE_STATUSES.has(Number(match[1]));
}
