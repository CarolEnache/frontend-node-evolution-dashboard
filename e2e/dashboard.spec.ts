import type { Locator, Page } from "@playwright/test";
import { drainFlood, floodOlderSources } from "./database";
import { expect, test } from "./fixtures";
import { SEED_COUNT_LABEL } from "./seed";

function versionChip(page: Page, source: string): Locator {
  const pattern = new RegExp(`^${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  return page.locator("dt", { hasText: pattern }).locator("xpath=following-sibling::dd[1]");
}

test("shows the seeded timeline, worth-learning list, and current versions", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Evolution" })).toBeVisible();
  const timeline = page.getByRole("region", { name: "Timeline" });
  await expect(timeline).toContainText("TypeScript 7.0.2");
  await expect(timeline).toContainText("TypeScript 7.1.0-beta");
  await expect(timeline).toContainText("Next.js 15.5.0");
  await expect(timeline).toContainText("Node.js 26.13.0 (Lithium LTS)");
  await expect(timeline).toContainText("CSS overflow-clip-margin");
  await expect(timeline.getByRole("heading", { level: 2 }).first()).toContainText(/week of/i);

  await expect(page.getByText(SEED_COUNT_LABEL)).toBeVisible();
  await expect(versionChip(page, "Node.js")).toHaveText("26.13.0");
  await expect(versionChip(page, "Next.js")).toHaveText("16.4.3");
  await expect(versionChip(page, "TypeScript")).toHaveText("7.0.2");
  await expect(versionChip(page, "MDN")).toHaveText("8.1.7");
  await expect(page.getByText(/Checked \d{1,2} \w{3} \d{4}/).first()).toBeVisible();

  await page.getByRole("link", { name: "Worth learning", exact: true }).click();
  await expect(page).toHaveURL(/\/worth-learning$/);
  const worth = page.getByRole("region", { name: "Worth learning" });
  await expect(worth).toContainText("CSS overflow-clip-margin");
  await expect(worth).toContainText("Baseline status");
  await expect(worth).toContainText("CSS Grid support in Firefox");
  await expect(worth).toContainText("Browser support change");
  await expect(worth).toContainText("Node.js 26.12.1 security release");
  await expect(worth).toContainText("Security release");
  await expect(worth).toContainText("Node.js 26.13.0 (Lithium LTS)");
  await expect(worth).toContainText("LTS release");
  await expect(worth).not.toContainText("TypeScript 7.1.0-beta");
  await expect(worth).not.toContainText("Node.js 27.0.0-alpha");
  await expect(worth).not.toContainText("Next.js 15.5.0");
  await expect(worth).not.toContainText("Next.js 16.4.3");
  await expect(worth).not.toContainText("Cache Components in Next.js 16");
  await expect(worth).not.toContainText("TypeScript 7.0.2");
});

test("filters the timeline by source and gap", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Node.js", exact: true }).click();
  await expect(page).toHaveURL(/source=node/);
  await expect(page.getByRole("link", { name: "Node.js", exact: true })).toHaveAttribute("aria-current", "page");
  const timeline = page.getByRole("region", { name: "Timeline" });
  await expect(timeline).toContainText("Lithium");
  await expect(timeline).not.toContainText("TypeScript 7.0.2");

  await page.getByRole("link", { name: "New", exact: true }).click();
  await expect(page).toHaveURL(/gap=new/);
  await expect(timeline).toContainText("Node.js 27.0.0-alpha");
  await expect(timeline).toContainText("26.12.1 security release");
  await expect(timeline).not.toContainText("Lithium LTS");

  await page.getByRole("link", { name: "Worth learning", exact: true }).click();
  await expect(page).toHaveURL(/\/worth-learning\?/);
  const worth = page.getByRole("region", { name: "Worth learning" });
  await expect(worth).toContainText("Node.js 26.12.1 security release");
  await expect(worth).not.toContainText("Node.js 27.0.0-alpha");
  await expect(worth).not.toContainText("TypeScript");
  await expect(worth).not.toContainText("26.13.0");
});

test("filters the timeline by an explicit date range", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "From", exact: true }).fill("2000-01-01");
  await page.getByRole("textbox", { name: "To", exact: true }).fill("2000-01-02");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/from=2000-01-01/);
  await expect(page).toHaveURL(/to=2000-01-02/);
  await expect(page.getByRole("region", { name: "Timeline" })).toContainText("Nothing in this slice");
});

test("applies from and to dates chosen in the filter form", async ({ page }) => {
  // Seed dates are relative to when the database was seeded, so derive the window
  // and the expected slice from the seeded rows instead of hardcoding calendar days.
  type ApiEntry = { title: string; date: string };
  const all = ((await (await page.request.get("/api/entries")).json()) as { entries: ApiEntry[] }).entries;
  const days = [...new Set(all.map((entry) => entry.date.slice(0, 10)))].sort().reverse();
  expect(days.length).toBeGreaterThanOrEqual(4);
  const to = days[1]!;
  const from = days[days.length - 2]!;
  const inWindow = (entry: ApiEntry) => entry.date.slice(0, 10) >= from && entry.date.slice(0, 10) <= to;
  const expected = all.filter(inWindow).map((entry) => entry.title);
  const newest = all.find((entry) => entry.date.slice(0, 10) > to)!;
  const oldest = all.find((entry) => entry.date.slice(0, 10) < from)!;

  await page.goto("/");
  await page.locator('input[name="from"]').fill(from);
  await page.locator('input[name="to"]').fill(to);
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(new RegExp(`from=${from}`));
  await expect(page).toHaveURL(new RegExp(`to=${to}`));
  const timeline = page.getByRole("region", { name: "Timeline" });
  await expect(timeline).toContainText(expected[0]!);
  await expect(timeline).not.toContainText(newest.title);
  await expect(timeline).not.toContainText(oldest.title);
  await expect(page.getByText(`${expected.length} in view`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply" })).toBeEnabled();

  const response = await page.request.get(`/api/entries?from=${from}&to=${to}`);
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { entries: ApiEntry[] };
  expect(body.entries.map((entry) => entry.title)).toEqual(expected);
  expect(body.entries.every(inWindow)).toBe(true);
});

test("shows an empty slice and serves the entries API", async ({ page }) => {
  await page.goto("/?tag=zzzz-not-a-tag");
  await expect(page.getByRole("region", { name: "Timeline" })).toContainText("Nothing in this slice");
  await expect(page.getByText("0 in view")).toBeVisible();

  await page.goto("/worth-learning?tag=zzzz-not-a-tag");
  await expect(page.getByRole("region", { name: "Worth learning" })).toContainText("Nothing worth learning in this slice");

  const response = await page.request.get("/api/entries?source=typescript");
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { entries: Array<{ title: string }> };
  expect(body.entries.some((entry) => entry.title.includes("TypeScript 7.0.2"))).toBe(true);

  const denied = await page.request.post("/api/revalidate");
  expect(denied.status()).toBe(401);
  const allowed = await page.request.post("/api/revalidate", {
    headers: { authorization: "Bearer e2e-revalidate-secret" },
  });
  expect(allowed.ok()).toBeTruthy();
});

test("filters by type, tag, and date window", async ({ page }) => {
  await page.goto("/");
  const timeline = page.getByRole("region", { name: "Timeline" });

  await page.getByRole("link", { name: "Security", exact: true }).click();
  await expect(page).toHaveURL(/type=security/);
  await expect(timeline).toContainText("Node.js 26.12.1 security release");
  await expect(timeline).not.toContainText("Node.js 26.13.0 (Lithium LTS)");
  await expect(timeline).not.toContainText("TypeScript 7.0.2");

  await page.goto("/worth-learning?type=security");
  await expect(page.getByRole("region", { name: "Worth learning" })).toContainText("Node.js 26.12.1 security release");
  await page.goto("/?type=security");

  await page.getByRole("link", { name: "Any type" }).click();
  await expect(page).not.toHaveURL(/type=/);
  await expect(timeline).toContainText("TypeScript 7.0.2");
  await page.getByRole("combobox", { name: "Tag" }).selectOption("css");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/tag=css/);
  await expect(timeline).toContainText("CSS overflow-clip-margin");
  await expect(timeline).toContainText("CSS Grid support in Firefox");
  await expect(timeline).not.toContainText("TypeScript 7.0.2");

  await page.goto("/");
  await page.getByRole("link", { name: "30 days" }).click();
  await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}/);
  await expect(page.getByRole("link", { name: "30 days" })).toHaveAttribute("aria-current", "page");
  await expect(timeline).not.toContainText("Next.js 15.5.0");
  await expect(timeline).toContainText("TypeScript 7.0.2");

  await page.getByRole("link", { name: "90 days" }).click();
  await expect(timeline).toContainText("Next.js 15.5.0");

  await page.getByRole("link", { name: "All dates" }).click();
  await expect(page).not.toHaveURL(/from=/);
  await expect(timeline).toContainText("Next.js 15.5.0");
});

test("clears a source filter when the active source is chosen again", async ({ page }) => {
  await page.goto("/");
  const node = page.getByRole("link", { name: "Node.js", exact: true });
  await node.click();
  await expect(page).toHaveURL(/source=node/);
  await node.click();
  await expect(page).not.toHaveURL(/source=/);
  await expect(page.getByRole("region", { name: "Timeline" })).toContainText("TypeScript 7.0.2");
  await expect(page.getByRole("link", { name: "All sources" })).toHaveAttribute("aria-current", "page");
});

test("shows gap badges and how close each item is to the profile", async ({ page }) => {
  await page.goto("/");
  const timeline = page.getByRole("region", { name: "Timeline" });
  await expect(timeline.getByTitle("86% similar to your profile")).toContainText("Already know");
  await expect(timeline.getByTitle("61% similar to your profile")).toContainText("Adjacent");
  const beta = timeline.getByRole("listitem").filter({ has: page.getByRole("link", { name: "TypeScript 7.1.0-beta" }) });
  await expect(beta.getByTitle("40% similar to your profile")).toContainText("New");
  await expect(timeline.getByTitle("80% similar to your profile")).toContainText("Already know");

  await page.goto("/worth-learning");
  const worth = page.getByRole("region", { name: "Worth learning" });
  await expect(worth.getByTitle("86% similar to your profile")).toHaveCount(0);
  await expect(worth.getByTitle("80% similar to your profile")).toHaveCount(0);
  await expect(worth.getByText("LTS release", { exact: true })).toBeVisible();
  const nodeSecurity = worth
    .getByRole("listitem")
    .filter({ has: page.getByRole("link", { name: "Node.js 26.12.1 security release" }) });
  await expect(nodeSecurity.getByText("Security release", { exact: true })).toBeVisible();
});

test("hides the timeline for an unknown source, gap, or type", async ({ page }) => {
  await page.goto("/?source=not-a-source");
  await expect(page.getByRole("region", { name: "Timeline" })).toContainText("Those filters are not recognised");
  await expect(page.getByText("0 in view")).toBeVisible();

  await page.goto("/worth-learning?source=not-a-source");
  await expect(page.getByRole("region", { name: "Worth learning" })).toContainText("Those filters are not recognised");

  await page.goto("/?gap=nope&type=Release");
  await expect(page.getByRole("region", { name: "Timeline" })).toContainText("Those filters are not recognised");
  await expect(page.getByText("0 in view")).toBeVisible();
});

test("ignores dates that are not YYYY-MM-DD", async ({ page }) => {
  await page.goto("/?from=yesterday&to=2026-13-40");
  await expect(page.getByText(SEED_COUNT_LABEL)).toBeVisible();
  await expect(page.getByRole("region", { name: "Timeline" })).toContainText("Next.js 15.5.0");
});

test("shows the stable TypeScript release on the version chip", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Asserted once on desktop Chromium");
  await page.goto("/");
  const timeline = page.getByRole("region", { name: "Timeline" });
  await expect(timeline).toContainText("TypeScript 7.1.0-beta");
  await expect(versionChip(page, "TypeScript")).toHaveText("7.0.2");
});

test("places the count beside the title on a wide viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop layout is asserted on the Chromium project");
  await page.goto("/");
  const title = await page.getByRole("heading", { name: "Evolution" }).boundingBox();
  const count = await page.getByText(SEED_COUNT_LABEL).boundingBox();
  expect(title).not.toBeNull();
  expect(count).not.toBeNull();
  expect((count?.x ?? 0)).toBeGreaterThan((title?.x ?? 0) + (title?.width ?? 0) - 8);
  expect((count?.y ?? 0)).toBeLessThan((title?.y ?? 0) + (title?.height ?? 0) + 96);
});

test("stacks the count under the title on a narrow viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "Narrow layout is asserted on the Pixel 5 project");
  await page.goto("/");
  const title = await page.getByRole("heading", { name: "Evolution" }).boundingBox();
  const count = await page.getByText(SEED_COUNT_LABEL).boundingBox();
  expect(title).not.toBeNull();
  expect(count).not.toBeNull();
  expect((count?.y ?? 0)).toBeGreaterThan((title?.y ?? 0) + (title?.height ?? 0) - 4);
});

test("does not call the network while rendering the dashboard", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (request) => {
    const { hostname } = new URL(request.url());
    if (hostname !== "127.0.0.1" && hostname !== "localhost") external.push(request.url());
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Evolution" })).toBeVisible();
  await page.getByRole("link", { name: "TypeScript", exact: true }).click();
  await expect(page).toHaveURL(/source=typescript/);
  await page.goto("/worth-learning");
  await expect(page.getByRole("region", { name: "Worth learning" })).toBeVisible();
  expect(external).toEqual([]);
});

test("keeps a buried source behind more than 1000 newer rows", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "The capped timeline is asserted once on desktop Chromium");
  floodOlderSources();
  try {
    await page.goto("/?source=node");
    const timeline = page.getByRole("region", { name: "Timeline" });
    await expect(timeline).toContainText("Node.js 12.22.12 buried release");
    await expect(timeline).toContainText("Node.js 26.13.0 (Lithium LTS)");
    await expect(timeline).not.toContainText("TypeScript 7.0.2");
    await expect(versionChip(page, "Node.js")).toHaveText("26.13.0");
    await expect(versionChip(page, "TypeScript")).toHaveText("7.0.2");
    await expect(versionChip(page, "Next.js")).toHaveText("16.4.3");

    const buried = await page.request.get("/api/entries?source=node&from=2019-01-01&to=2019-12-31");
    expect(buried.ok()).toBeTruthy();
    const buriedBody = (await buried.json()) as { entries: Array<{ title: string }> };
    expect(buriedBody.entries.map((entry) => entry.title)).toEqual(["Node.js 12.22.12 buried release"]);

    const typescript = await page.request.get("/api/entries?source=typescript");
    expect(typescript.ok()).toBeTruthy();
    const typescriptBody = (await typescript.json()) as { entries: Array<{ title: string }> };
    expect(typescriptBody.entries.some((entry) => entry.title === "TypeScript 7.0.2")).toBe(true);

    await page.goto("/worth-learning?source=node&from=2019-01-01&to=2019-12-31");
    await expect(page.getByRole("region", { name: "Worth learning" })).toContainText("Node.js 12.22.12 buried release");
    await expect(versionChip(page, "Node.js")).toHaveText("26.13.0");
  } finally {
    drainFlood();
  }
});
