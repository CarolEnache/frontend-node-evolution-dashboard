# Evolution

A local dashboard of what changed in the frontend platform and Node.js, and which of it is worth learning against a skills profile.

Sources, on their own cadence: MDN browser-compat-data, Can I Use, Node.js releases, the TypeScript devblog and GitHub releases, and Next.js stable releases plus `https://nextjs.org/feed.xml`. Each item is normalised into one `Entry`, deduped, and stored. Embeddings and the default summary run locally. Hugging Face is off unless `SUMMARY_PROVIDER=huggingface`.

Nothing in this repo is deployed. There is no Vercel project, no Neon branch, and no GitHub repository created from here.

## Layout

```text
apps/web          Next.js 16 App Router dashboard (Turbopack)
apps/worker       node-cron ingest entrypoint
packages/ingest   fetch, parse, diff, normalise
packages/ai       local embeddings, zero-shot, summaries
packages/db       Drizzle schema, SQLite + Postgres, migrations, seed
packages/shared-types
profile/skills.json
```

## Prerequisites

Node.js 22 or newer, pnpm 10. The package manager is pinned in `package.json`.

```bash
pnpm install
pnpm db:setup
pnpm dev
```

The app is at http://127.0.0.1:43123. With `APP_ENV` unset or `local` and `DATABASE_URL` empty, both the app and the worker use `data/dev.sqlite`.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Next.js dev server on port 43123, Turbopack |
| `pnpm build` | `next build` for `@evolution/web`, Turbopack, no `--webpack` |
| `pnpm lint` | ESLint for packages, the worker, the e2e tests, and the web app |
| `pnpm typecheck` | `tsc --noEmit` across the workspace |
| `pnpm test` | Vitest. No network and no `HF_TOKEN` |
| `pnpm test:e2e` | Playwright against a seeded SQLite file |
| `pnpm db:generate:sqlite` | Generate the SQLite Drizzle migration |
| `pnpm db:generate:postgres` | Generate the Postgres Drizzle migration |
| `pnpm db:migrate` | Apply the migration for the selected driver |
| `pnpm db:migrate:sqlite` | Apply `packages/db/migrations/sqlite` |
| `pnpm db:migrate:postgres` | Apply `packages/db/migrations/postgres` (requires `DATABASE_URL`) |
| `pnpm db:seed` | Upsert the sample timeline |
| `pnpm db:setup` | Migrate, then seed |
| `pnpm ingest` | Fetch every source once. Failures are logged per source |
| `pnpm ingest -- --source node` | Fetch one source, or a comma-separated list (`typescript,nextjs`) |
| `pnpm ingest:schedule` | Keep a process running. MDN, Can I Use, and Node every 6 hours. TypeScript and Next.js every 12 hours. Override with `INGEST_FAST_HOURS`, `INGEST_SLOW_HOURS`, or `INGEST_INTERVAL_HOURS` |

`pnpm ingest` does not call the models unless `ENRICH=1`. `ENRICH_MAX_PER_RUN` caps how many of those entries are enriched in one process. Embeddings download `Xenova/bge-small-en-v1.5` into `.cache/models` (override with `SUMMARY_CACHE_DIR`). Summaries download `onnx-community/Llama-3.2-1B-Instruct-ONNX` at `q4`, pinned revision `82ac69368916173bad498ad390290faab92d4fb0`, greedy, 64 new tokens, only after embeddings and any bart tagger have been disposed. `LOCAL_SUMMARY_MODEL=light` uses `onnx-community/Qwen2.5-0.5B-Instruct` at revision `22942cb7d7ba4cc81bb4673549ca4d4614469b5e`. Cloudflare Workers AI is off unless `CLOUDFLARE_FALLBACK=1` and both `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` are set. That path has a 20s abort and a 64 KB response cap, and it stops at 8000 neurons per UTC day. A failed summary leaves the stored worth-learning line in place. An ingest without `ENRICH=1` does not clear that line.

