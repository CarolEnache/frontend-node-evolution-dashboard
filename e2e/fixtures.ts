import { test as base } from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route(/^https?:\/\/(?!(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$))/, (route) =>
      route.abort("blockedbyclient"),
    );
    await use(page);
  },
});

export { expect } from "@playwright/test";
