import { decodeHtmlEntities, type Entry } from "@evolution/shared-types";
import { DatabaseConfigError, resolveAppEnv } from "./env";
import { defaultDatabaseUrl, isPostgresUrl } from "./paths";
import type { DashboardDb } from "./types";

/**
 * Numeric and hex references, a named entity, or an `&amp;...;` wrapper.
 * A leftover `&lt;` or `&gt;` is the one-decode form of `&amp;lt;` / `&amp;gt;`
 * and is not selected again, so the backfill stays idempotent.
 */
const BACKFILL_ENTITY =
  /&#(?:\d+|x[0-9a-fA-F]+);|&amp;(?:#(?:\d+|x[0-9a-fA-F]+)|[a-zA-Z][a-zA-Z0-9]+)?;|&(?!amp;|lt;|gt;)[a-zA-Z][a-zA-Z0-9]+;/i;

export interface BackfillResult {
  matched: number;
  updated: number;
  dryRun: boolean;
}

export function assertBackfillAllowed(appEnvRaw: string | null | undefined, allowProduction: boolean): void {
  const appEnv = resolveAppEnv(appEnvRaw);
  if (appEnv === "production" && !allowProduction) {
    throw new DatabaseConfigError(
      "Refusing to backfill HTML entities when APP_ENV=production. Pass --allow-production to override.",
    );
  }
}

/** Postgres URLs are ignored so this command stays on the local SQLite file. */
export function localBackfillDatabaseUrl(databaseUrl: string | null | undefined): string {
  const configured = databaseUrl?.trim();
  if (configured && !isPostgresUrl(configured)) return configured;
  return defaultDatabaseUrl();
}

export function backfillField(text: string): string {
  if (!BACKFILL_ENTITY.test(text)) return text;
  return decodeHtmlEntities(text);
}

export async function backfillHtmlEntities(
  db: DashboardDb,
  options: { dryRun?: boolean } = {},
): Promise<BackfillResult> {
  const dryRun = options.dryRun === true;
  const rows = await db.listEntries({ limit: Math.max(await db.countEntries(), 1) });
  const changed: Entry[] = [];
  for (const entry of rows) {
    const title = backfillField(entry.title);
    const summary = backfillField(entry.summary);
    if (title === entry.title && summary === entry.summary) continue;
    changed.push({ ...entry, title, summary });
  }
  if (!dryRun && changed.length > 0) await db.upsertEntries(changed);
  return { matched: changed.length, updated: dryRun ? 0 : changed.length, dryRun };
}
