import { expect, test } from "@playwright/test";
import { SEED_ENTRY_COUNT } from "./seed";

interface Entry {
  id: string;
  source: string;
  type: string;
  title: string;
  date: string;
  url: string;
  summary: string;
  tags: string[];
  gap?: string;
}

const ENTRY_KEYS = ["id", "source", "type", "title", "date", "url", "summary", "tags"] as const;

async function entries(response: { json: () => Promise<unknown> }): Promise<Entry[]> {
  const body = (await response.json()) as { entries?: Entry[] };
  expect(Array.isArray(body.entries)).toBe(true);
  return body.entries ?? [];
}

test("returns the seeded timeline as JSON", async ({ request }) => {
  const response = await request.get("/api/entries");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");
  const list = await entries(response);
  expect(list).toHaveLength(SEED_ENTRY_COUNT);
  for (const entry of list) {
    for (const key of ENTRY_KEYS) expect(entry[key]).toBeDefined();
    expect(Array.isArray(entry.tags)).toBe(true);
    expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(entry.url).toMatch(/^https:\/\//);
  }
  expect(list.some((entry) => entry.title === "TypeScript 7.0.2" && entry.gap === "adjacent")).toBe(true);
  const next = list.find((entry) => entry.title === "Next.js 16.4.3");
  expect(next?.summary).toBe(
    "This release is backporting bug fixes. It does not include all pending features/changes on canary. Core Changes Stable Next.js 16.4.3. Turbopack is the default for dev and build. Fix RSC navigation and runtime prefetches in next start. See the upgrade guide.",
  );
});

test("filters entries by source, type, gap, tag, and date", async ({ request }) => {
  const typescript = await entries(await request.get("/api/entries?source=typescript"));
  expect(typescript.length).toBeGreaterThan(0);
  expect(typescript.every((entry) => entry.source === "typescript")).toBe(true);
  expect(typescript.some((entry) => entry.title === "TypeScript 7.0.2")).toBe(true);

  const security = await entries(await request.get("/api/entries?type=security"));
  expect(security.map((entry) => entry.title)).toEqual([
    "MCP servers 2.4.0 security release",
    "Node.js 26.12.1 security release",
  ]);

  const fresh = await entries(await request.get("/api/entries?gap=new"));
  expect(fresh.length).toBeGreaterThan(0);
  expect(fresh.every((entry) => entry.gap === "new")).toBe(true);

  const css = await entries(await request.get("/api/entries?tag=css"));
  expect(css.map((entry) => entry.title).sort()).toEqual([
    "CSS Grid support in Firefox",
    "CSS overflow-clip-margin",
  ]);

  const all = await entries(await request.get("/api/entries"));
  const stale = all.find((entry) => entry.title === "Next.js 15.5.0");
  expect(stale).toBeDefined();
  const dayAfter = new Date(Date.parse(stale?.date ?? ""));
  dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
  const from = dayAfter.toISOString().slice(0, 10);
  const recent = await entries(await request.get(`/api/entries?from=${from}`));
  expect(recent.some((entry) => entry.title === "Next.js 15.5.0")).toBe(false);
  expect(recent.some((entry) => entry.title === "TypeScript 7.0.2")).toBe(true);

  const until = stale?.date.slice(0, 10);
  const older = await entries(await request.get(`/api/entries?to=${until}`));
  expect(older.some((entry) => entry.title === "Next.js 15.5.0")).toBe(true);
  expect(older.some((entry) => entry.title === "TypeScript 7.1.0-beta")).toBe(false);
});

test("rejects bad filter input without querying external services", async ({ request }) => {
  const invalidSource = await request.get("/api/entries?source=not-a-source");
  expect(invalidSource.status()).toBe(200);
  expect(await entries(invalidSource)).toEqual([]);

  const invalidCombo = await request.get("/api/entries?source=node&gap=not-a-gap&type=Release");
  expect(invalidCombo.status()).toBe(200);
  expect(await entries(invalidCombo)).toEqual([]);

  const ignoredDate = await request.get("/api/entries?from=yesterday&to=2026-13-40");
  expect(ignoredDate.status()).toBe(200);
  expect(await entries(ignoredDate)).toHaveLength(SEED_ENTRY_COUNT);

  const future = await request.get("/api/entries?from=2999-01-01");
  expect(future.status()).toBe(200);
  expect(await entries(future)).toEqual([]);

  const hostile = await request.get(`/api/entries?tag=${encodeURIComponent(`%" OR 1=1 --`)}&source=${encodeURIComponent("node;drop")}`);
  expect(hostile.status()).toBe(200);
  expect(await entries(hostile)).toEqual([]);

  const unknown = await request.get("/api/entries?limit=1&page=99");
  expect(unknown.status()).toBe(200);
  expect(await entries(unknown)).toHaveLength(SEED_ENTRY_COUNT);
});

test("returns 405 for unsupported entry methods", async ({ request }) => {
  for (const method of ["POST", "PUT", "DELETE"] as const) {
    const response = await request.fetch("/api/entries", { method });
    expect(response.status(), method).toBe(405);
  }
});

test("guards revalidate and reports its result", async ({ request }) => {
  const missing = await request.post("/api/revalidate");
  expect(missing.status()).toBe(401);
  expect(await missing.json()).toEqual({ ok: false, error: "Unauthorized" });

  const wrong = await request.post("/api/revalidate", {
    headers: { authorization: "Bearer wrong-secret" },
  });
  expect(wrong.status()).toBe(401);
  expect(await wrong.json()).toEqual({ ok: false, error: "Unauthorized" });

  const lowercase = await request.post("/api/revalidate", {
    headers: { authorization: "bearer e2e-revalidate-secret" },
  });
  expect(lowercase.status()).toBe(401);

  const bare = await request.post("/api/revalidate", {
    headers: { authorization: "e2e-revalidate-secret" },
  });
  expect(bare.status()).toBe(401);

  const allowed = await request.post("/api/revalidate", {
    headers: { authorization: "Bearer e2e-revalidate-secret" },
    data: { ignored: true },
  });
  expect(allowed.status()).toBe(200);
  expect(allowed.headers()["content-type"]).toContain("application/json");
  expect(await allowed.json()).toEqual({ ok: true, tag: "entries" });

  for (const method of ["GET", "PUT", "DELETE"] as const) {
    const response = await request.fetch("/api/revalidate", { method });
    expect(response.status(), method).toBe(405);
  }
});
