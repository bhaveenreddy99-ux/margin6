import type { Dispatch, SetStateAction } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BookmarkPlus, CheckCheck, Flag, Loader2, ShieldAlert } from "lucide-react";
import { formatNum } from "@/lib/inventory-utils";
import {
  DEFAULT_PRICE_TOLERANCE,
  DEFAULT_QTY_TOLERANCE,
  DEFAULT_TOTAL_TOLERANCE,
  resolveLineTotal,
  threeWayQtyAllDivergent,
} from "@/lib/invoice-comparison";
import type { InvoiceReviewDerivedComparisonRow } from "@/domain/invoices/invoiceReviewSelectors";
import type {
  InvoiceReviewCatalogItem,
  InvoiceReviewComparison,
  InvoiceReviewIssue,
  InvoiceReviewPoItem,
} from "@/domain/invoices/invoiceReviewTypes";
import { ISSUE_TYPES } from "@/domain/invoices/invoiceStatusLifecycle";

function statusBadge(status: string) {
  switch (status) {
    case "ok": return <Badge className="bg-success/10 text-success border-0 text-[10px]">OK</Badge>;
    case "qty_mismatch": return <Badge className="bg-warning/10 text-warning border-0 text-[10px]">Qty Mismatch</Badge>;
    case "price_mismatch": return <Badge className="bg-orange-500/10 text-orange-600 border-0 text-[10px]">Price Mismatch</Badge>;
    case "total_mismatch": return <Badge className="bg-destructive/10 text-destructive border-0 text-[10px]">Total Mismatch</Badge>;
    case "missing_from_invoice": return <Badge className="bg-destructive/10 text-destructive border-0 text-[10px]">Missing</Badge>;
    case "extra_on_invoice": return <Badge className="bg-blue-500/10 text-blue-600 border-0 text-[10px]">Extra</Badge>;
    case "unmatched": return <Badge className="bg-muted/60 text-muted-foreground border-0 text-[10px]">Unmatched</Badge>;
    case "received_short": return <Badge className="bg-amber-500/15 text-amber-800 dark:text-amber-200 border-0 text-[10px]">Short delivery</Badge>;
    case "received_over": return <Badge className="bg-violet-500/15 text-violet-700 border-0 text-[10px]">Over-received</Badge>;
    default: return null;
  }
}

type Props = {
  comparisonRows: InvoiceReviewDerivedComparisonRow[];
  comparisons: InvoiceReviewComparison[];
  poItems: InvoiceReviewPoItem[];
  issues: InvoiceReviewIssue[];
  catalogItems: InvoiceReviewCatalogItem[];
  catalogById: Record<string, InvoiceReviewCatalogItem>;
  catalogOverrides: Record<string, string>;
  setCatalogOverrides: Dispatch<SetStateAction<Record<string, string>>>;
  savingMappings: Record<string, boolean>;
  handleSaveMapping: (comp: InvoiceReviewComparison) => void;
  persistReceivedQty: (comp: InvoiceReviewComparison, raw: string) => Promise<void>;
  setComparisons: Dispatch<SetStateAction<InvoiceReviewComparison[]>>;
  onReportIssue: (comp: InvoiceReviewComparison) => void;
  /** Phase 4: number of rows auto-filled but not yet manager-confirmed */
  receivedUnconfirmedCount: number;
  /** Phase 4: mark all real invoice lines as manager-confirmed */
  onConfirmAllReceived: () => Promise<void>;
};

