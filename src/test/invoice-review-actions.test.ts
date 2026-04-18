import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useInvoiceReviewActions } from "@/hooks/useInvoiceReviewActions";
import type {
  ConfirmInvoiceReceiptResult,
  InvoiceReviewComparison,
  InvoiceReviewDocument,
} from "@/domain/invoices/invoiceReviewTypes";

const {
  fromEqMock,
  fromUpdateMock,
  fromMock,
  rpcMock,
  toastErrorMock,
  toastSuccessMock,
} = vi.hoisted(() => {
  const fromEqMock = vi.fn();
  const fromUpdateMock = vi.fn(() => ({ eq: fromEqMock }));
  const fromMock = vi.fn(() => ({ update: fromUpdateMock }));
  const rpcMock = vi.fn();
  const toastErrorMock = vi.fn();
  const toastSuccessMock = vi.fn();

  return {
    fromEqMock,
    fromUpdateMock,
    fromMock,
    rpcMock,
    toastErrorMock,
    toastSuccessMock,
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: fromMock,
    rpc: rpcMock,
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
  },
}));

function buildComparison(overrides: Partial<InvoiceReviewComparison> = {}): InvoiceReviewComparison {
  return {
    id: "comparison-1",
    item_name: "Tomatoes",
    invoiced_qty: 10,
    received_qty: 10,
    ...overrides,
  } as InvoiceReviewComparison;
}

function buildInvoice(overrides: Partial<InvoiceReviewDocument> = {}): InvoiceReviewDocument {
  return {
    id: "invoice-1",
    vendor_name: "Sysco",
    ...overrides,
  };
}

function buildHookProps(comparisons: InvoiceReviewComparison[]) {
  return {
    id: "invoice-1",
    currentRestaurantId: "restaurant-1",
    reviewDocKind: "invoice" as const,
    invoice: buildInvoice(),
    comparisons,
    lineItemById: {},
    catalogOverrides: {},
    reportItem: null,
    reportIssueType: "short_shipped",
    reportNotes: "",
    setInvoice: vi.fn(),
    setInvoiceItems: vi.fn(),
    setComparisons: vi.fn(),
    setIssues: vi.fn(),
    setVendorMappings: vi.fn(),
    setCatalogOverrides: vi.fn(),
    setReportSheetOpen: vi.fn(),
  };
}

function extractComparisonUpdater(
  setComparisons: ReturnType<typeof vi.fn>,
): (prev: InvoiceReviewComparison[]) => InvoiceReviewComparison[] {
  const updater = setComparisons.mock.calls.at(-1)?.[0];
  expect(typeof updater).toBe("function");
  return updater as (prev: InvoiceReviewComparison[]) => InvoiceReviewComparison[];
}

describe("useInvoiceReviewActions", () => {
  beforeEach(() => {
    fromEqMock.mockReset();
    fromEqMock.mockResolvedValue({ error: null });
    fromUpdateMock.mockClear();
    fromMock.mockClear();
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: null, error: null });
    toastErrorMock.mockReset();
    toastSuccessMock.mockReset();
  });

  it("persists null for blank received quantity", async () => {
    const comparison = buildComparison();
    const props = buildHookProps([comparison]);
    const { result } = renderHook(() => useInvoiceReviewActions(props));

    await act(async () => {
      await result.current.persistReceivedQty(comparison, "");
    });

    expect(fromMock).toHaveBeenCalledWith("invoice_line_comparisons");
    expect(fromUpdateMock).toHaveBeenCalledWith({ received_qty: null });
    expect(fromEqMock).toHaveBeenCalledWith("id", comparison.id);

    const updater = extractComparisonUpdater(props.setComparisons);
    const updated = updater([comparison]);
    expect(updated[0].received_qty).toBeNull();
    await waitFor(() => expect(result.current.receivedMissingCount).toBe(1));
  });

  it("persists null for non-numeric input and shows a toast", async () => {
    const comparison = buildComparison();
    const props = buildHookProps([comparison]);
    const { result } = renderHook(() => useInvoiceReviewActions(props));

    await act(async () => {
      await result.current.persistReceivedQty(comparison, "abc");
    });

    expect(fromUpdateMock).toHaveBeenCalledWith({ received_qty: null });
    expect(toastErrorMock).toHaveBeenCalledWith("Received quantity must be a number — left blank");
    await waitFor(() => expect(result.current.receivedMissingCount).toBe(1));
  });

  it("persists an exact numeric received quantity", async () => {
    const comparison = buildComparison({ received_qty: null });
    const props = buildHookProps([comparison]);
    const { result } = renderHook(() => useInvoiceReviewActions(props));

    await act(async () => {
      await result.current.persistReceivedQty(comparison, "4.5");
    });

    expect(fromUpdateMock).toHaveBeenCalledWith({ received_qty: 4.5 });
    const updater = extractComparisonUpdater(props.setComparisons);
    const updated = updater([comparison]);
    expect(updated[0].received_qty).toBe(4.5);
    expect(toastErrorMock).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.receivedMissingCount).toBe(0));
  });

  it("blocks confirm when any received quantity is missing", async () => {
    const comparison = buildComparison({ received_qty: null });
    const props = buildHookProps([comparison]);
    const { result } = renderHook(() => useInvoiceReviewActions(props));

    await act(async () => {
      await result.current.handleConfirmReceipt();
    });

    expect(rpcMock).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.receivedMissingCount).toBe(1));
  });

  it("calls confirm RPC when all received quantities are filled", async () => {
    const comparison = buildComparison({ received_qty: 9 });
    const props = buildHookProps([comparison]);
    const confirmResult: ConfirmInvoiceReceiptResult = {
      already_confirmed: false,
      no_catalog: 0,
      items: [],
    };
    rpcMock
      .mockResolvedValueOnce({ data: confirmResult, error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    const { result } = renderHook(() => useInvoiceReviewActions(props));

    await act(async () => {
      await result.current.handleConfirmReceipt();
    });

    expect(rpcMock).toHaveBeenCalledWith("confirm_invoice_receipt", {
      p_invoice_id: "invoice-1",
      p_restaurant_id: "restaurant-1",
    });
    await waitFor(() => expect(result.current.confirmResult).toEqual(confirmResult));
  });
});
