import { expect, test } from "./fixtures";

test("exposes the main controls by role and label", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Evolution" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Timeline" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Views" })).toBeVisible();
  await page.getByRole("link", { name: "Worth learning", exact: true }).click();
  await expect(page.getByRole("region", { name: "Worth learning" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Worth learning" })).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Tag" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply" })).toBeEnabled();
  await expect(page.getByRole("link", { name: "All sources" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "Any gap" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "All dates" })).toHaveAttribute("aria-current", "page");

  const entry = page.getByRole("region", { name: "Timeline" }).getByRole("link", { name: "TypeScript 7.0.2" });
  await expect(entry).toHaveAttribute("href", /typescript/i);
});

test("moves through source filters and the tag field from the keyboard", async ({ page }) => {
  await page.goto("/");
  const allSources = page.getByRole("link", { name: "All sources" });
  await allSources.focus();
  await expect(allSources).toBeFocused();

  await page.keyboard.press("Tab");
  const mdn = page.getByRole("link", { name: "MDN", exact: true });
  await expect(mdn).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/source=mdn-bcd/);
  await expect(mdn).toHaveAttribute("aria-current", "page");
  await expect(allSources).not.toHaveAttribute("aria-current", "page");

  const timeline = page.getByRole("region", { name: "Timeline" });
  await expect(timeline).toContainText("CSS overflow-clip-margin");
  await expect(timeline).not.toContainText("TypeScript 7.0.2");

  const tag = page.getByRole("textbox", { name: "Tag" });
  await tag.focus();
  await page.keyboard.type("css");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/source=mdn-bcd/);
  await expect(page).toHaveURL(/tag=css/);
  await expect(timeline).toContainText("overflow-clip-margin");
  await expect(timeline).not.toContainText("CSS Grid");

  await page.getByRole("button", { name: "Apply" }).focus();
  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.press("Shift+Tab");
    if (await tag.evaluate((element) => element === element.ownerDocument.activeElement)) break;
  }
  await expect(tag).toBeFocused();
});
