import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveDatabaseTarget } from "@evolution/db";
import { loadWorkerEnv } from "../src/env-file";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("worker .env", () => {
  it("loads DATABASE_URL from .env and does not override variables already set", () => {
    const root = mkdtempSync(path.join(tmpdir(), "evolution-dotenv-"));
    writeFileSync(
      path.join(root, ".env"),
      [
        "DATABASE_URL=file:/tmp/qa-db/from-dotenv.sqlite",
        "APP_ENV=local",
        "KEEP=from-file",
        'export QUOTED="a b"',
        "# comment",
        "EMPTY=",
        "UNQUOTED=hello # comment",
        "SINGLE='a b'",
        'HASH_IN_QUOTES="a # b"',
      ].join("\n"),
    );
    const env: NodeJS.ProcessEnv = { KEEP: "from-process" };
    loadWorkerEnv(env, root);
    expect(env.DATABASE_URL).toBe("file:/tmp/qa-db/from-dotenv.sqlite");
    expect(env.APP_ENV).toBe("local");
    expect(env.KEEP).toBe("from-process");
    expect(env.QUOTED).toBe("a b");
    expect(env.EMPTY).toBe("");
    expect(env.UNQUOTED).toBe("hello");
    expect(env.SINGLE).toBe("a b");
    expect(env.HASH_IN_QUOTES).toBe("a # b");
    expect(resolveDatabaseTarget({ appEnv: env.APP_ENV, databaseUrl: env.DATABASE_URL }).url).toBe(
      "file:/tmp/qa-db/from-dotenv.sqlite",
    );
  });

  it("leaves the environment unchanged when .env is absent", () => {
    const root = mkdtempSync(path.join(tmpdir(), "evolution-dotenv-"));
    const env: NodeJS.ProcessEnv = {};
    loadWorkerEnv(env, root);
    expect(env).toEqual({});
  });

  it("worker startup reads APP_ENV from .env before ingest", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "evolution-dotenv-"));
    writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
    writeFileSync(
      path.join(root, ".env"),
      "APP_ENV=staging\nDATABASE_URL=file:/tmp/qa-db/from-dotenv.sqlite\nNODE_ENV=production\n",
    );
    const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "test" };
    delete env.APP_ENV;
    delete env.DATABASE_URL;
    const result = await execFileAsync(
      path.join(repoRoot, "node_modules/.bin/tsx"),
      [path.join(repoRoot, "apps/worker/src/index.ts"), "--startup-only"],
      { cwd: root, env, encoding: "utf8" },
    );
    expect(result.stdout).toContain("[startup] worker APP_ENV=staging");
    expect(result.stdout).not.toContain("[ingest]");
    expect(result.stdout).toContain("NODE_ENV=test");
  });

  it("prints one [ingest] line when the working directory is outside the repo", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "evolution-no-repo-"));
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.APP_ENV;
    let code = 0;
    let stderr = "";
    try {
      const result = await execFileAsync(
        path.join(repoRoot, "node_modules/.bin/tsx"),
        [path.join(repoRoot, "apps/worker/src/index.ts"), "--startup-only"],
        { cwd, env, encoding: "utf8" },
      );
      stderr = result.stderr;
    } catch (error) {
      const failed = error as { code?: number; stderr?: string };
      code = typeof failed.code === "number" ? failed.code : 1;
      stderr = failed.stderr ?? "";
    }
    expect(code).toBe(1);
    expect(stderr.trim().split(/\r?\n/).filter((line) => line.trim() !== "")).toEqual([
      expect.stringMatching(/^\[ingest\] Could not find pnpm-workspace.yaml/),
    ]);
  });
});
