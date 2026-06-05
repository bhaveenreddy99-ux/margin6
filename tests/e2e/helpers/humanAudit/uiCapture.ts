import type { Page } from "@playwright/test";
import { parseIntegerText, parseMoneyText } from "./parseNumbers";

export async function waitForPageSettle(page: Page, ms = 1200): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(ms);
}

/** Read a Dashboard-style KPI card value by its label text. */
export async function readKpiCardValue(page: Page, label: string): Promise<string> {
  const card = page.locator("div.rounded-lg.border").filter({ hasText: label }).first();
  await card.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
  const value = card.locator("p.font-bold.tabular-nums, p.text-2xl, p.text-3xl").first();
  return ((await value.textContent()) ?? "").trim();
}

export async function readMoneyLostHero(page: Page): Promise<string> {
  const hero = page
    .locator("div")
    .filter({ has: page.getByText(/money lost this period/i) })
    .locator("p")
    .filter({ hasText: /^\$/ })
    .first();
  if (await hero.isVisible().catch(() => false)) {
    return ((await hero.textContent()) ?? "").trim();
  }
  return "";
}

export async function readSummaryStat(page: Page, label: string): Promise<string> {
  const card = page.locator("div.rounded-lg.border").filter({ hasText: label }).first();
  const value = card.locator("p.text-2xl.font-bold, p.font-bold.tabular-nums").first();
  return ((await value.textContent()) ?? "").trim();
}

export async function readTextAfterHeading(page: Page, heading: RegExp): Promise<string | null> {
  const h = page.getByRole("heading", { name: heading }).first();
  if (!(await h.isVisible().catch(() => false))) return null;
  const section = h.locator("xpath=ancestor::section[1]");
  const value = section.locator("p.text-4xl, p.text-5xl, span.font-bold").first();
  return ((await value.textContent()) ?? "").trim() || null;
}

export async function readInlineCount(page: Page, pattern: RegExp): Promise<string | null> {
  const el = page.getByText(pattern).first();
  if (!(await el.isVisible().catch(() => false))) return null;
  return ((await el.textContent()) ?? "").trim();
}

export function uiMoney(raw: string): number | null {
  return parseMoneyText(raw);
}

export function uiInteger(raw: string): number | null {
  return parseIntegerText(raw);
}
