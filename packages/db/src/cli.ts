import { createDb } from "./index";
import { DatabaseConfigError, resolveAppEnv } from "./env";
import { defaultDatabaseUrl, isPostgresUrl } from "./paths";
import { createPostgresDb } from "./postgres";
import { createSqliteDb } from "./sqlite";
import type { DashboardDb } from "./types";

const args = process.argv.slice(2);
const command = args.find((arg) => !arg.startsWith("--"));

try {
  const db = await openDatabase(readDialect(args));
  try {
    if (command === "migrate") {
      await db.migrate();
      console.log(`Migrations applied (${db.dialect}).`);
    } else if (command === "seed") {
      await db.migrate();
      await db.seed();
      const count = await db.countEntries();
      console.log(`Seeded ${count} entries (${db.dialect}).`);
    } else if (command === "sync-seed") {
      await db.migrate();
      const { syncSeedContent } = await import("./sync-seed");
      const result = await syncSeedContent(db);
      const count = await db.countEntries();
      console.log(
        `Synced seed content (${db.dialect}): inserted ${result.inserted}, updated ${result.updated}, unchanged ${result.unchanged}, ${count} entries total.`,
      );
    } else {
      console.error("Usage: cli.ts <migrate|seed|sync-seed> [--dialect sqlite|postgres]");
      process.exitCode = 1;
    }
  } finally {
    await db.close();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function readDialect(argv: string[]): "sqlite" | "postgres" | undefined {
  const index = argv.indexOf("--dialect");
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value !== "sqlite" && value !== "postgres") {
    throw new DatabaseConfigError("Expected --dialect sqlite or --dialect postgres.");
  }
  return value;
}

async function openDatabase(dialect: "sqlite" | "postgres" | undefined): Promise<DashboardDb> {
  if (dialect === "sqlite") return createSqliteDb(sqliteUrl());
  if (dialect === "postgres") return createPostgresDb(requirePostgresUrl(), { appEnv: resolveAppEnv(process.env.APP_ENV) });
  return createDb();
}

function sqliteUrl(): string {
  const configured = process.env.DATABASE_URL?.trim();
  if (configured && !isPostgresUrl(configured)) return configured;
  return defaultDatabaseUrl();
}

function requirePostgresUrl(): string {
  const configured = process.env.DATABASE_URL?.trim() ?? "";
  if (!configured) {
    throw new DatabaseConfigError(
      "Postgres migrations need DATABASE_URL. Set it to the Neon connection string for this environment (postgresql://USER:PASSWORD@HOST/neondb?sslmode=require).",
    );
  }
  if (!isPostgresUrl(configured)) {
    throw new DatabaseConfigError("DATABASE_URL must start with postgres:// or postgresql:// to run Postgres migrations.");
  }
  return configured;
}
