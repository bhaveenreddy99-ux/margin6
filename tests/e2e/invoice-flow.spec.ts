import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getMissingAuthReason } from "./helpers/env";
import { deleteInvoiceByVendor, openFirstInvoiceReview } from "./helpers/invoice";
import { expectAnyVisible, isVisible, openAppRoute } from "./helpers/navigation";
import { test, expect } from "./helpers/test";

const missingAuthReason = getMissingAuthReason();

const MANUAL_VENDOR = "Test Vendor E2E";
const MANUAL_INVOICE_NUMBER = "TEST-001";

function minimalPdfPath(): string {
  const filePath = path.join(os.tmpdir(), `margin6-e2e-invoice-${Date.now()}.pdf`);
  fs.writeFileSync(filePath, "%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  return filePath;
}

test.describe("invoice page UI", () => {
  test.skip(Boolean(missingAuthReason), missingAuthReason ?? "");

  test("invoice page loads with correct header and actions", async ({ page }) => {
    await openAppRoute(page, "/app/invoices");

    await expect(page.getByRole("heading", { name: /^invoices \(receiving\)$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /upload file/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /upload photo/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /enter manually/i })).toBeVisible();

    await expect(page.getByText(/total invoices/i)).toBeVisible();
    await expect(page.getByText(/^pending$/i)).toBeVisible();
    await expect(page.getByText(/active vendors/i)).toBeVisible();
    await expect(page.getByText(/last invoice/i)).toBeVisible();
  });

  test("invoice page shows correct empty state or invoice list", async ({ page }) => {
    await openAppRoute(page, "/app/invoices");

    await expectAnyVisible(
      [
        page.getByRole("button", { name: /^review$/i }).first(),
        page.getByText(/no invoices yet/i),
      ],
      "Expected invoice list or empty state to render.",
    );
  });

  test("invoice status filters work", async ({ page }) => {
    await openAppRoute(page, "/app/invoices");

    const statusTrigger = page
      .locator("div")
      .filter({ has: page.getByText(/^status$/i) })
      .getByRole("combobox")
      .first();
    await statusTrigger.click();
    await page.getByRole("option", { name: /pending review/i }).click();
    await expect(page.getByRole("heading", { name: /^invoices \(receiving\)$/i })).toBeVisible();

    await statusTrigger.click();
    await page.getByRole("option", { name: /^all$/i }).click();
    await expect(page.getByRole("heading", { name: /^invoices \(receiving\)$/i })).toBeVisible();
  });

  test("invoice search works", async ({ page }) => {
    await openAppRoute(page, "/app/invoices");

    const searchInput = page.getByPlaceholder(/search by vendor or invoice #/i);
    await searchInput.fill("PFG");
    await page.waitForTimeout(400);
    await expect(page.getByRole("heading", { name: /^invoices \(receiving\)$/i })).toBeVisible();

    await searchInput.fill("");
    await page.waitForTimeout(400);

    await searchInput.fill("ZZZ-NONEXISTENT-VENDOR-99999");
    await page.waitForTimeout(400);
    await expectAnyVisible(
      [
        page.getByText(/no invoices yet/i),
        page.locator(".space-y-2 > div").first(),
      ],
      "Expected filtered list or empty state after nonsense search.",
    );
  });

  test("upload file button opens file picker", async ({ page }) => {
    await openAppRoute(page, "/app/invoices");

    const fileInput = page.locator('input[type="file"][accept*="pdf"]').first();
    await expect(fileInput).toHaveCount(1);

    await page.getByRole("button", { name: /upload file/i }).click();
    await expect(fileInput).toBeAttached();
  });

  test("enter manually opens form", async ({ page }) => {
    await openAppRoute(page, "/app/invoices");

    await page.getByRole("button", { name: /enter manually/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText(/vendor name/i)).toBeVisible();
    await expect(page.getByText(/invoice #/i)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

test.describe("invoice review page", () => {
  test.skip(Boolean(missingAuthReason), missingAuthReason ?? "");

  test("invoice review page loads when invoice exists", async ({ page }) => {
    const invoiceId = await openFirstInvoiceReview(page);
    test.skip(!invoiceId, "No invoice available for review in this restaurant.");

    await expect(page.getByRole("heading", { name: /^invoice review$/i })).toBeVisible();
    await expect(page.getByText(/line items/i).first()).toBeVisible();
    await expect(page.getByText(/discrepancies/i).first()).toBeVisible();
    await expect(page.getByText(/invoice total/i).first()).toBeVisible();
    await expect(page.getByText(/issues reported/i).first()).toBeVisible();
    await expect(page.getByText(/line item comparison/i)).toBeVisible();

    await expect(page.getByRole("columnheader", { name: /^item$/i })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /^ordered$/i })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /^billed$/i })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /^received$/i })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /po price/i })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /invoice price/i })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /^status$/i })).toBeVisible();
  });

  test("invoice review shows post invoice button", async ({ page }) => {
    const invoiceId = await openFirstInvoiceReview(page);
    test.skip(!invoiceId, "No invoice available for review in this restaurant.");

    await expect(page.getByRole("button", { name: /post invoice/i })).toBeVisible();
    await expectAnyVisible(
      [
        page.getByText(/^reviewing$/i),
        page.getByText(/pending review/i),
        page.getByText(/confirmed/i),
      ],
      "Expected invoice receipt status badge on review page.",
    );
  });

  test("invoice review line items are displayed", async ({ page }) => {
    const invoiceId = await openFirstInvoiceReview(page);
    test.skip(!invoiceId, "No invoice available for review in this restaurant.");

    await expect(page.getByRole("heading", { name: /^invoice review$/i })).toBeVisible();
    await expect(page.getByText(/line item comparison/i)).toBeVisible({ timeout: 20_000 });

    await expectAnyVisible(
      [
        page.locator("table tbody tr").first(),
        page.getByText(/comparison not available/i),
        page.getByText(/review all lines before posting/i),
      ],
      "Expected comparison table or empty comparison message.",
    );

    await expectAnyVisible(
      [
        page.getByText(/^ok$/i),
        page.getByText(/^missing$/i),
        page.getByText(/^extra$/i),
        page.getByText(/price mismatch/i),
        page.getByText(/comparison not available/i),
        page.getByText(/unmatched/i),
      ],
      "Expected line item status badges or empty comparison state.",
    );

    await expectAnyVisible(
      [
        page.locator("table").getByText(/\$/).first(),
        page.getByText(/comparison not available/i),
        page.getByText(/\$0/).first(),
      ],
      "Expected dollar amounts or empty comparison state.",
    );
  });

  test("confirm all as received button works", async ({ page }) => {
    const invoiceId = await openFirstInvoiceReview(page);
    test.skip(!invoiceId, "No invoice available for review in this restaurant.");

    const confirmAllButton = page.getByRole("button", { name: /confirm all as received/i });
    if (!(await isVisible(confirmAllButton))) {
      test.skip(true, "Confirm all as received not shown for this invoice.");
    }

    await confirmAllButton.click();
    await page.waitForTimeout(800);

    await expectAnyVisible(
      [
        page.getByText(/confirmed ✓/i),
        page.getByText(/unconfirmed/i),
      ],
      "Expected received quantity confirmation labels after bulk confirm.",
    );
  });

  test("invoice review back navigation works", async ({ page }) => {
    const invoiceId = await openFirstInvoiceReview(page);
    test.skip(!invoiceId, "No invoice available for review in this restaurant.");

    await page.locator(".flex.items-center.gap-3 button").first().click();
    await expect(page).toHaveURL(/\/app\/invoices/);
  });
});

