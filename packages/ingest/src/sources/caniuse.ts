import type { Entry } from "@evolution/shared-types";
import { dedupeEntries } from "../dedupe";
import { fetchIfChanged, findState, readFetchedJson, touchedState } from "../fetch-if-changed";
import { type EntryDraft, normaliseEntry } from "../normalise";
import { SOURCE_URLS, type IngestContext, type IngestResult } from "./types";

type SupportCode = "y" | "a" | "n" | "p" | "u" | "d" | string;

export interface CaniuseFeature {
  title?: string;
  description?: string;
  categories?: string[];
  stats?: Record<string, Record<string, SupportCode>>;
}

export interface CaniuseData {
  updated?: number;
  data?: Record<string, CaniuseFeature>;
}

const SUPPORTED = new Set(["y", "a"]);
const UNSUPPORTED = new Set(["n", "p"]);

export function diffCaniuse(
  previous: CaniuseData | null,
  next: CaniuseData,
  meta: { version: string; date: string; url: string },
): EntryDraft[] {
  const before = previous?.data ?? {};
  const drafts: EntryDraft[] = [];
  for (const [key, feature] of Object.entries(next.data ?? {})) {
    const title = feature.title?.trim() || key;
    if (!before[key]) {
      drafts.push({
        source: "caniuse",
        type: "feature",
        key,
        title,
        version: meta.version,
        date: meta.date,
        url: meta.url,
        summary: feature.description?.trim() || `${title} was added to Can I Use in ${meta.version}.`,
        tags: ["caniuse", ...(feature.categories ?? [])],
        raw: { key, title },
      });
      continue;
    }
    for (const [browser, versions] of Object.entries(feature.stats ?? {})) {
      for (const [browserVersion, status] of Object.entries(versions)) {
        const prior = before[key]?.stats?.[browser]?.[browserVersion];
        if (prior && UNSUPPORTED.has(prior) && SUPPORTED.has(status)) {
          drafts.push({
            source: "caniuse",
            type: "support-change",
            key: `${key}:${browser}:${browserVersion}`,
            title: `${title} is supported in ${browser} ${browserVersion}`,
            version: meta.version,
            date: meta.date,
            url: `https://caniuse.com/${key}`,
            summary: `${title} moved from "${prior}" to "${status}" in ${browser} ${browserVersion}.`,
            tags: ["caniuse", browser, ...(feature.categories ?? [])],
            raw: { key, browser, browserVersion, from: prior, to: status },
          });
        }
      }
    }
  }
  return drafts;
}

export async function ingestCaniuse(ctx: IngestContext): Promise<IngestResult> {
  const now = (ctx.now ?? (() => new Date()))().toISOString();
  const metaUrl = SOURCE_URLS.caniuseMeta;
  const previous = findState(ctx.states, metaUrl);
  const metaRes = await fetchIfChanged(metaUrl, previous, ctx);
  if (!metaRes.changed || !metaRes.body) {
    return { source: "caniuse", entries: [], skipped: true, states: [touchedState(previous, "caniuse", metaUrl, metaRes, now)] };
  }
  const meta = readFetchedJson("caniuse", metaUrl, metaRes.body, "Can I Use metadata", now) as { version?: string };
  if (!meta.version) throw new Error("Can I Use metadata is missing a version");
  const metaState = touchedState(previous, "caniuse", metaUrl, metaRes, now, meta.version);
  if (previous?.version && previous.version === meta.version) {
    return { source: "caniuse", entries: [], skipped: true, states: [metaState] };
  }
  const dataUrl = SOURCE_URLS.caniuseData(meta.version);
  const dataRes = await fetchIfChanged(dataUrl, undefined, ctx);
  if (!dataRes.body) throw new Error("Can I Use data was empty");
  const next = readFetchedJson("caniuse", dataUrl, dataRes.body, "Can I Use data", now) as CaniuseData;
  const date = typeof next.updated === "number" ? new Date(next.updated * 1000).toISOString() : now;
  const drafts: EntryDraft[] = [
    {
      source: "caniuse",
      type: "release",
      version: meta.version,
      title: `Can I Use ${meta.version}`,
      date,
      url: "https://caniuse.com/",
      summary: `Can I Use data updated to ${meta.version}.`,
      tags: ["caniuse"],
      raw: { version: meta.version, updated: next.updated ?? null },
    },
  ];
  if (previous?.version) {
    const previousRes = await fetchIfChanged(SOURCE_URLS.caniuseData(previous.version), undefined, ctx);
    if (previousRes.body) {
      drafts.push(
        ...diffCaniuse(
          readFetchedJson(
            "caniuse",
            SOURCE_URLS.caniuseData(previous.version),
            previousRes.body,
            "previous Can I Use",
            now,
          ) as CaniuseData,
          next,
          {
            version: meta.version,
            date,
            url: "https://caniuse.com/",
          },
        ),
      );
    }
  }
  return {
    source: "caniuse",
    entries: finish(drafts),
    skipped: false,
    states: [metaState, touchedState(undefined, "caniuse", dataUrl, dataRes, now, meta.version)],
  };
}

function finish(drafts: EntryDraft[]): Entry[] {
  return dedupeEntries(drafts.map((draft) => normaliseEntry(draft)));
}
