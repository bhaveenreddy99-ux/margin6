import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Link } from "react-router-dom";
import { CheckCircle, Eye, Copy, ShoppingCart, XCircle, Trash2, MoreHorizontal } from "lucide-react";
import type { InventorySessionListRow, SessionStats } from "@/domain/inventory/enterInventoryTypes";
import { formatSessionRowDate } from "@/domain/inventory/enterInventoryHelpers";
import { formatCurrency } from "@/lib/inventory-utils";

type Props = {
  approvedSessions: InventorySessionListRow[];
  sessionStats: SessionStats;
  approvedFilter: string;
  onApprovedFilterChange: (value: string) => void;
  isManagerOrOwner: boolean;
  onView: (session: InventorySessionListRow) => void;
  onDuplicate: (session: InventorySessionListRow) => void;
  onOpenSmartOrderModal: (session: InventorySessionListRow) => void;
  onDeclineToReview: (sessionId: string) => void;
  onRequestDeleteSession: (sessionId: string) => void;
};

export function InventoryCountHubApprovedSection({
  approvedSessions,
  sessionStats,
  approvedFilter,
  onApprovedFilterChange,
  isManagerOrOwner,
  onView,
  onDuplicate,
  onOpenSmartOrderModal,
  onDeclineToReview,
  onRequestDeleteSession,
}: Props) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-tight">Approved</h2>
        <Select value={approvedFilter} onValueChange={onApprovedFilterChange}>
          <SelectTrigger className="h-8 w-[8.5rem] text-xs">
            <SelectValue placeholder="Range" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="60">Last 60 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Card className="border shadow-sm overflow-hidden">
        {approvedSessions.length === 0 ? (
          <CardContent className="py-10 text-center px-4">
            <CheckCircle className="h-9 w-9 text-muted-foreground/25 mb-2 mx-auto" />
            <p className="text-sm text-muted-foreground">No approved sessions in this range</p>
          </CardContent>
        ) : (
          <div className="divide-y divide-border/60">
            {approvedSessions.map((s) => {
              const stats = sessionStats[s.id];
              const totalItems = stats?.totalItems ?? stats?.total ?? 0;
              const value = stats?.totalValue ?? 0;
              const itemsWithCost = stats?.itemsWithCost ?? 0;
              const itemsWithoutCost = stats?.itemsWithoutCost ?? 0;
              const noCostData = totalItems > 0 && itemsWithCost === 0;
              const allHaveCost = totalItems > 0 && itemsWithoutCost === 0;
              const someMissingCost = itemsWithoutCost > 0 && itemsWithCost > 0;
              return (
                <div
                  key={s.id}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 hover:bg-muted/20 transition-colors"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-sm truncate">{s.name || "Count session"}</p>
                      <Badge className="bg-success/15 text-success border-0 text-[10px] shrink-0">Approved</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      List: {s.inventory_lists?.name || "—"}
                    </p>
                    <div className="text-[11px] text-muted-foreground space-y-1">
                      <p>
                        {s.locations?.name ? <span>{s.locations.name} · </span> : null}
                        Approved {formatSessionRowDate(s.approved_at || s.updated_at)}
                      </p>
                      {noCostData ? (
                        <>
                          <p className="text-xs text-amber-600 font-medium">No cost data</p>
                          <p className="text-[11px] text-muted-foreground leading-snug">
                            Unit costs not set for any items in this count.{" "}
                            <Link
                              to="/app/inventory/lists"
                            >
                              Set costs in List Management
                            </Link>
                          </p>
                        </>
                      ) : (
                        <>
                          {allHaveCost && (
                            <>
                              <p className="text-foreground font-medium">{formatCurrency(value)}</p>
                              <p className="text-[11px] text-muted-foreground">
                                Est. inventory value · {totalItems} items
                              </p>
                            </>
                          )}
                          {someMissingCost && (
                            <>
                              <p className="text-foreground font-medium">
                                {formatCurrency(value)}
                                <span className="text-xs text-amber-600 align-super"> *</span>
                              </p>
                              <p className="text-[11px] text-amber-600/90 leading-snug">
                                Includes {itemsWithCost} of {totalItems} items — {itemsWithoutCost} items have no unit
                                cost set →{" "}
                                <Link
                                  to="/app/inventory/lists"
                                  className="font-medium underline underline-offset-2 hover:text-amber-700"
                                >
                                  Set costs in List Management
                                </Link>
                              </p>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 sm:justify-end shrink-0">
                    <span className="text-xs text-muted-foreground tabular-nums">{totalItems} items</span>
                    <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => onView(s)}>
                      <Eye className="h-3.5 w-3.5" /> View
                    </Button>
                    {isManagerOrOwner && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => onDuplicate(s)}>
                            <Copy className="h-3.5 w-3.5 mr-2" /> Duplicate
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onOpenSmartOrderModal(s)}>
                            <ShoppingCart className="h-3.5 w-3.5 mr-2" /> Smart order
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onClick={() => onDeclineToReview(s.id)}>
                            <XCircle className="h-3.5 w-3.5 mr-2" /> Decline to review
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive" onClick={() => onRequestDeleteSession(s.id)}>
                            <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </section>
  );
}
