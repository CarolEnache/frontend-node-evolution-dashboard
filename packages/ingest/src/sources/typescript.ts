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

export function readTypeScriptPackument(payload: unknown): TypeScriptPackument {
  if (!payload || typeof payload !== "object") {
    throw new Error("TypeScript metadata must be an object");
  }
  return payload as TypeScriptPackument;
}

function stringTag(tags: TypeScriptPackument["dist-tags"], name: string): string | undefined {
  const value = tags?.[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function parseTypeScriptPackument(payload: unknown): EntryDraft[] {
  const doc = readTypeScriptPackument(payload);
  const tags = doc["dist-tags"];
  const tracked: Array<["latest" | "beta" | "rc", string | undefined]> = [
    ["latest", stringTag(tags, "latest")],
    ["beta", stringTag(tags, "beta")],
    ["rc", stringTag(tags, "rc")],
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
  const packument = metaRes.changed && metaRes.body
    ? readTypeScriptPackument(parseJson(metaRes.body, "TypeScript metadata"))
    : undefined;
  const latest = packument
    ? (stringTag(packument["dist-tags"], "latest") ?? null)
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
  if (packument) drafts.push(...parseTypeScriptPackument(packument));
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
