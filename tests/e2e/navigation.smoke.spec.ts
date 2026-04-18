import { loginIfNeeded } from "./helpers/auth";
import { getMissingAuthReason } from "./helpers/env";
import { test, expect } from "./helpers/test";

const missingAuthReason = getMissingAuthReason();

test.describe("navigation smoke", () => {
  test.skip(Boolean(missingAuthReason), missingAuthReason ?? "");

  test("sidebar navigation reaches core screens", async ({ page }) => {
    await loginIfNeeded(page);

    await page.getByRole("link", { name: /dashboard/i }).click();
    await expect(page).toHaveURL(/\/app\/dashboard/);
    await expect(page.getByRole("heading", { name: /dashboard/i })).toBeVisible();

    await page.getByRole("link", { name: /list management/i }).click();
    await expect(page).toHaveURL(/\/app\/inventory\/lists/);
    await expect(page.getByRole("heading", { name: /^list management$/i })).toBeVisible();

    await page.getByRole("link", { name: /inventory management/i }).click();
    await expect(page).toHaveURL(/\/app\/inventory\/enter/);
    await expect(page.getByRole("heading", { name: /^inventory management$/i })).toBeVisible();

    await page.getByRole("link", { name: /invoices \(receiving\)/i }).click();
    await expect(page).toHaveURL(/\/app\/invoices/);
    await expect(page.getByRole("heading", { name: /^invoices \(receiving\)$/i })).toBeVisible();
  });
});
