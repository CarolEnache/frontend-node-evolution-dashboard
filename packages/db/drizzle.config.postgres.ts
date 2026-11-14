import { defineConfig } from "drizzle-kit";

/**
 * Placeholder only. Generate does not connect.
 * `pnpm db:migrate:postgres` uses DATABASE_URL and fails if it is missing or unreachable.
 */
const databaseUrl =
  process.env.DATABASE_URL?.trim() || "postgresql://USER:PASSWORD@HOST/neondb?sslmode=require";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.postgres.ts",
  out: "./migrations/postgres",
  dbCredentials: {
    url: databaseUrl,
  },
});
