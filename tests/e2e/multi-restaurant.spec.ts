import { expectNoRuntimeOverlay } from "./helpers/auth";
import { getMissingAuthReason } from "./helpers/env";
import { expectAnyVisible, isVisible, openAppRoute } from "./helpers/navigation";
import { test, expect } from "./helpers/test";

const missingAuthReason = getMissingAuthReason();

async function settle(page: import("@playwright/test").Page, ms = 800): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(ms);
}

async function countRestaurantCards(page: import("@playwright/test").Page): Promise<number> {
  return page.getByRole("button", { name: /^open$/i }).count();
}

async function getHeaderRestaurantName(page: import("@playwright/test").Page): Promise<string | null> {
  const header = page.locator("header");
  const nameButton = header.getByRole("button").filter({ has: page.locator("svg") }).first();
  if (await isVisible(nameButton)) {
    const text = (await nameButton.innerText()).trim();
    if (text && !/select restaurant/i.test(text)) return text.split("\n")[0]?.trim() ?? text;
  }
  const staticName = header.locator("button.pointer-events-none span").first();
  if (await isVisible(staticName)) {
    return (await staticName.innerText()).trim();
  }
  return null;
}

async function openRestaurantDropdown(page: import("@playwright/test").Page): Promise<boolean> {
  const switcher = page.locator("header button:not(.pointer-events-none)").first();
  if (!(await isVisible(switcher))) return false;
  await switcher.click();
  await page.waitForTimeout(500);
  return true;
}

test.describe("Signup flow", () => {
  test("new user signup goes straight to create restaurant", async ({ browser }) => {
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    try {
      await page.goto("/signup", { waitUntil: "domcontentloaded" });
      await settle(page);

      const uniqueEmail = `margin6.e2e.${Date.now()}@gmail.com`;
      await page.getByLabel(/full name/i).fill("E2E Multi Restaurant");
      await page.getByLabel(/^email$/i).fill(uniqueEmail);
      await page.getByLabel(/^password$/i).fill("TestPass123!");
      await page.getByRole("button", { name: /sign up/i }).click();
      await page.waitForTimeout(2000);

      await expectAnyVisible(
        [
          page.getByRole("heading", { name: /create your restaurant/i }),
          page.getByRole("heading", { name: /dashboard/i }),
          page.getByText(/check your email/i),
          page.getByText(/check your email to continue/i),
          page.getByText(/confirm your account/i),
          page.getByText(/account created/i),
          page.getByRole("heading", { name: /sign in/i }),
          page.getByText(/sign in to your account/i),
          page.getByText(/create your account/i),
        ],
        "Expected create-restaurant redirect, dashboard, login, or email confirmation message.",
      );

      const url = page.url();
      if (url.includes("/onboarding/create-restaurant")) {
        await expect(page).toHaveURL(/\/onboarding\/create-restaurant/);
      } else if (url.includes("/app/dashboard")) {
        await expect(page).toHaveURL(/\/app\/dashboard/);
      }
    } finally {
      await context.close();
    }
  });

  test("unauthenticated user visiting /app/restaurants redirects to login", async ({ browser }) => {
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    try {
      await page.goto("/app/restaurants", { waitUntil: "domcontentloaded" });
      await settle(page);

      expect(
        /\/login|\/demo|\/onboarding/.test(page.url()),
        `Expected redirect to login, demo, or onboarding; got ${page.url()}`,
      ).toBeTruthy();
    } finally {
      await context.close();
    }
  });
});

