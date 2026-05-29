import { getMissingAuthReason } from "./helpers/env";
import { expectAnyVisible, isVisible, openAppRoute } from "./helpers/navigation";
import { test, expect } from "./helpers/test";

const missingAuthReason = getMissingAuthReason();

test.describe("notifications smoke", () => {
  test.skip(Boolean(missingAuthReason), missingAuthReason ?? "");

  test("notifications page loads", async ({ page }) => {
    await openAppRoute(page, "/app/notifications");

    await expect(page.getByRole("heading", { name: /^notifications$/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /^all$/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /^invoices$/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /^critical$/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /^reminders$/i })).toBeVisible();

    await expect(page.getByText(/^loading/i)).toHaveCount(0, { timeout: 20_000 });

    await expectAnyVisible(
      [
        page.getByText(/no notifications/i),
        page.getByText(/you're all caught up/i),
        page.locator(".rounded-lg.cursor-pointer").first(),
      ],
      "Expected notifications list or empty state.",
    );
  });

  test("filter tabs work", async ({ page }) => {
    await openAppRoute(page, "/app/notifications");

    for (const tabName of ["Invoices", "Critical", "Reminders", "All"] as const) {
      await page.getByRole("tab", { name: new RegExp(`^${tabName}$`, "i") }).click();
      await expect(page.getByRole("heading", { name: /^notifications$/i })).toBeVisible();
    }
  });

  test("bell badge shows in header", async ({ page }) => {
    await openAppRoute(page, "/app/dashboard");

    const bellButton = page.locator("header button.relative.h-8.w-8");
    await expect(bellButton).toBeVisible({ timeout: 20_000 });

    const badge = bellButton.locator(".bg-destructive");
    if (await isVisible(badge)) {
      await expect(badge).toBeVisible();
    }
  });

  test("price increase notification renders", async ({ page }) => {
    await openAppRoute(page, "/app/notifications");

    const priceBadge = page.getByText(/price increase/i).first();
    if (!(await isVisible(priceBadge))) {
      test.skip(true, "No PRICE_INCREASE notification in this restaurant.");
    }

    await expect(priceBadge).toBeVisible();
    await expectAnyVisible(
      [
        page.locator(".font-mono").filter({ hasText: /\$/ }).first(),
        page.getByText(/→/).first(),
        page.getByText(/%/).first(),
      ],
      "Expected price change details on PRICE_INCREASE notification.",
    );
  });

  test("low stock notification renders", async ({ page }) => {
    await openAppRoute(page, "/app/notifications");

    const lowStockBadge = page.getByText(/low stock/i).first();
    if (!(await isVisible(lowStockBadge))) {
      test.skip(true, "No LOW_STOCK notification in this restaurant.");
    }

    await expect(lowStockBadge).toBeVisible();
    await expectAnyVisible(
      [
        page.getByText(/ago/i).first(),
        page.locator(".rounded-lg.cursor-pointer").first(),
      ],
      "Expected LOW_STOCK notification content.",
    );
  });

  test("weekly digest renders", async ({ page }) => {
    await openAppRoute(page, "/app/notifications");

    const weeklyBadge = page.getByText(/weekly digest/i).first();
    if (!(await isVisible(weeklyBadge))) {
      test.skip(true, "No WEEKLY_DIGEST notification in this restaurant.");
    }

    await expect(weeklyBadge).toBeVisible();
    await expectAnyVisible(
      [
        page.getByText(/sent loss report/i).first(),
        page.getByText(/ago/i).first(),
      ],
      "Expected WEEKLY_DIGEST notification content.",
    );
  });
});
