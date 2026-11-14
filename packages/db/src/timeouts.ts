import type { PoolConfig } from "pg";

/**
 * Neon compute can take a few seconds to wake, so the connection timeout is
 * long enough for a cold start and short enough to fail a dead host quickly.
 * Query and statement timeouts stop a request from waiting on a stuck query.
 */
export const POSTGRES_TIMEOUTS = {
  connectionTimeoutMillis: 15_000,
  idleTimeoutMillis: 30_000,
  queryTimeoutMillis: 20_000,
  statementTimeoutMillis: 20_000,
  idleInTransactionTimeoutMillis: 20_000,
  max: 5,
} as const;

export function postgresPoolConfig(databaseUrl: string): PoolConfig {
  const config: PoolConfig = {
    connectionString: databaseUrl,
    application_name: "evolution-dashboard",
    connectionTimeoutMillis: POSTGRES_TIMEOUTS.connectionTimeoutMillis,
    idleTimeoutMillis: POSTGRES_TIMEOUTS.idleTimeoutMillis,
    query_timeout: POSTGRES_TIMEOUTS.queryTimeoutMillis,
    statement_timeout: POSTGRES_TIMEOUTS.statementTimeoutMillis,
    idle_in_transaction_session_timeout: POSTGRES_TIMEOUTS.idleInTransactionTimeoutMillis,
    max: POSTGRES_TIMEOUTS.max,
    allowExitOnIdle: true,
  };
  if (prefersSsl(databaseUrl)) config.ssl = { rejectUnauthorized: true };
  return config;
}

function prefersSsl(databaseUrl: string): boolean {
  try {
    const parsed = new URL(databaseUrl);
    const mode = parsed.searchParams.get("sslmode");
    if (mode === "require" || mode === "verify-full" || mode === "verify-ca") return true;
    return parsed.hostname.endsWith(".neon.tech");
  } catch {
    return false;
  }
}