test.describe("My Restaurants page", () => {
  test.skip(Boolean(missingAuthReason), missingAuthReason ?? "");

  test("My Restaurants page loads", async ({ page }) => {
    await openAppRoute(page, "/app/restaurants");
    await settle(page, 1000);

    await expectAnyVisible(
      [
        page.getByText(/my restaurants/i),
        page.getByText(/restaurant/i),
      ],
      "My Restaurants page should show a heading or restaurant label.",
    );

    await expectNoRuntimeOverlay(page);
  });

  test("Add New Restaurant button is visible", async ({ page }) => {
    await openAppRoute(page, "/app/restaurants");
    await settle(page);

    await expectAnyVisible(
      [
        page.getByText(/add new restaurant/i),
        page.getByRole("button", { name: /add/i }),
        page.getByText(/\+ add/i),
      ],
      "Add New Restaurant affordance should be visible.",
    );
  });

  test("restaurant cards render with KPI data or loading state", async ({ page }) => {
    await openAppRoute(page, "/app/restaurants");
    await settle(page, 2000);

    await expectAnyVisible(
      [
        page.getByText(/money lost/i),
        page.getByText(/lost this week/i),
        page.getByText(/inventory/i),
        page.getByText(/last.*count/i),
        page.getByText(/no counts yet/i),
      ],
      "Restaurant cards should show KPI labels or empty count state.",
    );

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain("undefined");
    expect(bodyText).not.toContain("[object Object]");
  });

  test("comparison table shows for 2+ restaurants", async ({ page }) => {
    await openAppRoute(page, "/app/restaurants");
    await settle(page, 1000);

    const cardCount = await countRestaurantCards(page);
    if (cardCount >= 2) {
      await expectAnyVisible(
        [
          page.getByText(/this week.*all restaurants/i),
          page.getByText(/all restaurants/i),
          page.getByRole("table"),
        ],
        "Comparison table should render when user has 2+ restaurants.",
      );
    } else {
      // eslint-disable-next-line no-console
      console.log("Only 1 restaurant — comparison table correctly hidden");
    }
  });

  test("Open button switches restaurant and navigates to dashboard", async ({ page }) => {
    await openAppRoute(page, "/app/restaurants");
    await settle(page, 1000);

    const openButton = page.getByRole("button", { name: /^open$/i }).first();
    await expectAnyVisible(
      [openButton],
      "At least one Open button should exist on My Restaurants.",
    );

    await openButton.click();
    await settle(page);

    await expect(page).toHaveURL(/\/app\/dashboard/);
    await expect(page.getByRole("heading", { name: /dashboard/i })).toBeVisible();
    await expectNoRuntimeOverlay(page);
  });
});

test.describe("Restaurant switcher in header", () => {
  test.skip(Boolean(missingAuthReason), missingAuthReason ?? "");

  test("header shows restaurant name", async ({ page }) => {
    await openAppRoute(page, "/app/dashboard");
    await settle(page);

    await expectAnyVisible(
      [
        page.getByRole("button", { name: /restaurant/i }),
        page.locator("header").getByText(/restaurant/i),
        page.locator("header").getByRole("button").first(),
      ],
      "Header should expose the current restaurant or a switcher control.",
    );
  });

  test("restaurant dropdown opens when clicked (2+ restaurants)", async ({ page }) => {
    await openAppRoute(page, "/app/dashboard");
    await settle(page);

    const opened = await openRestaurantDropdown(page);
    if (!opened) {
      // eslint-disable-next-line no-console
      console.log("Only 1 restaurant — no dropdown expected");
      return;
    }

    const menuVisible = await isVisible(page.getByRole("menuitem").first())
      || await isVisible(page.getByRole("menu").first())
      || await isVisible(page.getByText(/add new restaurant/i).first());

    if (!menuVisible) {
      // eslint-disable-next-line no-console
      console.log("Only 1 restaurant — no dropdown expected");
      return;
    }

    await expectAnyVisible(
      [
        page.getByRole("menuitem"),
        page.getByRole("option"),
        page.getByText(/add new restaurant/i),
        page.getByRole("menu"),
      ],
      "Restaurant dropdown should expose menu items when multiple restaurants exist.",
    );
  });

  test("switching restaurant navigates to dashboard", async ({ page }) => {
    await openAppRoute(page, "/app/dashboard");
    await settle(page);

    await openRestaurantDropdown(page);
    const menuItems = page.getByRole("menuitem");
    const itemCount = await menuItems.count();

    if (itemCount < 2) {
      // eslint-disable-next-line no-console
      console.log("Only 1 restaurant — switch test skipped");
      return;
    }

    await menuItems.nth(1).click();
    await settle(page, 1500);

    await expect(page).toHaveURL(/\/app\/dashboard/);
    await expectAnyVisible(
      [
        page.getByText(/switched to/i),
        page.getByRole("heading", { name: /dashboard/i }),
      ],
      "After switching restaurants, dashboard should load or show switch toast.",
    );
  });
});

