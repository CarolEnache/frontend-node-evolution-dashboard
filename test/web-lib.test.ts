import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
}));

import { cacheLife, cacheTag } from "next/cache";
import { createDb } from "@evolution/db";
import { cn } from "../apps/web/src/lib/utils";
import { currentTimeMs, dashboardCacheKey, loadDashboard } from "../apps/web/src/lib/entries";
import {
  GAP_ORDER,
  SOURCE_ORDER,
  TYPE_ORDER,
  firstParam,
  hrefWith,
  isoDay,
  isValidIsoDay,
  parseQuery,
  uniqueTags,
} from "../apps/web/src/lib/filters";

describe("dashboard filters", () => {
  it("reads the first trimmed query value", () => {
    expect(firstParam(undefined)).toBeUndefined();
    expect(firstParam("")).toBeUndefined();
    expect(firstParam("  ")).toBeUndefined();
    expect(firstParam(" node ")).toBe("node");
    expect(firstParam([" nextjs ", "node"])).toBe("nextjs");
    expect(firstParam([])).toBeUndefined();
  });

  it("parses a filter and flags unknown enums without dropping valid fields", () => {
    const parsed = parseQuery({
      source: "node",
      type: ["security"],
      gap: "new",
      tag: " lts ",
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(parsed.invalid).toBe(false);
    expect(parsed.filter).toEqual({
      source: "node",
      type: "security",
      gap: "new",
      tag: "lts",
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(parsed.flat).toEqual(parsed.filter);

    const mixed = parseQuery({ source: "nope", type: "release", gap: "soon", from: "yesterday", to: "" });
    expect(mixed.invalid).toBe(true);
    expect(mixed.filter).toEqual({ type: "release" });
    expect(mixed.flat.from).toBeUndefined();

    const impossible = parseQuery({ from: "2026-02-31", to: "2026-11-31" });
    expect(impossible.invalid).toBe(false);
    expect(impossible.filter.from).toBeUndefined();
    expect(impossible.filter.to).toBeUndefined();
  });

  it("accepts only real calendar days and collects sorted unique tags", () => {
    expect(isValidIsoDay("2026-11-01")).toBe(true);
    expect(isValidIsoDay("2026-02-31")).toBe(false);
    expect(isValidIsoDay("yesterday")).toBe(false);
    expect(isValidIsoDay("2026-13-40")).toBe(false);
    expect(
      uniqueTags([
        { tags: ["css", "mdn"] },
        { tags: ["css", " nextjs "] },
        { tags: ["", "baseline"] },
      ]),
    ).toEqual(["baseline", "css", "mdn", "nextjs"]);
  });

  it("builds links and formats a UTC day", () => {
    expect(hrefWith({ source: "node", tag: "css" }, { tag: null, gap: "new" })).toBe("/?source=node&gap=new");
    expect(hrefWith({ source: "node" }, { source: "" })).toBe("/");
    expect(hrefWith({}, { tag: "app router" })).toBe("/?tag=app+router");
    expect(isoDay(new Date("2026-10-31T23:30:00.000Z"))).toBe("2026-10-31");
    expect(SOURCE_ORDER).toEqual(["mdn-bcd", "caniuse", "node", "typescript", "nextjs"]);
    expect(GAP_ORDER).toEqual(["already-know", "adjacent", "new"]);
    expect(TYPE_ORDER).toEqual(["release", "lts", "security", "feature", "support-change", "article"]);
  });
});

describe("dashboard data", () => {
  it("keys the cache by sqlite mtime and leaves a postgres URL unchanged", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://user@localhost/evolution");
    expect(dashboardCacheKey()).toBe("postgresql://user@localhost/evolution");

    const missing = `file:${path.join(mkdtempSync(path.join(tmpdir(), "evolution-missing-")), "missing.sqlite")}`;
    vi.stubEnv("DATABASE_URL", missing);
    expect(dashboardCacheKey()).toBe(missing);

    const file = path.join(mkdtempSync(path.join(tmpdir(), "evolution-key-")), "dash.sqlite");
    const url = `file:${file}`;
    vi.stubEnv("DATABASE_URL", url);
    expect(dashboardCacheKey()).toBe(url);
  });

  it("loads seeded entries inside the hour cache and closes the database", async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "evolution-dash-")), "dash.sqlite");
    const url = `file:${file}`;
    vi.stubEnv("DATABASE_URL", url);
    const db = await createDb(url);
    await db.seed(new Date("2026-10-31T00:00:00.000Z"));
    await db.close();
    const before = Date.now();
    expect(currentTimeMs()).toBeGreaterThanOrEqual(before);
    const key = dashboardCacheKey();
    expect(key.startsWith(`${url}:`)).toBe(true);
    const data = await loadDashboard(key);
    expect(data.entries).toHaveLength(10);
    expect(data.states.length).toBeGreaterThan(0);
    expect(cacheLife).toHaveBeenCalledWith("hours");
    expect(cacheTag).toHaveBeenCalledWith("entries");
    expect(typeof cn).toBe("function");
  });
});
