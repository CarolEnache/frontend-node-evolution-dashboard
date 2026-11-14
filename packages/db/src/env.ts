import { readAppEnv, NEON_ENVIRONMENTS, type AppEnvironment, type NeonEnvironment } from "@evolution/shared-types";
import { defaultDatabaseUrl, isPostgresUrl } from "./paths";

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

function isCredentialQueryParam(name: string): boolean {
  return name.toLowerCase().endsWith("password");
}

export function redactDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username) parsed.username = "***";
    if (parsed.password) parsed.password = "***";
    for (const key of [...parsed.searchParams.keys()]) {
      if (isCredentialQueryParam(key)) parsed.searchParams.set(key, "***");
    }
    return parsed.toString();
  } catch {
    return "postgresql://***";
  }
}

export function describeDatabaseFailure(appEnv: AppEnvironment, url: string, cause: unknown): string {
  const reason = scrubSecrets(cause instanceof Error ? cause.message : String(cause), url);
  return `Postgres is configured (APP_ENV=${appEnv}, ${redactDatabaseUrl(url)}) but the database is unreachable. ${reason}`;
}

export type PostgresClientErrorKind = "idle" | "checked-out";

/** A client error with no awaiting caller must be logged, not thrown. */
export function describeIdleClientError(
  appEnv: AppEnvironment,
  url: string,
  cause: unknown,
  kind: PostgresClientErrorKind = "idle",
): string {
  const code =
    cause && typeof cause === "object" && "code" in cause && typeof cause.code === "string" ? cause.code : "";
  const reason = scrubSecrets(cause instanceof Error ? cause.message : String(cause), url);
  const coded = code ? ` (${code})` : "";
  const label = kind === "checked-out" ? "Postgres checked-out client error" : "Postgres idle client error";
  return `${label}${coded} (APP_ENV=${appEnv}, ${redactDatabaseUrl(url)}). ${reason}`;
}

const MIN_SECRET_LENGTH = 4;

function scrubSecrets(reason: string, url: string): string {
  let text = url ? reason.split(url).join("[redacted]") : reason;
  try {
    text = scrubCredentialComponents(text, new URL(url));
  } catch {
    // A value that is not a URL has no credential to strip.
  }
  return text;
}

/** Replace a credential only where it is a URL userinfo password or a password query parameter. */
function scrubCredentialComponents(text: string, parsed: URL): string {
  let result = text;
  for (const secret of credentialValues(parsed)) {
    const escaped = escapeRegExp(secret);
    result = result.replaceAll(new RegExp(`(://[^\\s/@]*:)${escaped}(@)`, "g"), "$1[redacted]$2");
    result = result.replaceAll(
      new RegExp(`((?:^|[?&\\s])[A-Za-z0-9_-]*password=)${escaped}(?=&|\\s|$)`, "gi"),
      "$1[redacted]",
    );
  }
  return result;
}

function credentialValues(parsed: URL): string[] {
  const values = [parsed.password];
  for (const [key, value] of parsed.searchParams) {
    if (isCredentialQueryParam(key)) values.push(value);
  }
  const secrets: string[] = [];
  for (const value of values) {
    if (!value || value.length < MIN_SECRET_LENGTH) continue;
    secrets.push(value);
    try {
      const decoded = decodeURIComponent(value);
      if (decoded !== value && decoded.length >= MIN_SECRET_LENGTH) secrets.push(decoded);
    } catch {
      // A credential that is not percent-encoded stays as stored.
    }
  }
  return secrets;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
