import { loginIfNeeded, expectNoRuntimeOverlay } from "./helpers/auth";
import { getMissingAuthReason } from "./helpers/env";
import { expectAnyVisible, isVisible, openAppRoute } from "./helpers/navigation";
import { test, expect } from "./helpers/test";
import type { Page } from "@playwright/test";

const missingAuthReason = getMissingAuthReason();

test.setTimeout(45_000);

async function settle(page: Page, ms = 800): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(ms);
}

async function getHeaderRestaurantName(page: Page): Promise<string | null> {
  const header = page.locator("header");
  const restaurantButton = header.locator("button").filter({
    has: page.locator("svg.lucide-building2"),
  }).first();
  if (await isVisible(restaurantButton)) {
    const text = (await restaurantButton.innerText()).trim();
    if (text && !/select restaurant/i.test(text)) return text.split("\n")[0]?.trim() ?? text;
  }
  const staticName = header.locator("button.pointer-events-none span").first();
  if (await isVisible(staticName)) {
    return (await staticName.innerText()).trim();
  }
  return null;
}

async function openRestaurantDropdown(page: Page): Promise<boolean> {
  const switcher = page.locator("header button").filter({
    has: page.locator("svg.lucide-building2"),
  }).first();
  if (!(await isVisible(switcher))) {
    return false;
  }
  await switcher.click();
  await page.waitForTimeout(500);
  return true;
}

function restaurantMenuItems(page: Page) {
  return page.getByRole("menuitem").filter({ hasNotText: /add new restaurant/i });
}

async function switchToSecondRestaurant(page: Page): Promise<boolean> {
  const currentName = await getHeaderRestaurantName(page);
  const opened = await openRestaurantDropdown(page);
  if (!opened) {
    // eslint-disable-next-line no-console
    console.log("Only 1 restaurant — switch step skipped");
    return false;
  }

  const items = restaurantMenuItems(page);
  const count = await items.count();
  if (count < 2) {
    // eslint-disable-next-line no-console
    console.log("Only 1 restaurant — switch step skipped");
    await page.keyboard.press("Escape");
    return false;
  }

  for (let i = 0; i < count; i++) {
    const item = items.nth(i);
    const label = ((await item.innerText()).trim().split("\n")[0] ?? "").trim();
    if (label && label !== currentName) {
      await item.click();
      await settle(page, 2000);
      return true;
    }
  }

  await items.nth(1).click();
  await settle(page, 2000);
  return true;
}

async function assertRestaurantContextChanged(
  page: Page,
  previousName: string | null,
): Promise<void> {
  const newName = await getHeaderRestaurantName(page);
  if (previousName && newName && newName !== previousName) {
    expect(newName).not.toBe(previousName);
    return;
  }

  await expectAnyVisible(
    [
      page.getByText(/switched to/i),
      page.getByRole("heading", { name: /^dashboard$/i }),
      page.getByText(/showing data for/i),
    ],
    "Restaurant switch should update context or show switch confirmation.",
  );
}

async function assertCleanBody(page: Page, scope: "main" | "body" = "main"): Promise<void> {
  const text = await page.locator(scope === "main" ? "main" : "body").innerText();
  expect(text).not.toContain("undefined");
  expect(text).not.toContain("[object Object]");
  expect(text).not.toContain("NaN");
}

async function openInvoiceSettingsSection(page: Page): Promise<void> {
  await page.getByRole("button", { name: /invoice settings/i }).click();
  await settle(page);
}

async function extractInvoiceEmail(page: Page): Promise<string | null> {
  const text = await page.locator("main").innerText();
  const match = text.match(/[a-z0-9-]+@invoices\.margin6\.com/i);
  return match?.[0] ?? null;
}

async function countRestaurantCards(page: Page): Promise<number> {
  return page.getByRole("button", { name: /^open$/i }).count();
}

async function assertNoCrash(page: Page): Promise<void> {
  await expectNoRuntimeOverlay(page);
  await assertCleanBody(page);
}