## Source endpoints

All of these are public and work without credentials. `GITHUB_TOKEN` is optional and is sent only to `api.github.com`.

| Source | What it fetches | URL |
| --- | --- | --- |
| MDN browser-compat-data | npm version | `https://registry.npmjs.org/@mdn/browser-compat-data/latest` |
| MDN browser-compat-data | compat JSON for that version | `https://cdn.jsdelivr.net/npm/@mdn/browser-compat-data@<version>/data.json` |
| MDN browser-compat-data | release notes (Additions) | `https://api.github.com/repos/mdn/browser-compat-data/releases/latest` |
| Can I Use | npm version | `https://registry.npmjs.org/caniuse-db/latest` |
| Can I Use | full support data for that version | `https://cdn.jsdelivr.net/npm/caniuse-db@<version>/fulldata-json/data-2.0.json` |
| Node.js | dist index, newest first | `https://nodejs.org/dist/index.json` |
| Node.js | LTS schedule | `https://raw.githubusercontent.com/nodejs/Release/main/schedule.json` |
| Node.js | releases feed | `https://nodejs.org/en/feed/releases.xml` |
| TypeScript | dist-tags (`latest`, `beta`, `rc`; nightlies ignored) | `https://registry.npmjs.org/typescript` |
| TypeScript | GitHub releases / changelog | `https://api.github.com/repos/microsoft/TypeScript/releases?per_page=10` |
| TypeScript | devblog feed | `https://devblogs.microsoft.com/typescript/feed/` |
| Next.js | latest GitHub release | `https://api.github.com/repos/vercel/next.js/releases/latest` |
| Next.js | recent GitHub releases (canaries dropped) | `https://api.github.com/repos/vercel/next.js/releases?per_page=30` |
| Next.js | blog feed | `https://nextjs.org/feed.xml` |

## How a change gets onto the timeline

