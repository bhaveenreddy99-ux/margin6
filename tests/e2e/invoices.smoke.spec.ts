import { getMissingAuthReason } from "./helpers/env";
import { expectAnyVisible, isVisible, openAppRoute } from "./helpers/navigation";
import { test, expect } from "./helpers/test";

const missingAuthReason = getMissingAuthReason();

test.describe("invoices smoke", () => {
  test.skip(Boolean(missingAuthReason), missingAuthReason ?? "");

  test("invoices screens load and invoice review opens when data is available", async ({ page }) => {
    await openAppRoute(page, "/app/invoices");

    await expect(page.getByRole("heading", { name: /^invoices \(receiving\)$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /upload file/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /enter manually/i })).toBeVisible();

    await expectAnyVisible(
      [
        page.getByText(/total invoices/i),
        page.getByText(/no invoices yet/i),
        page.locator("table"),
      ],
      "Expected invoice list or empty state to render.",
    );

    const reviewButton = page.getByRole("button", { name: /^review$/i }).first();
    if (!(await isVisible(reviewButton))) {
      return;
    }

    await reviewButton.click();

    await expect(page).toHaveURL(/\/app\/invoices\/.+\/review/);
    await expect(page.getByRole("heading", { name: /^invoice review$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /post invoice/i })).toBeVisible();

    await expectAnyVisible(
      [
        page.getByRole("columnheader", { name: /invoice price/i }),
        page.getByText(/review all lines before posting/i),
        page.getByText(/reported issues/i),
      ],
      "Expected invoice review comparison or issue UI to render.",
    );
  });
});
