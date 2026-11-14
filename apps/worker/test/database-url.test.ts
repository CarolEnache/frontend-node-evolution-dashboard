import { execFile } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("unsupported DATABASE_URL", () => {
  it("exits non-zero for mysql:// and does not create a sqlite file", async () => {
    const leaked = path.resolve(repoRoot, "mysql:");
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.APP_ENV;
    env.DATABASE_URL = "mysql://user:super-secret@localhost/db";
    try {
      const result = await runWorker(env);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toMatch(/unsupported scheme "mysql"/);
      expect(`${result.stdout}\n${result.stderr}`).not.toContain("super-secret");
      expect(existsSync(leaked)).toBe(false);
    } finally {
      rmSync(leaked, { recursive: true, force: true });
    }
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
