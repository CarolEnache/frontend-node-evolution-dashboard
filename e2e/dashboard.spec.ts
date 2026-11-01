import { expect, test } from "@playwright/test";

test("shows the seeded timeline, worth-learning list, and current versions", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Evolution" })).toBeVisible();
  const timeline = page.getByRole("region", { name: "Timeline" });
  await expect(timeline).toContainText("TypeScript 7.0.2");
  await expect(timeline).toContainText("Next.js 15.5.0");
  await expect(timeline).toContainText("Node.js 26.13.0 (Lithium LTS)");
  await expect(timeline).toContainText("CSS overflow-clip-margin");

  await page.getByRole("link", { name: "Worth learning", exact: true }).click();
  await expect(page).toHaveURL(/\/worth-learning/);
  const worth = page.getByRole("region", { name: "Worth learning" });
  await expect(worth).toContainText("CSS overflow-clip-margin");
  await expect(worth).toContainText("Node.js 26.12.1 security release");
  await expect(worth).toContainText("Baseline status");
  await expect(worth).not.toContainText("Next.js 15.5.0");
  await expect(worth).not.toContainText("TypeScript 7.1.0-beta");
  await expect(worth).not.toContainText("Next.js 16.4.3");

  await expect(page.getByText("26.13.0").first()).toBeVisible();
  await expect(page.getByText("16.4.3").first()).toBeVisible();
});

test("filters the timeline by source and gap", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Node.js", exact: true }).click();
  await expect(page).toHaveURL(/source=node/);
  const timeline = page.getByRole("region", { name: "Timeline" });
  await expect(timeline).toContainText("Lithium");
  await expect(timeline).not.toContainText("TypeScript 7.0.2");

  await page.getByRole("link", { name: "New", exact: true }).click();
  await expect(page).toHaveURL(/gap=new/);
  await expect(timeline).toContainText("Node.js 27.0.0-alpha");
  await expect(timeline).not.toContainText("Lithium LTS");
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

test("shows an empty slice and serves the entries API", async ({ page }) => {
  await page.goto("/?tag=zzzz-not-a-tag");
  await expect(page.getByRole("region", { name: "Timeline" })).toContainText("Nothing in this slice");

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
