import type { Source } from "@evolution/shared-types";
import { SourceFetchError } from "./fetch-if-changed";
import { ingestCaniuse } from "./sources/caniuse";
import { ingestMdn } from "./sources/mdn-bcd";
import { ingestNext } from "./sources/nextjs";
import { ingestNode } from "./sources/node";
import { ingestTypeScript } from "./sources/typescript";
import { type IngestContext, type IngestResult } from "./sources/types";

export { dedupeEntries } from "./dedupe";
export { conditionalHeaders, failureSourceState, fetchIfChanged, SourceFetchError } from "./fetch-if-changed";
export { parseGithubReleases } from "./github";
export { clampSummary, inferTags, normaliseEntry, toIso, type EntryDraft } from "./normalise";
export { parseFeed } from "./rss";
export { diffCaniuse, type CaniuseData } from "./sources/caniuse";
export { collectCompat, diffBcd, parseMdnReleaseNotes, sectionItems } from "./sources/mdn-bcd";
export { currentLts, parseNodeIndex, selectNewNodeReleases } from "./sources/node";
export { isNightlyTypeScript, parseTypeScriptPackument } from "./sources/typescript";
export { SOURCE_CADENCE_HOURS, SOURCE_URLS, type IngestContext, type IngestResult } from "./sources/types";

const INGESTERS = {
  "mdn-bcd": ingestMdn,
  caniuse: ingestCaniuse,
  node: ingestNode,
  typescript: ingestTypeScript,
  nextjs: ingestNext,
} as const;

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

export async function ingestSource(source: Source, ctx: IngestContext = {}): Promise<IngestResult> {
  const ingest = INGESTERS[source as keyof typeof INGESTERS];
  if (!ingest) {
    throw new Error(`No ingester registered for source "${source}".`);
  }
  const attemptedAt = (ctx.now ?? (() => new Date()))().toISOString();
  const fetchImpl = ctx.fetchImpl ?? fetch;
  const wrapped: typeof fetch = async (input, init) => {
    try {
      return await fetchImpl(input, init);
    } catch (error) {
      throw new SourceFetchError(source, requestUrl(input), attemptedAt, error);
    }
  };
  try {
    return await ingest({ ...ctx, fetchImpl: wrapped });
  } catch (error) {
    if (error instanceof SourceFetchError) throw error;
    if (error instanceof Error) {
      const match = /^GET (\S+) (?:failed with \d+|timed out\b)/.exec(error.message);
      if (match?.[1]) throw new SourceFetchError(source, match[1], attemptedAt, error);
    }
    throw error;
  }
}

export async function ingestAll(ctx: IngestContext = {}, sources?: Source[]): Promise<IngestResult[]> {
  const list = sources ?? (Object.keys(INGESTERS) as Source[]);
  const results: IngestResult[] = [];
  for (const source of list) {
    results.push(await ingestSource(source, ctx));
  }
  return results;
}
