import { defineConfig } from "drizzle-kit";

const configured = process.env.DATABASE_URL?.trim();
const sqliteUrl =
  configured && !configured.startsWith("postgres://") && !configured.startsWith("postgresql://")
    ? configured.replace(/^file:/, "")
    : "../../data/dev.sqlite";

/** Run from packages/db: `pnpm db:generate:sqlite` / `pnpm db:migrate:sqlite`. */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.sqlite.ts",
  out: "./migrations/sqlite",
  dbCredentials: {
    url: sqliteUrl,
  },
});