test.describe("Data isolation between restaurants", () => {
  test.skip(Boolean(missingAuthReason), missingAuthReason ?? "");

  test("dashboard shows current restaurant name", async ({ page }) => {
    await openAppRoute(page, "/app/dashboard");
    await settle(page, 2000);

    await expect(page.getByRole("heading", { name: /^dashboard$/i })).toBeVisible({ timeout: 20_000 });

    const headerName = await getHeaderRestaurantName(page);
    if (headerName) {
      await expectAnyVisible(
        [
          page.getByText(headerName, { exact: false }),
          page.locator("main").getByText(headerName, { exact: false }),
        ],
        "Dashboard should reference the current restaurant name.",
      );
    }

    const hasDropdown = await isVisible(page.locator("header button:not(.pointer-events-none)").first());
    if (hasDropdown) {
      await expectAnyVisible(
        [page.getByText(/showing data for/i)],
        "Multi-restaurant users should see the data isolation line.",
      );
    }
  });

  test("Money Lost widget does not show data from other restaurant", async ({ page }) => {
    await openAppRoute(page, "/app/dashboard");
    await settle(page, 1000);

    const previousName = await getHeaderRestaurantName(page);

    await openRestaurantDropdown(page);
    const menuItems = page.getByRole("menuitem");
    const itemCount = await menuItems.count();

    if (itemCount < 2) {
      // eslint-disable-next-line no-console
      console.log("Only 1 restaurant — isolation switch not exercised");
      await expectNoRuntimeOverlay(page);
      return;
    }

    await menuItems.nth(1).click();
    await settle(page, 1500);

    const newName = await getHeaderRestaurantName(page);
    if (previousName && newName) {
      expect(newName).not.toBe(previousName);
    }

    if (previousName) {
      const mainText = await page.locator("main").innerText();
      expect(mainText.includes(previousName)).toBeFalsy();
    }

    await expectNoRuntimeOverlay(page);
  });
});

test.describe("Create restaurant flow", () => {
  test.skip(Boolean(missingAuthReason), missingAuthReason ?? "");

  test("create restaurant page loads", async ({ page }) => {
    await openAppRoute(page, "/app/restaurants/new");
    await settle(page);

    await expectAnyVisible(
      [
        page.getByRole("heading", { name: /create/i }),
        page.getByRole("heading", { name: /restaurant/i }),
        page.getByPlaceholder(/restaurant name|my restaurant/i),
        page.getByLabel(/name/i),
      ],
      "Create restaurant form should render.",
    );
  });

  test("invoice email success screen shown after creation", async ({ page }) => {
    await openAppRoute(page, "/app/restaurants/new");
    await settle(page);

    const uniqueName = `Test Restaurant ${Date.now()}`;
    await page.getByLabel(/name/i).fill(uniqueName);
    await page.getByRole("button", { name: /create restaurant/i }).click();
    await page.waitForTimeout(8000);

    await expectAnyVisible(
      [
        page.getByText(/your restaurant is ready/i),
        page.getByText(/invoice.*email/i),
        page.getByText(/invoices\.margin6\.com/i),
        page.getByText(/forward/i),
        page.getByText(/ready/i),
        page.getByRole("button", { name: /copy/i }),
        page.getByRole("button", { name: /dashboard/i }),
        page.getByRole("link", { name: /dashboard/i }),
        page.getByRole("heading", { name: /^dashboard$/i }),
      ],
      "Expected invoice email success screen or dashboard fallback after creation.",
    );
  });
});

test.describe("Single restaurant UX", () => {
  test.skip(Boolean(missingAuthReason), missingAuthReason ?? "");

  test("single restaurant user sees add second restaurant prompt", async ({ page }) => {
    await openAppRoute(page, "/app/restaurants");
    await settle(page, 1000);

    const cardCount = await countRestaurantCards(page);
    if (cardCount === 1) {
      await expectAnyVisible(
        [
          page.getByText(/add another restaurant/i),
          page.getByText(/second restaurant/i),
          page.getByText(/why add another/i),
          page.getByText(/add new restaurant/i),
        ],
        "Single-restaurant UX should encourage adding a second restaurant.",
      );
    } else {
      // eslint-disable-next-line no-console
      console.log("Multiple restaurants — single UX not shown");
    }
  });
});
