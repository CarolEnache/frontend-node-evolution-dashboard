import { expect, test } from "./fixtures";

test("shows a pending state on a filter chip while the same route is refreshing", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-e2e-suspend": "1500" });
  await page.goto("/");
  const node = page.getByRole("link", { name: "Node.js", exact: true });
  const navigation = node.click();
  await expect(node).toHaveAttribute("aria-busy", "true");
  await expect(page.getByTestId("pending-indicator")).toBeVisible();
  await navigation;
  await expect(page).toHaveURL(/source=node/);
  await expect(page.getByRole("region", { name: "Timeline" })).toContainText("Lithium");
});

test("shows the route skeleton when navigating between views", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-e2e-suspend": "1500" });
  await page.goto("/");
  const navigation = page
    .getByRole("navigation", { name: "Views" })
    .getByRole("link", { name: "Worth learning", exact: true })
    .click();
  await expect(page.getByTestId("dashboard-skeleton")).toBeVisible();
  await navigation;
  await expect(page.getByRole("region", { name: "Worth learning" })).toBeVisible();
});

test("marks the filter form busy while it submits", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-e2e-suspend": "1500" });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Tag" }).selectOption("css");
  const apply = page.getByRole("button", { name: "Apply" });
  const submitted = apply.click();
  await expect(apply).toBeDisabled();
  await expect(apply).toHaveAttribute("aria-busy", "true");
  await submitted;
  await expect(page).toHaveURL(/tag=css/);
  await expect(page.getByRole("region", { name: "Timeline" })).toContainText("CSS overflow-clip-margin");
});

test("shows a loading state on a feature card when its source link is opened", async ({ page }) => {
  await page.goto("/");
  const card = page.getByTestId("entry-card").filter({ hasText: "TypeScript 7.0.2" });
  const link = card.getByRole("link", { name: "TypeScript 7.0.2" });
  await page.evaluate(`
    window.addEventListener("click", (event) => {
      const target = event.target;
      if (!target || !target.closest) return;
      const anchor = target.closest("a");
      if (anchor && anchor.origin !== window.location.origin) event.preventDefault();
    });
  `);
  await link.click();
  await expect(card).toHaveAttribute("aria-busy", "true");
  await expect(card.getByRole("status")).toContainText("Opening the source");
});
