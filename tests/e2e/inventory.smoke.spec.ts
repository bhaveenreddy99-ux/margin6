import { getMissingAuthReason } from "./helpers/env";
import { isVisible, openAppRoute } from "./helpers/navigation";
import { test, expect } from "./helpers/test";

const missingAuthReason = getMissingAuthReason();

test.describe("inventory smoke", () => {
  test.skip(Boolean(missingAuthReason), missingAuthReason ?? "");

  test("inventory page loads and supports a safe session edit when available", async ({ page }) => {
    await openAppRoute(page, "/app/inventory/enter");

    await expect(page.getByRole("heading", { name: /^inventory management$/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^in progress$/i })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /start new count|continue count/i }).first(),
    ).toBeVisible();

    const continueCountButton = page.getByRole("button", { name: /continue count/i }).first();
    const continueButton = page.getByRole("button", { name: /^continue$/i }).first();

    if (await isVisible(continueCountButton)) {
      await continueCountButton.click();
    } else if (await isVisible(continueButton)) {
      await continueButton.click();
    } else {
      return;
    }

    await expect(page.getByPlaceholder(/search items/i)).toBeVisible();

    const stockInput = page.locator('input[inputmode="decimal"][type="number"]').first();
    if (!(await isVisible(stockInput))) {
      return;
    }

    const originalValue = await stockInput.inputValue();
    const originalNumber = Number(originalValue || "0");
    const updatedValue = String(Number.isFinite(originalNumber) ? originalNumber + 1 : 1);
    const resetValue = originalValue === "" ? "0" : originalValue;
    const blurTarget = page.getByPlaceholder(/search items/i);

    await stockInput.fill(updatedValue);
    await blurTarget.click();
    await expect(page.getByText(/^saved$/i).first()).toBeVisible();

    await stockInput.fill(resetValue);
    await blurTarget.click();
    await expect(page.getByText(/^saved$/i).first()).toBeVisible();
  });
});
