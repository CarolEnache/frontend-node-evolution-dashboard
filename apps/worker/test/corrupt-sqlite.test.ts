import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("corrupt sqlite worker", () => {
  it("exits with one [ingest] line when the sqlite file is not a database", async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "evolution-corrupt-")), "dev.sqlite");
    writeFileSync(file, "not a sqlite database");
    const env: NodeJS.ProcessEnv = { ...process.env, APP_ENV: "local", DATABASE_URL: `file:${file}` };
    const result = await runWorker(env);
    expect(result.code).toBe(1);
    const lines = result.stderr.trim().split(/\r?\n/).filter((line) => line.trim() !== "");
    expect(lines).toEqual([expect.stringMatching(/^\[ingest\] .*database is corrupt/i)]);
    expect(result.stderr).not.toMatch(/SQLITE_NOTADB/);
    expect(result.stderr).not.toMatch(/^\s+at /m);
  });
});

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