export function ComparisonTable({
  comparisonRows,
  comparisons,
  poItems,
  issues,
  catalogItems,
  catalogById,
  catalogOverrides,
  setCatalogOverrides,
  savingMappings,
  handleSaveMapping,
  persistReceivedQty,
  setComparisons,
  onReportIssue,
  receivedUnconfirmedCount,
  onConfirmAllReceived,
}: Props) {
  return (
    <>
      <Card className="overflow-hidden">
        <CardHeader className="pb-3 pt-4 px-4">
          <CardTitle className="text-sm font-semibold">Line Item Comparison</CardTitle>
          <p className="text-[11px] text-muted-foreground">
            Three-way: ordered (PO) vs billed (invoice) vs received (actual delivery). Edit Received to record physical counts. Flags short/over delivery, PO vs invoice qty/price/total above {DEFAULT_QTY_TOLERANCE.percent}% / {DEFAULT_PRICE_TOLERANCE.percent}% / {DEFAULT_TOTAL_TOLERANCE.percent}% (totals after ${formatNum(DEFAULT_TOTAL_TOLERANCE.minAbsolute)}).
          </p>

          {/* Phase 4: Unconfirmed received qty warning */}
          {receivedUnconfirmedCount > 0 && (
            <div className="mt-3 rounded-lg border border-amber-300/60 bg-amber-50/80 dark:border-amber-700/50 dark:bg-amber-950/30 px-3 py-2.5 flex items-start gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                  Received quantities are auto-filled from invoice — confirm actual delivery before updating inventory.
                </p>
                <p className="text-[11px] text-amber-800/80 dark:text-amber-300/80 mt-0.5">
                  {receivedUnconfirmedCount} line{receivedUnconfirmedCount === 1 ? "" : "s"} still need confirmation.
                  Edit each Received field, or confirm all if the delivery matches the invoice.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 h-7 text-[11px] border-amber-400/60 text-amber-800 hover:bg-amber-100 dark:border-amber-600/60 dark:text-amber-200 dark:hover:bg-amber-900/40"
                onClick={() => void onConfirmAllReceived()}
              >
                <CheckCheck className="h-3 w-3 mr-1" />
                Confirm all as received
              </Button>
            </div>
          )}

          <p className="text-xs font-medium text-foreground mt-3 pt-3 border-t border-border/50">
            Review all lines before posting.
          </p>
        </CardHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="text-xs font-semibold">Item</TableHead>
                <TableHead className="text-xs font-semibold text-right">Ordered</TableHead>
                <TableHead className="text-xs font-semibold text-right">Billed</TableHead>
                <TableHead className="text-xs font-semibold text-right">Received</TableHead>
                <TableHead className="text-xs font-semibold text-right">PO Price</TableHead>
                <TableHead className="text-xs font-semibold text-right">Invoice Price</TableHead>
                <TableHead className="text-xs font-semibold text-right">PO Total</TableHead>
                <TableHead className="text-xs font-semibold text-right">Invoice Total</TableHead>
                <TableHead className="text-xs font-semibold text-center">Status</TableHead>
                <TableHead className="text-xs font-semibold w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {comparisons.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-muted-foreground text-sm py-8">
                    {poItems.length === 0
                      ? "No linked Smart Order — comparison not available"
                      : "No line items to compare"}
                  </TableCell>
                </TableRow>
              ) : (
                comparisonRows.map((comp) => {
                  const reported = issues.some((iss) => iss.invoice_line_comparison_id === comp.id);
                  const qtyDiff = comp.qtyAnalysis.difference;
                  const qtyPctDiff = comp.qtyAnalysis.percentDifference;
                  const costDiff = comp.priceAnalysis.difference;
                  const costPctDiff = comp.priceAnalysis.percentDifference;
                  const recvDiff = comp.receivedVsBilled?.difference;
                  const recvPct = comp.receivedVsBilled?.percentDifference;
                  const poTotal = resolveLineTotal(comp.po_total_cost, comp.po_qty, comp.po_unit_cost);
                  const invoicedTotal = resolveLineTotal(
                    comp.invoiced_total_cost,
                    comp.invoiced_qty,
                    comp.invoiced_unit_cost,
                  );
                  const totalDiff = comp.totalAnalysis.difference;
                  const totalPctDiff = comp.totalAnalysis.percentDifference;
                  const threeWay = threeWayQtyAllDivergent(comp);

                  return (
                    <TableRow
                      key={comp.id}
                      id={comp.id}
                      className={`${comp.derived_status !== "ok" ? "bg-warning/3" : ""} ${threeWay ? "ring-1 ring-destructive/40 bg-destructive/[0.06]" : ""}`}
                    >
                      <TableCell className="text-sm font-medium">
                        <div>
                          <span>{comp.item_name}</span>
                          {(comp.invoice_item_id != null || comp.purchase_history_item_id != null) && (() => {
                            const override = catalogOverrides[comp.id];
                            if (override !== undefined) {
                              return (
                                <div className="flex items-center gap-1 mt-1">
                                  <Select
                                    value={override}
                                    onValueChange={(val) =>
                                      setCatalogOverrides((prev) => ({ ...prev, [comp.id]: val }))
                                    }
                                  >
                                    <SelectTrigger className="h-6 text-[11px] w-44 border-dashed">
                                      <SelectValue placeholder="Match catalog…" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {catalogItems.map((c) => (
                                        <SelectItem key={c.id} value={c.id} className="text-xs">
                                          {c.item_name}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  {override && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 px-1.5 text-primary"
                                      disabled={savingMappings[comp.id]}
                                      onClick={() => handleSaveMapping(comp)}
                                    >
                                      {savingMappings[comp.id] ? (
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                      ) : (
                                        <BookmarkPlus className="h-3 w-3" />
                                      )}
                                    </Button>
                                  )}
                                </div>
                              );
                            }
                            if (comp.catalog_item_id) {
                              const catalogItem = catalogById[comp.catalog_item_id];
                              return (
                                <div className="flex items-center gap-1.5 mt-1">
                                  <Badge className="bg-primary/10 text-primary border-0 text-[10px] font-normal">
                                    {catalogItem?.item_name ?? comp.catalog_item_id}
                                  </Badge>
                                  <button
                                    className="text-[10px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                                    onClick={() =>
                                      setCatalogOverrides((prev) => ({
                                        ...prev,
                                        [comp.id]: comp.catalog_item_id!,
                                      }))
                                    }
                                  >
                                    change
                                  </button>
                                </div>
                              );
                            }
                            return (
                              <div className="mt-1">
                                <Select
                                  value=""
                                  onValueChange={(val) =>
                                    setCatalogOverrides((prev) => ({ ...prev, [comp.id]: val }))
                                  }
                                >
                                  <SelectTrigger className="h-6 text-[11px] w-44 border-dashed text-muted-foreground">
                                    <SelectValue placeholder="Match catalog…" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {catalogItems.map((c) => (
                                      <SelectItem key={c.id} value={c.id} className="text-xs">
                                        {c.item_name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            );
                          })()}
                          {comp.derived_status === "unmatched" && (
                            <p className="text-[10px] text-muted-foreground mt-1.5 leading-snug max-w-[15rem]">
                              Unmatched = no safe catalog match. Select item manually.
                            </p>
                          )}
                        </div>
                      </TableCell>

                      <TableCell className="text-sm text-right font-mono text-muted-foreground">
                        {comp.po_qty != null ? formatNum(comp.po_qty) : "—"}
                      </TableCell>

                      <TableCell
                        className={`text-sm text-right font-mono font-semibold ${comp.qtyAnalysis.exceedsTolerance ? "text-warning" : ""}`}
                      >
                        {comp.invoiced_qty != null ? formatNum(comp.invoiced_qty) : "—"}
                        {qtyDiff != null && comp.qtyAnalysis.exceedsTolerance && (
                          <span className="ml-1 text-[10px]">
                            ({qtyDiff > 0 ? "+" : ""}{formatNum(qtyDiff)}
                            {qtyPctDiff != null ? ` · ${qtyPctDiff.toFixed(1)}%` : ""})
                          </span>
                        )}
                      </TableCell>

                      <TableCell className="text-sm text-right align-top">
                        <div className="flex flex-col items-end gap-0.5">
                        <Input
                          type="number"
                          step="any"
                          min={0}
                          className={`h-8 w-[5.5rem] text-right font-mono text-xs px-2 ${
                            comp.receivedVsBilled?.exceedsTolerance
                              ? "border-amber-500/60"
                              : !comp.received_qty_confirmed && (comp.invoiced_qty ?? 0) > 0 && comp.status !== "missing_from_invoice"
                              ? "border-amber-300/60 bg-amber-50/40 dark:bg-amber-950/20"
                              : ""
                          }`}
                          value={comp.received_qty ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            const n = v === "" ? null : Number(v);
                            setComparisons((prev) =>
                              prev.map((c) =>
                                c.id === comp.id
                                  ? { ...c, received_qty: n != null && Number.isFinite(n) ? n : null }
                                  : c,
                              ),
                            );
                          }}
                          onBlur={(e) => void persistReceivedQty(comp, e.target.value)}
                        />
                        {!comp.received_qty_confirmed && (comp.invoiced_qty ?? 0) > 0 && comp.status !== "missing_from_invoice" && (
                          <span className="text-[9px] text-amber-700 dark:text-amber-400 font-medium">unconfirmed</span>
                        )}
                        {comp.received_qty_confirmed && (comp.invoiced_qty ?? 0) > 0 && comp.status !== "missing_from_invoice" && (
                          <span className="text-[9px] text-success font-medium">confirmed ✓</span>
                        )}
                        {recvDiff != null && comp.receivedVsBilled?.exceedsTolerance && (
                          <div className="text-[10px] text-muted-foreground">
                            ({recvDiff > 0 ? "+" : ""}{formatNum(recvDiff)}
                            {recvPct != null ? ` · ${recvPct.toFixed(1)}%` : ""})
                          </div>
                        )}
                        {comp.receivedDollar != null &&
                          comp.receivedVsBilled?.exceedsTolerance &&
                          Math.abs(comp.receivedDollar) > 0.005 && (
                            <div className="text-[10px] font-mono text-amber-700 dark:text-amber-300">
                              {comp.receivedDollar > 0 ? "Short " : "Over "}$
                              {formatNum(Math.abs(comp.receivedDollar))} at invoice price
                            </div>
                          )}
                        </div>
                      </TableCell>

                      <TableCell className="text-sm text-right font-mono text-muted-foreground">
                        {comp.po_unit_cost != null ? `$${formatNum(comp.po_unit_cost)}` : "—"}
                      </TableCell>

                      <TableCell
                        className={`text-sm text-right font-mono font-semibold ${comp.priceAnalysis.exceedsTolerance ? "text-orange-600" : ""}`}
                      >
                        {comp.invoiced_unit_cost != null ? `$${formatNum(comp.invoiced_unit_cost)}` : "—"}
                        {costDiff != null && comp.priceAnalysis.exceedsTolerance && (
                          <span className="ml-1 text-[10px]">
                            ({costDiff > 0 ? "+" : "-"}${formatNum(Math.abs(costDiff))}
                            {costPctDiff != null ? ` · ${costPctDiff.toFixed(1)}%` : ""})
                          </span>
                        )}
                      </TableCell>

                      <TableCell className="text-sm text-right font-mono text-muted-foreground">
                        {poTotal != null ? `$${formatNum(poTotal)}` : "—"}
                      </TableCell>

                      <TableCell
                        className={`text-sm text-right font-mono font-semibold ${comp.totalAnalysis.exceedsTolerance ? "text-destructive" : ""}`}
                      >
                        {invoicedTotal != null ? `$${formatNum(invoicedTotal)}` : "—"}
                        {totalDiff != null && comp.totalAnalysis.exceedsTolerance && (
                          <span className="ml-1 text-[10px]">
                            ({totalDiff > 0 ? "+" : "-"}${formatNum(Math.abs(totalDiff))}
                            {totalPctDiff != null ? ` · ${totalPctDiff.toFixed(1)}%` : ""})
                          </span>
                        )}
                      </TableCell>

                      <TableCell className="text-center">{statusBadge(comp.derived_status)}</TableCell>

                      <TableCell className="text-right">
                        {comp.derived_status !== "ok" && !reported ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-[11px] text-orange-600 hover:text-orange-700"
                            onClick={() => onReportIssue(comp)}
                          >
                            <Flag className="h-3 w-3 mr-1" /> Report
                          </Button>
                        ) : reported ? (
                          <Badge className="bg-orange-500/10 text-orange-600 border-0 text-[10px]">
                            Reported
                          </Badge>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {issues.length > 0 && (
        <Card className="overflow-hidden border-orange-500/20">
          <CardHeader className="pb-3 pt-4 px-4">
            <CardTitle className="text-sm font-semibold text-orange-600">Reported Issues</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="text-xs font-semibold">Item</TableHead>
                  <TableHead className="text-xs font-semibold">Issue Type</TableHead>
                  <TableHead className="text-xs font-semibold">Notes</TableHead>
                  <TableHead className="text-xs font-semibold">Reported</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {issues.map((iss) => (
                  <TableRow key={iss.id}>
                    <TableCell className="text-sm font-medium">{iss.item_name}</TableCell>
                    <TableCell className="text-sm">
                      {ISSUE_TYPES.find((t) => t.value === iss.issue_type)?.label ?? iss.issue_type}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{iss.notes || "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(iss.reported_at).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </>
  );
}
