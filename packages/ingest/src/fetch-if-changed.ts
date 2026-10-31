import type { SourceState } from "@evolution/shared-types";

export interface ConditionalCache {
  etag?: string | null;
  lastModified?: string | null;
}

export interface FetchIfChangedOptions {
  fetchImpl?: typeof fetch;
  githubToken?: string;
  headers?: Record<string, string>;
}

export interface FetchIfChangedResult {
  changed: boolean;
  status: number;
  body: string | null;
  etag: string | null;
  lastModified: string | null;
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
    if (options?.githubToken) headers.authorization = `Bearer ${options.githubToken}`;
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
  const response = await fetchImpl(url, { headers: conditionalHeaders(url, prev, options) });
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
    throw new Error(`GET ${url} failed with ${response.status}`);
  }
  return {
    changed: true,
    status: response.status,
    body: await response.text(),
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
  };
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
