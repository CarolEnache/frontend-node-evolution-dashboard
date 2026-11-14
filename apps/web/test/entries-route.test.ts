import { SOURCES } from "@evolution/shared-types";
import { describe, expect, it } from "vitest";
import { GET } from "../src/app/api/entries/route";

describe("GET /api/entries source validation", () => {
  it("returns 400 for an unknown source and does not pretend the timeline is empty", async () => {
    const response = await GET(new Request("http://localhost/api/entries?source=bogus"));
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({
      error: `Unknown source "bogus". Expected one of: ${SOURCES.join(", ")}.`,
    });
  });

  it("returns 400 when an unknown source is combined with another bad filter", async () => {
    const response = await GET(new Request("http://localhost/api/entries?source=not-a-source&gap=nope"));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string; entries?: unknown };
    expect(body.entries).toBeUndefined();
    expect(body.error).toContain('Unknown source "not-a-source"');
    expect(body.error).toContain(SOURCES.join(", "));
  });

  it("keeps an empty 200 for an unknown gap when the source is known", async () => {
    const response = await GET(new Request("http://localhost/api/entries?source=node&gap=not-a-gap&type=Release"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ entries: [] });
  });
});
