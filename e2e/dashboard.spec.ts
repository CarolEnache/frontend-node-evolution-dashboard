import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

function versionChip(page: Page, source: string): Locator {
  const pattern = new RegExp(`^${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  return page.locator("dt", { hasText: pattern }).locator("xpath=following-sibling::dd[1]");
}

test("shows the seeded timeline, worth-learning list, and current versions", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Evolution" })).toBeVisible();
  const timeline = page.getByRole("region", { name: "Timeline" });
  await expect(timeline).toContainText("TypeScript 7.0.2");
  await expect(timeline).toContainText("Next.js 15.5.0");
  await expect(timeline).toContainText("Node.js 26.13.0 (Lithium LTS)");
  await expect(timeline.getByRole("heading", { level: 2 }).first()).toContainText(/week of/i);

  const worth = page.getByRole("complementary", { name: "Worth learning" });
  await expect(worth).toContainText("TypeScript 7.1.0-beta");
  await expect(worth).toContainText("Cache Components in Next.js 16");
  await expect(worth).not.toContainText("Next.js 15.5.0");
  await expect(worth).not.toContainText("Next.js 16.4.3");
  await expect(worth).not.toContainText("Lithium LTS");

  await expect(page.getByText("10 in view")).toBeVisible();
  await expect(versionChip(page, "Node.js")).toHaveText("26.13.0");
  await expect(versionChip(page, "Next.js")).toHaveText("16.4.3");
  await expect(versionChip(page, "MDN")).toHaveText("8.1.7");
  await expect(page.getByText(/Checked \d{1,2} \w{3} \d{4}/).first()).toBeVisible();
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
  await expect(timeline).not.toContainText("Lithium LTS");

  const worth = page.getByRole("complementary", { name: "Worth learning" });
  await expect(worth).toContainText("Node.js 27.0.0-alpha");
  await expect(worth).toContainText("26.12.1 security release");
  await expect(worth).not.toContainText("TypeScript");
  await expect(worth).not.toContainText("26.13.0");
});

test("shows an empty slice and serves the entries API", async ({ page }) => {
  await page.goto("/?tag=zzzz-not-a-tag");
  await expect(page.getByRole("region", { name: "Timeline" })).toContainText("Nothing in this slice");
  await expect(page.getByText("0 in view")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Worth learning" })).toContainText(
    "Nothing adjacent or new in the last 30 days",
  );

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
  await expect(page.getByRole("complementary", { name: "Worth learning" })).toContainText(
    "Node.js 26.12.1 security release",
  );

  await page.getByRole("link", { name: "Any type" }).click();
  await expect(page).not.toHaveURL(/type=/);
  await expect(timeline).toContainText("TypeScript 7.0.2");
  await page.getByRole("textbox", { name: "Tag" }).fill("css");
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
  const worth = page.getByRole("complementary", { name: "Worth learning" });
  await expect(timeline.getByTitle("86% similar to your profile")).toContainText("Already know");
  await expect(timeline.getByTitle("61% similar to your profile")).toContainText("Adjacent");
  await expect(timeline.getByTitle("40% similar to your profile")).toContainText("New");
  await expect(worth.getByTitle("40% similar to your profile")).toContainText("New");
  await expect(worth.getByTitle("61% similar to your profile")).toContainText("Adjacent");
  await expect(worth.getByTitle("86% similar to your profile")).toHaveCount(0);
  await expect(worth.getByTitle("80% similar to your profile")).toHaveCount(0);
});

test("hides the timeline for an unknown source, gap, or type", async ({ page }) => {
  await page.goto("/?source=not-a-source");
  await expect(page.getByRole("region", { name: "Timeline" })).toContainText("Nothing in this slice");
  await expect(page.getByRole("complementary", { name: "Worth learning" })).toContainText(
    "Nothing adjacent or new",
  );

  await page.goto("/?gap=nope&type=Release");
  await expect(page.getByRole("region", { name: "Timeline" })).toContainText("Nothing in this slice");
  await expect(page.getByText("0 in view")).toBeVisible();
});

test("ignores dates that are not YYYY-MM-DD", async ({ page }) => {
  await page.goto("/?from=yesterday&to=2026-13-40");
  await expect(page.getByText("10 in view")).toBeVisible();
  await expect(page.getByRole("region", { name: "Timeline" })).toContainText("Next.js 15.5.0");
});

test("shows the stable TypeScript release on the version chip", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Asserted once on desktop Chromium");
  test.fail(
    true,
    "TODO: preferredVersion treats a TypeScript beta (type release) as the current stable version, so the chip shows 7.1.0-beta instead of 7.0.2",
  );
  await page.goto("/");
  await expect(versionChip(page, "TypeScript")).toHaveText("7.0.2");
});

test("places worth learning beside the timeline on a wide viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium");
  await page.goto("/");
  const timeline = await page.getByRole("region", { name: "Timeline" }).boundingBox();
  const worth = await page.getByRole("complementary", { name: "Worth learning" }).boundingBox();
  expect(timeline).not.toBeNull();
  expect(worth).not.toBeNull();
  expect(Math.abs((worth?.y ?? 0) - (timeline?.y ?? 0))).toBeLessThan(80);
  expect((worth?.x ?? 0)).toBeGreaterThan((timeline?.x ?? 0) + (timeline?.width ?? 0) - 8);
});

test("stacks worth learning under the timeline on a narrow viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  await page.goto("/");
  const timeline = await page.getByRole("region", { name: "Timeline" }).boundingBox();
  const worth = await page.getByRole("complementary", { name: "Worth learning" }).boundingBox();
  expect(timeline).not.toBeNull();
  expect(worth).not.toBeNull();
  expect((worth?.y ?? 0)).toBeGreaterThan((timeline?.y ?? 0) + (timeline?.height ?? 0) - 4);
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
  expect(external).toEqual([]);
});
