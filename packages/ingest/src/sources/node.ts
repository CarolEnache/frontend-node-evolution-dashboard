import { versionsEqual, type Entry, type EntryType } from "@evolution/shared-types";
import { dedupeEntries } from "../dedupe";
import { fetchIfChanged, findState, touchedState } from "../fetch-if-changed";
import { type EntryDraft, normaliseEntry, parseJson } from "../normalise";
import { parseFeed, slugKey } from "../rss";
import { SOURCE_URLS, type IngestContext, type IngestResult } from "./types";

export interface NodeDistRelease {
  version: string;
  date: string;
  lts: string | false;
  security?: boolean;
  npm?: string;
  v8?: string;
}

export interface NodeScheduleLine {
  start?: string;
  lts?: string;
  maintenance?: string;
  end?: string;
  codename?: string;
}

export function selectNewNodeReleases(
  releases: NodeDistRelease[],
  previousVersion?: string | null,
  firstRunLimit = 5,
): NodeDistRelease[] {
  if (!previousVersion) return releases.slice(0, firstRunLimit);
  const index = releases.findIndex((release) => versionsEqual(release.version, previousVersion));
  if (index === -1) return releases.slice(0, firstRunLimit);
  return releases.slice(0, index);
}

export function nodeEntryType(release: Pick<NodeDistRelease, "security" | "lts">): EntryType {
  if (release.security) return "security";
  if (release.lts) return "lts";
  return "release";
}

export function parseNodeIndex(
  payload: unknown,
  options?: { previousVersion?: string | null; firstRunLimit?: number },
): EntryDraft[] {
  if (!Array.isArray(payload)) throw new Error("Node.js index must be an array");
  const releases = payload.filter(isNodeRelease);
  return selectNewNodeReleases(releases, options?.previousVersion, options?.firstRunLimit).map((release) => {
    const type = nodeEntryType(release);
    const version = release.version;
    const codename = typeof release.lts === "string" ? release.lts : undefined;
    const tags = ["node"];
    if (release.security) tags.push("security");
    if (codename) tags.push("lts", codename.toLowerCase());
    const summary = [
      `Node.js ${version} was published on ${release.date}.`,
      release.npm ? `npm ${release.npm}.` : "",
      release.v8 ? `V8 ${release.v8}.` : "",
      release.security ? "Security release." : "",
      codename ? `LTS codename ${codename}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
    return {
      source: "node" as const,
      type,
      version,
      title: codename ? `Node.js ${version} (${codename} LTS)` : `Node.js ${version}`,
      date: release.date,
      url: `https://nodejs.org/en/blog/release/${version}`,
      summary,
      tags,
      raw: release,
    };
  });
}

export function currentLts(schedule: unknown, now = new Date()): { version: string; codename: string; lts: string } | null {
  if (!schedule || typeof schedule !== "object") return null;
  let chosen: { version: string; codename: string; lts: string } | null = null;
  for (const [version, value] of Object.entries(schedule as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const line = value as NodeScheduleLine;
    if (!line.lts || !line.codename) continue;
    const ltsStart = Date.parse(line.lts);
    const end = line.end ? Date.parse(line.end) : Number.POSITIVE_INFINITY;
    if (Number.isNaN(ltsStart) || ltsStart > now.getTime() || now.getTime() > end) continue;
    if (!chosen || ltsStart > Date.parse(chosen.lts)) {
      chosen = { version, codename: line.codename, lts: line.lts };
    }
  }
  return chosen;
}

function isNodeRelease(value: unknown): value is NodeDistRelease {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<NodeDistRelease>;
  return typeof record.version === "string" && typeof record.date === "string";
}

export async function ingestNode(ctx: IngestContext): Promise<IngestResult> {
  const nowDate = (ctx.now ?? (() => new Date()))();
  const now = nowDate.toISOString();
  const indexUrl = SOURCE_URLS.nodeIndex;
  const previous = findState(ctx.states, indexUrl);
  const indexRes = await fetchIfChanged(indexUrl, previous, ctx);
  const scheduleUrl = SOURCE_URLS.nodeSchedule;
  const scheduleRes = await fetchIfChanged(scheduleUrl, findState(ctx.states, scheduleUrl), ctx);
  const feedUrl = SOURCE_URLS.nodeRss;
  const feedRes = await fetchIfChanged(feedUrl, findState(ctx.states, feedUrl), ctx);
  const states = [
    touchedState(previous, "node", indexUrl, indexRes, now, previous?.version),
    touchedState(findState(ctx.states, scheduleUrl), "node", scheduleUrl, scheduleRes, now),
    touchedState(findState(ctx.states, feedUrl), "node", feedUrl, feedRes, now),
  ];
  if (!indexRes.changed && !scheduleRes.changed && !feedRes.changed) {
    return { source: "node", entries: [], skipped: true, states };
  }
  const drafts: EntryDraft[] = [];
  if (indexRes.changed && indexRes.body) {
    const payload = parseJson(indexRes.body, "Node.js index") as NodeDistRelease[];
    const newest = Array.isArray(payload) ? payload.find(isNodeRelease) : undefined;
    states[0] = touchedState(previous, "node", indexUrl, indexRes, now, newest?.version ?? previous?.version);
    drafts.push(...parseNodeIndex(payload, { previousVersion: previous?.version }));
  }
  if (scheduleRes.changed && scheduleRes.body) {
    const lts = currentLts(parseJson(scheduleRes.body, "Node.js schedule"), nowDate);
    if (lts) {
      states[1] = { ...states[1]!, version: `${lts.version} ${lts.codename}` };
    }
  }
  if (feedRes.changed && feedRes.body) {
    for (const item of parseFeed(feedRes.body)) {
      const versionMatch = item.title.match(/v?\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.]+)?/);
      drafts.push({
        source: "node",
        type: /security/i.test(item.title) ? "security" : /\blts\b/i.test(item.title) ? "lts" : versionMatch ? "release" : "article",
        ...(versionMatch ? { version: versionMatch[0] } : { key: slugKey(item.title) }),
        title: item.title,
        date: item.date,
        url: item.url,
        summary: item.summary,
        tags: ["node"],
        raw: item,
      });
    }
  }
  return { source: "node", entries: finish(drafts), skipped: false, states };
}

function finish(drafts: EntryDraft[]): Entry[] {
  return dedupeEntries(drafts.map((draft) => normaliseEntry(draft)));
}
