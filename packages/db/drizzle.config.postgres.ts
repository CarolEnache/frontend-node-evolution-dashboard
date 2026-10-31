import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.postgres.ts",
  out: "./migrations/postgres",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://USER:PASSWORD@HOST/neondb?sslmode=require",
  },
});
