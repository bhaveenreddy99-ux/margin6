import { getMissingAuthReason } from "./helpers/env";
import { expectAnyVisible, openAppRoute } from "./helpers/navigation";
import { test, expect } from "./helpers/test";

const missingAuthReason = getMissingAuthReason();

test.describe("dashboard smoke", () => {
  test.skip(Boolean(missingAuthReason), missingAuthReason ?? "");

  test("dashboard renders KPI cards and a key summary section", async ({ page }) => {
    await openAppRoute(page, "/app/dashboard");

    await expect(page.getByRole("heading", { name: /dashboard/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /start inventory/i })).toBeVisible();

    await expectAnyVisible(
      [
        page.getByRole("heading", { name: /today's situation/i }),
        page.getByRole("heading", { name: /this period/i }),
        page.getByRole("heading", { name: /spend overview/i }),
      ],
      "Expected at least one dashboard summary section to render.",
    );

    await expectAnyVisible(
      [
        page.getByText(/inventory value/i),
        page.getByText(/critical low stock items/i),
        page.getByText(/delivery issues/i),
        page.getByText(/price increase impact/i),
      ],
      "Expected at least one key dashboard KPI to render.",
    );
  });
});
