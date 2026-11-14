import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { DatabaseConfigError, DatabaseUnavailableError } from "@evolution/db";
import { describe, expect, it } from "vitest";
import { ingestFailureLine, WorkerConfigError } from "../src/failure";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("worker config and database errors", () => {
  it("prints one [ingest] line for an invalid FETCH_TIMEOUT_MS", async () => {
    const env: NodeJS.ProcessEnv = { ...process.env, FETCH_TIMEOUT_MS: "abc", APP_ENV: "local" };
    delete env.DATABASE_URL;
    const result = await runWorker(env);
    expect(result.code).toBe(1);
    expect(errorLines(result.stderr)).toEqual([
      expect.stringMatching(/^\[ingest\] Expected a positive integer, received "abc"$/),
    ]);
  });

  it("prints one [ingest] line when a Neon environment has no DATABASE_URL", async () => {
    const env: NodeJS.ProcessEnv = { ...process.env, APP_ENV: "development" };
    delete env.DATABASE_URL;
    delete env.FETCH_TIMEOUT_MS;
    const result = await runWorker(env);
    expect(result.code).toBe(1);
    expect(errorLines(result.stderr)).toEqual([
      expect.stringMatching(/^\[ingest\] APP_ENV=development uses Neon Postgres, but DATABASE_URL is missing\./),
    ]);
    expect(result.stderr).not.toMatch(/super-secret/);
  });

  it("formats database and config errors as one line and leaves other errors alone", () => {
    const unavailable = new DatabaseUnavailableError(
      "Postgres is configured (APP_ENV=local, postgresql://***:***@127.0.0.1:1/db) but the database is unreachable. connect ECONNREFUSED 127.0.0.1:1",
    );
    expect(ingestFailureLine(unavailable)).toBe(`[ingest] ${unavailable.message}`);
    expect(ingestFailureLine(new WorkerConfigError('Expected a positive integer, received "abc"'))).toBe(
      '[ingest] Expected a positive integer, received "abc"',
    );
    expect(
      ingestFailureLine(new DatabaseConfigError("APP_ENV=development uses Neon Postgres, but DATABASE_URL is missing.")),
    ).toBe("[ingest] APP_ENV=development uses Neon Postgres, but DATABASE_URL is missing.");
    expect(ingestFailureLine(new Error("entries write failed"))).toBeUndefined();
    expect(ingestFailureLine(unavailable)).not.toContain("super-secret");
  });
});

function errorLines(stderr: string): string[] {
  return stderr.trim().split(/\r?\n/).filter((line) => line.trim() !== "");
}

async function runWorker(env: NodeJS.ProcessEnv) {
  try {
    const result = await execFileAsync(
      path.join(repoRoot, "node_modules/.bin/tsx"),
      [path.join(repoRoot, "apps/worker/src/index.ts"), "--once", "--source", "node"],
      { cwd: repoRoot, env, encoding: "utf8" },
    );
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof failed.code === "number" ? failed.code : 1,
      stdout: failed.stdout ?? "",
      stderr: failed.stderr ?? "",
    };
  }
}
