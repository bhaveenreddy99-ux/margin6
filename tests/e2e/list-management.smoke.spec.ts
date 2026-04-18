import { getMissingAuthReason } from "./helpers/env";
import { isVisible, openAppRoute } from "./helpers/navigation";
import { test, expect } from "./helpers/test";

const missingAuthReason = getMissingAuthReason();

test.describe("list management smoke", () => {
  test.skip(Boolean(missingAuthReason), missingAuthReason ?? "");

  test("list management page loads and renders key UI safely", async ({ page }) => {
    await openAppRoute(page, "/app/inventory/lists");

    await expect(page.getByRole("heading", { name: /^list management$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /create list/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^import$/i }).first()).toBeVisible();

    const emptyState = page.getByText(/no lists yet/i);
    if (await isVisible(emptyState)) {
      await expect(emptyState).toBeVisible();
      return;
    }

    await expect(page.getByPlaceholder(/search lists/i)).toBeVisible();
  });
});
