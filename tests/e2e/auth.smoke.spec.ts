import { loginIfNeeded } from "./helpers/auth";
import { getMissingAuthReason } from "./helpers/env";
import { test, expect } from "./helpers/test";

const missingAuthReason = getMissingAuthReason();

test.describe("app boot smoke", () => {
  test.skip(Boolean(missingAuthReason), missingAuthReason ?? "");

  test("loads the authenticated shell without a blocking crash", async ({ page }) => {
    await loginIfNeeded(page);

    await expect(page).toHaveURL(/\/app\/dashboard/);
    await expect(page.getByRole("heading", { name: /dashboard/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /dashboard/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /list management/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /inventory management/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /invoices \(receiving\)/i })).toBeVisible();
  });
});
