import { defaultDatabaseUrl, isPostgresUrl } from "./paths";

/** Neon Postgres environments. Local development stays on SQLite. */
export const NEON_ENVIRONMENTS = ["development", "integration", "staging", "production"] as const;

export type NeonEnvironment = (typeof NEON_ENVIRONMENTS)[number];
export type AppEnvironment = "local" | NeonEnvironment;
export type DatabaseDialect = "sqlite" | "postgres";

const NEON_ENV_SET = new Set<string>(NEON_ENVIRONMENTS);

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
  const raw = value?.trim().toLowerCase() ?? "";
  if (raw === "" || raw === "local") return "local";
  if (NEON_ENV_SET.has(raw)) return raw as NeonEnvironment;
  throw new DatabaseConfigError(
    `Unknown APP_ENV "${value?.trim()}". Expected local, development, integration, staging, or production.`,
  );
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
  const reason = cause instanceof Error ? cause.message : String(cause);
  return `Postgres is configured (APP_ENV=${appEnv}, ${redactDatabaseUrl(url)}) but the database is unreachable. ${reason}`;
}

function present(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
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
    if (isPostgresUrl(configured)) {
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
  if (isPostgresUrl(configured)) {
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
