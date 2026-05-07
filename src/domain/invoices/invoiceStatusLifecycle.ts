import { FIXED_STATUSES } from "@/lib/invoice-comparison";

export { FIXED_STATUSES };
export type { InvoiceComparisonStatus } from "@/lib/invoice-comparison";

/** Returns false for statuses that must never be overridden by a client-derived value. */
export function shouldPersistDerivedStatus(
  currentDbStatus: string | null | undefined,
): boolean {
  return currentDbStatus == null || !FIXED_STATUSES.has(currentDbStatus as never);
}

export const ISSUE_TYPES = [
  { value: "short_shipped", label: "Short Shipped" },
  { value: "damaged", label: "Damaged" },
  { value: "wrong_item", label: "Wrong Item" },
  { value: "price_discrepancy", label: "Price Discrepancy" },
  { value: "other", label: "Other" },
] as const;

export type IssueTypeValue = (typeof ISSUE_TYPES)[number]["value"];

/** Valid receipt-level statuses in lifecycle order. */
export type ReceiptStatus = "pending" | "reviewing" | "confirmed" | "issues_reported";