1. The worker sends `If-None-Match` / `If-Modified-Since` and skips a 304. Validators are stored on `source_state` and sent on the next run. A request times out after `FETCH_TIMEOUT_MS` (default 20s) and retries up to `FETCH_MAX_ATTEMPTS` (default 3) with exponential backoff on 408, 429, 500, 502, 503, 504, timeouts, and network errors. One source failing does not stop the others.
2. MDN and Can I Use also compare the npm version and only download the full JSON when it changed. The first time a version is seen, the pipeline records the release (and MDN's "Additions" list) instead of emitting every historical feature. The next version diffs `__compat` paths and Can I Use `stats` flips.
3. Node.js reads `https://nodejs.org/dist/index.json` (newest first), the release schedule, and the releases feed. The first run keeps five releases. Later runs keep whatever is newer than the stored version in that index.
4. TypeScript tracks the `latest`, `beta`, and `rc` dist-tags and ignores `7.x.x-dev.*` nightlies.
5. Next.js drops GitHub releases with `prerelease: true` or a `canary` tag. Blog posts come from `https://nextjs.org/feed.xml` (`/blog/feed.xml` and `/rss.xml` 404).
6. Rows that share an id, or a release family and version, collapse to one entry. The more specific type wins: security, then LTS, then release.
7. With `ENRICH=1`, the entry text is embedded locally and compared with the skills in `profile/skills.json`. Similarity decides the gap: already know at 0.75 and above, adjacent from 0.55, otherwise new. A confident zero-shot label can nudge that only within 0.05 of a threshold. The summary model runs for adjacent and new items. Vectors and summary lines are cached in the `embeddings` table.

## Dashboard

Server components read the database. The loader is a Cache Component (`use cache`, `cacheLife('hours')`, `cacheTag('entries')`). Next.js 16 rejects `export const revalidate` while `cacheComponents` is on, so the hour window lives on that function instead. After ingest, the worker POSTs to `WEB_REVALIDATE_URL` with `Authorization: Bearer $REVALIDATE_SECRET`, and the route calls `revalidateTag('entries', 'max')`.

`/` is the timeline, newest first, across MDN, Can I Use, Node.js, TypeScript, and Next.js. `/worth-learning` flags what is worth learning. Filters are shareable query params on both views: `source`, `tag`, `type`, `gap`, `from`, `to`.

Worth learning does not wait on FNED-6 (tagging) or FNED-7 (embeddings and summaries). The active strategy is `activeWorthLearningStrategy` in `@evolution/shared-types`, currently `heuristicWorthLearningStrategy`. It scores security releases, LTS, baseline tags, browser support changes, and stable major or minor versions, then orders them by that signal plus recency and a source weight (MDN, Node, Can I Use, TypeScript, Next.js). Prereleases and routine patches stay on the timeline and are not flagged. With no date range the window is the last 30 days; a from/to range replaces that window. Point `activeWorthLearningStrategy` at `enrichmentWorthLearningStrategy` when `gap` and `similarity` are filled in. The page only calls `WorthLearningStrategy.select`.

`GET /api/entries` repeats the timeline filters as JSON. Both pages read SQLite (or Postgres) through `@evolution/db` in Server Components. `pnpm db:setup` seeds `data/dev.sqlite` so the views render before a live ingest.

## AI

| Step | Model | Where it runs |
| --- | --- | --- |
| Embeddings | `BAAI/bge-small-en-v1.5` via `Xenova/bge-small-en-v1.5` | Local Transformers.js |
| Summary (default) | `onnx-community/Llama-3.2-1B-Instruct-ONNX` at `q4` | Local Transformers.js on CPU, greedy, 64 new tokens. Loaded after bge and bart, then disposed |
| Summary (lighter) | `onnx-community/Qwen2.5-0.5B-Instruct` | Set `LOCAL_SUMMARY_MODEL=light` |
| Summary (optional) | `@cf/meta/llama-3.1-8b-instruct-fp8-fast` | Only with `CLOUDFLARE_FALLBACK=1` plus account id and API token. 4119 neurons per million input tokens and 34868 per million output tokens, capped at 8000 neurons per day |
| Summary and zero-shot (opt-in) | `meta-llama/Llama-3.1-8B-Instruct` and `facebook/bart-large-mnli` | `SUMMARY_PROVIDER=huggingface` and `HF_TOKEN` |

`HF_TOKEN` is optional. Tests inject fakes and do not download models. `RUN_MODEL_TESTS=1` runs the local Llama smoke test; default CI leaves it skipped.

One model is in memory at a time. bge-small is on the order of 100 MB. bart-large-mnli stays fp32 (about 1.6 GB of weights) because the quantized checkpoint is not usable, and it is disposed before summarization. Llama 3.2 1B q4 is about 0.8–1.5 GB including the ONNX runtime. The peak is one of those, which fits a 2-core runner with 7 GB of RAM. Set `ENRICH_MAX_PER_RUN` when a run should enrich only a slice of the batch.

`pnpm install` builds `onnxruntime-node`. That package's installer may download a CUDA library even though this project runs embeddings on CPU. The web app does not import Transformers.js, the ingestion package, or the database drivers into the client bundle. `apps/web` depends only on `@evolution/db` and `@evolution/shared-types`. `next.config.ts` sets `turbopack.root` to the monorepo root, `transpilePackages` for those two packages, and `serverExternalPackages` for `better-sqlite3`, `pg`, and the Transformers runtime. Database access is marked `server-only`. Turbopack warns that `findRepoRoot` walks the filesystem and traces the repo into the server output. The production build still finishes on Turbopack, so the project does not fall back to webpack.

## Environments

Development, integration, staging, and production each have an `.env.*.example`. The longer notes, including the Vercel root directory and the Neon branch names, are in [docs/environments.md](docs/environments.md).

| Environment | `APP_ENV` | Database |
| --- | --- | --- |
| local | unset or `local` | SQLite `data/dev.sqlite` |
| development | `development` | Neon branch `development` |
| integration | `integration` | Neon branch `integration` |
| staging | `staging` | Neon branch `staging` |
| production | `production` | Neon branch `production` |

Day-to-day development stays on SQLite. The four named environments require a Neon `DATABASE_URL`. A missing URL throws `DatabaseConfigError`. A host that does not connect throws `DatabaseUnavailableError` (15s connection timeout, 20s query timeout). `NODE_ENV` is only `development`, `production`, or `test`. Driver selection, the placeholder URLs, and the migration commands are in [docs/environments.md](docs/environments.md).

Example files only. No real tokens, connection strings, or project ids are checked in.

## Tests

```bash
pnpm test
pnpm exec playwright install chromium
pnpm build
pnpm test:e2e
```

Playwright seeds `data/e2e.sqlite` and starts the dev server on port 43187. Unit tests cover parsers, normalisation, conditional fetch (200, 304, timeout, retry, and per-source errors), the in-process scheduler, version skip, gap thresholds, embedding cache, the Hugging Face retry wrapper, and the web and worker startup logs. Tests mock `fetch` and do not call the upstreams.

## CI

`.github/workflows/ci.yml` runs on pull requests and on pushes to `main`, on `ubuntu-latest`, with cancel-in-progress. It uses Node.js 22 and pnpm 10, with the pnpm store cached. Jobs:

| Job | Command |
| --- | --- |
| Lint | `pnpm lint` |
| Typecheck | `pnpm typecheck` |
| Unit tests | `pnpm test:coverage` |
| Build | `pnpm build` |
| End-to-end | Playwright Chromium with a version-keyed browser cache, `CI=true`, and failure artifacts |
| Startup | One run each for `development`, `integration`, `staging`, and `production`. Sets `APP_ENV` and a standard `NODE_ENV`, starts the Next.js `register` hook and `apps/worker` with `--startup-only`, and fails unless both print `hello world`. |

The startup job's Vercel and Neon steps are labelled `STUB`. They echo the branch or target they would use. They do not deploy, call those CLIs, or read secrets. The workflow does not declare a GitHub Actions `environment`.

## What is stubbed

- GitHub Actions for Vercel previews and Neon branches do not call those APIs. They exit when the secrets are missing, and they only print the intended action when the secrets exist.
- The scheduled ingest workflow runs `pnpm ingest` only if `DATABASE_URL` is configured.
- Postgres uses node-postgres with the dialect migration in `packages/db/migrations/postgres`. Unit tests mock that client and do not open a network connection.
- A full MDN or Can I Use feature diff runs only after a previous version has been stored. The seed is what the dashboard shows until you ingest.

## What you add later

- `HF_TOKEN`: optional. Only read when `SUMMARY_PROVIDER=huggingface`.
- `LOCAL_SUMMARY_DTYPE`: optional ONNX quant for the local summary. Default `q4`.
- `SUMMARY_CACHE_DIR`: optional Transformers.js cache. Default `.cache/models`, outside `node_modules`.
- `CLOUDFLARE_FALLBACK`: set to `1` to allow Workers AI. Off otherwise, even if credentials are present.
- `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`: read from the environment only, and only used when the fallback flag is `1`.
- `ENRICH_MAX_PER_RUN`: optional cap on entries enriched in one process.
- `GITHUB_TOKEN`: optional, public read. Raises the unauthenticated 60 requests/hour limit.
- A Neon project and branches named `development`, `integration`, `staging`, and `production`. SQLite stays the local database. Set `APP_ENV` to the branch name and `DATABASE_URL` to that branch's connection string.
- A Vercel project whose Root Directory is `apps/web`, plus custom environments Integration and Staging. `apps/web/vercel.json` is the install and build config. Leave `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID` unset until then.
- `REVALIDATE_SECRET`, the same value on the worker and the web deployment, and `WEB_REVALIDATE_URL` pointing at `/api/revalidate`.
