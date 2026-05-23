import { expect, type Locator, type Page } from "@playwright/test";
import { expectAppShell, expectNoRuntimeOverlay, loginIfNeeded } from "./auth";

export async function openAppRoute(page: Page, path: string): Promise<void> {
  await loginIfNeeded(page);
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  await expect(page.getByRole("link", { name: /^overview$/i })).toBeVisible({ timeout: 20_000 });
  await expectAppShell(page);
  await expectNoRuntimeOverlay(page);
}

export async function isVisible(locator: Locator): Promise<boolean> {
  try {
    return await locator.first().isVisible();
  } catch {
    return false;
  }
}

export async function expectAnyVisible(
  locators: Locator[],
  message: string,
): Promise<void> {
  for (const locator of locators) {
    if (await isVisible(locator)) {
      return;
    }
  }

  expect(false, message).toBeTruthy();
}