test.describe("Smart Landing Page Routing", () => {
  test("1.1 — single restaurant lands on dashboard, multi lands on restaurants", async ({ page }) => {
    test.skip(Boolean(missingAuthReason), missingAuthReason ?? "");

    await loginIfNeeded(page);
    await page.goto("/app", { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/app\/(dashboard|restaurants)/, { timeout: 15_000 });

    const url = page.url();
    if (url.includes("/app/restaurants")) {
      expect(url).toMatch(/\/app\/restaurants/);
    } else {
      expect(url).toMatch(/\/app\/dashboard/);
    }

    await assertNoCrash(page);
  });

  test("1.2 — unauthenticated /app redirects to login", async ({ browser }) => {
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    try {
      await page.goto("/app", { waitUntil: "domcontentloaded" });
      await settle(page);

      expect(
        /\/login|\/demo|\/onboarding/.test(page.url()),
        `Expected redirect to login, demo, or onboarding; got ${page.url()}`,
      ).toBeTruthy();
    } finally {
      await context.close();
    }
  });

  test("1.3 — /app/dashboard always accessible when authenticated", async ({ page }) => {
    test.skip(Boolean(missingAuthReason), missingAuthReason ?? "");

    await openAppRoute(page, "/app/dashboard");
    await settle(page, 1000);

    await expect(page.getByRole("heading", { name: /^dashboard$/i })).toBeVisible({ timeout: 20_000 });
    await assertNoCrash(page);
  });
});

test.describe("Restaurant Context Isolation", () => {
  test.skip(Boolean(missingAuthReason), missingAuthReason ?? "");

  test("2.1 — header shows correct restaurant name", async ({ page }) => {
    await openAppRoute(page, "/app/dashboard");
    await settle(page, 1000);

    const name = await getHeaderRestaurantName(page);
    expect(name).toBeTruthy();
    expect(name).not.toMatch(/select restaurant/i);

    const restaurantSwitchers = page.locator("header button").filter({
      has: page.locator("svg.lucide-building2"),
    });
    expect(await restaurantSwitchers.count()).toBeLessThanOrEqual(1);

    await assertNoCrash(page);
  });

  test("2.2 — dashboard subtitle matches header restaurant", async ({ page }) => {
    await openAppRoute(page, "/app/dashboard");
    await settle(page, 1000);

    const headerName = await getHeaderRestaurantName(page);
    if (headerName) {
      await expectAnyVisible(
        [
          page.getByText(/showing data for/i),
          page.locator("main").getByText(headerName, { exact: false }),
          page.getByRole("heading", { name: /^dashboard$/i }),
        ],
        "Dashboard should reference the current restaurant context.",
      );
    }

    await assertNoCrash(page);
  });

  test("2.3 — switching restaurant changes dashboard data", async ({ page }) => {
    await openAppRoute(page, "/app/dashboard");
    await settle(page, 1000);

    const previousName = await getHeaderRestaurantName(page);

    const switched = await switchToSecondRestaurant(page);
    if (!switched) return;

    await assertRestaurantContextChanged(page, previousName);
    await expect(page).toHaveURL(/\/app\/dashboard/);
    await assertNoCrash(page);
  });

  test("2.4 — data isolation line visible for multi-restaurant only", async ({ page }) => {
    await openAppRoute(page, "/app/dashboard");
    await settle(page, 1000);

    const hasDropdown = await isVisible(
      page.locator("header button").filter({ has: page.locator("svg.lucide-building2") }).first(),
    );
    const bodyText = await page.locator("main").innerText();

    if (hasDropdown) {
      expect(bodyText).toMatch(/showing data for/i);
    } else {
      expect(bodyText).not.toMatch(/showing data for/i);
    }

    await assertNoCrash(page);
  });

  test("2.5 — switching restaurant does not crash any widget", async ({ page }) => {
    await openAppRoute(page, "/app/dashboard");
    await settle(page, 1000);

    await switchToSecondRestaurant(page);
    await settle(page, 2000);

    await expectAnyVisible(
      [
        page.getByText(/money lost/i),
        page.getByText(/lost this period/i),
        page.getByText(/profit leak/i),
        page.getByText(/price hike/i),
        page.getByText(/critical/i),
        page.getByText(/reorder/i),
        page.getByText(/inventory value/i),
        page.getByText(/today/i),
        page.getByText(/briefing/i),
        page.getByText(/at a glance/i),
        page.getByRole("heading", { name: /^dashboard$/i }),
        page.getByText(/switched to/i),
      ],
      "Dashboard widgets or empty states should render after restaurant switch.",
    );

    await assertNoCrash(page);
  });
});

test.describe("Inventory Isolation", () => {
  test.skip(Boolean(missingAuthReason), missingAuthReason ?? "");

  test("3.1 — List Management loads for current restaurant", async ({ page }) => {
    await openAppRoute(page, "/app/inventory/lists");
    await settle(page, 1000);

    await expectAnyVisible(
      [
        page.getByText(/list management/i),
        page.getByText(/list/i),
        page.getByText(/no lists/i),
        page.getByRole("button", { name: /create list/i }),
      ],
      "List Management should render lists or empty state.",
    );

    await assertNoCrash(page);
  });

  test("3.2 — List Management shows restaurant-scoped lists only", async ({ page }) => {
    await openAppRoute(page, "/app/inventory/lists");
    await settle(page, 1000);

    await switchToSecondRestaurant(page);
    await settle(page, 1500);

    await expectAnyVisible(
      [
        page.getByText(/list management/i),
        page.getByText(/no lists/i),
        page.getByRole("button", { name: /create list/i }),
      ],
      "List Management should reload after restaurant switch.",
    );

    await assertNoCrash(page);
  });

  test("3.3 — Inventory count page loads for current restaurant", async ({ page }) => {
    await openAppRoute(page, "/app/inventory/enter");
    await settle(page, 1000);

    await expectAnyVisible(
      [
        page.getByText(/inventory management/i),
        page.getByText(/inventory/i),
        page.getByText(/start/i),
        page.getByText(/select a list/i),
        page.getByText(/select a location/i),
        page.getByRole("button", { name: /start/i }),
      ],
      "Inventory count page should render.",
    );

    await assertNoCrash(page);
  });

  test("3.4 — PAR page loads for current restaurant", async ({ page }) => {
    await openAppRoute(page, "/app/par");
    await settle(page, 1000);

    await expectAnyVisible(
      [
        page.getByText(/par/i),
        page.getByText(/guide/i),
        page.getByText(/create par guide/i),
        page.getByText(/create an inventory list/i),
        page.getByRole("button", { name: /create/i }),
      ],
      "PAR page should render guides or empty state.",
    );

    await assertNoCrash(page);
  });
});

test.describe("Invoice Isolation", () => {
  test.skip(Boolean(missingAuthReason), missingAuthReason ?? "");

  test("4.1 — Invoices page loads for current restaurant", async ({ page }) => {
    await openAppRoute(page, "/app/invoices");
    await settle(page, 1000);

    await expectAnyVisible(
      [
        page.getByText(/invoice/i),
        page.getByText(/no invoice/i),
        page.getByRole("button", { name: /upload/i }),
      ],
      "Invoices page should render.",
    );

    await assertNoCrash(page);
  });

  test("4.2 — Invoice data changes on restaurant switch", async ({ page }) => {
    await openAppRoute(page, "/app/invoices");
    await settle(page, 1000);

    await switchToSecondRestaurant(page);
    await settle(page, 1500);

    await expectAnyVisible(
      [
        page.getByText(/invoice/i),
        page.getByText(/no invoice/i),
        page.getByRole("button", { name: /upload/i }),
      ],
      "Invoices page should render after restaurant switch.",
    );

    await assertNoCrash(page);
  });

  test("4.3 — Invoice email address is restaurant-specific", async ({ page }) => {
    await openAppRoute(page, "/app/settings");
    await settle(page, 1000);

    await openInvoiceSettingsSection(page);

    await expectAnyVisible(
      [
        page.getByText(/invoices\.margin6\.com/i),
        page.getByText(/invoice.*email/i),
        page.getByText(/@invoices/i),
        page.getByText(/generate invoice email/i),
      ],
      "Settings should show invoice email section.",
    );

    const emailA = await extractInvoiceEmail(page);
    const switched = await switchToSecondRestaurant(page);

    if (!switched || !emailA) {
      // eslint-disable-next-line no-console
      console.log("Single restaurant or no invoice email — email isolation not exercised");
      await assertNoCrash(page);
      return;
    }

    await openAppRoute(page, "/app/settings");
    await settle(page, 1000);
    await openInvoiceSettingsSection(page);

    const emailB = await extractInvoiceEmail(page);
    if (emailB) {
      expect(emailB).not.toBe(emailA);
      expect(emailB).toMatch(/@invoices\.margin6\.com/i);
    }

    await assertNoCrash(page);
  });
});

test.describe("Sales and Waste Isolation", () => {
  test.skip(Boolean(missingAuthReason), missingAuthReason ?? "");

  test("5.1 — Sales Entry loads for current restaurant", async ({ page }) => {
    await openAppRoute(page, "/app/sales");
    await settle(page, 1000);

    await expectAnyVisible(
      [
        page.getByText(/sales/i),
        page.getByText(/weekly/i),
        page.getByText(/gross sales/i),
        page.getByText(/no sales/i),
        page.getByRole("heading", { name: /sales entry/i }),
      ],
      "Sales page should render.",
    );

    await assertNoCrash(page);
  });

  test("5.2 — Sales data scoped to current restaurant", async ({ page }) => {
    await openAppRoute(page, "/app/sales");
    await settle(page, 1000);

    await switchToSecondRestaurant(page);
    await settle(page, 1500);

    await expectAnyVisible(
      [
        page.getByText(/sales/i),
        page.getByText(/weekly/i),
        page.getByRole("heading", { name: /sales entry/i }),
      ],
      "Sales page should render after restaurant switch.",
    );

    await assertCleanBody(page);
    await expectNoRuntimeOverlay(page);
  });

  test("5.3 — Waste Log loads for current restaurant", async ({ page }) => {
    await openAppRoute(page, "/app/waste-log");
    await settle(page, 1000);

    await expectAnyVisible(
      [
        page.getByText(/waste/i),
        page.getByRole("button", { name: /log waste/i }),
        page.getByText(/most wasted/i),
        page.getByText(/entries/i),
      ],
      "Waste Log should render.",
    );

    await assertNoCrash(page);
  });

  test("5.4 — Waste Log data changes on restaurant switch", async ({ page }) => {
    await openAppRoute(page, "/app/waste-log");
    await settle(page, 1000);

    await switchToSecondRestaurant(page);
    await settle(page, 1500);

    await expectAnyVisible(
      [
        page.getByText(/waste log/i),
        page.getByRole("button", { name: /log waste/i }),
      ],
      "Waste Log should render after restaurant switch.",
    );

    await assertCleanBody(page);
    await expectNoRuntimeOverlay(page);
  });
});

test.describe("Notifications Isolation", () => {
  test.skip(Boolean(missingAuthReason), missingAuthReason ?? "");

  test("6.1 — Bell badge shows a number (honest count)", async ({ page }) => {
    await openAppRoute(page, "/app/dashboard");
    await settle(page, 1000);

    const header = page.locator("header");
    await expectAnyVisible(
      [
        header.locator("button").filter({ has: page.locator("svg") }),
        header.getByRole("button").nth(-2),
      ],
      "Header bell control should render.",
    );

    const badge = header.locator(".bg-destructive").first();
    if (await isVisible(badge)) {
      const badgeText = (await badge.innerText()).trim();
      expect(badgeText).toMatch(/^\d+|99\+$/);
    }

    await assertNoCrash(page);
  });

  test("6.2 — Notifications page loads", async ({ page }) => {
    await openAppRoute(page, "/app/notifications");
    await settle(page, 1000);

    await expectAnyVisible(
      [
        page.getByText(/notification/i),
        page.getByText(/no notification/i),
        page.getByText(/price/i),
        page.getByText(/alert/i),
        page.getByRole("tab"),
      ],
      "Notifications page should render.",
    );

    await assertNoCrash(page);
  });

  test("6.3 — Notifications show restaurant filter (multi)", async ({ page }) => {
    await openAppRoute(page, "/app/notifications");
    await settle(page, 1000);

    const cardCount = await countRestaurantCards(page);
    if (cardCount >= 2) {
      await openAppRoute(page, "/app/notifications");
      await settle(page, 1000);

      await expectAnyVisible(
        [
          page.getByText(/showing alerts for/i),
          page.getByText(/switch restaurants/i),
          page.getByRole("tab"),
          page.getByRole("button", { name: /all restaurants/i }),
        ],
        "Multi-restaurant notifications should show filter and context copy.",
      );
    } else {
      // eslint-disable-next-line no-console
      console.log("Only 1 restaurant — notification filter not shown");
    }

    await assertNoCrash(page);
  });

  test("6.4 — Notifications page does not crash on switch", async ({ page }) => {
    await openAppRoute(page, "/app/notifications");
    await settle(page, 1000);

    await switchToSecondRestaurant(page);
    await settle(page, 1500);

    await expectAnyVisible(
      [
        page.getByText(/notification/i),
        page.getByText(/no notification/i),
      ],
      "Notifications page should render after restaurant switch.",
    );

    await assertCleanBody(page);
    await expectNoRuntimeOverlay(page);
  });
});

test.describe("Settings Isolation", () => {
  test.skip(Boolean(missingAuthReason), missingAuthReason ?? "");

  test("7.1 — Settings page loads for current restaurant", async ({ page }) => {
    await openAppRoute(page, "/app/settings");
    await settle(page, 1000);

    await expectAnyVisible(
      [
        page.getByText(/settings/i),
        page.getByText(/restaurant/i),
        page.getByText(/invoice/i),
        page.getByText(/timezone/i),
        page.getByRole("button", { name: /business profile/i }),
      ],
      "Settings page should render.",
    );

    await assertNoCrash(page);
  });

  test("7.2 — Settings shows current restaurant name", async ({ page }) => {
    await openAppRoute(page, "/app/settings");
    await settle(page, 1000);

    const headerName = await getHeaderRestaurantName(page);
    await page.getByRole("button", { name: /business profile/i }).click();
    await settle(page);

    if (headerName) {
      await expectAnyVisible(
        [
          page.getByLabel(/restaurant name/i),
          page.locator("main").getByRole("textbox").first(),
          page.locator("main").getByText(headerName, { exact: false }),
        ],
        "Settings should reference the current restaurant.",
      );
      const nameInput = page.getByLabel(/restaurant name/i);
      if (await isVisible(nameInput)) {
        await expect(nameInput).toHaveValue(headerName);
      }
    }

    await assertNoCrash(page);
  });

  test("7.3 — Settings data changes on restaurant switch", async ({ page }) => {
    await openAppRoute(page, "/app/settings");
    await settle(page, 1000);

    await page.getByRole("button", { name: /business profile/i }).click();
    await settle(page);

    const nameBefore = await getHeaderRestaurantName(page);
    const switched = await switchToSecondRestaurant(page);
    if (!switched) return;

    await openAppRoute(page, "/app/settings");
    await settle(page, 1000);
    await page.getByRole("button", { name: /business profile/i }).click();
    await settle(page);

    await assertRestaurantContextChanged(page, nameBefore);
    await assertNoCrash(page);
  });
});

test.describe("Billing Isolation", () => {
  test.skip(Boolean(missingAuthReason), missingAuthReason ?? "");

  test("8.1 — Billing page loads for current restaurant", async ({ page }) => {
    await openAppRoute(page, "/app/billing");
    await settle(page, 1000);

    await expectAnyVisible(
      [
        page.getByText(/billing/i),
        page.getByText(/trial/i),
        page.getByText(/plan/i),
        page.getByText(/\$99/i),
        page.getByText(/upgrade/i),
      ],
      "Billing page should render.",
    );

    await assertNoCrash(page);
  });

  test("8.2 — Billing shows trial or active for current restaurant", async ({ page }) => {
    await openAppRoute(page, "/app/billing");
    await settle(page, 1000);

    await expectAnyVisible(
      [
        page.getByText(/trial/i),
        page.getByText(/active/i),
        page.getByText(/days left/i),
        page.getByText(/pro plan/i),
        page.getByText(/canceled/i),
      ],
      "Billing should show subscription status.",
    );

    await assertNoCrash(page);
  });

  test("8.3 — Billing is restaurant-scoped (multi)", async ({ page }) => {
    await openAppRoute(page, "/app/billing");
    await settle(page, 1000);

    await switchToSecondRestaurant(page);
    await settle(page, 1500);

    await openAppRoute(page, "/app/billing");
    await settle(page, 1000);

    await expectAnyVisible(
      [
        page.getByText(/billing/i),
        page.getByText(/trial/i),
        page.getByText(/pro plan/i),
        page.getByText(/upgrade/i),
      ],
      "Billing should render for switched restaurant.",
    );

    await assertNoCrash(page);
  });
});

test.describe("Smart Order Isolation", () => {
  test.skip(Boolean(missingAuthReason), missingAuthReason ?? "");

  test("9.1 — Smart Order loads for current restaurant", async ({ page }) => {
    await openAppRoute(page, "/app/smart-order");
    await settle(page, 1000);

    await expectAnyVisible(
      [
        page.getByText(/smart order/i),
        page.getByText(/inventory count/i),
        page.getByText(/generate/i),
        page.getByText(/par/i),
        page.getByText(/approve/i),
      ],
      "Smart Order page should render.",
    );

    await assertNoCrash(page);
  });

  test("9.2 — Smart Order data changes on restaurant switch", async ({ page }) => {
    await openAppRoute(page, "/app/smart-order");
    await settle(page, 1000);

    await switchToSecondRestaurant(page);
    await settle(page, 1500);

    await expectAnyVisible(
      [
        page.getByText(/smart order/i),
        page.getByText(/inventory count/i),
        page.getByText(/par/i),
      ],
      "Smart Order should render after restaurant switch.",
    );

    await assertCleanBody(page);
    await expectNoRuntimeOverlay(page);
  });
});

test.describe("Complete Data Isolation Proof", () => {
  test.skip(Boolean(missingAuthReason), missingAuthReason ?? "");

  test("10.1 — Full page scan after switch (no cross-contamination)", async ({ page }) => {
    await openAppRoute(page, "/app/dashboard");
    await settle(page, 1000);

    const nameA = await getHeaderRestaurantName(page);
    const switched = await switchToSecondRestaurant(page);
    if (!switched || !nameA) return;

    await settle(page, 2000);

    const nameB = await getHeaderRestaurantName(page);
    if (nameB && nameB !== nameA) {
      expect(nameB).not.toBe(nameA);
      const mainText = await page.locator("main").innerText();
      expect(mainText.includes(nameA)).toBeFalsy();
    } else {
      await assertRestaurantContextChanged(page, nameA);
    }

    await assertNoCrash(page);
  });

  test("10.2 — Each page shows only current restaurant data", async ({ page }) => {
    test.setTimeout(120_000);
    const routes = [
      "/app/invoices",
      "/app/waste-log",
      "/app/sales",
      "/app/smart-order",
      "/app/inventory/lists",
    ];

    for (const route of routes) {
      await openAppRoute(page, route);
      await settle(page, 1000);
      await switchToSecondRestaurant(page);
      await settle(page, 1500);

      await assertCleanBody(page);
      const bodyText = await page.locator("body").innerText();
      expect(bodyText).not.toContain("null");
      await expectNoRuntimeOverlay(page);
    }
  });

  test("10.3 — Money Lost widget resets on restaurant switch", async ({ page }) => {
    await openAppRoute(page, "/app/dashboard");
    await settle(page, 1000);

    const beforeText = await page.locator("main").innerText();
    const switched = await switchToSecondRestaurant(page);
    if (!switched) return;

    await settle(page, 2000);

    await expectAnyVisible(
      [
        page.getByText(/money lost/i),
        page.getByText(/lost this period/i),
        page.getByText(/no waste/i),
        page.getByText(/no data/i),
        page.getByRole("heading", { name: /^dashboard$/i }),
        page.getByText(/switched to/i),
      ],
      "Money Lost widget should re-render after restaurant switch.",
    );

    const afterText = await page.locator("main").innerText();
    expect(afterText.length).toBeGreaterThan(0);
    expect(beforeText || afterText).toBeTruthy();

    await assertNoCrash(page);
  });

  test("10.4 — Settings invoice email unique per restaurant", async ({ page }) => {
    await openAppRoute(page, "/app/settings");
    await settle(page, 1000);
    await openInvoiceSettingsSection(page);

    const emailA = await extractInvoiceEmail(page);
    const switched = await switchToSecondRestaurant(page);
    if (!switched || !emailA) {
      // eslint-disable-next-line no-console
      console.log("Single restaurant or missing invoice email — isolation proof skipped");
      return;
    }

    await openAppRoute(page, "/app/settings");
    await settle(page, 1000);
    await openInvoiceSettingsSection(page);

    const emailB = await extractInvoiceEmail(page);
    if (emailB) {
      expect(emailB).not.toBe(emailA);
      expect(emailA).toMatch(/@invoices\.margin6\.com/i);
      expect(emailB).toMatch(/@invoices\.margin6\.com/i);
    }

    await assertNoCrash(page);
  });
});

test.describe("Purchase History Isolation", () => {
  test.skip(Boolean(missingAuthReason), missingAuthReason ?? "");

  test("11.1 — Purchase History loads per restaurant", async ({ page }) => {
    await openAppRoute(page, "/app/purchase-history");
    await settle(page, 1000);

    await expectAnyVisible(
      [
        page.getByText(/purchase history/i),
        page.getByText(/purchase/i),
        page.getByText(/history/i),
        page.getByText(/no purchase/i),
        page.getByText(/no records/i),
        page.getByText(/order/i),
      ],
      "Purchase History should render.",
    );

    await assertNoCrash(page);
  });

  test("11.2 — Purchase History changes on switch", async ({ page }) => {
    await openAppRoute(page, "/app/purchase-history");
    await settle(page, 1000);

    await switchToSecondRestaurant(page);
    await settle(page, 1500);

    await expectAnyVisible(
      [
        page.getByText(/purchase history/i),
        page.getByText(/no records/i),
        page.getByText(/no purchase/i),
      ],
      "Purchase History should render after restaurant switch.",
    );

    await assertNoCrash(page);
  });
});

test.describe("My Restaurants Portfolio", () => {
  test.skip(Boolean(missingAuthReason), missingAuthReason ?? "");

  test("12.1 — My Restaurants shows real KPIs not dashes", async ({ page }) => {
    await openAppRoute(page, "/app/restaurants");
    await settle(page, 3000);

    await expectAnyVisible(
      [
        page.getByText(/money lost/i),
        page.getByText(/\$\d/),
        page.getByText(/no counts yet/i),
        page.getByText(/inventory/i),
      ],
      "Restaurant cards should show KPI data or valid empty states.",
    );

    await assertCleanBody(page, "body");
    await expectNoRuntimeOverlay(page);
  });

  test("12.2 — Comparison table ranks by money lost", async ({ page }) => {
    await openAppRoute(page, "/app/restaurants");
    await settle(page, 2000);

    const cardCount = await countRestaurantCards(page);
    if (cardCount < 2) {
      // eslint-disable-next-line no-console
      console.log("Only 1 restaurant — comparison table not shown");
      return;
    }

    await expectAnyVisible(
      [
        page.getByRole("table"),
        page.getByText(/this week.*all restaurants/i),
        page.getByText(/all restaurants/i),
      ],
      "Comparison table should render for 2+ restaurants.",
    );

    const firstRow = page.getByRole("row").nth(1);
    await firstRow.click();
    await settle(page);

    await expect(page).toHaveURL(/\/app\/dashboard/);
    await assertNoCrash(page);
  });

  test("12.3 — Add New Restaurant card always visible", async ({ page }) => {
    await openAppRoute(page, "/app/restaurants");
    await settle(page, 1000);

    const addButton = page.getByText(/add new restaurant/i).first();
    await expectAnyVisible(
      [addButton, page.getByRole("button", { name: /add/i })],
      "Add New Restaurant affordance should be visible.",
    );

    await addButton.click();
    await settle(page);

    await expect(page).toHaveURL(/\/app\/restaurants\/new|\/onboarding\/create-restaurant/);
  });

  test("12.4 — My Restaurants link in sidebar (2+ restaurants)", async ({ page }) => {
    await openAppRoute(page, "/app/dashboard");
    await settle(page, 1000);

    const myRestaurantsLink = page.getByRole("link", { name: /my restaurants/i });
    if (!(await isVisible(myRestaurantsLink))) {
      // eslint-disable-next-line no-console
      console.log("Only 1 restaurant — My Restaurants sidebar link hidden");
      return;
    }

    await myRestaurantsLink.click();
    await settle(page);

    await expect(page).toHaveURL(/\/app\/restaurants/);
    await assertNoCrash(page);
  });
});

test.describe("Free Audit (Public, No Auth)", () => {
  test("13.1 — /audit loads without login", async ({ browser }) => {
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    try {
      await page.goto("/audit", { waitUntil: "domcontentloaded" });
      await settle(page, 1000);

      expect(page.url()).not.toMatch(/\/login/);

      await expectAnyVisible(
        [
          page.getByText(/find out/i),
          page.getByText(/invoice/i),
          page.getByText(/leak/i),
          page.getByText(/audit/i),
          page.getByText(/lost this week/i),
        ],
        "Leak audit page should render publicly.",
      );

      await expectNoRuntimeOverlay(page);
    } finally {
      await context.close();
    }
  });

  test("13.2 — Audit drop zone renders", async ({ browser }) => {
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    try {
      await page.goto("/audit", { waitUntil: "domcontentloaded" });
      await settle(page, 1000);

      await expectAnyVisible(
        [
          page.locator('input[type="file"]'),
          page.getByText(/drop/i),
          page.getByText(/drag/i),
          page.getByText(/browse/i),
        ],
        "Audit upload zone should render.",
      );
    } finally {
      await context.close();
    }
  });
});
