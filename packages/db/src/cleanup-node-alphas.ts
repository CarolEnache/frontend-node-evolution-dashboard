import type { Entry } from "@evolution/shared-types";
import type { AppEnvironment } from "./env";
import type { DashboardDb } from "./types";

const ORPHAN_ID = /^node:(release|lts|security):(\d+\.\d+\.\d+-alpha(?:\.\d+)+)$/;

export interface NodeAlphaCleanupChange {
  from: string;
  into: string;
  action: "merge" | "rename";
}

export interface NodeAlphaCleanupResult {
  dryRun: boolean;
  changes: NodeAlphaCleanupChange[];
}

/** Neon hosts and the hosted app environments are off limits for this cleanup. */
export function assertNotNeonDatabase(databaseUrl: string, appEnv: AppEnvironment = "local"): void {
  if (appEnv !== "local" || /neon\.tech|neon\.database|aws\.neon/i.test(databaseUrl)) {
    throw new Error("Refusing to clean a Neon database.");
  }
}

export function canonicalAlphaTarget(id: string): { id: string; version: string } | null {
  const match = ORPHAN_ID.exec(id);
  if (!match?.[1] || !match[2]) return null;
  const version = match[2].replace(/-alpha(?:\.\d+)+$/i, "-alpha");
  return { id: `node:${match[1]}:${version}`, version };
}

function fillEnrichment(target: Entry, extra: Entry): Entry {
  return {
    ...target,
    similarity: target.similarity ?? extra.similarity,
    gap: target.gap ?? extra.gap,
    worthLearning: target.worthLearning ?? extra.worthLearning,
    tags: [...new Set([...target.tags, ...extra.tags])].sort(),
  };
}

function renamedTitle(entry: Entry, version: string): string {
  if (entry.version && entry.title.includes(entry.version)) {
    return entry.title.replace(entry.version, version);
  }
  return `Node.js ${version}`;
}

/**
 * Collapse `node:*:27.0.0-alpha.0.0.0` style rows into `27.0.0-alpha`.
 * Dry-run unless `apply` is true. Enrichment on the surviving row is kept,
 * and empty fields are filled from the orphan.
 */
export async function cleanupNodeAlphaEntries(
  db: DashboardDb,
  options: { apply?: boolean } = {},
): Promise<NodeAlphaCleanupResult> {
  const apply = options.apply === true;
  const rows = await db.listEntries({ source: "node", limit: 10_000 });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const groups = new Map<string, { target: { id: string; version: string }; orphans: Entry[] }>();
  for (const row of rows) {
    const target = canonicalAlphaTarget(row.id);
    if (!target) continue;
    const group = groups.get(target.id) ?? { target, orphans: [] };
    group.orphans.push(row);
    groups.set(target.id, group);
  }

  const changes: NodeAlphaCleanupChange[] = [];
  const upserts: Entry[] = [];
  const deletes: string[] = [];
  for (const group of groups.values()) {
    const canonical = byId.get(group.target.id);
    if (canonical) {
      let merged = canonical;
      for (const orphan of group.orphans) {
        merged = fillEnrichment(merged, orphan);
        changes.push({ from: orphan.id, into: canonical.id, action: "merge" });
        deletes.push(orphan.id);
      }
      upserts.push(merged);
      continue;
    }
    const [newest, ...rest] = [...group.orphans].sort((left, right) => (left.date < right.date ? 1 : -1));
    if (!newest) continue;
    let survivor: Entry = {
      ...newest,
      id: group.target.id,
      version: group.target.version,
      title: renamedTitle(newest, group.target.version),
    };
    for (const orphan of rest) survivor = fillEnrichment(survivor, orphan);
    for (const orphan of group.orphans) {
      changes.push({ from: orphan.id, into: group.target.id, action: "rename" });
      deletes.push(orphan.id);
    }
    upserts.push(survivor);
  }

  if (apply && (upserts.length > 0 || deletes.length > 0)) {
    if (upserts.length > 0) await db.upsertEntries(upserts);
    if (deletes.length > 0) await db.deleteEntries(deletes);
  }
  return { dryRun: !apply, changes };
}
