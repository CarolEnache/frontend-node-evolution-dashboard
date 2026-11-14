import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDb } from "@evolution/db";
import { endOfUtcDay, filterEntries, startOfUtcDay, type Entry } from "@evolution/shared-types";
import { describe, expect, it, vi } from "vitest";
import { GET } from "../src/app/api/entries/route";
import { loadFilteredEntries } from "../src/lib/entries";
import { isValidIsoDay, parseQuery } from "../src/lib/filters";

function entry(overrides: Partial<Entry> & Pick<Entry, "id" | "title" | "date">): Entry {
  return {
    source: "node",
    type: "release",
    url: "https://example.com/entry",
    summary: overrides.title,
    tags: ["node"],
    raw: null,
    ...overrides,
  };
}

describe("FNED-26 calendar dates", () => {
  it("rejects impossible days without rolling them into the next month", () => {
    const rolled = new Date(Date.UTC(2026, 1, 31));
    expect(rolled.getUTCFullYear()).toBe(2026);
    expect(rolled.getUTCMonth()).toBe(2);
    expect(rolled.getUTCDate()).toBe(3);

    expect(isValidIsoDay("2026-02-31")).toBe(false);
    expect(isValidIsoDay("2026-04-31")).toBe(false);
    expect(isValidIsoDay("2026-11-31")).toBe(false);
    expect(isValidIsoDay("2026-02-29")).toBe(false);
    expect(isValidIsoDay("2024-02-29")).toBe(true);
    expect(isValidIsoDay("2026-02-28")).toBe(true);
    expect(isValidIsoDay("2026-01-31")).toBe(true);
    expect(isValidIsoDay("2026-12-31")).toBe(true);
    expect(isValidIsoDay("2026-02-00")).toBe(false);
    expect(isValidIsoDay("2026-00-10")).toBe(false);
    expect(isValidIsoDay("2026-2-28")).toBe(false);
    expect(isValidIsoDay(" 2026-02-28")).toBe(false);

    const dropped = parseQuery({ from: "2026-02-31", to: "2026-04-31" });
    expect(dropped.invalid).toBe(false);
    expect(dropped.filter.from).toBeUndefined();
    expect(dropped.filter.to).toBeUndefined();
    expect(dropped.flat.from).toBeUndefined();

    const blank = parseQuery({ from: "", to: "   " });
    expect(blank.filter).toEqual({});
  });
});

describe("FNED-26/28 UTC date bounds", () => {
  const rows = [
    entry({ id: "before", title: "Before", date: "2026-06-14T23:59:59.999Z" }),
    entry({ id: "start", title: "Start", date: "2026-06-15T00:00:00.000Z" }),
    // 23:30Z is still 15 June in UTC and already 16 June in America/Los_Angeles.
    entry({ id: "evening", title: "Evening", date: "2026-06-15T23:30:00.000Z" }),
    entry({ id: "end", title: "End", date: "2026-06-15T23:59:59.999Z" }),
    entry({ id: "after", title: "After", date: "2026-06-16T00:00:00.000Z" }),
  ];

  it("uses inclusive UTC day bounds rather than a local timezone", () => {
    expect(startOfUtcDay("2026-06-15")).toBe("2026-06-15T00:00:00.000Z");
    expect(endOfUtcDay("2026-06-15")).toBe("2026-06-15T23:59:59.999Z");
    expect(filterEntries(rows, { from: "2026-06-15", to: "2026-06-15" }).map((item) => item.id)).toEqual([
      "end",
      "evening",
      "start",
    ]);
  });

  it("applies the date filter before the row cap", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "evolution-date-"));
    const url = `file:${path.join(dir, "date.sqlite")}`;
    const db = await createDb(url);
    try {
      await db.upsertEntries(rows);
      await db.upsertEntries(
        Array.from({ length: 5 }, (_, index) =>
          entry({
            id: `newer-${index}`,
            title: `Newer ${index}`,
            date: `2026-12-2${index}T00:00:00.000Z`,
          }),
        ),
      );
      expect((await db.listEntries({ from: "2026-06-15", to: "2026-06-15", limit: 1 })).map((item) => item.id)).toEqual([
        "end",
      ]);
      expect((await db.listEntries({ from: "2026-06-16", to: "2026-06-16" })).map((item) => item.id)).toEqual(["after"]);
      // A day after 16 June and before the December rows. `to` has to apply or those rows leak in.
      expect(await db.listEntries({ from: "2026-06-17", to: "2026-06-17" })).toEqual([]);
    } finally {
      await db.close();
    }
  });
});

describe("FNED-28 entries route", () => {
  it("returns the in-range row past the newest 1000 and drops an impossible from day", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "evolution-cap-"));
    const url = `file:${path.join(dir, "cap.sqlite")}`;
    vi.stubEnv("APP_ENV", "local");
    vi.stubEnv("DATABASE_URL", url);
    const db = await createDb(url);
    try {
      const noise = Array.from({ length: 1001 }, (_, index) =>
        entry({
          id: `noise-${index}`,
          title: `Noise ${index}`,
          date: "2026-12-01T00:00:00.000Z",
          tags: ["noise"],
        }),
      );
      await db.upsertEntries([
        ...noise,
        entry({ id: "kept", title: "Kept by the date filter", date: "2026-01-15T12:00:00.000Z", tags: ["kept"] }),
      ]);
    } finally {
      await db.close();
    }

    const ranged = await GET(new Request("http://127.0.0.1/api/entries?from=2026-01-15&to=2026-01-15"));
    expect(ranged.status).toBe(200);
    const rangedBody = (await ranged.json()) as { entries: Array<{ id: string }> };
    expect(rangedBody.entries.map((item) => item.id)).toEqual(["kept"]);

    const filtered = await loadFilteredEntries(`${url}:filtered`, { from: "2026-01-15", to: "2026-01-15" });
    expect(filtered.map((item) => item.id)).toEqual(["kept"]);

    const impossible = await GET(new Request("http://127.0.0.1/api/entries?from=2026-02-31"));
    const impossibleBody = (await impossible.json()) as { entries: Array<{ id: string }> };
    expect(impossibleBody.entries).toHaveLength(1000);
    expect(impossibleBody.entries.some((item) => item.id === "kept")).toBe(false);

    const blank = await GET(new Request("http://127.0.0.1/api/entries?from=&to="));
    const blankBody = (await blank.json()) as { entries: Array<{ id: string }> };
    expect(blankBody.entries).toHaveLength(1000);
  });
});
