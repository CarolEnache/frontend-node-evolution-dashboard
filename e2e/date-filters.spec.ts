import { expect, test } from "./fixtures";
import { SEED_COUNT_LABEL } from "./seed";

test("shows a notice for an invalid from date and ignores that bound", async ({ page }) => {
  await page.goto("/?from=notadate");

  const notice = page.getByRole("alert", { name: "Date filter" });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('From "notadate" is not a valid date');
  await expect(notice).toContainText("That bound was ignored");
  await expect(page.locator('input[name="from"]')).toHaveValue("");
  await expect(page.locator('input[name="from"]')).toHaveAttribute("aria-describedby", "date-filter-notice");
  await expect(page.getByRole("link", { name: "All dates" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText(SEED_COUNT_LABEL)).toBeVisible();
  await expect(page.getByRole("region", { name: "Timeline" })).toContainText("Next.js 15.5.0");
  await expect(page.getByRole("link", { name: "Worth learning", exact: true })).toHaveAttribute("href", "/worth-learning");
});

test("warns and swaps a reversed date range", async ({ page }) => {
  await page.goto("/?from=2026-12-01&to=2026-01-01");

  const notice = page.getByRole("alert", { name: "Date filter" });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("From is after To");
  await expect(notice).toContainText("The range was swapped to 2026-01-01 through 2026-12-01");
  await expect(page.locator('input[name="from"]')).toHaveValue("2026-01-01");
  await expect(page.locator('input[name="to"]')).toHaveValue("2026-12-01");
  await expect(page.getByRole("link", { name: "All dates" })).not.toHaveAttribute("aria-current", "page");
  await expect(page.getByText(SEED_COUNT_LABEL)).toBeVisible();
  await expect(page.getByRole("region", { name: "Timeline" })).toContainText("Next.js 15.5.0");
  await expect(page.getByRole("region", { name: "Timeline" })).not.toContainText("Nothing in this slice");
});

test("returns 400 for an invalid from date", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "The entries API is asserted once");

  const response = await request.get("/api/entries?from=notadate");
  expect(response.status()).toBe(400);
  expect(response.headers()["content-type"]).toContain("application/json");
  expect(await response.json()).toEqual({
    error: 'from must be a calendar date in YYYY-MM-DD. Received "notadate".',
  });
});
