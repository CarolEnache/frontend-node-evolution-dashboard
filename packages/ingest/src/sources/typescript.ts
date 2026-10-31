import type { Entry } from "@evolution/shared-types";
import { dedupeEntries } from "../dedupe";
import { fetchIfChanged, findState, touchedState } from "../fetch-if-changed";
import { parseGithubReleases } from "../github";
import { type EntryDraft, normaliseEntry, parseJson } from "../normalise";
import { parseFeed, slugKey } from "../rss";
import { SOURCE_URLS, type IngestContext, type IngestResult } from "./types";

interface TypeScriptPackument {
  "dist-tags"?: Record<string, string>;
  time?: Record<string, string>;
}

export function isNightlyTypeScript(version: string): boolean {
  return /-dev\./.test(version);
}

export function parseTypeScriptPackument(payload: unknown): EntryDraft[] {
  if (!payload || typeof payload !== "object") throw new Error("TypeScript metadata must be an object");
  const doc = payload as TypeScriptPackument;
  const tags = doc["dist-tags"] ?? {};
  const tracked: Array<["latest" | "beta" | "rc", string | undefined]> = [
    ["latest", tags.latest],
    ["beta", tags.beta],
    ["rc", tags.rc],
  ];
  const drafts: EntryDraft[] = [];
  const seen = new Set<string>();
  for (const [tag, version] of tracked) {
    if (!version || isNightlyTypeScript(version) || seen.has(version)) continue;
    seen.add(version);
    drafts.push({
      source: "typescript",
      type: "release",
      version,
      title: tag === "latest" ? `TypeScript ${version}` : `TypeScript ${version} (${tag})`,
      date: doc.time?.[version] ?? new Date(0).toISOString(),
      url: "https://devblogs.microsoft.com/typescript/",
      summary: `TypeScript dist-tag ${tag} is ${version}. Nightly next builds are ignored.`,
      tags: ["typescript", tag === "latest" ? "stable" : tag],
      raw: { tag, version },
    });
  }
  return drafts;
}

export async function ingestTypeScript(ctx: IngestContext): Promise<IngestResult> {
  const now = (ctx.now ?? (() => new Date()))().toISOString();
  const metaUrl = SOURCE_URLS.tsMeta;
  const releaseUrl = SOURCE_URLS.tsReleases;
  const feedUrl = SOURCE_URLS.tsFeed;
  const metaRes = await fetchIfChanged(metaUrl, findState(ctx.states, metaUrl), ctx);
  const releaseRes = await fetchIfChanged(releaseUrl, findState(ctx.states, releaseUrl), ctx);
  const feedRes = await fetchIfChanged(feedUrl, findState(ctx.states, feedUrl), ctx);
  const latest = metaRes.changed && metaRes.body
    ? ((parseJson(metaRes.body, "TypeScript metadata") as TypeScriptPackument)["dist-tags"]?.latest ?? null)
    : (findState(ctx.states, metaUrl)?.version ?? null);
  const states = [
    touchedState(findState(ctx.states, metaUrl), "typescript", metaUrl, metaRes, now, latest),
    touchedState(findState(ctx.states, releaseUrl), "typescript", releaseUrl, releaseRes, now, latest),
    touchedState(findState(ctx.states, feedUrl), "typescript", feedUrl, feedRes, now),
  ];
  if (!metaRes.changed && !releaseRes.changed && !feedRes.changed) {
    return { source: "typescript", entries: [], skipped: true, states };
  }
  const drafts: EntryDraft[] = [];
  if (metaRes.changed && metaRes.body) drafts.push(...parseTypeScriptPackument(parseJson(metaRes.body, "TypeScript metadata")));
  if (releaseRes.changed && releaseRes.body) drafts.push(...parseGithubReleases("typescript", parseJson(releaseRes.body, "TypeScript releases")));
  if (feedRes.changed && feedRes.body) {
    for (const item of parseFeed(feedRes.body)) {
      drafts.push({
        source: "typescript",
        type: "article",
        key: slugKey(item.title),
        title: item.title,
        date: item.date,
        url: item.url,
        summary: item.summary,
        tags: ["typescript"],
        raw: item,
      });
    }
  }
  return { source: "typescript", entries: finish(drafts), skipped: false, states };
}

function finish(drafts: EntryDraft[]): Entry[] {
  return dedupeEntries(drafts.map((draft) => normaliseEntry(draft)));
}
