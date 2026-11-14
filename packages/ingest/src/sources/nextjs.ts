import type { Entry } from "@evolution/shared-types";
import { dedupeEntries } from "../dedupe";
import { fetchIfChanged, findState, readFetchedJson, touchedState } from "../fetch-if-changed";
import { asReleaseList, parseGithubReleases } from "../github";
import { type EntryDraft, normaliseEntry } from "../normalise";
import { parseFeed, slugKey } from "../rss";
import { SOURCE_URLS, type IngestContext, type IngestResult } from "./types";

export async function ingestNext(ctx: IngestContext): Promise<IngestResult> {
  const now = (ctx.now ?? (() => new Date()))().toISOString();
  const latestUrl = SOURCE_URLS.nextLatest;
  const listUrl = SOURCE_URLS.nextReleases;
  const feedUrl = SOURCE_URLS.nextFeed;
  const latestRes = await fetchIfChanged(latestUrl, findState(ctx.states, latestUrl), ctx);
  const listRes = await fetchIfChanged(listUrl, findState(ctx.states, listUrl), ctx);
  const feedRes = await fetchIfChanged(feedUrl, findState(ctx.states, feedUrl), ctx);
  const latestVersion = latestRes.changed && latestRes.body
    ? (asReleaseList(readFetchedJson("nextjs", latestUrl, latestRes.body, "Next.js latest", now))[0]?.tag_name ?? null)
    : (findState(ctx.states, latestUrl)?.version ?? null);
  const states = [
    touchedState(findState(ctx.states, latestUrl), "nextjs", latestUrl, latestRes, now, latestVersion),
    touchedState(findState(ctx.states, listUrl), "nextjs", listUrl, listRes, now, latestVersion),
    touchedState(findState(ctx.states, feedUrl), "nextjs", feedUrl, feedRes, now),
  ];
  if (!latestRes.changed && !listRes.changed && !feedRes.changed) {
    return { source: "nextjs", entries: [], skipped: true, states };
  }
  const drafts: EntryDraft[] = [];
  if (latestRes.changed && latestRes.body) {
    drafts.push(...parseGithubReleases("nextjs", readFetchedJson("nextjs", latestUrl, latestRes.body, "Next.js latest", now)));
  }
  if (listRes.changed && listRes.body) {
    drafts.push(...parseGithubReleases("nextjs", readFetchedJson("nextjs", listUrl, listRes.body, "Next.js releases", now)));
  }
  if (feedRes.changed && feedRes.body) {
    for (const item of parseFeed(feedRes.body)) {
      drafts.push({
        source: "nextjs",
        type: "article",
        key: slugKey(item.title),
        title: item.title,
        date: item.date,
        url: item.url,
        summary: item.summary,
        tags: ["nextjs"],
        raw: item,
      });
    }
  }
  return { source: "nextjs", entries: finish(drafts), skipped: false, states };
}

function finish(drafts: EntryDraft[]): Entry[] {
  return dedupeEntries(drafts.map((draft) => normaliseEntry(draft)));
}
