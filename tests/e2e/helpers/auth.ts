import fs from "node:fs/promises";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { getSmokeCredentials, getStorageStatePath } from "./env";

export async function expectAppShell(page: Page): Promise<void> {
  // Sidebar uses "Overview" as the dashboard link label.
  // Prefer data-sidebar buttons — breadcrumb trails can duplicate page titles as links.
  const sidebarLink = (name: RegExp) =>
    page.locator('[data-sidebar="menu-button"]').filter({ hasText: name }).first();

  await expect(sidebarLink(/^overview$/i)).toBeVisible({ timeout: 20_000 });
  await expect(sidebarLink(/list management/i)).toBeVisible();
  await expect(sidebarLink(/inventory management/i)).toBeVisible();
  await expect(sidebarLink(/invoices \(receiving\)/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible();
}

export async function expectNoRuntimeOverlay(page: Page): Promise<void> {
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
}

export async function loginIfNeeded(page: Page): Promise<void> {
  await page.goto("/app/dashboard", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);

  const overview = page.locator('[data-sidebar="menu-button"]').filter({ hasText: /^overview$/i }).first();
  if (!(await overview.isVisible().catch(() => false))) {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
  }

  if (page.url().includes("/login")) {
    const credentials = getSmokeCredentials();
    if (!credentials) {
      throw new Error(
        "Smoke tests need auth. Set E2E_EMAIL/E2E_PASSWORD or provide PLAYWRIGHT_AUTH_FILE with a valid storage state.",
      );
    }

    await page.getByLabel("Email").fill(credentials.email);
    await page.getByLabel("Password").fill(credentials.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app\/|onboarding\/create-restaurant|demo)/, { timeout: 15_000 });
  }

  if (page.url().includes("/demo")) {
    throw new Error("Smoke tests require a user with at least one restaurant membership.");
  }

  if (page.url().includes("/onboarding/create-restaurant")) {
    throw new Error("Smoke tests require a user with at least one restaurant membership.");
  }

  if (!page.url().includes("/app/")) {
    throw new Error(`Expected authenticated app route after login; got ${page.url()}`);
  }

  await page.waitForTimeout(800);
  await expectAppShell(page);
  await expectNoRuntimeOverlay(page);

  const storageStatePath = getStorageStatePath();
  await fs.mkdir(path.dirname(storageStatePath), { recursive: true });
  await page.context().storageState({ path: storageStatePath });
}
