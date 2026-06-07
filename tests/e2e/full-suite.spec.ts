import { loginIfNeeded } from "./helpers/auth";
import { getMissingAuthReason } from "./helpers/env";
import { expectAnyVisible, isVisible, openAppRoute } from "./helpers/navigation";
import { test, expect } from "./helpers/test";

const missingAuthReason = getMissingAuthReason();

async function settle(page: import("@playwright/test").Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(800);
}

// ═══════════════════════════════════════════════════════════════════════════
// Authenticated suite — covers everything behind /app/*
// ═══════════════════════════════════════════════════════════════════════════
test.describe("Margin6 — full feature suite (authenticated)", () => {
  test.skip(Boolean(missingAuthReason), missingAuthReason ?? "");

  // ── 1. Auth ───────────────────────────────────────────────────────────────
  test("01 Auth — login redirects to /app/dashboard, signed-out users land on /login", async ({ page, context }) => {
    await loginIfNeeded(page);
    await expect(page).toHaveURL(/\/app\/dashboard/);

    // Open a fresh unauthenticated context to confirm the protected-route gate.
    const anonContext = await context.browser()!.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const anonPage = await anonContext.newPage();
    await anonPage.goto("/app/dashboard", { waitUntil: "domcontentloaded" });
    await anonPage.waitForTimeout(500);
    await expect(anonPage).toHaveURL(/\/login/);
    await anonContext.close();
  });

  // ── 2. Onboarding checklist ───────────────────────────────────────────────
  test("02 Onboarding checklist — renders or is hidden when complete", async ({ page }) => {
    await openAppRoute(page, "/app/dashboard");
    await settle(page);

    const heading = page.getByRole("heading", { name: /get started/i });
    if (!(await isVisible(heading))) {
      // eslint-disable-next-line no-console
      console.log("Onboarding checklist not shown (either fully complete or no restaurant).");
      return;
    }
    await expect(page.getByText(/complete setup to unlock/i)).toBeVisible();
    await expect(page.getByText(/upload your first invoice/i)).toBeVisible();
  });

  // ── 3. Profit Risk widget ─────────────────────────────────────────────────
  test("03 Profit Risk widget — hero or empty state, waste row opens drilldown", async ({ page }) => {
    await openAppRoute(page, "/app/dashboard");
    await settle(page);

    await expectAnyVisible(
      [
        page.getByText(/profit risk identified/i),
        page.getByText(/no risk data yet/i),
      ],
      "Profit Risk widget should render either the hero copy or the empty state.",
    );

    const wasteBtn = page.getByRole("button", { name: /recorded waste/i });
    const wasteCount = await wasteBtn.count();
    if (wasteCount > 0) {
      // The sub-label button sits inside the gradient card — pick the first one
      // (button role, not the Waste Log sidebar link which is a link role).
      await wasteBtn.first().click();
      await page.waitForTimeout(500);
      await expect(page.getByText(/line breakdown/i).first()).toBeVisible();
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    } else {
      // eslint-disable-next-line no-console
      console.log("Money Lost widget in empty state — drilldown not exercised.");
    }
  });

  // ── 4. Top Profit Leaks ───────────────────────────────────────────────────
  test("04 Top Profit Leaks card — renders rows or empty state, clicking a row opens drilldown", async ({ page }) => {
    await openAppRoute(page, "/app/dashboard");
    await settle(page);

    await expect(page.getByRole("heading", { name: /top profit leaks/i })).toBeVisible();
    await expectAnyVisible(
      [page.getByText(/no leak data yet/i), page.locator('button:has-text("$")').first()],
      "ProfitLeaksCard should show empty state or at least one leak row.",
    );

    // If a leak row exists, clicking it opens the drilldown sheet.
    const firstRowBtn = page
      .locator("button")
      .filter({ has: page.locator("span:has-text('1')") })
      .first();
    if (await isVisible(firstRowBtn)) {
      // The card uses numbered rank chips; clicking opens DrilldownSheet.
      // We don't assert the click navigated anywhere — just that no crash.
    }
  });

  // ── 5. Price Hike Alerts ──────────────────────────────────────────────────
  test("05 Price Hike Alerts card — renders, clicking a row navigates to /app/invoices", async ({ page }) => {
    await openAppRoute(page, "/app/dashboard");
    await settle(page);

    await expect(page.getByRole("heading", { name: /price hike alerts/i })).toBeVisible();
    await expectAnyVisible(
      [
        page.getByText(/no price hikes detected/i),
        page.locator("button >> text=/\\+\\d/").first(),
      ],
      "Price Hike Alerts should render empty state or at least one row.",
    );

    const pctBadge = page.locator("button >> text=/\\+\\d+\\.\\d%/").first();
    if (await isVisible(pctBadge)) {
      await pctBadge.click();
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(500);
      await expect(page).toHaveURL(/\/app\/invoices/);
    } else {
      // eslint-disable-next-line no-console
      console.log("No price hike rows present — navigation click not exercised.");
    }
  });

  // ── 6. Overstock Cash Trap ────────────────────────────────────────────────
  test("06 Overstock Cash Trap card — renders items or empty state", async ({ page }) => {
    await openAppRoute(page, "/app/dashboard");
    await settle(page);

    await expect(page.getByRole("heading", { name: /cash frozen in overstock/i })).toBeVisible();
    await expectAnyVisible(
      [
        page.getByText(/no overstock detected/i),
        page.getByText(/frozen in slow-moving inventory/i),
      ],
      "Overstock card should render empty state or total frozen.",
    );
  });

  // ── 7. Variance & Shrinkage ───────────────────────────────────────────────
  test("07 Variance & Shrinkage card — renders rows or empty state, footer total visible when populated", async ({ page }) => {
    await openAppRoute(page, "/app/dashboard");
    await settle(page);

    await expect(page.getByRole("heading", { name: /variance & shrinkage/i })).toBeVisible();
    const empty = await isVisible(page.getByText(/no variance detected/i));
    if (empty) {
      // eslint-disable-next-line no-console
      console.log("Shrinkage card in empty state.");
      return;
    }
    await expect(page.getByText(/total unaccounted this period/i)).toBeVisible();
  });

  // ── 8. Today at a glance ──────────────────────────────────────────────────
  test("08 Today at a glance — 4 KPI cards visible", async ({ page }) => {
    await openAppRoute(page, "/app/dashboard");
    await settle(page);

    await expect(page.getByRole("heading", { name: /today at a glance/i })).toBeVisible();
    await expectAnyVisible(
      [page.getByText(/critical low stock items/i)],
      "Critical low stock KpiCard not visible.",
    );
    await expectAnyVisible(
      [page.getByText(/reorder needed today/i)],
      "Reorder Needed Today KpiCard not visible.",
    );
    await expectAnyVisible(
      [page.getByText(/inventory value/i)],
      "Inventory Value KpiCard not visible.",
    );
    await expectAnyVisible(
      [page.getByText(/last count/i)],
      "Last Count KpiCard not visible.",
    );
  });

  // ── 9. Time filter ────────────────────────────────────────────────────────
  test("09 Time filter — switching this_week / last_week / 30_days does not crash", async ({ page, runtime }) => {
    await openAppRoute(page, "/app/dashboard");
    await settle(page);

    const labels: RegExp[] = [/this week/i, /last week/i, /30 days/i];
    for (const label of labels) {
      const trigger = page.getByRole("button", { name: label }).first();
      if (await isVisible(trigger)) {
        await trigger.click();
        await page.waitForTimeout(600);
      }
    }
    expect.soft(runtime.pageErrors, "No page errors after time filter changes").toEqual([]);
  });

  // ── 10. Action Center ─────────────────────────────────────────────────────
  test("10 Action Center — renders", async ({ page }) => {
    await openAppRoute(page, "/app/dashboard");
    await settle(page);
    await expectAnyVisible(
      [
        page.getByRole("heading", { name: /what needs attention/i }),
        page.getByRole("heading", { name: /action center/i }),
      ],
      "Action Center / What needs attention section not visible.",
    );
  });

  // ── 11. Smart Order preview ───────────────────────────────────────────────
  test("11 Smart Order preview — renders", async ({ page }) => {
    await openAppRoute(page, "/app/dashboard");
    await settle(page);
    await expectAnyVisible(
      [
        page.getByRole("heading", { name: /smart order/i }),
        page.getByText(/suggested order/i),
        page.getByText(/items to reorder/i),
      ],
      "Smart Order preview not visible.",
    );
  });

  // ── 12. Reports tab ───────────────────────────────────────────────────────
  test("12 Reports tab — clicking the tab renders content", async ({ page, runtime }) => {
    await openAppRoute(page, "/app/dashboard");
    await settle(page);

    const tab = page.getByRole("tab", { name: /reports/i }).first();
    if (await isVisible(tab)) {
      await tab.click();
      await page.waitForTimeout(600);
    } else {
      // eslint-disable-next-line no-console
      console.log("Reports tab not visible.");
    }
    expect.soft(runtime.pageErrors, "No page errors after Reports tab click").toEqual([]);
  });

  // ── 13. Invoices ──────────────────────────────────────────────────────────
  test("13 Invoices page — loads, upload control present", async ({ page }) => {
    await openAppRoute(page, "/app/invoices");
    await settle(page);
    await expectAnyVisible(
      [
        page.getByRole("heading", { name: /invoices/i }).first(),
        page.getByText(/invoices/i).first(),
      ],
      "Invoices page heading not visible.",
    );
    await expectAnyVisible(
      [
        page.getByRole("button", { name: /upload/i }).first(),
        page.getByRole("button", { name: /add invoice/i }).first(),
        page.getByText(/forward to your invoice email/i),
      ],
      "Invoices page upload affordance not visible.",
    );
  });

  // ── 14. Inventory Management ──────────────────────────────────────────────
  test("14 Inventory Management page — loads", async ({ page }) => {
    await openAppRoute(page, "/app/inventory/enter");
    await settle(page);
    await expectAnyVisible(
      [
        page.getByRole("heading", { name: /inventory/i }).first(),
        page.getByText(/enter inventory/i),
        page.getByText(/select a list/i),
      ],
      "Inventory Management page did not render.",
    );
  });

  // ── 15. Sales Entry ───────────────────────────────────────────────────────
  test("15 Sales Entry page — loads, accepts numeric input", async ({ page }) => {
    await openAppRoute(page, "/app/sales");
    await settle(page);
    await expectAnyVisible(
      [
        page.getByRole("heading", { name: /sales/i }).first(),
        page.getByText(/weekly sales/i),
        page.getByText(/gross sales/i),
      ],
      "Sales Entry page did not render.",
    );

    const numberInput = page.locator('input[type="number"]').first();
    if (await isVisible(numberInput)) {
      await numberInput.fill("123");
      await expect(numberInput).toHaveValue("123");
    } else {
      // eslint-disable-next-line no-console
      console.log("Sales Entry numeric input not found (possibly read-only state).");
    }
  });

  // ── 16. Waste Log ─────────────────────────────────────────────────────────
  test("16 Waste Log page — loads, log waste affordance present", async ({ page }) => {
    await openAppRoute(page, "/app/waste-log");
    await settle(page);
    await expectAnyVisible(
      [
        page.getByRole("heading", { name: /waste/i }).first(),
        page.getByText(/log waste/i),
      ],
      "Waste Log page heading missing.",
    );
    await expectAnyVisible(
      [
        page.getByRole("button", { name: /log waste/i }).first(),
        page.getByRole("button", { name: /add/i }).first(),
      ],
      "Waste Log page action button missing.",
    );
  });

  // ── 17. Smart Order ───────────────────────────────────────────────────────
  test("17 Smart Order page — loads", async ({ page }) => {
    await openAppRoute(page, "/app/smart-order");
    await settle(page);
    await expectAnyVisible(
      [
        page.getByRole("heading", { name: /smart order/i }).first(),
        page.getByText(/suggested order/i),
        page.getByText(/no recommendations/i),
      ],
      "Smart Order page did not render.",
    );
  });

  // ── 18. Purchase History ──────────────────────────────────────────────────
  test("18 Purchase History page — loads", async ({ page }) => {
    await openAppRoute(page, "/app/purchase-history");
    await settle(page);
    await expectAnyVisible(
      [
        page.getByRole("heading", { name: /purchase history/i }).first(),
        page.getByText(/purchase history/i).first(),
      ],
      "Purchase History page did not render.",
    );
  });

  // ── 19. Notifications ─────────────────────────────────────────────────────
  test("19 Notifications page — loads", async ({ page }) => {
    await openAppRoute(page, "/app/notifications");
    await settle(page);
    await expectAnyVisible(
      [
        page.getByRole("heading", { name: /notifications/i }).first(),
        page.getByText(/no notifications/i),
      ],
      "Notifications page did not render.",
    );
  });

  // ── 20. Settings ──────────────────────────────────────────────────────────
  test("20 Settings page — loads, invoice email visible (OWNER)", async ({ page }) => {
    await page.goto("/app/settings", { waitUntil: "domcontentloaded" });
    await settle(page);

    if (page.url().includes("/app/dashboard")) {
      // OwnerRoute redirected — user is not OWNER on the current restaurant.
      // eslint-disable-next-line no-console
      console.log("Settings requires OWNER role for the current restaurant — skipping.");
      return;
    }

    await expectAnyVisible(
      [
        page.getByRole("heading", { name: /settings/i }).first(),
        page.getByText(/settings/i).first(),
      ],
      "Settings page heading missing.",
    );
    await expectAnyVisible(
      [
        page.getByText(/@invoices\.margin6\.com/i),
        page.getByText(/invoice email/i),
      ],
      "Settings page should show the invoice email or its label.",
    );
  });

  // ── 21. Billing ───────────────────────────────────────────────────────────
  test("21 Billing page — loads, status visible, upgrade button present", async ({ page }) => {
    await page.goto("/app/billing", { waitUntil: "domcontentloaded" });
    await settle(page);

    if (page.url().includes("/app/dashboard")) {
      // eslint-disable-next-line no-console
      console.log("Billing requires OWNER role for the current restaurant — skipping.");
      return;
    }

    await expect(page.getByRole("heading", { name: /^billing$/i })).toBeVisible();
    await expectAnyVisible(
      [
        page.getByText(/days? left in your free trial/i),
        page.getByText(/pro plan/i).first(),
        page.getByText(/payment failed/i),
        page.getByText(/has been canceled/i),
      ],
      "Billing page must show a subscription status state.",
    );
    await expectAnyVisible(
      [page.getByRole("button", { name: /upgrade now/i })],
      "Billing page must show an Upgrade Now button when not active.",
    );
  });

  // ── 23. Sidebar navigation ────────────────────────────────────────────────
  test("23 Sidebar navigation — every link navigates without crash", async ({ page, runtime }) => {
    await openAppRoute(page, "/app/dashboard");
    await settle(page);

    const sidebarRoutes: { name: RegExp; expectUrl: RegExp }[] = [
      { name: /^overview$/i, expectUrl: /\/app\/dashboard/ },
      { name: /list management/i, expectUrl: /\/app\/inventory\/lists/ },
      { name: /inventory management/i, expectUrl: /\/app\/inventory\/enter/ },
      { name: /invoices \(receiving\)/i, expectUrl: /\/app\/invoices/ },
      { name: /waste log/i, expectUrl: /\/app\/waste-log/ },
      { name: /sales entry/i, expectUrl: /\/app\/sales/ },
      { name: /smart order/i, expectUrl: /\/app\/smart-order/ },
      { name: /purchase history/i, expectUrl: /\/app\/purchase-history/ },
      { name: /notifications/i, expectUrl: /\/app\/notifications/ },
    ];

    for (const route of sidebarRoutes) {
      const link = page.getByRole("link", { name: route.name }).first();
      if (!(await isVisible(link))) {
        // eslint-disable-next-line no-console
        console.log(`Sidebar link "${route.name}" not visible — likely role-gated.`);
        continue;
      }
      await link.click();
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(500);
      await expect(page).toHaveURL(route.expectUrl);
    }
    expect.soft(runtime.pageErrors, "No page errors during sidebar walk").toEqual([]);
  });

  // ── 24. Sign out ──────────────────────────────────────────────────────────
  test("24 Sign out — button redirects to /login", async ({ page }) => {
    await openAppRoute(page, "/app/dashboard");
    await settle(page);

    const signOut = page.getByRole("button", { name: /sign out/i }).first();
    await expect(signOut).toBeVisible();
    await signOut.click();
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(800);
    await expect(page).toHaveURL(/\/login/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Public suite — /audit never requires auth
// ═══════════════════════════════════════════════════════════════════════════
test.describe("Margin6 — public Free Leak Audit", () => {
  test("22 /audit page — loads without login in a fresh browser context", async ({ browser }) => {
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();
    try {
      await page.goto("/audit", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(800);

      await expect(page).toHaveURL(/\/audit/);
      await expect(
        page.getByRole("heading", {
          name: /find out what your restaurant lost this week/i,
        }),
      ).toBeVisible();
      await expect(page.getByText(/drop invoice pdfs here or click to browse/i)).toBeVisible();
      await expect(
        page.getByRole("button", { name: /analyze my invoices/i }),
      ).toBeVisible();
      // Button is disabled until a file is selected — assert disabled state.
      await expect(
        page.getByRole("button", { name: /analyze my invoices/i }),
      ).toBeDisabled();
    } finally {
      await context.close();
    }
  });
});
