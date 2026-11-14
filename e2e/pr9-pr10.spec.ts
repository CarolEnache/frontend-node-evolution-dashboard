import { expect, test } from "./fixtures";
import { SEED_COUNT_LABEL, SEED_ENTRY_COUNT } from "./seed";

interface ApiEntry {
  title: string;
  date: string;
  url: string;
}

test("shows the corrected and new source links, then settles with no pending card", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("pending-indicator")).toHaveCount(0);
  const timeline = page.getByRole("region", { name: "Timeline" });

  const typescript = timeline.getByRole("link", { name: "TypeScript 7.0.2" });
  await expect(typescript).toBeVisible();
  await expect(typescript).toHaveAttribute("href", "https://github.com/microsoft/TypeScript/releases/tag/v7.0.2");
  await expect(typescript).not.toHaveAttribute("target", /.+/);
  await expect(typescript).not.toHaveAttribute("rel", /.+/);
  await expect(page.getByTestId("entry-card").filter({ hasText: "TypeScript 7.0.2" })).not.toHaveAttribute(
    "aria-busy",
    "true",
  );

  await expect(timeline.getByRole("link", { name: "TC39 proposals" })).toHaveAttribute(
    "href",
    "https://github.com/tc39/proposals",
  );
  await expect(timeline.getByRole("link", { name: "2ality" })).toHaveAttribute("href", "https://2ality.com/");

  await page.goto("/worth-learning");
  const mcp = page.getByRole("region", { name: "Worth learning" }).getByRole("link", {
    name: "MCP servers 2.4.0 security release",
  });
  await expect(mcp).toBeVisible();
  await expect(mcp).toHaveAttribute("href", "https://github.com/modelcontextprotocol/servers/releases/tag/v2.4.0");
  await expect(page.getByTestId("dashboard-skeleton")).toHaveCount(0);
});

test("keeps an inclusive UTC day and ignores impossible calendar dates", async ({ page }) => {
  const all = ((await (await page.request.get("/api/entries")).json()) as { entries: ApiEntry[] }).entries;
  const byDay = new Map<string, string[]>();
  for (const entry of all) {
    const day = entry.date.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), entry.title]);
  }
  const days = [...byDay.keys()].sort();
  expect(days.length).toBeGreaterThanOrEqual(2);
  const day = days[0]!;
  const otherDay = days[days.length - 1]!;
  const inside = byDay.get(day)!;
  const outside = byDay.get(otherDay)!.find((title) => !inside.includes(title));
  expect(outside).toBeTruthy();

  await page.goto("/");
  await page.locator('input[name="from"]').fill(day);
  await page.locator('input[name="to"]').fill(day);
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(new RegExp(`from=${day}`));
  await expect(page).toHaveURL(new RegExp(`to=${day}`));
  const timeline = page.getByRole("region", { name: "Timeline" });
  for (const title of inside) await expect(timeline).toContainText(title);
  await expect(timeline).not.toContainText(outside!);

  const ranged = (await (await page.request.get(`/api/entries?from=${day}&to=${day}`)).json()) as {
    entries: ApiEntry[];
  };
  expect(ranged.entries.map((entry) => entry.title).sort()).toEqual([...inside].sort());
  expect(
    ranged.entries.every((entry) => entry.date >= `${day}T00:00:00.000Z` && entry.date <= `${day}T23:59:59.999Z`),
  ).toBe(true);

  await page.goto("/?from=2026-02-31&to=2026-11-31");
  await expect(page.getByText(SEED_COUNT_LABEL)).toBeVisible();
  await expect(timeline).toContainText("TypeScript 7.0.2");
  await expect(timeline).not.toContainText("Nothing in this slice");
  const ignored = (await (await page.request.get("/api/entries?from=2026-02-31&to=2026-04-31")).json()) as {
    entries: ApiEntry[];
  };
  expect(ignored.entries).toHaveLength(SEED_ENTRY_COUNT);
});

test("omits empty from and to when the filter form is submitted", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[name="from"]').fill("2000-01-01");
  await page.locator('input[name="to"]').fill("2000-01-02");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/from=2000-01-01/);
  await expect(page.getByRole("region", { name: "Timeline" })).toContainText("Nothing in this slice");

  await page.locator('input[name="from"]').fill("");
  await page.locator('input[name="to"]').fill("");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).not.toHaveURL(/from=/);
  await expect(page).not.toHaveURL(/to=/);
  await expect(page.getByText(SEED_COUNT_LABEL)).toBeVisible();
});

test("filters cards from the tag dropdown, including a tag added in #9", async ({ page }) => {
  await page.goto("/");
  const tag = page.getByRole("combobox", { name: "Tag" });
  await expect(tag.getByRole("option", { name: "All tags" })).toBeAttached();
  await expect(tag.getByRole("option", { name: "newsletter" })).toBeAttached();
  await expect(tag.getByRole("option", { name: "mcp" })).toBeAttached();
  const labels = await tag.locator("option").allTextContents();
  const options = labels.slice(1);
  expect([...options].sort((left, right) => left.localeCompare(right))).toEqual(options);

  await tag.selectOption("newsletter");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/tag=newsletter/);
  const timeline = page.getByRole("region", { name: "Timeline" });
  await expect(timeline).toContainText("JavaScript Weekly");
  await expect(timeline).toContainText("Bytes");
  await expect(timeline).not.toContainText("TypeScript 7.0.2");
  await expect(page.getByText("2 in view")).toBeVisible();

  await tag.selectOption({ label: "All tags" });
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).not.toHaveURL(/tag=/);
  await expect(timeline).toContainText("TypeScript 7.0.2");
  await expect(page.getByText(SEED_COUNT_LABEL)).toBeVisible();
});
