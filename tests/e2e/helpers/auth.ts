import fs from "node:fs/promises";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import { getSmokeCredentials, getStorageStatePath } from "./env";

export async function expectAppShell(page: Page): Promise<void> {
  await expect(page.getByRole("link", { name: /dashboard/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /list management/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /inventory management/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /invoices \(receiving\)/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible();
}

export async function expectNoRuntimeOverlay(page: Page): Promise<void> {
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
}

export async function loginIfNeeded(page: Page): Promise<void> {
  await page.goto("/app/dashboard", { waitUntil: "domcontentloaded" });

  if (page.url().includes("/app/")) {
    await expectAppShell(page);
    await expectNoRuntimeOverlay(page);
    return;
  }

  if (page.url().includes("/demo")) {
    throw new Error("Smoke tests require a user with at least one restaurant membership.");
  }

  const credentials = getSmokeCredentials();
  if (!credentials) {
    throw new Error(
      "Smoke tests need auth. Set E2E_EMAIL/E2E_PASSWORD or provide PLAYWRIGHT_AUTH_FILE with a valid storage state.",
    );
  }

  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await page.getByLabel("Email").fill(credentials.email);
  await page.getByLabel("Password").fill(credentials.password);
  await page.getByRole("button", { name: /sign in/i }).click();

  if (page.url().includes("/demo")) {
    throw new Error("Smoke tests require a user with at least one restaurant membership.");
  }

  await expect(page).toHaveURL(/\/app\/dashboard/);
  await expectAppShell(page);
  await expectNoRuntimeOverlay(page);

  const storageStatePath = getStorageStatePath();
  await fs.mkdir(path.dirname(storageStatePath), { recursive: true });
  await page.context().storageState({ path: storageStatePath });
}
