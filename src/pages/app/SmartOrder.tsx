import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { ShoppingCart, DollarSign, AlertTriangle, Package, Eye, ArrowLeft, Trash2, ExternalLink, Info, Pencil, Hash } from "lucide-react";
import { ExportButtons } from "@/components/ExportButtons";
import { getRisk, formatNum, formatCurrency, computeNeedRaw, isWholeUnitType, type RiskLevel } from "@/lib/inventory-utils";
import ItemIdentityBlock from "@/components/ItemIdentityBlock";
import { useLastOrderDates } from "@/hooks/useLastOrderDates";
import { format } from "date-fns";

const normalizeItemName = (value: string | null | undefined) => (value || "").trim().toLowerCase();

export default function SmartOrderPage() {
  const { currentRestaurant } = useRestaurant();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRun, setSelectedRun] = useState<any>(null);
  const [runItems, setRunItems] = useState<any[]>([]);
  const [deleteRunId, setDeleteRunId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editingRunItem, setEditingRunItem] = useState<string | null>(null);
  const [editRunValues, setEditRunValues] = useState<{ par_level: string; unit_cost: string }>({ par_level: "", unit_cost: "" });

  // Filters
  const [dateFilter, setDateFilter] = useState("30");
  const [listFilter, setListFilter] = useState("all");
  const [lists, setLists] = useState<any[]>([]);
  const [catalogItems, setCatalogItems] = useState<any[]>([]);

  // Detail view toggles
  const [showGreen, setShowGreen] = useState(false);
  const [showNoPar, setShowNoPar] = useState(false);

  const { lastOrderDates } = useLastOrderDates(currentRestaurant?.id);

  useEffect(() => {
    if (!currentRestaurant) return;
    supabase.from("inventory_lists").select("id, name").eq("restaurant_id", currentRestaurant.id)
      .then(({ data }) => { if (data) setLists(data); });
    supabase.from("inventory_catalog_items").select("id, item_name, product_number, vendor_sku").eq("restaurant_id", currentRestaurant.id)
      .then(({ data }) => { if (data) setCatalogItems(data); });
  }, [currentRestaurant]);

  const catalogLookup = catalogItems.reduce<Record<string, any>>((acc, ci) => {
    const normalizedName = normalizeItemName(ci.item_name);
    if (!normalizedName || acc[normalizedName]) return acc;
    acc[normalizedName] = ci;
    return acc;
  }, {});

  const catalogById = catalogItems.reduce<Record<string, any>>((acc, ci) => {
    acc[ci.id] = ci;
    return acc;
  }, {});

  const fetchRuns = async () => {
    if (!currentRestaurant) return;
    setLoading(true);
    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - parseInt(dateFilter));

    let query = supabase.from("smart_order_runs")
      .select("*, inventory_lists(name), inventory_sessions(name, approved_at), par_guides(name), smart_order_run_items(id)")
      .eq("restaurant_id", currentRestaurant.id)
      .gte("created_at", daysAgo.toISOString())
      .order("created_at", { ascending: false });

    if (listFilter !== "all") {
      query = query.eq("inventory_list_id", listFilter);
    }

    const { data } = await query;
    if (data) setRuns(data);
    setLoading(false);
  };

  useEffect(() => { fetchRuns(); }, [currentRestaurant, dateFilter, listFilter]);

  // Auto-open a run if viewRun param is set
  useEffect(() => {
    const viewRunId = searchParams.get("viewRun");
    if (viewRunId && runs.length > 0) {
      const run = runs.find(r => r.id === viewRunId);
      if (run) {
        openRunDetail(run);
        searchParams.delete("viewRun");
        setSearchParams(searchParams, { replace: true });
      }
    }
  }, [runs, searchParams]);

  const openRunDetail = async (run: any) => {
    setSelectedRun(run);
    const { data } = await supabase.from("smart_order_run_items").select("*").eq("run_id", run.id);
    if (data) {
      setRunItems(data.sort((a, b) => b.suggested_order - a.suggested_order));
    }
  };

  const handleDeleteRun = async (idToDelete: string) => {
    if (!idToDelete) return;

    // Close dialog + optimistic UI update immediately
    setDeleteRunId(null);
    setRuns(prev => prev.filter(r => r.id !== idToDelete));
    if (selectedRun?.id === idToDelete) { setSelectedRun(null); setRunItems([]); }

    // Delete child items first (FK safety)
    await supabase.from("smart_order_run_items").delete().eq("run_id", idToDelete);

    const { data: poRow } = await supabase.from("purchase_orders").select("id").eq("smart_order_run_id", idToDelete).maybeSingle();
    if (poRow?.id) {
      const { data: invs } = await supabase.from("invoices").select("id").eq("purchase_order_id", poRow.id);
      if (invs?.length) {
        const invIds = invs.map((r: { id: string }) => r.id);
        await supabase.from("invoice_items").delete().in("invoice_id", invIds);
        await supabase.from("invoices").delete().in("id", invIds);
      }
      await supabase.from("purchase_order_items").delete().eq("purchase_order_id", poRow.id);
      await supabase.from("purchase_orders").delete().eq("id", poRow.id);
    }

    const { data: phRows } = await supabase.from("purchase_history").select("id").eq("smart_order_run_id", idToDelete);
    if (phRows && phRows.length > 0) {
      const phIds = phRows.map(p => p.id);
      await supabase.from("purchase_history_items").delete().in("purchase_history_id", phIds);
      await supabase.from("purchase_history").delete().in("id", phIds);
    }

    const { error } = await supabase.from("smart_order_runs").delete().eq("id", idToDelete);
    if (error) {
      toast.error(`Delete failed: ${error.message}`);
      fetchRuns();
    } else {
      toast.success("Smart order deleted");
      fetchRuns();
    }
  };

  const handleSubmitOrder = async () => {
    if (!selectedRun || !user) return;
    // Capture pre-submit status from the closure so the toast is correct
    // even after state updates happen asynchronously.
    const isFirstSubmit = selectedRun.status !== 'submitted';
    setSubmitting(true);
    try {
      // PO number generation and assignment is handled entirely by the RPC.
      const { data: rpcResult, error } = await supabase.rpc('submit_smart_order', { p_run_id: selectedRun.id });
      if (error) throw error;

      // Re-fetch the updated row so we always have the DB-authoritative
      // po_number and status, regardless of what the RPC return value looks
      // like under different PostgREST schema-cache states.
      const { data: freshRun } = await supabase
        .from('smart_order_runs')
        .select('id, status, po_number')
        .eq('id', selectedRun.id)
        .single();

      // Primary: re-fetched row. Fallback: RPC JSONB payload. Never null.
      const poNumber: string | null =
        freshRun?.po_number ??
        (rpcResult as any)?.po_number ??
        null;

      setSelectedRun((prev: any) => ({
        ...prev,
        status: freshRun?.status ?? 'submitted',
        po_number: poNumber,
      }));
      setRuns(prev =>
        prev.map(r =>
          r.id === selectedRun.id
            ? { ...r, status: freshRun?.status ?? 'submitted', po_number: poNumber }
            : r
        )
      );

      if (isFirstSubmit) {
        toast.success(poNumber ? `Order submitted — ${poNumber}` : 'Order submitted');
      } else {
        toast.success('Purchase History updated');
      }
    } catch (e: any) {
      toast.error(`Submit failed: ${e.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const riskBadge = (risk: string, currentStock?: number, parLevel?: number) => {
    const riskInfo = getRisk(currentStock, parLevel);
    const badgeClass = risk === "RED" ? "bg-destructive/10 text-destructive"
      : risk === "YELLOW" ? "bg-warning text-warning-foreground"
      : risk === "NO_PAR" ? "bg-muted/60 text-muted-foreground"
      : "bg-success text-success-foreground";
    const label = risk === "RED" ? "Critical" : risk === "YELLOW" ? "Low" : risk === "NO_PAR" ? "No PAR" : "OK";

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>
            <Badge className={`${badgeClass} text-[10px] font-medium border-0`}>{label}</Badge>
          </TooltipTrigger>
          <TooltipContent><p className="text-xs">{riskInfo.tooltip}</p></TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  // Detail view
  if (selectedRun) {
    const orderItems = runItems.filter(i => i.suggested_order > 0 && i.risk !== "NO_PAR");
    const greenItems = runItems.filter(i => i.risk === "GREEN" && i.suggested_order <= 0);
    const noParItems = runItems.filter(i => i.risk === "NO_PAR");
    const redCount = runItems.filter(i => i.risk === "RED").length;
    const yellowCount = runItems.filter(i => i.risk === "YELLOW").length;
    const lineEstCost = (i: { suggested_order: number; unit_cost: number | null }) => {
      if (!i.unit_cost || !(i.suggested_order > 0)) return 0;
      return Math.round(Number(i.suggested_order) * Number(i.unit_cost) * 100) / 100;
    };
    const totalEstCost = orderItems.reduce((sum, i) => sum + lineEstCost(i), 0);
    const totalOrderQty = orderItems.reduce((sum, i) => sum + Number(i.suggested_order), 0);
    const selectedGuideName = selectedRun.par_guides?.name || null;

    // Build display list based on toggles
    const displayItems = [
      ...orderItems,
      ...(showGreen ? greenItems : []),
      ...(showNoPar ? noParItems : []),
    ];

    return (
      <div className="space-y-5 animate-fade-in">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setSelectedRun(null); setRunItems([]); }}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Smart Order Detail</h1>
              <p className="text-sm text-muted-foreground">
                {selectedRun.inventory_sessions?.name || "Count session"}
                {" · "}
                List: {selectedRun.inventory_lists?.name || "—"}
                {" · "}
                {new Date(selectedRun.created_at).toLocaleDateString()}
              </p>
              {selectedGuideName && (
                <p className="text-xs text-muted-foreground">
                  Based on PAR guide: <span className="font-medium text-foreground">{selectedGuideName}</span>
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {selectedRun.status === 'submitted' && (
              <Badge className="bg-primary/10 text-primary border-0 text-[11px]">
                {selectedRun.po_number ? selectedRun.po_number : 'Submitted'}
              </Badge>
            )}
            <ExportButtons
              items={displayItems.map(i => ({ ...i, suggestedOrder: i.suggested_order, pack_size: i.pack_size }))}
              filename="smart-order"
              type="smartorder"
            />
            <Button
              size="sm"
              variant={selectedRun.status === 'submitted' ? 'outline' : 'default'}
              className="gap-1.5"
              disabled={submitting}
              onClick={handleSubmitOrder}
            >
              <ShoppingCart className="h-3.5 w-3.5" />
              {submitting ? 'Saving…' : selectedRun.status === 'submitted' ? 'Update Purchase History' : 'Submit Order'}
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => {
              window.location.href = "/app/purchase-history";
            }}>
              <ExternalLink className="h-3.5 w-3.5" /> Purchase History
            </Button>
          </div>
        </div>

        {!selectedRun.par_guide_id && (
          <Card className="border-warning/30 bg-warning/5">
            <CardContent className="flex items-start gap-3 p-4">
              <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-warning">
                  No PAR guide was linked to this count — order quantities may be inaccurate.
                </p>
                <p className="text-xs text-warning mt-1">
                  Link a PAR guide in PAR Management and run a new count for accurate suggestions.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Sticky Summary Bar */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm -mx-4 px-4 py-3 border-b border-border/40">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Card className="border-destructive/15">
              <CardContent className="flex items-center gap-3 p-3">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                <div>
                  <p className="stat-value text-lg">{redCount}</p>
                  <p className="text-[10px] text-muted-foreground">Critical</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-warning/15">
              <CardContent className="flex items-center gap-3 p-3">
                <AlertTriangle className="h-5 w-5 text-warning" />
                <div>
                  <p className="stat-value text-lg">{yellowCount}</p>
                  <p className="text-[10px] text-muted-foreground">Warning</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 p-3">
                <Package className="h-5 w-5 text-primary" />
                <div>
                  <p className="stat-value text-lg">{orderItems.length}</p>
                  <p className="text-[10px] text-muted-foreground">Items to order</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-primary/20">
              <CardContent className="flex items-center gap-3 p-3">
                <Hash className="h-5 w-5 text-primary" />
                <div>
                  <p className="stat-value text-lg font-mono tabular-nums">{formatNum(totalOrderQty)}</p>
                  <p className="text-[10px] text-muted-foreground">Σ order qty</p>
                  <p className="text-[9px] text-muted-foreground/70 leading-tight mt-0.5">Sum of line qty (mixed UOM)</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-primary/15">
              <CardContent className="flex items-center gap-3 p-3">
                <DollarSign className="h-5 w-5 text-primary" />
                <div>
                  <p className="stat-value text-lg">{formatCurrency(totalEstCost)}</p>
                  <p className="text-[10px] text-muted-foreground">Est. total cost</p>
                  <p className="text-[9px] text-muted-foreground/70 leading-tight mt-0.5">Matches line est. costs</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Toggles */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Switch id="show-green" checked={showGreen} onCheckedChange={setShowGreen} />
            <Label htmlFor="show-green" className="text-xs text-muted-foreground">Show OK items</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="show-nopar" checked={showNoPar} onCheckedChange={setShowNoPar} />
            <Label htmlFor="show-nopar" className="text-xs text-muted-foreground">Show Missing PAR</Label>
          </div>
          {noParItems.length > 0 && (
            <Badge variant="outline" className="text-[10px] gap-1">
              <Info className="h-3 w-3" /> {noParItems.length} items missing PAR
            </Badge>
          )}
        </div>

        <Card className="overflow-hidden">
          <Table>
              <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="text-xs font-semibold">Risk</TableHead>
                <TableHead className="text-xs font-semibold">Item</TableHead>
                <TableHead className="text-xs font-semibold">Product #</TableHead>
                <TableHead className="text-xs font-semibold">Pack Size</TableHead>
                <TableHead className="text-xs font-semibold">Last Ordered</TableHead>
                <TableHead className="text-xs font-semibold">Current</TableHead>
                <TableHead className="text-xs font-semibold">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger className="flex items-center gap-1">
                        PAR <Info className="h-3 w-3 text-muted-foreground" /> <Pencil className="h-3 w-3 text-muted-foreground/40" />
                      </TooltipTrigger>
                      <TooltipContent><p className="text-xs max-w-xs">Target stock level. Click a value to edit.</p></TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </TableHead>
                <TableHead className="text-xs font-semibold">Need</TableHead>
                 <TableHead className="text-xs font-semibold">
                   <TooltipProvider>
                     <Tooltip>
                       <TooltipTrigger className="flex items-center gap-1">
                         Order Qty <Info className="h-3 w-3 text-muted-foreground" />
                       </TooltipTrigger>
                       <TooltipContent><p className="text-xs max-w-xs">Full-case rounding is applied. Case items always order in whole cases.</p></TooltipContent>
                     </Tooltip>
                   </TooltipProvider>
                 </TableHead>
                 <TableHead className="text-xs font-semibold">
                   <span className="flex items-center gap-1">Est. Cost <Pencil className="h-3 w-3 text-muted-foreground/40" /></span>
                 </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-8 text-sm text-muted-foreground">
                    No items to display. Adjust filters above.
                  </TableCell>
                </TableRow>
              ) : displayItems.map(i => (
                <TableRow key={i.id} className="hover:bg-muted/30 transition-colors">
                  <TableCell>{riskBadge(i.risk, i.current_stock, i.par_level)}</TableCell>
                  <TableCell>
                    <span className="font-medium text-sm">{i.item_name}</span>
                    <ItemIdentityBlock
                      brandName={i.brand_name}
                      className="block mt-0.5"
                    />
                  </TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground/60">
                    {(() => {
                      const ci = i.catalog_item_id ? catalogById[i.catalog_item_id] : catalogLookup[normalizeItemName(i.item_name)];
                      return ci?.product_number || ci?.vendor_sku || "—";
                    })()}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{i.pack_size || "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {(() => {
                      const catalogItem = i.catalog_item_id ? catalogById[i.catalog_item_id] : catalogLookup[normalizeItemName(i.item_name)];
                      const d = catalogItem?.id ? lastOrderDates[catalogItem.id] : null;
                      return d ? format(new Date(d), "MM/dd/yy") : "—";
                    })()}
                  </TableCell>
                  <TableCell className="font-mono text-sm">{formatNum(i.current_stock)}</TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">
                    {editingRunItem === `${i.id}_par` ? (
                      <Input
                        autoFocus
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step={0.1}
                        className="w-20 h-8 text-sm font-mono text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        value={editRunValues.par_level}
                        onFocus={e => e.target.select()}
                        onChange={e => setEditRunValues(prev => ({ ...prev, par_level: e.target.value }))}
                        onBlur={async () => {
                          const parsed = parseFloat(editRunValues.par_level) || 0;
                          setRunItems(prev => prev.map(r => r.id === i.id ? { ...r, par_level: parsed } : r));
                          await supabase.from("smart_order_run_items").update({ par_level: parsed }).eq("id", i.id);
                          setEditingRunItem(null);
                        }}
                        onKeyDown={e => { if (e.key === "Escape") setEditingRunItem(null); if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                      />
                    ) : (
                      <button
                        className="font-mono text-sm text-muted-foreground hover:text-foreground hover:underline decoration-dashed underline-offset-2 cursor-pointer"
                        onClick={() => { setEditingRunItem(`${i.id}_par`); setEditRunValues({ par_level: String(i.par_level ?? ""), unit_cost: String(i.unit_cost ?? "") }); }}
                        title="Click to edit PAR"
                      >
                        {formatNum(i.par_level)}
                      </button>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">{computeNeedRaw(i.current_stock, i.par_level) > 0 ? String(Math.ceil(computeNeedRaw(i.current_stock, i.par_level))) : "—"}</TableCell>
                  <TableCell className="font-mono text-sm font-bold">{i.suggested_order > 0 ? formatNum(i.suggested_order) : "—"}</TableCell>
                  <TableCell className="font-mono text-sm">
                    {editingRunItem === `${i.id}_cost` ? (
                      <Input
                        autoFocus
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step={0.01}
                        className="w-24 h-8 text-sm font-mono text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        value={editRunValues.unit_cost}
                        placeholder="Unit price"
                        onFocus={e => e.target.select()}
                        onChange={e => setEditRunValues(prev => ({ ...prev, unit_cost: e.target.value }))}
                        onBlur={async () => {
                          const parsed = parseFloat(editRunValues.unit_cost) || null;
                          setRunItems(prev => prev.map(r => r.id === i.id ? { ...r, unit_cost: parsed } : r));
                          await supabase.from("smart_order_run_items").update({ unit_cost: parsed }).eq("id", i.id);
                          setEditingRunItem(null);
                        }}
                        onKeyDown={e => { if (e.key === "Escape") setEditingRunItem(null); if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                      />
                    ) : (
                      <button
                        className="font-mono text-sm hover:underline decoration-dashed underline-offset-2 cursor-pointer"
                        onClick={() => { setEditingRunItem(`${i.id}_cost`); setEditRunValues({ par_level: String(i.par_level ?? ""), unit_cost: String(i.unit_cost ?? "") }); }}
                        title="Click to edit unit price"
                      >
                        {i.unit_cost && i.suggested_order > 0
                          ? formatCurrency(lineEstCost(i))
                          : <span className="text-muted-foreground/40">—</span>
                        }
                      </button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
    );
  }

  // ─── LIST VIEW ────────────────────────
  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Smart Orders</h1>
          <p className="page-description">View and manage your saved smart order runs</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Select value={dateFilter} onValueChange={setDateFilter}>
          <SelectTrigger className="h-9 w-40 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
            <SelectItem value="365">Last year</SelectItem>
          </SelectContent>
        </Select>
        <Select value={listFilter} onValueChange={setListFilter}>
          <SelectTrigger className="h-9 w-48 text-xs"><SelectValue placeholder="All lists" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All lists</SelectItem>
            {lists.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}
        </div>
      ) : runs.length === 0 ? (
        <Card>
          <CardContent className="empty-state">
            <ShoppingCart className="empty-state-icon" />
            <p className="empty-state-title">No smart orders yet</p>
            <p className="empty-state-description">Create a smart order from an approved inventory session in Inventory Management.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden border shadow-sm">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="text-xs font-semibold">Date</TableHead>
                <TableHead className="text-xs font-semibold">Count session</TableHead>
                <TableHead className="text-xs font-semibold">List</TableHead>
                <TableHead className="text-xs font-semibold">PAR Guide</TableHead>
                <TableHead className="text-xs font-semibold text-right">Items</TableHead>
                <TableHead className="text-xs font-semibold w-28">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map(run => (
                <TableRow key={run.id} className="hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => openRunDetail(run)}>
                  <TableCell className="text-xs text-muted-foreground">{new Date(run.created_at).toLocaleDateString()}</TableCell>
                  <TableCell className="text-sm font-medium">
                    <div>{run.inventory_sessions?.name || "—"}</div>
                    {run.inventory_sessions?.approved_at && (
                      <div className="text-[10px] text-muted-foreground font-normal tabular-nums">
                        Approved {new Date(run.inventory_sessions.approved_at).toLocaleDateString()}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{run.inventory_lists?.name || "—"}</TableCell>
                  <TableCell className="text-xs">
                    {run.par_guides?.name || (
                      run.par_guide_id
                        ? "—"
                        : <span className="text-warning">No linked PAR guide</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs font-mono text-right">{run.smart_order_run_items?.length || 0}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={() => openRunDetail(run)}>
                        <Eye className="h-3 w-3 mr-1" /> View
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={() => setDeleteRunId(run.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteRunId} onOpenChange={(o) => !o && setDeleteRunId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete smart order?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete this smart order run and its linked purchase history. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteRunId && handleDeleteRun(deleteRunId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
