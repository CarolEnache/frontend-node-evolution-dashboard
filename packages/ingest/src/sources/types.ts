import type { Entry, Source, SourceState } from "@evolution/shared-types";
import type { FetchIfChangedOptions } from "../fetch-if-changed";

export const SOURCE_URLS = {
  mdnMeta: "https://registry.npmjs.org/@mdn/browser-compat-data/latest",
  mdnData: (version: string) => `https://cdn.jsdelivr.net/npm/@mdn/browser-compat-data@${version}/data.json`,
  mdnRelease: "https://api.github.com/repos/mdn/browser-compat-data/releases/latest",
  caniuseMeta: "https://registry.npmjs.org/caniuse-db/latest",
  caniuseData: (version: string) => `https://cdn.jsdelivr.net/npm/caniuse-db@${version}/fulldata-json/data-2.0.json`,
  nodeIndex: "https://nodejs.org/dist/index.json",
  nodeSchedule: "https://raw.githubusercontent.com/nodejs/Release/main/schedule.json",
  nodeRss: "https://nodejs.org/en/feed/releases.xml",
  tsMeta: "https://registry.npmjs.org/typescript",
  tsReleases: "https://api.github.com/repos/microsoft/TypeScript/releases?per_page=10",
  tsFeed: "https://devblogs.microsoft.com/typescript/feed/",
  nextLatest: "https://api.github.com/repos/vercel/next.js/releases/latest",
  nextReleases: "https://api.github.com/repos/vercel/next.js/releases?per_page=30",
  nextFeed: "https://nextjs.org/feed.xml",
} as const;

export const SOURCE_CADENCE_HOURS: Record<Source, number> = {
  "mdn-bcd": 6,
  caniuse: 6,
  node: 6,
  typescript: 12,
  nextjs: 12,
};

export interface IngestContext extends FetchIfChangedOptions {
  now?: () => Date;
  states?: SourceState[];
}

export interface IngestResult {
  source: Source;
  entries: Entry[];
  states: SourceState[];
  skipped: boolean;
}
