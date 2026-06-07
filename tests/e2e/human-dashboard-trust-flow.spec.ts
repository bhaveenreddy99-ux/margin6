import { getMissingAuthReason } from "./helpers/env";
import { openFirstInvoiceReview } from "./helpers/invoice";
import { openAppRoute } from "./helpers/navigation";
import { test, expect } from "./helpers/test";
import { HumanAuditCollector, logCheck } from "./helpers/humanAudit/auditCollector";
import { fetchLiveExpectedMetrics } from "./helpers/humanAudit/auditExpectedMetrics";
import {
  buildResolvedAuditSession,
  waitForRestaurantContextSettled,
} from "./helpers/humanAudit/auditSession";
import { getSupabaseEnv } from "./helpers/humanAudit/auditSupabase";
import { formatPct, isStrictAuditMode } from "./helpers/humanAudit/parseNumbers";
import {
  readInlineCount,
  readKpiCardValue,
  readProfitRiskHero,
  readSummaryStat,
  uiInteger,
  uiMoney,
  waitForPageSettle,
} from "./helpers/humanAudit/uiCapture";
import { writeAuditReport } from "./helpers/humanAudit/writeAuditReport";
import {
  diagnoseLiveExpectedMetrics,
  logLiveMetricsDiagnostic,
} from "./helpers/humanAudit/diagnoseLiveMetrics";

const missingAuthReason = getMissingAuthReason();
const collector = new HumanAuditCollector();
const STRICT_AUDIT = isStrictAuditMode();

const CORE_KPI_LABELS = [
  "Critical low stock items",
  "Reorder needed today",
  "Inventory value",
  "Profit Risk Identified",
] as const;

