import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createDb } from "../src/index";
import {
  DatabaseConfigError,
  NEON_ENVIRONMENTS,
  describeDatabaseFailure,
  redactDatabaseUrl,
  resolveDatabaseTarget,
} from "../src/env";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const ORIGINAL_ENV = { APP_ENV: process.env.APP_ENV, DATABASE_URL: process.env.DATABASE_URL };

afterEach(() => {
  restoreEnv("APP_ENV", ORIGINAL_ENV.APP_ENV);
  restoreEnv("DATABASE_URL", ORIGINAL_ENV.DATABASE_URL);
});

describe("database target", () => {
  it("uses SQLite with no configuration", () => {
    delete process.env.APP_ENV;
    delete process.env.DATABASE_URL;
    const target = resolveDatabaseTarget();
    expect(target).toMatchObject({ appEnv: "local", dialect: "sqlite" });
    expect(target.url).toMatch(/data\/dev\.sqlite$/);
  });

  it("keeps SQLite when APP_ENV is local and DATABASE_URL is empty", () => {
    const target = resolveDatabaseTarget({ appEnv: "local", databaseUrl: "  " });
    expect(target.dialect).toBe("sqlite");
    expect(target.url).toMatch(/dev\.sqlite$/);
  });

  it("requires a Postgres URL for each Neon environment", () => {
    for (const appEnv of NEON_ENVIRONMENTS) {
      expect(() => resolveDatabaseTarget({ appEnv, databaseUrl: "" })).toThrow(DatabaseConfigError);
      expect(() => resolveDatabaseTarget({ appEnv, databaseUrl: "" })).toThrow(/DATABASE_URL is missing/);
      expect(() => resolveDatabaseTarget({ appEnv, databaseUrl: "file:/tmp/dev.sqlite" })).toThrow(
        /must start with postgres:\/\/ or postgresql:\/\//,
      );
    }
  });

  it("selects Postgres when a Neon environment has a DATABASE_URL", () => {
    const url = "postgresql://USER:PASSWORD@ep-staging.region.aws.neon.tech/neondb?sslmode=require";
    expect(resolveDatabaseTarget({ appEnv: "Staging", databaseUrl: url })).toEqual({
      appEnv: "staging",
      dialect: "postgres",
      url,
    });
  });

  it("honours an explicit Postgres URL when APP_ENV is unset", () => {
    const url = "postgres://USER:PASSWORD@ep-development.region.aws.neon.tech/neondb";
    expect(resolveDatabaseTarget({ appEnv: undefined, databaseUrl: url })).toMatchObject({
      appEnv: "local",
      dialect: "postgres",
      url,
    });
  });

  it("rejects an unknown APP_ENV and a Postgres URL with no host", () => {
    expect(() => resolveDatabaseTarget({ appEnv: "qa", databaseUrl: "" })).toThrow(/Unknown APP_ENV "qa"/);
    expect(() => resolveDatabaseTarget({ appEnv: "production", databaseUrl: "postgresql:///neondb" })).toThrow(/no host/);
    expect(() =>
      resolveDatabaseTarget({
        appEnv: "production",
        databaseUrl: "postgresql://USER:super-secret@/neondb",
      }),
    ).toThrow(/not a valid URL/);
    try {
      resolveDatabaseTarget({ appEnv: "production", databaseUrl: "postgresql://USER:super-secret@/neondb" });
    } catch (error) {
      expect(error instanceof Error ? error.message : "").not.toContain("super-secret");
    }
  });

  it("strips a password when the driver echoes the connection string", () => {
    const url = "postgresql://user:super-secret@ep-staging.region.aws.neon.tech/neondb?sslmode=require";
    const message = describeDatabaseFailure("staging", url, new Error(`connect failed for ${url}`));
    expect(message).not.toContain("super-secret");
    expect(message).toContain("[redacted]");
    expect(message).toContain("ep-staging.region.aws.neon.tech");
    expect(message).toContain("APP_ENV=staging");
  });

  it("redacts credentials in URLs", () => {
    const redacted = redactDatabaseUrl(
      "postgresql://user:super-secret@ep-production.region.aws.neon.tech/neondb?sslmode=require",
    );
    expect(redacted).not.toContain("super-secret");
    expect(redacted).not.toContain("user");
    expect(redacted).toContain("ep-production.region.aws.neon.tech");
  });

  it("rejects an unsupported scheme instead of opening it as SQLite", async () => {
    const url = "mysql://user:super-secret@localhost/db";
    const leaked = path.resolve("mysql:");
    try {
      for (const appEnv of [undefined, "local"] as const) {
        expect(() => resolveDatabaseTarget({ appEnv, databaseUrl: url })).toThrow(DatabaseConfigError);
        expect(() => resolveDatabaseTarget({ appEnv, databaseUrl: url })).toThrow(/unsupported scheme "mysql"/);
        try {
          resolveDatabaseTarget({ appEnv, databaseUrl: url });
        } catch (error) {
          expect(error instanceof Error ? error.message : "").not.toContain("super-secret");
        }
        expect(() => resolveDatabaseTarget({ appEnv, databaseUrl: url, explicitUrl: true })).toThrow(
          /unsupported scheme "mysql"/,
        );
      }
      await expect(createDb(url)).rejects.toBeInstanceOf(DatabaseConfigError);
      expect(existsSync(leaked)).toBe(false);
      expect(resolveDatabaseTarget({ appEnv: "local", databaseUrl: "data/dev.sqlite" }).dialect).toBe("sqlite");
    } finally {
      rmSync(leaked, { recursive: true, force: true });
    }
  });

  it("lets an explicit file URL open SQLite while APP_ENV names a Neon environment", async () => {
    process.env.APP_ENV = "production";
    process.env.DATABASE_URL = "";
    const dir = mkdtempSync(path.join(tmpdir(), "evolution-explicit-"));
    const db = await createDb(`file:${path.join(dir, "override.sqlite")}`);
    try {
      expect(db.dialect).toBe("sqlite");
      expect(await db.countEntries()).toBe(0);
    } finally {
      await db.close();
    }
  });
});

describe("db cli", () => {
  it("fails clearly when Postgres migrations are requested without DATABASE_URL", async () => {
    const result = await runCli(["migrate", "--dialect", "postgres"], {
      ...process.env,
      APP_ENV: "integration",
      DATABASE_URL: "",
    });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/DATABASE_URL/);
    expect(result.stderr).not.toMatch(/ECONNREFUSED|getaddrinfo|unreachable/i);
  });

  it("applies the SQLite migration to the file named by DATABASE_URL", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "evolution-cli-"));
    const file = path.join(dir, "cli.sqlite");
    const result = await runCli(["migrate", "--dialect", "sqlite"], {
      ...process.env,
      APP_ENV: "local",
      DATABASE_URL: `file:${file}`,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/sqlite/);
    const { default: Database } = await import("better-sqlite3");
    const sqlite = new Database(file, { readonly: true });
    try {
      const names = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => (row as { name: string }).name);
      expect(names).toEqual(expect.arrayContaining(["entries", "source_state", "embeddings"]));
    } finally {
      sqlite.close();
    }
  });
});

function restoreEnv(key: "APP_ENV" | "DATABASE_URL", value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

async function runCli(args: string[], env: NodeJS.ProcessEnv) {
  try {
    const result = await execFileAsync("pnpm", ["exec", "tsx", "packages/db/src/cli.ts", ...args], {
      cwd: repoRoot,
      env,
      encoding: "utf8",
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof failed.code === "number" ? failed.code : 1, stdout: failed.stdout ?? "", stderr: failed.stderr ?? "" };
  }
}
