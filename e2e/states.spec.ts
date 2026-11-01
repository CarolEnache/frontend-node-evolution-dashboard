import { corruptDatabase, emptyDatabase, seedDatabase } from "./database";
import { expect, test } from "./fixtures";

test("shows the loading skeleton while the timeline stream is pending", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-e2e-suspend": "1200" });
  const navigation = page.goto("/", { waitUntil: "commit" });
  await expect(page.getByTestId("dashboard-skeleton")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Evolution" })).toHaveCount(0);
  await navigation;
  await expect(page.getByRole("heading", { name: "Evolution" })).toBeVisible();
  await expect(page.getByTestId("dashboard-skeleton")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Timeline" })).toContainText("TypeScript 7.0.2");
});

test("shows the empty-data state when the database has no entries", async ({ page }) => {
  emptyDatabase();
  try {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "The timeline is empty" })).toBeVisible();
    await expect(page.getByText("Run pnpm db:setup to load the local seed")).toBeVisible();
    await expect(page.getByText("0 in view")).toBeVisible();
    await expect(page.getByText("No successful run").first()).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Worth learning" })).toContainText(
      "Nothing adjacent or new in the last 30 days",
    );

    const response = await page.request.get("/api/entries");
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ entries: [] });
  } finally {
    seedDatabase();
  }
});

test("shows the error boundary and recovers after Try again", async ({ page }) => {
  corruptDatabase();
  try {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "The timeline did not load" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(page.getByText("Evolution", { exact: true }).first()).toBeVisible();

    seedDatabase();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { name: "Evolution" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Timeline" })).toContainText("TypeScript 7.0.2");
    await expect(page.getByText("10 in view")).toBeVisible();
  } finally {
    seedDatabase();
  }
});
