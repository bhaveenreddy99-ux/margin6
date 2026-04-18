import { useEffect, useState, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useSearchParams, useNavigate } from "react-router-dom";
import { CheckCircle, XCircle, Eye, ClipboardCheck, ArrowLeft, Search, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { getRisk, computeOrderQty, type RiskThresholds } from "@/lib/inventory-utils";
import { riskThresholdsFromSettings } from "@/domain/inventory/riskThresholds";
import { useLastOrderDates } from "@/hooks/useLastOrderDates";
import { format } from "date-fns";
import type {
  InventoryCatalogItemRow,
  InventorySessionListRow,
} from "@/domain/inventory/enterInventoryTypes";
import {
  loadSessionItemsWithApprovedPar,
  type SessionItemWithApprovedPar,
} from "@/domain/inventory/sessionSelectors";
import {
  approveInventorySession,
  sendInventorySessionBackToInProgress,
} from "@/domain/inventory/sessionWorkflow";

type FilterTab = "all" | "critical" | "low" | "ok" | "nopar";
type ReviewCatalogItem = Pick<
  InventoryCatalogItemRow,
  "id" | "item_name" | "product_number" | "vendor_sku"
>;

export default function ReviewPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const sessionFromUrl = searchParams.get("session")?.trim() || null;
  const { currentRestaurant, currentLocation } = useRestaurant();
  const { user } = useAuth();
  const { lastOrderDates } = useLastOrderDates(currentRestaurant?.id, currentLocation?.id);
  const [sessions, setSessions] = useState<InventorySessionListRow[]>([]);
  const [catalogItems, setCatalogItems] = useState<ReviewCatalogItem[]>([]);
  const [viewItems, setViewItems] = useState<SessionItemWithApprovedPar[] | null>(null);
  const [viewSession, setViewSession] = useState<InventorySessionListRow | null>(null);
  const [localItems, setLocalItems] = useState<Record<string, number>>({});
  const [activeFilter, setActiveFilter] = useState<FilterTab>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [declineSessionId, setDeclineSessionId] = useState<string | null>(null);
  const [declineNote, setDeclineNote] = useState("");
  const [declining, setDeclining] = useState(false);
  const [approving, setApproving] = useState(false);
  const [isResolvingSessionParam, setIsResolvingSessionParam] = useState(() => !!sessionFromUrl);
  const [riskThresholds, setRiskThresholds] = useState<RiskThresholds>({
    redThresholdPercent: 50,
    yellowThresholdPercent: 100,
  });

  const fetchSessions = useCallback(async () => {
    if (!currentRestaurant?.id) return;
    const { data } = await supabase
      .from("inventory_sessions")
      .select("*, inventory_lists(name)")
      .eq("restaurant_id", currentRestaurant.id)
      .eq("status", "IN_REVIEW")
      .order("updated_at", { ascending: false });
    if (data) setSessions(data);
  }, [currentRestaurant?.id]);

  useEffect(() => { void fetchSessions(); }, [fetchSessions]);

  useEffect(() => {
    if (!currentRestaurant?.id) return;
    supabase
      .from("smart_order_settings")
      .select("red_threshold, yellow_threshold")
      .eq("restaurant_id", currentRestaurant.id)
      .maybeSingle()
      .then(({ data }) => { setRiskThresholds(riskThresholdsFromSettings(data)); });
  }, [currentRestaurant]);

  useEffect(() => {
    if (!currentRestaurant) return;
    supabase.from("inventory_catalog_items").select("id, item_name, product_number, vendor_sku")
      .eq("restaurant_id", currentRestaurant.id)
      .then(({ data }) => { if (data) setCatalogItems(data); });
  }, [currentRestaurant]);

  const handleApprove = async (sessionId: string) => {
    if (!currentRestaurant?.id || !user?.id) return;
    setApproving(true);

    const result = await approveInventorySession({
      supabase,
      sessionId,
      restaurantId: currentRestaurant.id,
      userId: user.id,
      riskThresholds,
    });

    setApproving(false);
    if (!result.ok) {
      toast.error(result.errorMessage);
      return;
    }
    if (result.smartOrderErrorMessage) {
      toast.error(result.smartOrderErrorMessage);
    }
    if (result.smartOrderRunId) {
      toast.success("Session approved", {
        description: "Smart order draft created.",
        action: {
          label: "Open Smart Order",
          onClick: () => navigate(`/app/smart-order?viewRun=${result.smartOrderRunId}`),
        },
      });
    } else {
      toast.success("Session approved!");
    }
    if (result.catalogLinksStripped) {
      toast.info("Saved order lines; some catalog links were cleared due to invalid references.");
    }
    if (viewSession?.id === sessionId) { setViewItems(null); setViewSession(null); setLocalItems({}); }
    fetchSessions();
  };

  const handleDecline = async () => {
    if (!declineSessionId) return;
    setDeclining(true);
    const result = await sendInventorySessionBackToInProgress({
      supabase,
      sessionId: declineSessionId,
    });
    setDeclining(false);
    if (!result.ok) { toast.error(result.errorMessage); return; }
    toast.success(declineNote.trim() ? `Sent back: "${declineNote.trim()}"` : "Session sent back for recount");
    if (viewSession?.id === declineSessionId) { setViewItems(null); setViewSession(null); }
    setDeclineSessionId(null); setDeclineNote("");
    fetchSessions();
  };

  const openSessionForReview = useCallback(async (session: InventorySessionListRow): Promise<boolean> => {
    if (!currentRestaurant?.id) return false;
    setLocalItems({}); setActiveFilter("all"); setSearchQuery(""); setCollapsedCategories(new Set());
    const { items, errorMessage } = await loadSessionItemsWithApprovedPar({
      supabase,
      restaurantId: currentRestaurant.id,
      inventoryListId: session.inventory_list_id,
      sessionId: session.id,
    });
    if (errorMessage || !items) {
      toast.error("Could not load session");
      return false;
    }
    setViewItems(items);
    setViewSession(session);
    return true;
  }, [currentRestaurant?.id]);

  const handleView = async (session: InventorySessionListRow) => {
    await openSessionForReview(session);
  };

  useEffect(() => {
    const id = searchParams.get("session")?.trim();
    if (!id) {
      setIsResolvingSessionParam(false);
      return;
    }
    if (!currentRestaurant?.id) return;

    let cancelled = false;
    setIsResolvingSessionParam(true);

    (async () => {
      const { data: sessionRow, error: sessionError } = await supabase
        .from("inventory_sessions")
        .select("*, inventory_lists(name)")
        .eq("id", id)
        .eq("restaurant_id", currentRestaurant.id)
        .maybeSingle();

      if (cancelled) return;

      if (sessionError) {
        toast.error("Could not load session");
        navigate("/app/inventory/review", { replace: true });
        setIsResolvingSessionParam(false);
        return;
      }
      if (!sessionRow) {
        toast.error("Session not found");
        navigate("/app/inventory/review", { replace: true });
        setIsResolvingSessionParam(false);
        return;
      }
      if (sessionRow.status === "APPROVED") {
        toast.info("This session is already approved");
        navigate("/app/inventory/approved", { replace: true });
        setIsResolvingSessionParam(false);
        return;
      }
      if (sessionRow.status !== "IN_REVIEW") {
        toast.error("This session is not pending review.");
        navigate("/app/inventory/review", { replace: true });
        setIsResolvingSessionParam(false);
        return;
      }

      const ok = await openSessionForReview(sessionRow);
      if (cancelled) return;
      if (!ok) {
        navigate("/app/inventory/review", { replace: true });
        setIsResolvingSessionParam(false);
        return;
      }
      navigate("/app/inventory/review", { replace: true });
      setIsResolvingSessionParam(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [searchParams, currentRestaurant?.id, navigate, openSessionForReview]);

  const isManagerOrOwner = currentRestaurant?.role === "OWNER" || currentRestaurant?.role === "MANAGER";

  const riskCounts = useMemo(() => {
    if (!viewItems) return { critical: 0, low: 0, ok: 0, nopar: 0 };
    return viewItems.reduce((acc, item) => {
      const r = getRisk(Number(item.current_stock), item.approved_par, riskThresholds);
      if (r.level === "RED") acc.critical++;
      else if (r.level === "YELLOW") acc.low++;
      else if (r.level === "GREEN") acc.ok++;
      else acc.nopar++;
      return acc;
    }, { critical: 0, low: 0, ok: 0, nopar: 0 });
  }, [riskThresholds, viewItems]);

  const filteredItems = useMemo(() => {
    if (!viewItems) return [];
    let items = viewItems;
    if (activeFilter !== "all") items = items.filter(item => {
      const r = getRisk(Number(item.current_stock), item.approved_par, riskThresholds);
      if (activeFilter === "critical") return r.level === "RED";
      if (activeFilter === "low") return r.level === "YELLOW";
      if (activeFilter === "ok") return r.level === "GREEN";
      if (activeFilter === "nopar") return r.level === "NO_PAR";
      return true;
    });
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(i => i.item_name.toLowerCase().includes(q) || (i.category || "").toLowerCase().includes(q));
    }
    return items;
  }, [viewItems, activeFilter, searchQuery, riskThresholds]);

  const groupedByCategory = useMemo(() => {
    const groups: Record<string, SessionItemWithApprovedPar[]> = {};
    filteredItems.forEach(item => {
      const cat = item.category || "Uncategorized";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    });
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [filteredItems]);

  const showDeepLinkLoader =
    !!sessionFromUrl && viewItems === null && (isResolvingSessionParam || !currentRestaurant);

  // ── FULL SCREEN REVIEW VIEW ──
  if (viewItems && viewSession) {
    const totalNeed = viewItems.filter(i => computeOrderQty(Number(i.current_stock ?? 0), i.approved_par, i.unit, i.pack_size) > 0).length;

    return (
      <div className="flex flex-col animate-fade-in -mx-4 -mt-4 lg:-mx-6 lg:-mt-6 min-h-screen bg-background">
        <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b border-border/50 shadow-sm">
          <div className="flex items-center justify-between px-6 py-3 gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 rounded-lg"
                onClick={() => {
                  setViewItems(null); setViewSession(null); setLocalItems({});
                  navigate("/app/inventory/enter");
                }}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="text-sm font-bold truncate">{viewSession.name}</h1>
                  <Badge className="bg-amber-500/15 text-amber-600 border-0 text-[10px] font-semibold shrink-0">In Review</Badge>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  List: {viewSession.inventory_lists?.name || "—"} · {new Date(viewSession.updated_at).toLocaleDateString()}
                </p>
              </div>
            </div>
            {isManagerOrOwner && (
              <div className="flex gap-2 shrink-0">
                <Button size="sm" variant="outline" className="gap-1.5 h-9 text-xs border-destructive/30 text-destructive hover:bg-destructive/10"
                  onClick={() => setDeclineSessionId(viewSession.id)}>
                  <XCircle className="h-3.5 w-3.5" /> Decline
                </Button>
                <Button size="sm" disabled={approving} className="gap-1.5 h-9 text-xs bg-success hover:bg-success/90 text-success-foreground"
                  onClick={() => handleApprove(viewSession.id)}>
                  <CheckCircle className="h-3.5 w-3.5" /> {approving ? "Approving…" : "Approve"}
                </Button>
              </div>
            )}
          </div>

          {/* Stats strip */}
          <div className="flex items-stretch border-t border-border/30">
            {[
              { label: "Critical", value: riskCounts.critical, color: "text-destructive", bg: "bg-destructive/8" },
              { label: "Low", value: riskCounts.low, color: "text-amber-500", bg: "bg-amber-500/8" },
              { label: "OK", value: riskCounts.ok, color: "text-success", bg: "bg-success/8" },
              { label: "No PAR", value: riskCounts.nopar, color: "text-muted-foreground", bg: "bg-muted/40" },
              { label: "Need Order", value: totalNeed, color: "text-primary", bg: "bg-primary/8" },
              { label: "Total", value: viewItems.length, color: "text-foreground", bg: "" },
            ].map(({ label, value, color, bg }) => (
              <div key={label} className={`flex-1 flex flex-col items-center justify-center py-2.5 border-r border-border/20 last:border-0 ${bg}`}>
                <span className={`text-xl font-bold tabular-nums leading-none ${color}`}>{value}</span>
                <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60 mt-0.5">{label}</span>
              </div>
            ))}
          </div>

          {/* Search + filters */}
          <div className="flex items-center gap-3 px-6 py-2 border-t border-border/20 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
              <Input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search items..." className="pl-8 h-8 text-xs w-52" />
            </div>
            <Tabs value={activeFilter} onValueChange={v => setActiveFilter(v as FilterTab)}>
              <TabsList className="h-8">
                <TabsTrigger value="all" className="text-xs px-3">All {viewItems.length}</TabsTrigger>
                <TabsTrigger value="critical" className="text-xs px-3">🔴 {riskCounts.critical}</TabsTrigger>
                <TabsTrigger value="low" className="text-xs px-3">🟡 {riskCounts.low}</TabsTrigger>
                <TabsTrigger value="ok" className="text-xs px-3">🟢 {riskCounts.ok}</TabsTrigger>
                <TabsTrigger value="nopar" className="text-xs px-3">No PAR {riskCounts.nopar}</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>

        <div className="flex-1 pb-8">
          {filteredItems.length === 0 ? (
            <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">No items match this filter.</div>
          ) : groupedByCategory.map(([category, items]) => {
            const isCollapsed = collapsedCategories.has(category);
            const catCritical = items.filter(i => getRisk(Number(i.current_stock), i.approved_par, riskThresholds).level === "RED").length;
            const catLow = items.filter(i => getRisk(Number(i.current_stock), i.approved_par, riskThresholds).level === "YELLOW").length;
            return (
              <Collapsible key={category} open={!isCollapsed} onOpenChange={() => {
                setCollapsedCategories(prev => { const n = new Set(prev); if (n.has(category)) n.delete(category); else n.add(category); return n; });
              }}>
                <CollapsibleTrigger className="w-full flex items-center gap-3 px-6 py-2.5 bg-muted/25 border-y border-border/25 hover:bg-muted/40 transition-colors cursor-pointer">
                  {isCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/50" />}
                  <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/60">{category}</span>
                  <span className="text-[10px] text-muted-foreground/35">{items.length} items</span>
                  <div className="flex gap-1 ml-auto">
                    {catCritical > 0 && <Badge className="bg-destructive/10 text-destructive border-0 text-[10px] h-4 px-1.5">{catCritical} critical</Badge>}
                    {catLow > 0 && <Badge className="bg-amber-500/10 text-amber-600 border-0 text-[10px] h-4 px-1.5">{catLow} low</Badge>}
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent bg-muted/10 border-b border-border/20">
                        <TableHead className="pl-6 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 py-2">Item</TableHead>
                        <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 py-2 w-28">Product #</TableHead>
                        <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 py-2 w-28">Pack Size</TableHead>
                        <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 py-2 w-32 text-center">On Hand</TableHead>
                        <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 py-2 w-24 text-right">PAR</TableHead>
                        <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 py-2 w-24 text-right">Price</TableHead>
                        <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 py-2 w-20 text-right">Need</TableHead>
                        <TableHead className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 py-2 w-24 text-center pr-6">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map(item => {
                        const stock = localItems[item.id] !== undefined ? localItems[item.id] : Number(item.current_stock ?? 0);
                        const risk = getRisk(stock, item.approved_par, riskThresholds);
                        const need = computeOrderQty(stock, item.approved_par, item.unit, item.pack_size);
                        const lastOrdered = (() => {
                          const ci = catalogItems.find(c => c.item_name === item.item_name);
                          const d = ci ? lastOrderDates[ci.id] : null;
                          return d ? format(new Date(d), "MM/dd/yy") : null;
                        })();
                        const rowBg = risk.level === "RED" ? "bg-destructive/[0.025]" : risk.level === "YELLOW" ? "bg-amber-500/[0.025]" : "";
                        return (
                          <TableRow key={item.id} className={`border-b border-border/10 hover:bg-muted/20 transition-colors ${rowBg}`}>
                            <TableCell className="pl-6 py-3">
                              <p className="font-medium text-sm">{item.item_name}</p>
                              <div className="flex items-center gap-1.5 mt-0.5">
                                {item.brand_name && <span className="text-[10px] text-muted-foreground/55 italic">{item.brand_name}</span>}
                                {item.brand_name && lastOrdered && <span className="text-muted-foreground/25">·</span>}
                                {lastOrdered && <span className="text-[10px] text-muted-foreground/45">Last: {lastOrdered}</span>}
                              </div>
                            </TableCell>
                            <TableCell className="py-3 text-[11px] text-muted-foreground/55 font-mono">{item.vendor_sku || "—"}</TableCell>
                            <TableCell className="py-3 text-[11px] text-muted-foreground/55">{item.pack_size || "—"}</TableCell>
                            <TableCell className="text-center py-3">
                              {isManagerOrOwner ? (
                                <Input type="number" inputMode="decimal" min={0} step={0.1}
                                  className={"w-20 h-8 text-sm font-mono text-center mx-auto block [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none rounded-lg border-2 " + (stock > 0 ? "border-success/50 bg-success/8 text-success font-semibold" : "border-border/50")}
                                  value={localItems[item.id] !== undefined ? localItems[item.id] : (item.current_stock ?? "")}
                                  onFocus={e => e.target.select()}
                                  onChange={e => setLocalItems(prev => ({ ...prev, [item.id]: parseFloat(e.target.value) || 0 }))}
                                  onBlur={e => supabase.from("inventory_session_items").update({ current_stock: parseFloat(e.target.value) || 0 }).eq("id", item.id)}
                                />
                              ) : (
                                <span className={"mx-auto block h-8 w-20 text-center text-sm font-mono tabular-nums leading-8 " + (stock > 0 ? "font-semibold text-success" : "text-foreground")}>
                                  {localItems[item.id] !== undefined ? localItems[item.id] : (item.current_stock ?? "")}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-right py-3">
                              <div className="flex flex-col items-end gap-0.5">
                                <span className="text-sm font-mono font-semibold tabular-nums text-foreground">
                                  {item.par_level != null ? Number(item.par_level).toFixed(1) : <span className="text-muted-foreground/30">—</span>}
                                </span>
                                {item.approved_par != null && (
                                  <span className="text-[9px] text-muted-foreground/40">Guide: {item.approved_par}</span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-right py-3">
                              <span className="text-sm font-mono tabular-nums text-foreground">
                                {item.unit_cost != null ? `$${Number(item.unit_cost).toFixed(2)}` : <span className="text-muted-foreground/30">—</span>}
                              </span>
                            </TableCell>
                            <TableCell className="text-right py-3">
                              {need > 0 ? <span className="font-mono text-sm font-bold text-destructive">{need}</span> : <span className="text-muted-foreground/25 text-sm">—</span>}
                            </TableCell>
                            <TableCell className="text-center pr-6 py-3">
                              <Badge className={`${risk.bgClass} ${risk.textClass} border-0 text-[10px] font-semibold px-2`}>{risk.label}</Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>

        {/* Decline Dialog */}
        <Dialog open={!!declineSessionId} onOpenChange={o => { if (!o) { setDeclineSessionId(null); setDeclineNote(""); } }}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle className="flex items-center gap-2 text-destructive"><XCircle className="h-4 w-4" /> Decline Session</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-1">
              <p className="text-sm text-muted-foreground">Session will be sent back to <span className="font-semibold text-foreground">In Progress</span> so staff can recount and resubmit.</p>
              <div className="space-y-1.5">
                <Label>Note for staff <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
                <Input value={declineNote} onChange={e => setDeclineNote(e.target.value)} placeholder="e.g. Freezer items missing, please recount" className="h-10" autoFocus />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => { setDeclineSessionId(null); setDeclineNote(""); }}>Cancel</Button>
                <Button className="flex-1 bg-destructive hover:bg-destructive/90 text-destructive-foreground gap-1.5" onClick={handleDecline} disabled={declining}>
                  <XCircle className="h-3.5 w-3.5" />{declining ? "Sending…" : "Send Back"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  if (showDeepLinkLoader) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 animate-fade-in">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Opening session…</p>
      </div>
    );
  }

  // ── SESSION LIST ──
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Review Inventory</h1>
          <p className="page-description">Approve or decline submitted inventory counts</p>
        </div>
        {sessions.length > 0 && <Badge className="bg-amber-500/15 text-amber-600 border-amber-500/20 text-xs">{sessions.length} pending review</Badge>}
      </div>

      {sessions.length === 0 ? (
        <Card><CardContent className="empty-state">
          <ClipboardCheck className="empty-state-icon" />
          <p className="empty-state-title">No sessions pending review</p>
          <p className="empty-state-description">Sessions submitted by staff will appear here for approval.</p>
        </CardContent></Card>
      ) : (
        <div className="rounded-xl border border-border/50 overflow-hidden shadow-sm">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 pl-5">Session</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">List</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">Submitted</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 text-center">Status</TableHead>
                <TableHead className="w-56 pr-5"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map(s => (
                <TableRow key={s.id} className="border-b border-border/20 hover:bg-muted/15 transition-colors">
                  <TableCell className="pl-5 py-4">
                    <p className="font-semibold text-sm">{s.name}</p>
                    <p className="text-[10px] text-muted-foreground/50 mt-0.5">ID: {s.id.slice(0, 8)}…</p>
                  </TableCell>
                  <TableCell className="py-4 text-sm text-muted-foreground">{s.inventory_lists?.name || "—"}</TableCell>
                  <TableCell className="py-4 text-sm text-muted-foreground">{new Date(s.updated_at).toLocaleDateString()}</TableCell>
                  <TableCell className="text-center py-4">
                    <Badge className="bg-amber-500/15 text-amber-600 border-0 text-[10px] font-semibold">In Review</Badge>
                  </TableCell>
                  <TableCell className="pr-5 py-4">
                    <div className="flex items-center gap-2 justify-end">
                      <Button size="sm" className="h-8 text-xs gap-1.5 bg-muted hover:bg-muted/80 text-foreground" onClick={() => handleView(s)}>
                        <Eye className="h-3 w-3" /> Review
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
