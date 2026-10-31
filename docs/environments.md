# Environments

Four environments, none of them provisioned by this repository. Copy the matching `.env.*.example` file. Do not commit filled-in copies.

| Environment | Where the app runs | Database | Vercel | Git branch |
| --- | --- | --- | --- | --- |
| development | `pnpm dev` on port 43123 | SQLite at `data/dev.sqlite` when `DATABASE_URL` is unset | Not deployed | local |
| integration | Vercel preview, custom environment **Integration** | Neon branch `integration` | Preview | `integration` |
| staging | Vercel preview, custom environment **Staging** | Neon branch `staging` | Preview | `staging` |
| production | Vercel production | Neon branch `production` (or the project's default branch) | Production | `main` |

## Vercel

Set the project's Root Directory to `apps/web`. `apps/web/vercel.json` installs and builds from the workspace root so pnpm can see every package. Turbopack is the Next.js 16 default for `next dev` and `next build`. Do not pass `--webpack`.

Suggested custom environments:

- Integration: attach the `integration` branch, set `APP_ENV=integration`, and point `DATABASE_URL` at the Neon integration branch.
- Staging: same pattern for `staging`.
- Production: the production environment, branch `main`.

`VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, and `VERCEL_TOKEN` stay empty until you create the project yourself. This repo does not call the Vercel API.

Preview URLs in the examples (`evolution-integration.vercel.app`, `evolution-staging.vercel.app`) are placeholders, not live deployments.

## Neon

Non-local Postgres is Neon Free: one project, four branches (`development`, `integration`, `staging`, `production`). Local development keeps using SQLite. Create the project and the branches yourself. Placeholder shape:

```text
NEON_PROJECT_ID=proj_placeholder
NEON_BRANCH=integration
DATABASE_URL=postgresql://USER:PASSWORD@ep-integration.region.aws.neon.tech/neondb?sslmode=require
```

Use one branch per environment. Drizzle schemas for both dialects live in `packages/db` (`schema.sqlite.ts`, `schema.postgres.ts`, plus `drizzle.config.*.ts`). The checked-in migration `packages/db/migrations/0001_init.sql` is applied by `pnpm db:migrate` to whichever database `DATABASE_URL` selects. SQLite is migrated automatically the first time `createDb()` opens a file. Postgres is not auto-migrated on app boot; run `pnpm db:migrate` against that URL before the app serves traffic.

`pgvector` is not enabled. Embeddings are stored as JSON text so the same migration runs on both engines.

## GitHub Actions

`.github/workflows/preview-*.yml` and the database-branch steps exit without calling Vercel or Neon when the secrets are absent. They also do not deploy when the secrets are present: the commands are documented stubs. `.github/workflows/ingest.yml` will run `pnpm ingest` only after `DATABASE_URL` is configured. `.github/workflows/ci.yml` is the lint, typecheck, unit, build, and Playwright pipeline.
