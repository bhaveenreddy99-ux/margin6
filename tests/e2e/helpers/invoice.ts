import { expect, type Page } from "@playwright/test";
import { isVisible, openAppRoute } from "./navigation";

export const E2E_VENDOR_NAME = "E2E Test Vendor";
export const E2E_INVOICE_NUMBER = "E2E-TEST-001";

export async function openFirstInvoiceReview(page: Page): Promise<string | null> {
  await openAppRoute(page, "/app/invoices");

  const reviewButton = page.getByRole("button", { name: /^review$/i }).first();
  if (!(await isVisible(reviewButton))) {
    return null;
  }

  await reviewButton.click();
  await expect(page).toHaveURL(/\/app\/invoices\/.+\/review/);

  const match = page.url().match(/\/app\/invoices\/([^/]+)\/review/);
  return match?.[1] ?? null;
}

async function fillManualInvoiceForm(
  page: Page,
  vendorName: string,
  invoiceNumber: string,
  itemName: string,
): Promise<void> {
  await page.getByRole("button", { name: /enter manually/i }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText(/vendor name/i)).toBeVisible();

  await page.getByPlaceholder(/e\.g\. sysco/i).fill(vendorName);
  await page.getByPlaceholder(/inv-001/i).fill(invoiceNumber);

  const addFirstItem = page.getByRole("button", { name: /add first item/i });
  if (await isVisible(addFirstItem)) {
    await addFirstItem.click();
  } else {
    await page.getByRole("button", { name: /add item/i }).first().click();
  }

  await page.getByPlaceholder(/item name/i).first().fill(itemName);
}

export async function createTestInvoice(page: Page): Promise<string | null> {
  await openAppRoute(page, "/app/invoices");
  await fillManualInvoiceForm(page, E2E_VENDOR_NAME, E2E_INVOICE_NUMBER, "E2E Test Item");

  await page.getByRole("button", { name: /save draft/i }).click();
  await expect(page.getByText(E2E_VENDOR_NAME)).toBeVisible({ timeout: 20_000 });

  const reviewButton = page
    .locator(".space-y-2 > div")
    .filter({ hasText: E2E_VENDOR_NAME })
    .first()
    .getByRole("button", { name: /^review$/i });

  if (!(await isVisible(reviewButton))) {
    return null;
  }

  await reviewButton.click();
  await expect(page).toHaveURL(/\/app\/invoices\/.+\/review/);
  const match = page.url().match(/\/app\/invoices\/([^/]+)\/review/);
  return match?.[1] ?? null;
}

export async function deleteInvoiceByVendor(page: Page, vendorName: string): Promise<void> {
  await openAppRoute(page, "/app/invoices");

  const row = page.locator(".space-y-2 > div").filter({ hasText: vendorName }).first();
  if (!(await isVisible(row))) {
    return;
  }

  await row.locator("button.text-destructive").click();
  await expect(page.getByText(/invoice deleted/i)).toBeVisible({ timeout: 10_000 });
}

export async function deleteTestInvoice(page: Page, _invoiceId?: string): Promise<void> {
  await deleteInvoiceByVendor(page, E2E_VENDOR_NAME);
}
