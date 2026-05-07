import { useMemo } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CheckCircle, TrendingUp } from "lucide-react";
import { formatNum } from "@/lib/inventory-utils";
import { STOCK_TRUTH_MESSAGE } from "@/lib/stockTruthCopy";
import { groupConfirmResultItems } from "@/domain/invoices/invoiceReviewSelectors";
import type { ConfirmInvoiceReceiptResult } from "@/domain/invoices/invoiceReviewTypes";

type Props = {
  // Pre-confirm alert
  alertOpen: boolean;
  onAlertOpenChange: (open: boolean) => void;
  lineItemCount: number;
  issueCount: number;
  onConfirm: () => void;
  // Post-confirm result
  confirmResult: ConfirmInvoiceReceiptResult | null;
  onResultClose: () => void;
  onNavigateInventory: () => void;
  onDone: () => void;
};

export function ConfirmReceiptDialog({
  alertOpen,
  onAlertOpenChange,
  lineItemCount,
  issueCount,
  onConfirm,
  confirmResult,
  onResultClose,
  onNavigateInventory,
  onDone,
}: Props) {
  const { postedStockItems, conversionFailedItems } = useMemo(
    () => groupConfirmResultItems(confirmResult),
    [confirmResult],
  );

  return (
    <>
      <AlertDialog open={alertOpen} onOpenChange={onAlertOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Post invoice to inventory?</AlertDialogTitle>
            <AlertDialogDescription>
              This will update stock levels for {lineItemCount} line item{lineItemCount !== 1 ? "s" : ""} and mark the invoice as confirmed.
              {issueCount > 0 &&
                ` There ${issueCount === 1 ? "is" : "are"} ${issueCount} open discrepanc${issueCount === 1 ? "y" : "ies"} — consider reporting issues before posting.`}
              {" "}This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirm}>Post Invoice</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!confirmResult} onOpenChange={onResultClose}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-success">
              <CheckCircle className="h-5 w-5" />
              Invoice posted
            </DialogTitle>
          </DialogHeader>

          {confirmResult && (
            <div className="space-y-4">
              {confirmResult.already_confirmed ? (
                <div className="rounded-lg border bg-muted/20 px-3 py-2">
                  <p className="text-sm text-muted-foreground">
                    This invoice was already posted. No additional stock movements were applied.
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border bg-muted/20 px-3 py-3 space-y-1.5">
                  <p className="text-sm text-muted-foreground">
                    {confirmResult.message ??
                      (typeof confirmResult.stock_movements_created === "number"
                        ? `Recorded ${confirmResult.stock_movements_created} stock movement${confirmResult.stock_movements_created === 1 ? "" : "s"} (normalized to cases where applicable).`
                        : "Receipt confirmed.")}
                  </p>
                  {typeof confirmResult.stock_movements_created === "number" &&
                    confirmResult.stock_movements_created > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Inventory ledger movements were written for matched catalog lines with convertible units.
                      </p>
                    )}
                  {(confirmResult.unit_conversion_failed ?? 0) > 0 && (
                    <p className="text-xs text-warning">
                      {confirmResult.unit_conversion_failed} line
                      {(confirmResult.unit_conversion_failed ?? 0) === 1 ? "" : "s"} skipped — unit could not be
                      converted to cases safely (see below).
                    </p>
                  )}
                </div>
              )}

              {postedStockItems.length > 0 && (
                <div className="rounded-lg border overflow-hidden">
                  <div className="bg-success/5 px-3 py-2 border-b">
                    <p className="text-xs font-semibold text-success">Stock movements recorded</p>
                  </div>
                  <div className="divide-y">
                    {postedStockItems.map((item, idx) => (
                      <div key={idx} className="flex items-center justify-between px-3 py-2 gap-2">
                        <span className="text-sm font-medium">{item.item_name}</span>
                        <div className="text-xs text-muted-foreground font-mono text-right shrink-0">
                          <span className="text-success font-semibold">
                            +{formatNum(item.quantity_confirmed)}{" "}
                            {item.quantity_unit ?? "case"}
                            {(item.quantity_confirmed ?? 0) === 1 ? "" : "s"}
                          </span>
                          {item.source_qty != null && (
                            <div className="text-[11px] text-muted-foreground">
                              from {formatNum(item.source_qty)} {item.source_unit ?? ""}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {conversionFailedItems.length > 0 && (
                <div className="rounded-lg border border-warning/20 overflow-hidden">
                  <div className="bg-warning/5 px-3 py-2 border-b border-warning/20">
                    <p className="text-xs font-semibold text-warning">Unit conversion failed</p>
                  </div>
                  <div className="divide-y divide-warning/10">
                    {conversionFailedItems.map((item, idx) => (
                      <div key={idx} className="flex flex-col gap-0.5 px-3 py-2">
                        <span className="text-sm text-muted-foreground">{item.item_name}</span>
                        <span className="text-xs text-warning">
                          {item.reason ?? "Could not convert to cases."}
                          {item.source_qty != null && (
                            <span className="font-mono">
                              {" "}
                              ({formatNum(item.source_qty)} {item.source_unit ?? ""})
                            </span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="px-3 py-2 bg-warning/5 border-t border-warning/20">
                    <p className="text-[11px] text-muted-foreground">
                      These lines were not posted as stock movements. Fix pack size / units or adjust received qty,
                      then re-open receipt confirmation if needed.
                    </p>
                  </div>
                </div>
              )}

              {confirmResult.no_catalog > 0 && (
                <div className="rounded-lg border border-muted overflow-hidden">
                  <div className="bg-muted/30 px-3 py-2 border-b">
                    <p className="text-xs font-semibold text-muted-foreground">
                      {confirmResult.no_catalog} item{confirmResult.no_catalog !== 1 ? "s" : ""} not matched to catalog
                    </p>
                  </div>
                  <div className="divide-y">
                    {(confirmResult.items ?? [])
                      .filter((i) => i.status === "no_catalog_match")
                      .map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between px-3 py-2">
                          <span className="text-sm text-muted-foreground">{item.item_name}</span>
                          <span className="text-xs text-muted-foreground">no SKU match</span>
                        </div>
                      ))}
                  </div>
                  <div className="px-3 py-2 bg-muted/10 border-t">
                    <p className="text-[11px] text-muted-foreground">
                      These items were <strong>not</strong> added to stock. Go to List Management to match them.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          <p className="text-[11px] text-muted-foreground pt-3 border-t border-border/60 leading-relaxed">
            {STOCK_TRUTH_MESSAGE}
          </p>
          <DialogFooter className="gap-2 mt-2">
            <Button variant="outline" className="gap-1.5" onClick={onNavigateInventory}>
              <TrendingUp className="h-4 w-4" /> View Inventory
            </Button>
            <Button onClick={onDone}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
