import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Entry } from "@evolution/shared-types";
import { describe, expect, it } from "vitest";
import { backfillHtmlEntities, localBackfillDatabaseUrl, assertBackfillAllowed } from "../src/backfill-entities";
import { createSqliteDb } from "../src/sqlite";
import { findRepoRoot } from "../src/paths";

const execFileAsync = promisify(execFile);

function entry(overrides: Partial<Entry> & Pick<Entry, "id" | "title" | "summary">): Entry {
  return {
    source: "typescript",
    type: "article",
    date: "2026-10-20T00:00:00.000Z",
    url: `https://example.com/${overrides.id}`,
    tags: ["typescript"],
    raw: { kept: true },
    gap: "new",
    similarity: 0.5,
    worthLearning: "Read it.",
    ...overrides,
  };
}

async function tempDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "evolution-backfill-"));
  const file = path.join(dir, "backfill.sqlite");
  const db = createSqliteDb(`file:${file}`);
  await db.migrate();
  return { db, file };
}

describe("HTML entity backfill", () => {
  it("decodes stored entities once and leaves a second run unchanged", async () => {
    const { db } = await tempDb();
    try {
      await db.upsertEntries([
        entry({
          id: "typescript:article:progress",
          title: "Progress on TypeScript 7 &#8211; December 2025",
          summary: "Today we&#8217;re excited [&#8230;]",
        }),
        entry({
          id: "typescript:article:literal-br",
          title: "Use &amp;lt;br&amp;gt;",
          summary: "Keep &amp;lt;br&amp;gt; as text",
        }),
        entry({
          id: "typescript:article:quotes",
          title: "the two &quot;pull&quot;",
          summary: "it&rsquo;s ready &amp; shipped",
        }),
        entry({
          id: "typescript:article:clean",
          title: "Already decoded",
          summary: "No entities here",
        }),
      ]);

      const dry = await backfillHtmlEntities(db, { dryRun: true });
      expect(dry).toEqual({ matched: 3, updated: 0, dryRun: true });
      expect((await db.listEntries()).find((row) => row.id === "typescript:article:literal-br")?.summary).toBe(
        "Keep &amp;lt;br&amp;gt; as text",
      );

      const first = await backfillHtmlEntities(db);
      expect(first).toEqual({ matched: 3, updated: 3, dryRun: false });
      const rows = await db.listEntries();
      const progress = rows.find((row) => row.id === "typescript:article:progress");
      const literal = rows.find((row) => row.id === "typescript:article:literal-br");
      const quotes = rows.find((row) => row.id === "typescript:article:quotes");
      const clean = rows.find((row) => row.id === "typescript:article:clean");
      expect(progress?.title).toBe("Progress on TypeScript 7 \u2013 December 2025");
      expect(progress?.summary).toBe("Today we\u2019re excited [\u2026]");
      expect(literal?.title).toBe("Use &lt;br&gt;");
      expect(literal?.summary).toBe("Keep &lt;br&gt; as text");
      expect(quotes?.title).toBe('the two "pull"');
      expect(quotes?.summary).toBe("it\u2019s ready & shipped");
      expect(literal?.tags).toEqual(["typescript"]);
      expect(literal?.gap).toBe("new");
      expect(literal?.worthLearning).toBe("Read it.");
      expect(literal?.raw).toEqual({ kept: true });
      expect(clean?.summary).toBe("No entities here");

      const second = await backfillHtmlEntities(db);
      expect(second).toEqual({ matched: 0, updated: 0, dryRun: false });
      const again = await db.listEntries();
      expect(again.find((row) => row.id === "typescript:article:literal-br")?.summary).toBe("Keep &lt;br&gt; as text");
      expect(again.find((row) => row.id === "typescript:article:progress")?.summary).toBe(
        "Today we\u2019re excited [\u2026]",
      );
    } finally {
      await db.close();
    }
  });

  it("defaults to the local SQLite file and refuses production without an explicit flag", () => {
    expect(localBackfillDatabaseUrl(undefined)).toMatch(/data\/dev\.sqlite$/);
    expect(localBackfillDatabaseUrl("postgresql://user:secret@ep.neon.tech/neondb")).toMatch(/data\/dev\.sqlite$/);
    expect(localBackfillDatabaseUrl("file:/tmp/evolution-local.sqlite")).toBe("file:/tmp/evolution-local.sqlite");
    expect(() => assertBackfillAllowed("production", false)).toThrow(/APP_ENV=production/);
    expect(() => assertBackfillAllowed("production", true)).not.toThrow();
    expect(() => assertBackfillAllowed("local", false)).not.toThrow();
  });

  it("prints a dry-run count and refuses production from the CLI", async () => {
    const { db, file } = await tempDb();
    await db.upsertEntries([
      entry({ id: "typescript:article:encoded", title: "We&#8217;re here", summary: "Wait&#8230;" }),
    ]);
    await db.close();

    const dry = await runCli(["backfill-entities", "--dry-run"], {
      ...process.env,
      APP_ENV: "local",
      DATABASE_URL: `file:${file}`,
    });
    expect(dry.code).toBe(0);
    expect(dry.stdout).toContain("Dry run: 1 entries would be updated.");

    const denied = await runCli(["backfill-entities"], {
      ...process.env,
      APP_ENV: "production",
      DATABASE_URL: "postgresql://user:secret@ep.neon.tech/neondb",
    });
    expect(denied.code).not.toBe(0);
    expect(denied.stderr).toMatch(/APP_ENV=production/);
    expect(denied.stderr).not.toContain("secret");
    expect(denied.stderr).not.toMatch(/ECONNREFUSED|getaddrinfo|unreachable/i);
  });
});

async function runCli(args: string[], env: NodeJS.ProcessEnv) {
  try {
    const result = await execFileAsync("pnpm", ["exec", "tsx", "packages/db/src/cli.ts", ...args], {
      cwd: findRepoRoot(),
      env,
      encoding: "utf8",
    });
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
