import { stripVersionPrefix, type EntryType, type Source } from "@evolution/shared-types";
import type { EntryDraft } from "./normalise";

export interface GithubReleaseJson {
  tag_name?: string;
  name?: string | null;
  body?: string | null;
  published_at?: string | null;
  html_url?: string;
  prerelease?: boolean;
  draft?: boolean;
}

export function asReleaseList(payload: unknown): GithubReleaseJson[] {
  const list = Array.isArray(payload) ? payload : [payload];
  return list.filter((item): item is GithubReleaseJson => Boolean(item) && typeof item === "object");
}

export function parseGithubReleases(
  source: Extract<Source, "typescript" | "nextjs" | "node" | "mdn-bcd">,
  payload: unknown,
): EntryDraft[] {
  const drafts: EntryDraft[] = [];
  for (const release of asReleaseList(payload)) {
    if (release.draft || !release.tag_name) continue;
    const tag = release.tag_name;
    if (source === "nextjs" && (release.prerelease || /canary/i.test(tag))) continue;
    if (source === "typescript" && /-dev\./.test(tag)) continue;
    if (source === "typescript" && release.prerelease && !/beta|rc/i.test(tag)) continue;
    const version = stripVersionPrefix(tag);
    const type = releaseType(source, release, version);
    const title = release.name?.trim() || `${label(source)} ${version}`;
    drafts.push({
      source,
      type,
      version,
      title,
      date: release.published_at ?? new Date(0).toISOString(),
      url: release.html_url ?? `https://github.com/${repo(source)}/releases/tag/${tag}`,
      summary: release.body?.trim() || `${label(source)} ${version} was published.`,
      tags: releaseTags(source, type, version),
      raw: { tag, prerelease: Boolean(release.prerelease) },
    });
  }
  return drafts;
}

function releaseType(source: Source, release: GithubReleaseJson, version: string): EntryType {
  const blob = `${release.name ?? ""} ${release.tag_name ?? ""} ${release.body ?? ""}`;
  if (/security/i.test(blob)) return "security";
  if (source === "node" && /\blts\b/i.test(blob)) return "lts";
  if (/beta|rc/i.test(version)) return "release";
  return "release";
}

function releaseTags(source: Source, type: EntryType, version: string): string[] {
  const tags = [source === "mdn-bcd" ? "mdn" : source === "node" ? "node" : source];
  if (type === "security") tags.push("security");
  if (type === "lts") tags.push("lts");
  if (/beta/i.test(version)) tags.push("beta");
  else if (/rc/i.test(version)) tags.push("rc");
  else if (type === "release") tags.push("stable");
  return tags;
}

function label(source: Source): string {
  if (source === "nextjs") return "Next.js";
  if (source === "typescript") return "TypeScript";
  if (source === "node") return "Node.js";
  return "browser-compat-data";
}

function repo(source: Source): string {
  if (source === "nextjs") return "vercel/next.js";
  if (source === "typescript") return "microsoft/TypeScript";
  if (source === "node") return "nodejs/node";
  return "mdn/browser-compat-data";
}
