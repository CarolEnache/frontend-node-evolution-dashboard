import { expect, test } from "./fixtures";

test("the dashboard and /api/entries agree when tag is repeated", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "The page and entries API are compared once");

  await page.goto("/?tag=css&tag=node");
  await expect(page.getByTestId("tag-select")).toHaveValue("css");

  const timeline = page.getByRole("region", { name: "Timeline" });
  const entryLinks = timeline.getByTestId("entry-card").getByRole("link");
  await expect(entryLinks).toHaveCount(2);
  const pageTitles = (await entryLinks.allTextContents()).map((title) => title.trim()).sort();

  const repeated = await request.get("/api/entries?tag=css&tag=node");
  expect(repeated.status()).toBe(200);
  const repeatedBody = (await repeated.json()) as { entries: Array<{ title: string }> };
  const repeatedTitles = repeatedBody.entries.map((entry) => entry.title).sort();

  const first = await request.get("/api/entries?tag=css");
  const firstTitles = ((await first.json()) as { entries: Array<{ title: string }> }).entries
    .map((entry) => entry.title)
    .sort();
  const last = await request.get("/api/entries?tag=node");
  const lastTitles = ((await last.json()) as { entries: Array<{ title: string }> }).entries
    .map((entry) => entry.title)
    .sort();

  expect(pageTitles).toEqual(repeatedTitles);
  expect(repeatedTitles).toEqual(firstTitles);
  expect(repeatedTitles).toEqual(["CSS Grid support in Firefox", "CSS overflow-clip-margin"]);
  expect(repeatedTitles).not.toEqual(lastTitles);
  await expect(timeline).not.toContainText("Node.js 26.13.0 (Lithium LTS)");
});
