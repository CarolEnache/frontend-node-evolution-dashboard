import { compareSemver, stripVersionPrefix, type Entry } from "@evolution/shared-types";
import { dedupeEntries } from "../dedupe";
import { fetchIfChanged, findState, touchedState } from "../fetch-if-changed";
import { asReleaseList } from "../github";
import { type EntryDraft, normaliseEntry, parseJson } from "../normalise";
import { SOURCE_URLS, type IngestContext, type IngestResult } from "./types";

interface CompatStatus {
  experimental?: boolean;
  standard_track?: boolean;
  deprecated?: boolean;
}

interface CompatRecord {
  path: string;
  versionAdded: Record<string, string | boolean | null>;
  status?: CompatStatus;
}

interface SupportStatement {
  version_added?: string | boolean | null;
}

export function sectionItems(body: string, heading: string): string[] {
  const match = new RegExp(`^#{1,3}\\s+${heading}\\s*$`, "im").exec(body);
  if (!match) return [];
  const rest = body.slice(match.index + match[0].length);
  const next = rest.search(/^#{1,3}\s+/m);
  const block = next === -1 ? rest : rest.slice(0, next);
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => cleanFeatureKey(line.replace(/^- /, "")))
    .filter(Boolean);
}

/** Release notes append ` ([#30922](pull-url))` to a feature key. Keep the key only. */
export function cleanFeatureKey(item: string): string {
  const withoutCode = item.replace(/`/g, "");
  const withoutLinks = withoutCode
    .replace(/\s*\(\s*\[[^\]]+\]\([^)]*\)\s*\)/g, "")
    .replace(/\[[^\]]+\]\([^)]*\)/g, " ");
  const text = withoutLinks.replace(/\s*\(#\d+\)/g, "").trim();
  const match = /^([A-Za-z0-9_.-]+)/.exec(text);
  return match?.[1] ?? text;
}

export function parseMdnReleaseNotes(
  body: string,
  meta: { version: string; date: string; url: string },
): EntryDraft[] {
  return sectionItems(body, "Additions").map((item) => ({
    source: "mdn-bcd" as const,
    type: "feature" as const,
    key: item,
    title: item,
    version: meta.version,
    date: meta.date,
    url: meta.url,
    summary: `Listed under Additions in browser-compat-data ${meta.version}.`,
    tags: ["mdn", "baseline"],
    raw: { addition: item, version: meta.version },
  }));
}

export function collectCompat(node: unknown, path: string[] = [], out: CompatRecord[] = []): CompatRecord[] {
  if (!node || typeof node !== "object") return out;
  const record = node as Record<string, unknown>;
  if (record.__compat && typeof record.__compat === "object") {
    const compat = record.__compat as {
      support?: Record<string, SupportStatement | SupportStatement[]>;
      status?: CompatStatus;
    };
    const versionAdded: Record<string, string | boolean | null> = {};
    for (const [browser, support] of Object.entries(compat.support ?? {})) {
      const statement = Array.isArray(support) ? support[0] : support;
      versionAdded[browser] = statement?.version_added ?? null;
    }
    out.push({ path: path.join("."), versionAdded, status: compat.status });
  }
  for (const [key, value] of Object.entries(record)) {
    if (key.startsWith("__") || !value || typeof value !== "object") continue;
    collectCompat(value, [...path, key], out);
  }
  return out;
}

export function diffBcd(
  previous: unknown,
  next: unknown,
  meta: { version: string; date: string; url: string },
): EntryDraft[] {
  const before = new Map(collectCompat(previous).map((record) => [record.path, record]));
  const drafts: EntryDraft[] = [];
  for (const record of collectCompat(next)) {
    const prior = before.get(record.path);
    if (!prior) {
      drafts.push({
        source: "mdn-bcd",
        type: "feature",
        key: record.path,
        title: record.path,
        version: meta.version,
        date: meta.date,
        url: meta.url,
        summary: `New compat record ${record.path} in browser-compat-data ${meta.version}.`,
        tags: ["mdn", "baseline"],
        raw: record,
      });
      continue;
    }
    for (const [browser, added] of Object.entries(record.versionAdded)) {
      const previousAdded = prior.versionAdded[browser];
      const shipped =
        (previousAdded === false || previousAdded == null) && typeof added === "string" && added.length > 0;
      if (!shipped) continue;
      drafts.push({
        source: "mdn-bcd",
        type: "support-change",
        key: `${record.path}:${browser}:${added}`,
        title: `${record.path} shipped in ${browser} ${added}`,
        version: meta.version,
        date: meta.date,
        url: meta.url,
        summary: `${record.path} changed from unsupported to ${browser} ${added} in browser-compat-data ${meta.version}.`,
        tags: ["mdn", "baseline", browser],
        raw: { path: record.path, browser, versionAdded: added },
      });
    }
  }
  return drafts;
}

async function notesSince(
  previous: string,
  current: string,
  date: string,
  url: string,
  ctx: IngestContext,
): Promise<{ drafts: EntryDraft[]; notedPaths: Set<string> } | null> {
  const listRes = await fetchIfChanged(SOURCE_URLS.mdnReleases, undefined, ctx);
  if (!listRes.changed || !listRes.body) return null;
  const inRange = asReleaseList(parseJson(listRes.body, "MDN releases")).filter((release) => {
    if (!release.tag_name) return false;
    const version = stripVersionPrefix(release.tag_name);
    return compareSemver(version, previous) > 0 && compareSemver(version, current) <= 0;
  });
  if (inRange.length === 0) return null;
  const drafts: EntryDraft[] = [];
  for (const release of inRange) {
    if (!release.body) continue;
    drafts.push(
      ...parseMdnReleaseNotes(release.body, {
        version: current,
        date: release.published_at ?? date,
        url: release.html_url ?? url,
      }),
    );
  }
  return { drafts, notedPaths: new Set(drafts.map((draft) => draft.key ?? "").filter(Boolean)) };
}

export async function ingestMdn(ctx: IngestContext): Promise<IngestResult> {
  const now = (ctx.now ?? (() => new Date()))().toISOString();
  const metaUrl = SOURCE_URLS.mdnMeta;
  const previous = findState(ctx.states, metaUrl);
  const metaRes = await fetchIfChanged(metaUrl, previous, ctx);
  if (!metaRes.changed || !metaRes.body) {
    return skipped("mdn-bcd", [touchedState(previous, "mdn-bcd", metaUrl, metaRes, now, previous?.version)]);
  }
  const meta = parseJson(metaRes.body, "MDN metadata") as { version?: string };
  if (!meta.version) throw new Error("MDN metadata is missing a version");
  const metaState = touchedState(previous, "mdn-bcd", metaUrl, metaRes, now, meta.version);
  if (previous?.version && previous.version === meta.version) {
    return skipped("mdn-bcd", [metaState]);
  }

  const releaseUrl = SOURCE_URLS.mdnRelease;
  const releaseRes = await fetchIfChanged(releaseUrl, findState(ctx.states, releaseUrl), ctx);
  const dataUrl = SOURCE_URLS.mdnData(meta.version);
  const dataRes = await fetchIfChanged(dataUrl, undefined, ctx);
  let releaseDate = now;
  let releasePage = `https://github.com/mdn/browser-compat-data/releases`;
  const drafts: EntryDraft[] = [];
  let notedPaths: Set<string> | null = null;
  if (releaseRes.changed && releaseRes.body) {
    const release = asReleaseList(parseJson(releaseRes.body, "MDN release"))[0];
    releaseDate = release?.published_at ?? now;
    releasePage = release?.html_url ?? releasePage;
  }
  const skippedNotes = previous?.version
    ? await notesSince(previous.version, meta.version, releaseDate, releasePage, ctx)
    : null;
  if (skippedNotes) {
    notedPaths = skippedNotes.notedPaths;
    drafts.push(...skippedNotes.drafts);
  } else if (releaseRes.changed && releaseRes.body) {
    const release = asReleaseList(parseJson(releaseRes.body, "MDN release"))[0];
    if (release?.body) {
      const notes = parseMdnReleaseNotes(release.body, { version: meta.version, date: releaseDate, url: releasePage });
      notedPaths = new Set(notes.map((note) => note.key ?? "").filter(Boolean));
      drafts.push(...notes);
    }
  }
  if (previous?.version && dataRes.body) {
    const previousData = await fetchIfChanged(SOURCE_URLS.mdnData(previous.version), undefined, ctx);
    if (previousData.body) {
      const changes = diffBcd(parseJson(previousData.body, "previous BCD"), parseJson(dataRes.body, "BCD"), {
        version: meta.version,
        date: releaseDate,
        url: releasePage,
      });
      drafts.push(
        ...changes.filter((draft) => draft.type !== "support-change" || notedPaths === null || notedPaths.has(supportPath(draft))),
      );
    }
  }
  drafts.push({
    source: "mdn-bcd",
    type: "release",
    version: meta.version,
    title: `browser-compat-data ${meta.version}`,
    date: releaseDate,
    url: releasePage,
    summary: `MDN browser-compat-data updated to ${meta.version}.`,
    tags: ["mdn", "baseline"],
    raw: { version: meta.version },
  });
  return {
    source: "mdn-bcd",
    entries: finish(drafts),
    skipped: false,
    states: [
      metaState,
      touchedState(findState(ctx.states, releaseUrl), "mdn-bcd", releaseUrl, releaseRes, now, meta.version),
      touchedState(undefined, "mdn-bcd", dataUrl, dataRes, now, meta.version),
    ],
  };
}

function supportPath(draft: EntryDraft): string {
  const raw = draft.raw;
  if (raw && typeof raw === "object" && "path" in raw && typeof raw.path === "string") return raw.path;
  return "";
}

function finish(drafts: EntryDraft[]): Entry[] {
  return dedupeEntries(drafts.map((draft) => normaliseEntry(draft)));
}

function skipped(source: IngestResult["source"], states: IngestResult["states"]): IngestResult {
  return { source, entries: [], skipped: true, states };
}
