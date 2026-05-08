import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CheckCircle, ShoppingCart, ChevronDown, ChevronRight, XCircle } from "lucide-react";
import { ExportButtons } from "@/components/ExportButtons";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useLastOrderDates } from "@/hooks/useLastOrderDates";
import { format } from "date-fns";
import { getRisk, computeOrderQty, type RiskThresholds } from "@/lib/inventory-utils";
import { riskThresholdsFromSettings } from "@/domain/inventory/riskThresholds";
import type {
  InventorySessionListRow,
} from "@/domain/inventory/enterInventoryTypes";
import {
  loadSessionItemsWithApprovedPar,
  type SessionItemWithApprovedPar,
} from "@/domain/inventory/sessionSelectors";
import { moveApprovedInventorySessionToReview } from "@/domain/inventory/sessionWorkflow";

function formatDateTime(isoString: string) {
  const d = new Date(isoString);
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return { date, time };
}

export default function ApprovedPage() {
  const { currentRestaurant, currentLocation } = useRestaurant();
  const navigate = useNavigate();
  const { lastOrderDates } = useLastOrderDates(currentRestaurant?.id, currentLocation?.id);
  const [sessions, setSessions] = useState<InventorySessionListRow[]>([]);
  const [expandedSession, setExpandedSession] = useState<string | null>(null);
  const [sessionItems, setSessionItems] = useState<Record<string, SessionItemWithApprovedPar[]>>({});
  const [loadingSession, setLoadingSession] = useState<string | null>(null);
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [declineSessionId, setDeclineSessionId] = useState<string | null>(null);
  const [localSuggestedOrder, setLocalSuggestedOrder] = useState<Record<string, string>>({});
  const [riskThresholds, setRiskThresholds] = useState<RiskThresholds>({
    redThresholdPercent: 50,
    yellowThresholdPercent: 100,
  });

  const isManagerOrOwner = currentRestaurant?.role === "OWNER" || currentRestaurant?.role === "MANAGER";

  const handleDecline = async (sessionId: string) => {
    setDecliningId(sessionId);
    const result = await moveApprovedInventorySessionToReview({
      supabase,
      sessionId,
    });
    setDecliningId(null);
    if (!result.ok) { toast.error(result.errorMessage); return; }
    toast.success("Session moved back to Review");
    setSessions(prev => prev.filter(s => s.id !== sessionId));
  };

  useEffect(() => {
    if (!currentRestaurant) return;
    let sessionQuery = supabase
      .from("inventory_sessions")
      .select("*, inventory_lists(name)")
      .eq("restaurant_id", currentRestaurant.id)
      .eq("status", "APPROVED");
    if (currentLocation?.id) {
      sessionQuery = sessionQuery.eq("location_id", currentLocation.id);
    }
    sessionQuery
      .order("approved_at", { ascending: false })
      .then(({ data }) => { if (data) setSessions(data); });
    supabase
      .from("smart_order_settings")
      .select("red_threshold, yellow_threshold")
      .eq("restaurant_id", currentRestaurant.id)
      .maybeSingle()
      .then(({ data }) => { setRiskThresholds(riskThresholdsFromSettings(data)); });
  }, [currentRestaurant, currentLocation]);

  const loadSessionItems = async (session: InventorySessionListRow) => {
    // Toggle collapse if already loaded
    if (sessionItems[session.id]) {
      setExpandedSession(prev => prev === session.id ? null : session.id);
      return;
    }

    setLoadingSession(session.id);

    if (!currentRestaurant?.id) {
      setLoadingSession(null);
      return;
    }

    const { items, errorMessage } = await loadSessionItemsWithApprovedPar({
      supabase,
      restaurantId: currentRestaurant.id,
      inventoryListId: session.inventory_list_id,
      sessionId: session.id,
    });

    if (errorMessage || !items) {
      toast.error(errorMessage ?? "Could not load session items");
      setLoadingSession(null);
      return;
    }

    setSessionItems(prev => ({ ...prev, [session.id]: items }));
    setExpandedSession(session.id);
    setLoadingSession(null);
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Approved Inventory</h1>
          <p className="page-description">Finalized inventory sessions ready for ordering</p>
        </div>
        {sessions.length > 0 && (
          <Button size="sm" className="bg-gradient-amber shadow-amber gap-1.5" onClick={() => navigate("/app/smart-order")}>
            <ShoppingCart className="h-3.5 w-3.5" /> Create Smart Order
          </Button>
        )}
      </div>

      {sessions.length === 0 ? (
        <Card>
          <CardContent className="empty-state">
            <CheckCircle className="empty-state-icon" />
            <p className="empty-state-title">No approved sessions yet</p>
            <p className="empty-state-description">Approved inventory sessions will appear here and power Smart Order.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <Table>
            <TableBody>
              {sessions.map(s => {
                const { date, time } = formatDateTime(s.approved_at || s.updated_at);
                const isExpanded = expandedSession === s.id;
                const items = sessionItems[s.id];
                const isLoading = loadingSession === s.id;

                return (
                  <>
                    {/* Session header row */}
                    <TableRow
                      key={`header-${s.id}`}
                      className="bg-muted/20 hover:bg-muted/40 cursor-pointer transition-colors"
                      onClick={() => loadSessionItems(s)}
                    >
                      <TableCell colSpan={9} className="py-3 px-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className="text-muted-foreground">
                              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </span>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-sm">{s.name}</span>
                                <Badge className="bg-success/10 text-success text-[10px] font-medium border-0">Approved</Badge>
                              </div>
                              <p className="text-[11px] text-muted-foreground mt-0.5">
                                List: {s.inventory_lists?.name || "—"} · {date} at {time}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                            {items && items.length > 0 && (
                              <ExportButtons
                                items={items}
                                filename={`inventory-${s.name || "export"}`}
                                type="inventory"
                                meta={{
                                  listName: s.inventory_lists?.name,
                                  sessionName: s.name,
                                  date: s.approved_at ? new Date(s.approved_at).toLocaleDateString() : undefined,
                                }}
                              />
                            )}
                            {isManagerOrOwner && (
                              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10"
                                disabled={decliningId === s.id}
                                onClick={() => setDeclineSessionId(s.id)}>
                                <XCircle className="h-3 w-3" />
                                {decliningId === s.id ? "Declining…" : "Decline"}
                              </Button>
                            )}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>

                    {/* Column header row when expanded */}
                    {isExpanded && (
                      <TableRow key={`cols-${s.id}`} className="bg-muted/10">
                        <TableHead className="text-xs font-semibold pl-12">Item</TableHead>
                        <TableHead className="text-xs font-semibold text-center">Stock</TableHead>
                        <TableHead className="text-xs font-semibold text-right">PAR</TableHead>
                        <TableHead className="text-xs font-semibold text-center">Risk</TableHead>
                        <TableHead className="text-xs font-semibold text-center">Suggested Order</TableHead>
                        <TableHead className="text-xs font-semibold text-right">Unit Cost</TableHead>
                        <TableHead />
                      </TableRow>
                    )}

                    {/* Loading state */}
                    {isExpanded && isLoading && (
                      <TableRow key={`loading-${s.id}`}>
                        <TableCell colSpan={9} className="text-center py-4 text-xs text-muted-foreground pl-12">
                          Loading items…
                        </TableCell>
                      </TableRow>
                    )}

                    {/* Item rows */}
                    {isExpanded && items && items.map(item => {
                      const riskInfo = getRisk(Number(item.current_stock), item.approved_par, riskThresholds);
                      const computedOrder = item.approved_par != null && item.approved_par > 0
                        ? computeOrderQty(Number(item.current_stock), item.approved_par, item.unit, item.pack_size)
                        : null;
                      const lastOrderDate = item.catalog_item_id ? lastOrderDates[item.catalog_item_id] : null;
                      const lastOrderStr = lastOrderDate ? format(new Date(lastOrderDate), "MM/dd/yy") : null;
                      const localVal = localSuggestedOrder[item.id];
                      const displayOrder = localVal !== undefined ? localVal : (computedOrder !== null ? String(computedOrder % 1 === 0 ? computedOrder : parseFloat(computedOrder.toFixed(2))) : "");
                      return (
                        <TableRow key={item.id} className={`${riskInfo.bgClass} border-b border-border/30`}>
                          <TableCell className="pl-12 py-3">
                            <p className="text-sm font-medium leading-tight">{item.item_name}</p>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0 mt-0.5">
                              {item.category && (
                                <span className="text-[11px] text-muted-foreground/60">{item.category}</span>
                              )}
                              {item.pack_size && (
                                <span className="text-[11px] text-muted-foreground/50 font-mono">{item.pack_size}</span>
                              )}
                              {lastOrderStr && (
                                <span className="text-[11px] text-muted-foreground/40">Last: {lastOrderStr}</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-sm text-center py-3">
                            {Number(item.current_stock) % 1 === 0 ? Number(item.current_stock) : parseFloat(Number(item.current_stock).toFixed(2))}
                          </TableCell>
                          <TableCell className="font-mono text-sm text-muted-foreground text-right py-3">
                            {item.approved_par !== null && item.approved_par !== undefined ? item.approved_par : "—"}
                          </TableCell>
                          <TableCell className="text-center py-3">
                            <Badge className={`${riskInfo.bgClass} ${riskInfo.textClass} border-0 text-[10px]`}>
                              {riskInfo.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center py-3">
                            <Input
                              type="number"
                              inputMode="decimal"
                              min={0}
                              step={0.1}
                              value={displayOrder}
                              onChange={e => setLocalSuggestedOrder(prev => ({ ...prev, [item.id]: e.target.value }))}
                              onFocus={e => e.target.select()}
                              placeholder="—"
                              className="w-20 h-8 text-sm font-mono text-center mx-auto block [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none rounded-lg border-2 border-border/50 focus:border-primary/50"
                            />
                          </TableCell>
                          <TableCell className="font-mono text-sm text-right py-3">
                            {item.unit_cost ? `$${Number(item.unit_cost).toFixed(2)}` : "—"}
                          </TableCell>
                          <TableCell />
                        </TableRow>
                      );
                    })}

                    {/* Empty state for session with no items */}
                    {isExpanded && items && items.length === 0 && (
                      <TableRow key={`empty-${s.id}`}>
                        <TableCell colSpan={9} className="text-center py-4 text-xs text-muted-foreground pl-12">
                          No items in this session.
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog open={!!declineSessionId} onOpenChange={(open) => { if (!open) setDeclineSessionId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move session back to review?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the approved snapshot and move the session back to review. Any smart order
              suggestions based on this count will no longer be available.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (declineSessionId) handleDecline(declineSessionId); setDeclineSessionId(null); }}
            >
              Move to review
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
