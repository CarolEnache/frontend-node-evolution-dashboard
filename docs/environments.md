# Environments

Nothing here is provisioned by this repository. Copy the matching example file and fill it in yourself. Do not commit filled-in copies or real connection strings.

Local development is SQLite and needs no database URL. The four Neon environments are `development`, `integration`, `staging`, and `production`.

| Environment | `APP_ENV` | Database | Where it runs |
| --- | --- | --- | --- |
| local | unset or `local` | SQLite at `data/dev.sqlite` | `pnpm dev` on port 43123 |
| development | `development` | Neon branch `development` | your Neon development branch |
| integration | `integration` | Neon branch `integration` | Vercel preview, custom environment **Integration**, git branch `integration` |
| staging | `staging` | Neon branch `staging` | Vercel preview, custom environment **Staging**, git branch `staging` |
| production | `production` | Neon branch `production` | Vercel production, git branch `main` |

## Vercel

Set the project's Root Directory to `apps/web`. `apps/web/vercel.json` installs and builds from the workspace root so pnpm can see every package. Turbopack is the Next.js 16 default for `next dev` and `next build`. Do not pass `--webpack`.

Suggested custom environments:

- Integration: attach the `integration` branch, set `APP_ENV=integration`, and point `DATABASE_URL` at the Neon integration branch.
- Staging: same pattern for `staging`.
- Production: the production environment, branch `main`.

`VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, and `VERCEL_TOKEN` stay empty until you create the project yourself. This repo does not call the Vercel API.

Preview URLs in the examples (`evolution-integration.vercel.app`, `evolution-staging.vercel.app`) are placeholders, not live deployments.

## Local SQLite

Leave `APP_ENV` unset or set `APP_ENV=local`, and leave `DATABASE_URL` empty. `createDb()` opens `data/dev.sqlite` (created on first use, from the repo root, not the process cwd) and applies the SQLite migrations. `pnpm db:setup` migrates and seeds that file. An explicit SQLite URL (`file:…` or `:memory:`) also selects SQLite.

## Neon Postgres

Create one Neon project yourself and a branch for each of the four environments. This repo does not call the Neon API. Copy the matching `.env.*.example` and replace the placeholder:

```text
APP_ENV=integration
NEON_PROJECT_ID=proj_placeholder
NEON_BRANCH=integration
DATABASE_URL=postgresql://USER:PASSWORD@ep-integration.region.aws.neon.tech/neondb?sslmode=require
```

| `APP_ENV` | Example file | `NEON_BRANCH` | `DATABASE_URL` host placeholder |
| --- | --- | --- | --- |
| `development` | `.env.development.example` | `development` | `ep-development.region.aws.neon.tech` |
| `integration` | `.env.integration.example` | `integration` | `ep-integration.region.aws.neon.tech` |
| `staging` | `.env.staging.example` | `staging` | `ep-staging.region.aws.neon.tech` |
| `production` | `.env.production.example` | `production` | `ep-production.region.aws.neon.tech` |

`APP_ENV` set to one of those four names requires `DATABASE_URL` to be a `postgres://` or `postgresql://` URL. If it is missing, `createDb()` throws `DatabaseConfigError` and does not open SQLite. A file URL in that mode is also an error. With `APP_ENV` unset, a Postgres `DATABASE_URL` still selects Postgres, which is how the ingest workflow can run with only that secret.

The driver is `pg` (node-postgres) through Drizzle. The same pool serves the Next.js server and the node-cron worker, and multi-row upserts stay in a transaction. Neon connection strings with `sslmode=require` turn on TLS with certificate verification. The pool waits 15 seconds for a connection (enough for a suspended Neon compute to wake), 20 seconds for a query or statement, and 30 seconds before an idle connection is closed. The pool allows 5 connections and sets `application_name` to `evolution-dashboard`.

If the host does not connect, `createDb()` closes the pool and throws `DatabaseUnavailableError`. The message names `APP_ENV` and the host, and it strips the user and password.

Postgres is not migrated on app boot. Run `pnpm db:migrate` (or `pnpm db:migrate:postgres`) against that `DATABASE_URL` before the app serves traffic. SQLite is migrated automatically the first time `createDb()` opens a file.

## Migrations

Drizzle schemas live in `packages/db/src/schema.sqlite.ts` and `packages/db/src/schema.postgres.ts`. Generated SQL lives in `packages/db/migrations/sqlite` and `packages/db/migrations/postgres`. Embeddings are JSON text. `pgvector` is not enabled.

| Command | What it does |
| --- | --- |
| `pnpm db:generate:sqlite` | `drizzle-kit generate` for SQLite |
| `pnpm db:generate:postgres` | `drizzle-kit generate` for Postgres |
| `pnpm db:migrate:sqlite` | Apply `migrations/sqlite` to the local file (ignores a Postgres `DATABASE_URL`) |
| `pnpm db:migrate:postgres` | Apply `migrations/postgres`. Errors when `DATABASE_URL` is missing or the host is unreachable |
| `pnpm db:migrate` | Apply the migrations for whichever driver `APP_ENV` and `DATABASE_URL` select |
| `pnpm db:setup` | Migrate, then seed |

Generate does not connect. The Postgres config falls back to `postgresql://USER:PASSWORD@HOST/neondb?sslmode=require` only so `drizzle-kit generate` has a URL shape. That value is not a database.

## GitHub Actions

`.github/workflows/preview-*.yml` and the database-branch steps exit without calling Vercel or Neon when the secrets are absent. They also do not deploy when the secrets are present: the commands are documented stubs. `.github/workflows/ingest.yml` will run `pnpm ingest` only after `DATABASE_URL` is configured. `.github/workflows/ci.yml` is the lint, typecheck, unit, build, and Playwright pipeline, plus a startup check for `development`, `integration`, `staging`, and `production` that expects `hello world`, plus a Postgres integration job. That job runs `packages/db/test/postgres.integration.test.ts` against a `postgres:16` service container. It builds the test URL from host `127.0.0.1`, port `5432`, database `postgres`, and role `postgres`. The container uses trust authentication, so the workflow has no password and reads no secrets. The workflow's Vercel and Neon steps only echo; they do not deploy and they do not read secrets.
