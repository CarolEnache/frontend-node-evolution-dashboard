import { describe, expect, it } from "vitest";
import { GET } from "../src/app/api/entries/route";
import { dateFilterError, parseQuery, resolveDashboardDates } from "../src/lib/filters";

describe("date filter parsing", () => {
  it("keeps a real calendar range and reports nothing", () => {
    const parsed = parseQuery({ from: "2024-02-29", to: "2026-12-01", source: "node" });

    expect(parsed.invalid).toBe(false);
    expect(parsed.reversed).toBe(false);
    expect(parsed.invalidDates).toEqual([]);
    expect(parsed.filter).toEqual({ source: "node", from: "2024-02-29", to: "2026-12-01" });
    expect(parsed.flat).toEqual(parsed.filter);
    expect(dateFilterError(parsed)).toBeNull();

    const applied = resolveDashboardDates(parsed);
    expect(applied.notices).toEqual([]);
    expect(applied.filter).toEqual(parsed.filter);
    expect(applied.flat).toEqual(parsed.flat);
  });

  it("treats equal bounds as a valid range", () => {
    const parsed = parseQuery({ from: "2026-06-15", to: "2026-06-15" });

    expect(parsed.reversed).toBe(false);
    expect(parsed.invalidDates).toEqual([]);
    expect(dateFilterError(parsed)).toBeNull();
    expect(resolveDashboardDates(parsed).filter).toEqual({ from: "2026-06-15", to: "2026-06-15" });
  });

  it("ignores an invalid from date, names it, and leaves other filters in place", () => {
    const parsed = parseQuery({ from: "notadate", source: "node", tag: "css" });

    expect(parsed.invalid).toBe(false);
    expect(parsed.reversed).toBe(false);
    expect(parsed.invalidDates).toEqual([{ field: "from", value: "notadate" }]);
    expect(parsed.filter).toEqual({ source: "node", tag: "css" });
    expect(parsed.flat.from).toBeUndefined();

    const applied = resolveDashboardDates(parsed);
    expect(applied.filter).toEqual({ source: "node", tag: "css" });
    expect(applied.flat.from).toBeUndefined();
    expect(applied.notices).toEqual([
      'From "notadate" is not a valid date. Use YYYY-MM-DD. That bound was ignored.',
    ]);
    expect(dateFilterError(parsed)).toBe('from must be a calendar date in YYYY-MM-DD. Received "notadate".');
  });

  it("ignores each impossible calendar day and keeps a valid bound", () => {
    const both = parseQuery({ from: "2026-02-31", to: "2026-13-40" });
    expect(both.filter).toEqual({});
    expect(both.invalidDates).toEqual([
      { field: "from", value: "2026-02-31" },
      { field: "to", value: "2026-13-40" },
    ]);
    expect(both.reversed).toBe(false);
    expect(resolveDashboardDates(both).notices).toEqual([
      'From "2026-02-31" is not a valid date. Use YYYY-MM-DD. That bound was ignored.',
      'To "2026-13-40" is not a valid date. Use YYYY-MM-DD. That bound was ignored.',
    ]);
    expect(dateFilterError(both)).toBe(
      'from must be a calendar date in YYYY-MM-DD. Received "2026-02-31". to must be a calendar date in YYYY-MM-DD. Received "2026-13-40".',
    );

    const kept = parseQuery({ from: " yesterday ", to: "2026-06-01" });
    expect(kept.invalidDates).toEqual([{ field: "from", value: "yesterday" }]);
    expect(kept.filter).toEqual({ to: "2026-06-01" });
    expect(resolveDashboardDates(kept).filter).toEqual({ to: "2026-06-01" });
    expect(resolveDashboardDates(kept).flat.to).toBe("2026-06-01");
  });

  it("flags a reversed range for the API and swaps it for the dashboard", () => {
    const parsed = parseQuery({ from: "2026-12-01", to: "2026-01-01", tag: "css" });

    expect(parsed.invalid).toBe(false);
    expect(parsed.invalidDates).toEqual([]);
    expect(parsed.reversed).toBe(true);
    expect(parsed.filter).toEqual({ tag: "css", from: "2026-12-01", to: "2026-01-01" });
    expect(dateFilterError(parsed)).toBe(
      'from must be on or before to. Received from "2026-12-01" and to "2026-01-01".',
    );

    const applied = resolveDashboardDates(parsed);
    expect(applied.filter).toEqual({ tag: "css", from: "2026-01-01", to: "2026-12-01" });
    expect(applied.flat).toEqual(applied.filter);
    expect(applied.notices).toEqual(["From is after To. The range was swapped to 2026-01-01 through 2026-12-01."]);
  });

  it("does not treat an unknown source as a date error", () => {
    const parsed = parseQuery({ source: "not-a-source", type: "Release", gap: "soon" });

    expect(parsed.invalid).toBe(true);
    expect(parsed.invalidDates).toEqual([]);
    expect(parsed.reversed).toBe(false);
    expect(dateFilterError(parsed)).toBeNull();
    expect(resolveDashboardDates(parsed).notices).toEqual([]);
  });

  it("still reports an invalid date when the source is also unknown", () => {
    const parsed = parseQuery({ source: "not-a-source", from: "notadate" });

    expect(parsed.invalid).toBe(true);
    expect(parsed.filter.source).toBeUndefined();
    expect(dateFilterError(parsed)).toBe('from must be a calendar date in YYYY-MM-DD. Received "notadate".');
  });
});

describe("entries API date errors", () => {
  it("returns 400 for an invalid from date without listing entries", async () => {
    const response = await GET(new Request("http://localhost/api/entries?from=notadate"));

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({
      error: 'from must be a calendar date in YYYY-MM-DD. Received "notadate".',
    });
  });

  it("returns 400 for a reversed range", async () => {
    const response = await GET(new Request("http://localhost/api/entries?from=2026-12-01&to=2026-01-01"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'from must be on or before to. Received from "2026-12-01" and to "2026-01-01".',
    });
  });
});