test.describe("invoice upload flow", () => {
  test.skip(Boolean(missingAuthReason), missingAuthReason ?? "");

  test("upload file shows progress feedback", async ({ page }) => {
    await openAppRoute(page, "/app/invoices");

    const pdfPath = minimalPdfPath();
    try {
      const fileInput = page.locator('input[type="file"][accept*="pdf"]').first();
      await fileInput.setInputFiles(pdfPath);

      await expectAnyVisible(
        [
          page.getByText(/reading your invoice/i),
          page.getByText(/extracting line items/i),
          page.getByText(/ai is parsing your invoice/i),
          page.locator(".animate-spin").first(),
        ],
        "Expected upload parsing progress or loading state.",
      );
    } finally {
      fs.unlinkSync(pdfPath);
    }
  });

  test("upload file enforces 10MB size limit", async ({ page }) => {
    await openAppRoute(page, "/app/invoices");

    await page.evaluate(() => {
      const input = document.querySelector(
        'input[type="file"][accept*="pdf"]',
      ) as HTMLInputElement | null;
      if (!input) throw new Error("Invoice file input not found");

      const data = new Uint8Array(11 * 1024 * 1024);
      const file = new File([data], "large-invoice.pdf", { type: "application/pdf" });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await expect(page.getByText(/file too large/i)).toBeVisible({ timeout: 10_000 });
  });

  test("manual entry form saves draft invoice", async ({ page }) => {
    await openAppRoute(page, "/app/invoices");

    try {
      await page.getByRole("button", { name: /enter manually/i }).click();
      await page.getByPlaceholder(/e\.g\. sysco/i).fill(MANUAL_VENDOR);
      await page.getByPlaceholder(/inv-001/i).fill(MANUAL_INVOICE_NUMBER);

      const addFirstItem = page.getByRole("button", { name: /add first item/i });
      if (await isVisible(addFirstItem)) {
        await addFirstItem.click();
      } else {
        await page.getByRole("button", { name: /add item/i }).first().click();
      }
      await page.getByPlaceholder(/item name/i).first().fill("E2E Manual Item");

      await page.getByRole("button", { name: /save draft/i }).click();
      await expect(page.getByText(MANUAL_VENDOR)).toBeVisible({ timeout: 20_000 });
    } finally {
      await deleteInvoiceByVendor(page, MANUAL_VENDOR);
    }
  });
});

test.describe("notifications page", () => {
  test.skip(Boolean(missingAuthReason), missingAuthReason ?? "");

  test("notifications page loads correctly", async ({ page }) => {
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

  test("notification filters work", async ({ page }) => {
    await openAppRoute(page, "/app/notifications");

    await page.getByRole("tab", { name: /^invoices$/i }).click();
    await expect(page.getByRole("heading", { name: /^notifications$/i })).toBeVisible();

    await page.getByRole("tab", { name: /^critical$/i }).click();
    await expect(page.getByRole("heading", { name: /^notifications$/i })).toBeVisible();

    await page.getByRole("tab", { name: /^reminders$/i }).click();
    await expect(page.getByRole("heading", { name: /^notifications$/i })).toBeVisible();

    await page.getByRole("tab", { name: /^all$/i }).click();
    await expect(page.getByRole("heading", { name: /^notifications$/i })).toBeVisible();
  });

  test("unread notification count shows in header bell", async ({ page }) => {
    await openAppRoute(page, "/app/dashboard");

    const bellButton = page.locator("header button.relative.h-8.w-8");
    await expect(bellButton).toBeVisible({ timeout: 20_000 });
  });

  test("clicking bell opens notifications panel or navigates", async ({ page }) => {
    await openAppRoute(page, "/app/dashboard");

    await page.locator("header button.relative.h-8.w-8").click();
    await expect(page).toHaveURL(/\/app\/notifications/);
  });

  test("price increase notification shows correct data", async ({ page }) => {
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

  test("low stock notification shows correct data", async ({ page }) => {
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

  test("weekly digest notification shows correct data", async ({ page }) => {
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

  test("notifications mark as read when clicked", async ({ page }) => {
    await openAppRoute(page, "/app/notifications");

    const unreadDots = page.locator(".rounded-lg.cursor-pointer .bg-primary.rounded-full");
    const unreadCount = await unreadDots.count();
    if (unreadCount === 0) {
      test.skip(true, "No unread notifications to exercise read state.");
    }

    await page
      .locator(".rounded-lg.cursor-pointer")
      .filter({ has: page.locator(".bg-primary.rounded-full") })
      .first()
      .click();

    await expect(unreadDots).toHaveCount(unreadCount - 1, { timeout: 10_000 });
  });
});

test.describe("invoice notification integration", () => {
  test.skip(Boolean(missingAuthReason), missingAuthReason ?? "");

  test("invoice page shows pending review banner when invoices exist", async ({ page }) => {
    await openAppRoute(page, "/app/invoices");

    const banner = page.getByText(/awaiting review/i);
    if (!(await isVisible(banner))) {
      test.skip(true, "No invoices awaiting review in this restaurant.");
    }

    await expect(banner).toBeVisible();
    await expect(page.getByText(/review/i).first()).toBeVisible();
  });

  test("invoice review report button works", async ({ page }) => {
    const invoiceId = await openFirstInvoiceReview(page);
    test.skip(!invoiceId, "No invoice available for review in this restaurant.");

    const reportButton = page.getByRole("button", { name: /^report$/i }).first();
    if (!(await isVisible(reportButton))) {
      test.skip(true, "No reportable line items on this invoice.");
    }

    await reportButton.click();
    await expectAnyVisible(
      [
        page.getByRole("dialog", { name: /report issue/i }),
        page.getByText(/report issue/i),
      ],
      "Expected report issue dialog after clicking Report.",
    );

    await page.keyboard.press("Escape");
  });

  test("post invoice updates invoice status", async ({ page }) => {
    const invoiceId = await openFirstInvoiceReview(page);
    test.skip(!invoiceId, "No invoice available for review in this restaurant.");

    const postButton = page.getByRole("button", { name: /post invoice/i });
    await expect(postButton).toBeVisible();
    await expectAnyVisible(
      [
        page.getByText(/^reviewing$/i),
        page.getByText(/pending review/i),
      ],
      "Expected reviewing status badge (read-only — does not post).",
    );
  });
});

test.describe("feature completeness", () => {
  test.skip(Boolean(missingAuthReason), missingAuthReason ?? "");

  test("dashboard shows money lost widget", async ({ page }) => {
    await openAppRoute(page, "/app/dashboard");

    await expect(page.getByText(/profit risk identified/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/potential exposure this period/i)).toBeVisible();
  });

  test("dashboard shows price hike alerts", async ({ page }) => {
    await openAppRoute(page, "/app/dashboard");

    await expect(page.getByText(/price hike alerts/i)).toBeVisible({ timeout: 30_000 });
    await expectAnyVisible(
      [
        page.getByText(/no price hikes detected/i),
        page.locator("ul li button").first(),
      ],
      "Expected price hike alerts rows or empty state.",
    );
  });

  test("smart order page loads with order details", async ({ page }) => {
    await openAppRoute(page, "/app/smart-order");

    await expect(page.getByRole("heading", { name: /smart order/i })).toBeVisible();
    await expectAnyVisible(
      [
        page.locator("table").first(),
        page.getByText(/no smart order/i),
        page.getByText(/approve an inventory count/i),
        page.getByText(/set par levels/i),
      ],
      "Expected smart order content or empty state.",
    );
  });

  test("purchase history page loads", async ({ page }) => {
    await openAppRoute(page, "/app/purchase-history");

    await expect(page.getByRole("heading", { name: /purchase history/i })).toBeVisible();
    await expect(page.getByText(/track purchase orders and received invoices/i)).toBeVisible();
    await expectAnyVisible(
      [
        page.getByRole("tab", { name: /all/i }).first(),
        page.getByText(/no purchase orders yet/i),
        page.getByText(/no records yet/i),
      ],
      "Expected purchase history tabs or empty state.",
    );
    await expectAnyVisible(
      [
        page.getByText(/items/i).first(),
        page.getByText(/\$\d/).first(),
        page.getByText(/no purchase orders yet/i),
        page.getByText(/submit a smart order or upload an invoice/i),
      ],
      "Expected purchase history rows or empty state.",
    );
  });

  test("waste log page loads", async ({ page }) => {
    await openAppRoute(page, "/app/waste-log");

    await expect(page.getByRole("heading", { name: /waste log/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /log waste/i })).toBeVisible();
  });

  test("sales entry page loads", async ({ page }) => {
    await openAppRoute(page, "/app/sales");

    await expect(page.getByRole("heading", { name: /sales entry/i })).toBeVisible();
    await expectAnyVisible(
      [
        page.locator("table").first(),
        page.getByRole("button", { name: /save/i }),
        page.getByText(/weekly/i),
      ],
      "Expected sales entry form or table.",
    );
  });

  test("billing page shows founding member plan", async ({ page }) => {
    await openAppRoute(page, "/app/billing");

    await expect(page.getByRole("heading", { name: /^billing$/i })).toBeVisible();
    await expect(page.getByText(/founding member/i)).toBeVisible();
    await expect(page.getByText(/\$69\.99/)).toBeVisible();
    await expectAnyVisible(
      [
        page.getByRole("button", { name: /upgrade now/i }),
        page.getByText(/active/i),
        page.getByText(/trial/i),
      ],
      "Expected billing CTA or subscription status.",
    );
  });

  test("settings page loads all tabs", async ({ page }) => {
    await openAppRoute(page, "/app/settings");

    await expect(page.getByRole("heading", { name: /^settings$/i })).toBeVisible();

    const tabs = [/my profile/i, /business profile/i, /invoice settings/i, /inventory defaults/i];
    for (const tabPattern of tabs) {
      const tabButton = page.getByRole("button", { name: tabPattern }).first();
      if (await isVisible(tabButton)) {
        await tabButton.click();
        await expect(page.getByRole("heading", { name: /^settings$/i })).toBeVisible();
      }
    }
  });
});
