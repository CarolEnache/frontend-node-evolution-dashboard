import type { Entry } from "@evolution/shared-types";
import { dedupeEntries } from "../dedupe";
import { fetchIfChanged, findState, touchedState } from "../fetch-if-changed";
import { asReleaseList, parseGithubReleases } from "../github";
import { type EntryDraft, normaliseEntry, parseJson } from "../normalise";
import { parseFeed, slugKey } from "../rss";
import { SOURCE_URLS, type IngestContext, type IngestResult } from "./types";

/** First run only. Later runs keep everything published after the stored cursor. */
const RECENT_LIMIT = 5;

function publishedTime(date: string): number {
  const time = Date.parse(date);
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

function cursorTime(cursor: string | null | undefined): number | null {
  if (!cursor || !/^\d{4}-\d{2}-\d{2}/.test(cursor)) return null;
  const time = Date.parse(cursor);
  return Number.isNaN(time) ? null : time;
}

function newestCursor(dates: string[]): string | null {
  let max = Number.NEGATIVE_INFINITY;
  for (const date of dates) {
    const time = publishedTime(date);
    if (time > max) max = time;
  }
  return Number.isFinite(max) ? new Date(max).toISOString() : null;
}

function takeRecent<T extends { date: string; version?: string; key?: string; title: string }>(
  items: T[],
  cursor: string | null | undefined,
  limit: number,
): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const item of items) {
    const key = item.version ?? item.key ?? item.title;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  const since = cursorTime(cursor);
  if (since === null) return unique.slice(0, limit);
  return unique.filter((item) => publishedTime(item.date) > since);
}

export async function ingestNext(ctx: IngestContext): Promise<IngestResult> {
  const now = (ctx.now ?? (() => new Date()))().toISOString();
  const latestUrl = SOURCE_URLS.nextLatest;
  const listUrl = SOURCE_URLS.nextReleases;
  const feedUrl = SOURCE_URLS.nextFeed;
  const listPrevious = findState(ctx.states, listUrl);
  const feedPrevious = findState(ctx.states, feedUrl);
  const latestRes = await fetchIfChanged(latestUrl, findState(ctx.states, latestUrl), ctx);
  const listRes = await fetchIfChanged(listUrl, listPrevious, ctx);
  const feedRes = await fetchIfChanged(feedUrl, feedPrevious, ctx);
  const latestVersion = latestRes.changed && latestRes.body
    ? (asReleaseList(parseJson(latestRes.body, "Next.js latest"))[0]?.tag_name ?? null)
    : (findState(ctx.states, latestUrl)?.version ?? null);
  const states = [
    touchedState(findState(ctx.states, latestUrl), "nextjs", latestUrl, latestRes, now, latestVersion),
    touchedState(listPrevious, "nextjs", listUrl, listRes, now, listPrevious?.version),
    touchedState(feedPrevious, "nextjs", feedUrl, feedRes, now, feedPrevious?.version),
  ];
  if (!latestRes.changed && !listRes.changed && !feedRes.changed) {
    return { source: "nextjs", entries: [], skipped: true, states };
  }
  const drafts: EntryDraft[] = [];
  const releases: EntryDraft[] = [];
  if (latestRes.changed && latestRes.body) releases.push(...parseGithubReleases("nextjs", parseJson(latestRes.body, "Next.js latest")));
  if (listRes.changed && listRes.body) releases.push(...parseGithubReleases("nextjs", parseJson(listRes.body, "Next.js releases")));
  if (releases.length > 0) {
    const selected = takeRecent(releases, listPrevious?.version, RECENT_LIMIT);
    const cursor = newestCursor(selected.map((release) => release.date)) ?? listPrevious?.version ?? null;
    states[1] = touchedState(listPrevious, "nextjs", listUrl, listRes, now, cursor);
    drafts.push(...selected);
  }
  if (feedRes.changed && feedRes.body) {
    const posts = takeRecent(parseFeed(feedRes.body), feedPrevious?.version, RECENT_LIMIT);
    const cursor = newestCursor(posts.map((post) => post.date)) ?? feedPrevious?.version ?? null;
    states[2] = touchedState(feedPrevious, "nextjs", feedUrl, feedRes, now, cursor);
    for (const item of posts) {
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
