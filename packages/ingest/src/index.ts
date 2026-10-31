import type { Source } from "@evolution/shared-types";
import { ingestCaniuse } from "./sources/caniuse";
import { ingestMdn } from "./sources/mdn-bcd";
import { ingestNext } from "./sources/nextjs";
import { ingestNode } from "./sources/node";
import { ingestTypeScript } from "./sources/typescript";
import { type IngestContext, type IngestResult } from "./sources/types";

export { dedupeEntries } from "./dedupe";
export { conditionalHeaders, fetchIfChanged } from "./fetch-if-changed";
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

export async function ingestSource(source: Source, ctx: IngestContext = {}): Promise<IngestResult> {
  return INGESTERS[source](ctx);
}

export async function ingestAll(ctx: IngestContext = {}, sources?: Source[]): Promise<IngestResult[]> {
  const list = sources ?? (Object.keys(INGESTERS) as Source[]);
  const results: IngestResult[] = [];
  for (const source of list) {
    results.push(await ingestSource(source, ctx));
  }
  return results;
}