test.describe("Human dashboard trust flow", () => {
  test.skip(Boolean(missingAuthReason), missingAuthReason ?? "");

  test.afterAll(async () => {
    const report = collector.buildReport();
    for (const check of report.checks) {
      logCheck(check);
    }
    const paths = writeAuditReport(report);
    // eslint-disable-next-line no-console
    console.log(`\nHuman audit report written:\n  ${paths.md}\n  ${paths.json}`);
  });

  test("walk major pages and compare UI KPIs to live Supabase-backed expected values", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    await openAppRoute(page, "/app/dashboard");
    await waitForRestaurantContextSettled(page);

    const browserSession = await buildResolvedAuditSession(page);
    const supabaseEnv = getSupabaseEnv();

    const expected =
      supabaseEnv && browserSession.restaurantId
        ? await fetchLiveExpectedMetrics(browserSession, browserSession.locationId, "this_week")
        : null;

    const hasExpected = Boolean(expected);

    if (!hasExpected) {
      logLiveMetricsDiagnostic(diagnoseLiveExpectedMetrics(browserSession));
    }

    collector.setMeta({
      baseUrl: process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173",
      restaurantId: browserSession.restaurantId,
      locationId: browserSession.locationId,
      timeFilter: "this_week",
      dataSourceAvailable: hasExpected,
    });

    if (!hasExpected) {
      collector.skip({
        page: "Setup",
        label: "Live expected metrics",
        reason:
          "Could not load Supabase expected values. Set VITE_SUPABASE_* in .env, log in via E2E_EMAIL/E2E_PASSWORD, or set E2E_SUPABASE_SERVICE_ROLE_KEY for read-only audit queries.",
      });
    }

    const compareOrSkip = (args: Parameters<HumanAuditCollector["compareNumber"]>[0]) => {
      if (!hasExpected) {
        collector.skip({
          page: args.page,
          label: args.label,
          reason: "No live expected metrics — UI captured only.",
          uiValue: args.uiValue,
        });
        return;
      }
      collector.compareNumber(args);
    };

    // ── Dashboard ─────────────────────────────────────────────────────────────
    await openAppRoute(page, "/app/dashboard");
    await waitForPageSettle(page, 3000);

    const criticalUi = await readKpiCardValue(page, "Critical low stock items");
    compareOrSkip({
      page: "Dashboard",
      label: "Critical low stock items",
      uiValue: criticalUi,
      uiNumeric: uiInteger(criticalUi),
      expectedNumeric: expected?.criticalLowCount ?? null,
      sourceData: "latest APPROVED inventory_session_items + smart_order_settings thresholds",
      sourceTables: "inventory_sessions, inventory_session_items, smart_order_settings",
      formula: "count items where stock/par < red threshold (default 50%)",
      valueKind: "count",
    });

    const reorderUi = await readKpiCardValue(page, "Reorder needed today");
    compareOrSkip({
      page: "Dashboard",
      label: "Reorder needed today",
      uiValue: reorderUi,
      uiNumeric: uiMoney(reorderUi),
      expectedNumeric: expected?.reorderValue ?? null,
      sourceData: "latest APPROVED session items",
      sourceTables: "inventory_session_items, par_guide_items",
      formula: "Σ ceil(max(par − on_hand, 0)) × unit_cost",
      useDashboardRounding: true,
    });

    const inventoryUi = await readKpiCardValue(page, "Inventory value");
    compareOrSkip({
      page: "Dashboard",
      label: "Inventory value",
      uiValue: inventoryUi,
      uiNumeric: uiMoney(inventoryUi),
      expectedNumeric: expected?.inventoryValue ?? null,
      sourceData: "latest APPROVED inventory_session_items",
      sourceTables: "inventory_sessions, inventory_session_items",
      formula: "Σ on_hand × unit_cost",
      useDashboardRounding: true,
    });

    const foodCostUi = await readKpiCardValue(page, "Food cost this period");
    if (foodCostUi === "—" || foodCostUi === "") {
      if (!hasExpected) {
        collector.skip({
          page: "Dashboard",
          label: "Food cost this period",
          reason: "No live expected metrics — UI captured only.",
          uiValue: foodCostUi || "—",
        });
      } else {
        collector.compareExact({
        page: "Dashboard",
        label: "Food cost this period",
        uiValue: foodCostUi || "—",
        expectedValue: expected?.foodCostPct == null ? "—" : formatPct(expected.foodCostPct),
        sourceData: "weekly_sales.gross_sales for current week + period invoice spend",
        formula: "null until weekly sales entered; else periodSpend / gross_sales × 100",
      });
      }
    } else {
      compareOrSkip({
        page: "Dashboard",
        label: "Food cost this period",
        uiValue: foodCostUi,
        uiNumeric: uiMoney(foodCostUi),
        expectedNumeric: expected?.foodCostPct ?? null,
        sourceData: "weekly_sales + posted invoice spend (this_week filter)",
        formula: "periodSpend / weekly_gross_sales × 100",
        valueKind: "percent",
        tolerance: 0.5,
      });
    }

    const profitRiskUi = await readProfitRiskHero(page);
    if (profitRiskUi) {
      compareOrSkip({
        page: "Dashboard",
        label: "Profit Risk Identified",
        uiValue: profitRiskUi,
        uiNumeric: uiMoney(profitRiskUi),
        expectedNumeric: expected?.moneyLostTotal ?? null,
        sourceData: "waste_log + PRICE_INCREASE notifications + overstock session + shrinkage notifications",
        sourceTables: "waste_log, notifications, inventory_session_items",
        formula: "recorded waste + price hikes + overstock exposure + shrinkage alerts",
        useDashboardRounding: true,
      });
    } else {
      const emptyState = await page.getByText(/no risk data yet/i).isVisible().catch(() => false);
      if (emptyState && expected && expected.moneyLostTotal <= 0) {
        collector.compareExact({
          page: "Dashboard",
          label: "Profit Risk Identified",
          uiValue: "No risk data yet",
          expectedValue: "No risk data yet",
          sourceData: "same as Profit Risk widget",
          formula: "total ≤ 0 → empty state",
        });
      } else {
        collector.skip({
          page: "Dashboard",
          label: "Profit Risk Identified",
          reason: emptyState ? "Empty state with positive expected total — check permissions or loading." : "Widget not visible.",
          uiValue: profitRiskUi || "—",
        });
      }
    }

    // ── Profit & Loss Intelligence (Reports redirect → dashboard section) ───────
    const pnlHeading = page.getByRole("heading", { name: /profit & loss intelligence/i });
    if (await pnlHeading.isVisible().catch(() => false)) {
      await pnlHeading.scrollIntoViewIfNeeded();
      const savingsBanner = page.getByText(/potential savings identified this period/i);
      if (await savingsBanner.isVisible().catch(() => false)) {
        const savingsText =
          (await page
            .locator("div")
            .filter({ has: savingsBanner })
            .getByText(/^\$/)
            .first()
            .textContent()) ?? "";
        const bannerExpected =
          expected == null
            ? null
            : expected.overstockValue + expected.recordedWasteValue + expected.priceIncreaseImpact;
        compareOrSkip({
          page: "Reports / P&L Intelligence",
          label: "Potential savings banner",
          uiValue: savingsText.trim(),
          uiNumeric: uiMoney(savingsText),
          expectedNumeric: bannerExpected,
          sourceData: "dashboard snapshot parts",
          formula: "overstock + recorded waste + price increase impact",
          useDashboardRounding: true,
        });
      } else {
        collector.observe({
          page: "Reports / P&L Intelligence",
          label: "Potential savings banner",
          uiValue: "hidden (no savings opportunity)",
          sourceData: "dashboard ProfitLossIntelligence",
          note: "Banner only renders when overstock + waste + price hikes > 0",
        });
      }
    } else {
      collector.skip({
        page: "Reports / P&L Intelligence",
        label: "Section",
        reason: "Profit & Loss Intelligence section not visible on dashboard (scroll/layout).",
      });
    }

    // ── List Management / Catalog ─────────────────────────────────────────────
    await openAppRoute(page, "/app/inventory/lists");
    await waitForPageSettle(page, 2000);
    await expect(page.getByRole("heading", { name: /list management/i })).toBeVisible();
    const catalogRows = page.locator("table tbody tr");
    const visibleCatalogRows = await catalogRows.count();
    if (expected && visibleCatalogRows > 0) {
      collector.observe({
        page: "List Management / Catalog",
        label: "Visible catalog rows",
        uiValue: String(visibleCatalogRows),
        sourceData: `inventory_catalog_items count=${expected.catalogItemCount}`,
        note: `UI shows filtered table rows; DB total=${expected.catalogItemCount} (may differ by list/filter)`,
      });
    } else {
      collector.skip({
        page: "List Management / Catalog",
        label: "Catalog row count",
        reason: "No table rows visible or no expected metrics — page load verified only.",
      });
    }

    // ── PAR Management ──────────────────────────────────────────────────────
    await openAppRoute(page, "/app/par");
    await waitForPageSettle(page, 2000);
    await expect(page.getByRole("heading", { name: /par management/i })).toBeVisible();
    if (expected) {
      collector.observe({
        page: "PAR Management",
        label: "PAR guide item count (DB)",
        uiValue: "see par table",
        sourceData: "latest par_guide_items for restaurant/location",
        note: `Expected par_guide_items=${expected.parGuideItemCount} — compare visually in UI table`,
      });
    }

    // ── Inventory Count ─────────────────────────────────────────────────────
    await openAppRoute(page, "/app/inventory/enter");
    await waitForPageSettle(page, 2000);
    await expect(page.getByRole("heading", { name: /^inventory management$/i })).toBeVisible();
    if (expected) {
      const inProgressLabel = `${expected.inProgressSessionCount} in progress`;
      collector.observe({
        page: "Inventory Count",
        label: "In-progress sessions",
        uiValue: inProgressLabel,
        sourceData: "inventory_sessions status=IN_PROGRESS",
        formula: "count scoped to restaurant/location",
      });
    }

    // ── Inventory Review / Approval ─────────────────────────────────────────
    await openAppRoute(page, "/app/inventory/review");
    await waitForPageSettle(page, 2000);
    if (expected) {
      collector.observe({
        page: "Inventory Review / Approval",
        label: "Submitted sessions awaiting approval",
        uiValue: String(expected.submittedSessionCount),
        sourceData: "inventory_sessions status=SUBMITTED",
        formula: "count scoped to restaurant/location",
      });
    }

    // ── Smart Order ─────────────────────────────────────────────────────────
    await openAppRoute(page, "/app/smart-order");
    await waitForPageSettle(page, 2500);
    const redStat = page
      .locator("div.rounded-lg.border")
      .filter({ hasText: /^Critical$/ })
      .locator("p.stat-value")
      .first();
    if (expected?.smartOrderRedCount != null && (await redStat.isVisible().catch(() => false))) {
      const redUi = ((await redStat.textContent()) ?? "").trim();
      compareOrSkip({
        page: "Smart Order",
        label: "Critical (RED) lines on latest run",
        uiValue: redUi,
        uiNumeric: uiInteger(redUi),
        expectedNumeric: expected.smartOrderRedCount,
        sourceData: "latest smart_order_run_items + risk thresholds",
        formula: "count lines where stock/par < red threshold",
        valueKind: "count",
      });
    } else {
      collector.skip({
        page: "Smart Order",
        label: "RED line count",
        reason: "No smart order run in UI or stat not visible.",
      });
    }

    // ── Invoices ────────────────────────────────────────────────────────────
    await openAppRoute(page, "/app/invoices");
    await waitForPageSettle(page, 2000);
    const totalInvoicesUi = await readSummaryStat(page, "Total Invoices");
    compareOrSkip({
      page: "Invoices",
      label: "Total Invoices",
      uiValue: totalInvoicesUi,
      uiNumeric: uiInteger(totalInvoicesUi),
      expectedNumeric: expected?.invoiceTotal ?? null,
      sourceData: "invoices table for restaurant/location",
      formula: "count(all invoices)",
      valueKind: "count",
    });

    const pendingUi = await readSummaryStat(page, "Pending");
    compareOrSkip({
      page: "Invoices",
      label: "Pending",
      uiValue: pendingUi,
      uiNumeric: uiInteger(pendingUi),
      expectedNumeric: expected?.invoicePending ?? null,
      sourceData: "invoices by status",
      formula: "draftCount + receivedCount (summarizeInvoices)",
      valueKind: "count",
    });

    const vendorsUi = await readSummaryStat(page, "Active Vendors");
    compareOrSkip({
      page: "Invoices",
      label: "Active Vendors",
      uiValue: vendorsUi,
      uiNumeric: uiInteger(vendorsUi),
      expectedNumeric: expected?.invoiceActiveVendors ?? null,
      sourceData: "distinct vendor_name on invoices",
      formula: "Set(vendor_name).size",
      valueKind: "count",
    });

    // ── Invoice Review + Receipt Confirmation ───────────────────────────────
    const invoiceId = await openFirstInvoiceReview(page);
    if (invoiceId) {
      collector.observe({
        page: "Invoice Review",
        label: "Opened review route",
        uiValue: invoiceId,
        sourceData: "first Review button on invoices list",
        note: "Invoice loaded for line-level review",
      });

      const confirmBtn = page.getByRole("button", { name: /confirm receipt/i });
      const postBtn = page.getByRole("button", { name: /post invoice|confirm receipt/i });
      const receiptUi = (await confirmBtn.isVisible().catch(() => false))
        ? "Confirm receipt available"
        : (await postBtn.isVisible().catch(() => false))
          ? "Post / confirm control visible"
          : "Receipt already confirmed or blocked";
      collector.observe({
        page: "Receipt Confirmation",
        label: "Receipt workflow state",
        uiValue: receiptUi,
        sourceData: `invoice ${invoiceId} receipt_status`,
        note: "Human check — confirm button disabled when received qty unconfirmed",
      });
    } else {
      collector.skip({
        page: "Invoice Review",
        label: "Review screen",
        reason: "No reviewable invoice in seeded data.",
      });
      collector.skip({
        page: "Receipt Confirmation",
        label: "Confirm receipt",
        reason: "Depends on reviewable invoice.",
      });
    }

    // ── Waste Log ───────────────────────────────────────────────────────────
    await openAppRoute(page, "/app/waste-log");
    await waitForPageSettle(page, 2000);
    const weekWasteCard = page
      .locator("div.rounded-lg.border")
      .filter({ has: page.locator("svg.lucide-trending-down") })
      .locator("p.text-2xl")
      .first();
    if (await weekWasteCard.isVisible().catch(() => false) && expected) {
      const weekUi = ((await weekWasteCard.textContent()) ?? "").trim();
      compareOrSkip({
        page: "Waste Log",
        label: "Waste cost this week",
        uiValue: weekUi,
        uiNumeric: uiMoney(weekUi),
        expectedNumeric: expected.wasteWeekCost,
        sourceData: "waste_log rows since Monday (total_cost sum)",
        formula: "Σ total_cost for week entries",
        useDashboardRounding: true,
      });
    } else {
      collector.skip({
        page: "Waste Log",
        label: "Week waste cost",
        reason: "Summary card not visible or no expected metrics.",
      });
    }

    // ── Notifications ───────────────────────────────────────────────────────
    await openAppRoute(page, "/app/notifications");
    await waitForPageSettle(page, 1500);
    const unreadLine = await readInlineCount(page, /\d+ unread notification/i);
    if (unreadLine && expected) {
      const unreadUi = uiInteger(unreadLine);
      compareOrSkip({
        page: "Notifications",
        label: "Unread notifications (30-day window)",
        uiValue: unreadLine,
        uiNumeric: unreadUi,
        expectedNumeric: expected.unreadNotifications,
        sourceData: "notifications where read_at IS NULL",
        formula: "count for current user + restaurant, last 30 days",
        valueKind: "count",
      });
    } else {
      collector.skip({
        page: "Notifications",
        label: "Unread count",
        reason: "Unread banner not shown or expected metrics unavailable.",
      });
    }

    // ── Final assertion + report hint ───────────────────────────────────────
    const failed = collector.getFailedChecks();
    const skippedCore = collector.getSkippedCoreKpis(CORE_KPI_LABELS);

    if (STRICT_AUDIT && skippedCore.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `\nStrict audit: ${skippedCore.length} core KPI(s) skipped — set E2E_SUPABASE_SERVICE_ROLE_KEY`,
      );
    }

    if (failed.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `\n${failed.length} KPI mismatch(es). See dashboard-trust-human-audit-report.md`,
      );
    }

    if (STRICT_AUDIT) {
      expect(
        skippedCore,
        `Strict audit: core KPIs must not SKIP — ${skippedCore.map((c) => c.label).join(", ")}`,
      ).toEqual([]);
    }

    expect(
      failed,
      `Dashboard trust human audit: ${failed.length} KPI(s) mismatched — see dashboard-trust-human-audit-report.md`,
    ).toEqual([]);
  });
});
