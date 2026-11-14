import { readAppEnv, NEON_ENVIRONMENTS, type AppEnvironment, type NeonEnvironment } from "@evolution/shared-types";
import { databaseScheme, defaultDatabaseUrl, isPostgresUrl } from "./paths";

export { NEON_ENVIRONMENTS, type AppEnvironment, type NeonEnvironment };

export type DatabaseDialect = "sqlite" | "postgres";

export class DatabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseConfigError";
  }
}

export class DatabaseUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DatabaseUnavailableError";
  }
}

export interface DatabaseTarget {
  appEnv: AppEnvironment;
  dialect: DatabaseDialect;
  url: string;
}

export interface ResolveDatabaseInput {
  appEnv?: string | null;
  databaseUrl?: string | null;
  /**
   * True when the caller passed a URL into `createDb()`. That URL picks the
   * driver even if `APP_ENV` names a Neon environment, so tests and one-off
   * worker runs can open a file database explicitly.
   */
  explicitUrl?: boolean;
}

export function resolveAppEnv(value?: string | null): AppEnvironment {
  try {
    return readAppEnv({ APP_ENV: value ?? undefined });
  } catch (error) {
    throw new DatabaseConfigError(error instanceof Error ? error.message : String(error));
  }
}

export function redactDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username) parsed.username = "***";
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return "postgresql://***";
  }
}

export function describeDatabaseFailure(appEnv: AppEnvironment, url: string, cause: unknown): string {
  const reason = scrubSecrets(cause instanceof Error ? cause.message : String(cause), url);
  return `Postgres is configured (APP_ENV=${appEnv}, ${redactDatabaseUrl(url)}) but the database is unreachable. ${reason}`;
}

function scrubSecrets(reason: string, url: string): string {
  let text = url ? reason.split(url).join("[redacted]") : reason;
  try {
    const password = new URL(url).password;
    if (password) text = text.split(decodeURIComponent(password)).join("[redacted]");
  } catch {
    // A value that is not a URL has no credential to strip.
  }
  return text;
}

function present(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function sqliteOrPostgres(url: string): "sqlite" | "postgres" {
  const scheme = databaseScheme(url);
  if (scheme === undefined || scheme === "file") return "sqlite";
  if (scheme === "postgres" || scheme === "postgresql") return "postgres";
  throw new DatabaseConfigError(
    `DATABASE_URL uses the unsupported scheme "${scheme}". Expected a SQLite file (file:… or a filesystem path) or a postgres:// or postgresql:// URL.`,
  );
}

function assertPostgresUrl(url: string, appEnv: AppEnvironment): void {
  if (!isPostgresUrl(url)) {
    throw new DatabaseConfigError(
      `APP_ENV=${appEnv} uses Neon Postgres, but DATABASE_URL must start with postgres:// or postgresql://.`,
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new DatabaseConfigError(`APP_ENV=${appEnv} uses Neon Postgres, but DATABASE_URL is not a valid URL.`);
  }
  if (!parsed.hostname) {
    throw new DatabaseConfigError(`APP_ENV=${appEnv} uses Neon Postgres, but DATABASE_URL has no host.`);
  }
}

export function resolveDatabaseTarget(input?: ResolveDatabaseInput): DatabaseTarget {
  const appEnv = resolveAppEnv(input && "appEnv" in input ? input.appEnv : process.env.APP_ENV);
  const configured = present(input && "databaseUrl" in input ? input.databaseUrl : process.env.DATABASE_URL);

  if (input?.explicitUrl && configured) {
    if (sqliteOrPostgres(configured) === "postgres") {
      assertPostgresUrl(configured, appEnv);
      return { appEnv, dialect: "postgres", url: configured };
    }
    return { appEnv, dialect: "sqlite", url: configured };
  }

  if (appEnv !== "local") {
    if (!configured) {
      throw new DatabaseConfigError(
        `APP_ENV=${appEnv} uses Neon Postgres, but DATABASE_URL is missing. Set DATABASE_URL to the ${appEnv} Neon connection string (postgresql://USER:PASSWORD@HOST/neondb?sslmode=require).`,
      );
    }
    assertPostgresUrl(configured, appEnv);
    return { appEnv, dialect: "postgres", url: configured };
  }

  if (!configured) return { appEnv: "local", dialect: "sqlite", url: defaultDatabaseUrl() };
  if (sqliteOrPostgres(configured) === "postgres") {
    assertPostgresUrl(configured, appEnv);
    return { appEnv: "local", dialect: "postgres", url: configured };
  }
  return { appEnv: "local", dialect: "sqlite", url: configured };
}

export function resolveDatabaseUrl(input?: string): string {
  const explicit = input !== undefined && input.trim() !== "";
  return resolveDatabaseTarget({
    appEnv: process.env.APP_ENV,
    databaseUrl: explicit ? input : process.env.DATABASE_URL,
    explicitUrl: explicit,
  }).url;
}
