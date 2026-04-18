import { useEffect, useState, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { computeDetailedPARRecommendations, type DetailedPARRecommendation } from "@/lib/usage-analytics";
import {
  isSuggestionLikelyTooHigh,
  isSuggestionLikelyTooLow,
  isSuggestionMissingPar,
} from "@/domain/par/parHealth";
import {
  TrendingUp, TrendingDown, Minus, BellRing, BarChart3, RefreshCw,
  Sparkles, AlertTriangle, PackageCheck, PackageMinus, ListFilter, CheckSquare
} from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useIsCompact } from "@/hooks/use-mobile";

type FilterMode =
  | "all"
  | "changed"
  | "major"
  | "stockout"
  | "overstock"
  | "missing_par"
  | "likely_low"
  | "likely_high";

/** Display-only: managers see trust tied to count snapshots, not internal computeConfidence(). */
function confidenceTierFromDataPoints(dataPoints: number): "high" | "medium" | "low" {
  if (dataPoints >= 3) return "high";
  if (dataPoints === 2) return "medium";
  return "low";
}

function formatWeeklyUsages(values: number[]): string {
  if (!values.length) return "—";
  return values.map((v, i) => `W${i + 1}: ${v.toFixed(1)}`).join(" · ");
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function PARSuggestionsPage() {
  const { currentRestaurant, currentLocation } = useRestaurant();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const isCompact = useIsCompact();

  const [lists, setLists] = useState<any[]>([]);
  const [parGuides, setParGuides] = useState<any[]>([]);
  const [parSettings, setParSettings] = useState<any>(null);

  const [selectedList, setSelectedList] = useState("all");
  const [selectedGuide, setSelectedGuide] = useState("all");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");

  const [suggestions, setSuggestions] = useState<DetailedPARRecommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [notifying, setNotifying] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyDialogOpen, setApplyDialogOpen] = useState(false);
  const [itemsPendingApply, setItemsPendingApply] = useState<DetailedPARRecommendation[]>([]);

  const isManagerPlus = currentRestaurant?.role === "OWNER" || currentRestaurant?.role === "MANAGER";

  // Load lists + PAR settings
  useEffect(() => {
    if (!currentRestaurant) return;
    supabase.from("inventory_lists").select("id, name").eq("restaurant_id", currentRestaurant.id)
      .then(({ data }) => { if (data) setLists(data); });
    supabase.from("par_settings").select("*").eq("restaurant_id", currentRestaurant.id).maybeSingle()
      .then(({ data }) => { if (data) setParSettings(data); });
  }, [currentRestaurant]);

  // Deep link from PAR Management: /app/par/suggestions?list=<inventory_list_id>&filter=<mode>
  useEffect(() => {
    const listId = searchParams.get("list");
    if (!listId || lists.length === 0) return;
    if (lists.some((l) => l.id === listId)) {
      setSelectedList(listId);
    }
  }, [searchParams, lists]);

  useEffect(() => {
    const f = searchParams.get("filter");
    if (f === "likely_low" || f === "likely_high" || f === "missing_par") {
      setFilterMode(f);
    }
  }, [searchParams]);

  // Load PAR guides when list changes
  useEffect(() => {
    if (!currentRestaurant || selectedList === "all") { setParGuides([]); setSelectedGuide("all"); return; }
    supabase.from("par_guides").select("id, name").eq("restaurant_id", currentRestaurant.id).eq("inventory_list_id", selectedList)
      .then(({ data }) => { if (data) setParGuides(data); setSelectedGuide("all"); });
  }, [selectedList, currentRestaurant]);

  // ─── Shared PAR computation ──────────────────────────────────────────────
  const generateSuggestions = useCallback(async () => {
    if (!currentRestaurant) return;
    setLoading(true);
    setGenerated(false);
    setSelectedItems(new Set());
    try {
      const result = await computeDetailedPARRecommendations(currentRestaurant.id, {
        locationId: currentLocation?.id,
        inventoryListId: selectedList !== "all" ? selectedList : undefined,
        parGuideId: selectedGuide !== "all" ? selectedGuide : undefined,
        leadTimeDays: parSettings?.default_lead_time_days,
        useParGuideOverrides: true,
      });

      setSuggestions(result);
      setGenerated(true);

      if (result.length === 0) {
        toast.info("No significant PAR changes suggested based on recent approved sessions.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to generate PAR suggestions.";
      toast.error(message);
      setSuggestions([]);
      setGenerated(true);
    } finally {
      setLoading(false);
    }
  }, [currentRestaurant, currentLocation, selectedList, selectedGuide, parSettings]);

  // ─── Filtered suggestions ───────────────────────────────────────────────
  const filteredSuggestions = useMemo(() => {
    switch (filterMode) {
      case "changed": return suggestions.filter(s => Math.abs(s.change_pct) >= 10);
      case "major": return suggestions.filter(s => Math.abs(s.change_pct) >= 20);
      case "stockout": return suggestions.filter(s => s.risk_type === "stockout");
      case "overstock": return suggestions.filter(s => s.risk_type === "overstock");
      case "missing_par": return suggestions.filter(s => s.risk_type === "missing_par");
      case "likely_low": return suggestions.filter(s => isSuggestionLikelyTooLow(s));
      case "likely_high": return suggestions.filter(s => isSuggestionLikelyTooHigh(s));
      default: return suggestions;
    }
  }, [suggestions, filterMode]);

  const parHealthCounts = useMemo(
    () => ({
      missing: suggestions.filter(s => isSuggestionMissingPar(s)).length,
      likelyLow: suggestions.filter(s => isSuggestionLikelyTooLow(s)).length,
      likelyHigh: suggestions.filter(s => isSuggestionLikelyTooHigh(s)).length,
    }),
    [suggestions],
  );

  // ─── Apply to PAR Guide (same matching as single-row; batch-safe) ─────────
  const runApplyParItems = async (itemsToApply: DetailedPARRecommendation[]) => {
    if (!currentRestaurant || !user) return;
    setApplying(true);

    // Determine target guide
    let targetGuideId = selectedGuide !== "all" ? selectedGuide : null;

    if (!targetGuideId) {
      const listId = selectedList !== "all" ? selectedList : lists[0]?.id;
      if (!listId) {
        toast.error("Please select an inventory list first.");
        setApplying(false);
        return;
      }
      const { data: guides } = await supabase.from("par_guides")
        .select("id").eq("restaurant_id", currentRestaurant.id).eq("inventory_list_id", listId).limit(1);
      targetGuideId = guides?.[0]?.id;

      if (!targetGuideId) {
        const { data: newGuide, error } = await supabase.from("par_guides").insert({
          restaurant_id: currentRestaurant.id,
          inventory_list_id: listId,
          name: `AI Suggested PAR – ${new Date().toLocaleDateString()}`,
          created_by: user.id,
        }).select("id").single();
        if (error || !newGuide) {
          toast.error("Failed to create PAR guide.");
          setApplying(false);
          return;
        }
        targetGuideId = newGuide.id;
      }
    }

    const catalogIds = [
      ...new Set(
        itemsToApply.map((i) => i.catalog_item_id).filter((id): id is string => typeof id === "string" && id.length > 0),
      ),
    ];
    const catalogNameById = new Map<string, string>();
    if (catalogIds.length > 0) {
      const { data: catRows } = await supabase
        .from("inventory_catalog_items")
        .select("id, item_name")
        .in("id", catalogIds);
      for (const c of catRows ?? []) {
        if (c.item_name) catalogNameById.set(c.id, c.item_name);
      }
    }

    const { data: guideRows } = await supabase
      .from("par_guide_items")
      .select("id, item_name, catalog_item_id")
      .eq("par_guide_id", targetGuideId);
    const guideRowIdByCatalogId = new Map<string, string>();
    const guideRowIdByLowerName = new Map<string, string>();
    for (const row of guideRows ?? []) {
      if (row.catalog_item_id) guideRowIdByCatalogId.set(row.catalog_item_id, row.id);
      const k = row.item_name.trim().toLowerCase();
      if (!guideRowIdByLowerName.has(k)) guideRowIdByLowerName.set(k, row.id);
    }

    const resolveExistingRowId = (item: DetailedPARRecommendation): string | undefined => {
      if (item.catalog_item_id) {
        const byId = guideRowIdByCatalogId.get(item.catalog_item_id);
        if (byId) return byId;
      }
      const canonical = item.catalog_item_id ? catalogNameById.get(item.catalog_item_id)?.trim() : undefined;
      if (canonical) {
        const byCatalog = guideRowIdByLowerName.get(canonical.toLowerCase());
        if (byCatalog) return byCatalog;
      }
      const bySuggestionName = guideRowIdByLowerName.get(item.item_name.trim().toLowerCase());
      if (bySuggestionName) return bySuggestionName;
      return undefined;
    };

    let updated = 0;
    let created = 0;
    for (const item of itemsToApply) {
      let existingId = resolveExistingRowId(item);

      if (!existingId) {
        const { data: loose } = await supabase
          .from("par_guide_items")
          .select("id")
          .eq("par_guide_id", targetGuideId)
          .ilike("item_name", item.item_name)
          .maybeSingle();
        existingId = loose?.id;
      }

      const insertItemName =
        (item.catalog_item_id && catalogNameById.get(item.catalog_item_id)?.trim()) || item.item_name;

      if (existingId) {
        await supabase.from("par_guide_items").update({
          par_level: item.suggested_par,
          ...(item.catalog_item_id ? { catalog_item_id: item.catalog_item_id } : {}),
        }).eq("id", existingId);
        updated++;
      } else {
        await supabase.from("par_guide_items").insert({
          par_guide_id: targetGuideId,
          item_name: insertItemName,
          category: item.category,
          unit: item.unit,
          par_level: item.suggested_par,
          ...(item.catalog_item_id ? { catalog_item_id: item.catalog_item_id } : {}),
        });
        created++;
      }
    }

    const total = updated + created;
    toast.success(`Applied ${total} PAR update${total !== 1 ? "s" : ""}`);
    setApplying(false);
    setApplyDialogOpen(false);
    setItemsPendingApply([]);
    setSelectedItems(new Set());
  };

  const handleConfirmApply = () => {
    void runApplyParItems(itemsPendingApply);
  };

  const openApplyDialogForSelected = () => {
    const batch = filteredSuggestions.filter(s => selectedItems.has(s.item_name));
    if (batch.length === 0) {
      toast.error("No items selected.");
      return;
    }
    setItemsPendingApply(batch);
    setApplyDialogOpen(true);
  };

  const openApplyDialogForVisible = () => {
    if (filteredSuggestions.length === 0) {
      toast.error("No suggestions match the current filter.");
      return;
    }
    setItemsPendingApply(filteredSuggestions);
    setApplyDialogOpen(true);
  };

  // ─── Notify with anti-spam ──────────────────────────────────────────────
  const handleNotify = async () => {
    if (!currentRestaurant || !user) return;
    setNotifying(true);

    const fluctuatingCount = suggestions.filter(s => s.is_fluctuating).length;
    const majorCount = suggestions.filter(s => Math.abs(s.change_pct) >= 20).length;
    const totalChanges = suggestions.length;

    // Check anti-spam: was a PAR_SUGGESTIONS notification sent today?
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const { data: recentNotifs } = await supabase
      .from("notifications")
      .select("id")
      .eq("restaurant_id", currentRestaurant.id)
      .eq("type", "PAR_SUGGESTIONS")
      .gte("created_at", todayStart.toISOString())
      .limit(1);

    if (recentNotifs && recentNotifs.length > 0) {
      toast.info("PAR suggestion notification already sent today. Skipping to prevent spam.");
      setNotifying(false);
      return;
    }

    // Check thresholds
    if (fluctuatingCount < 3 && majorCount === 0 && totalChanges < 15) {
      toast.info("No significant changes to notify about (need ≥3 fluctuating, any major change, or ≥15 total).");
      setNotifying(false);
      return;
    }

    // Get recipients
    const { data: prefs } = await supabase
      .from("notification_preferences")
      .select("*, restaurant_id")
      .eq("restaurant_id", currentRestaurant.id);

    const { data: members } = await supabase
      .from("restaurant_members")
      .select("user_id, role")
      .eq("restaurant_id", currentRestaurant.id);

    const pref = prefs?.[0];
    const mode = pref?.recipients_mode ?? "OWNERS_MANAGERS";
    const inAppEnabled = pref?.channel_in_app ?? true;

    if (!inAppEnabled) {
      toast.info("In-app notifications are disabled in Alert Settings.");
      setNotifying(false);
      return;
    }

    const recipientUserIds: string[] = [];
    if (mode === "ALL") {
      // Still exclude STAFF for PAR notifications
      (members || []).forEach(m => {
        if (m.role === "OWNER" || m.role === "MANAGER") recipientUserIds.push(m.user_id);
      });
    } else if (mode === "CUSTOM") {
      // Get custom recipients from alert_recipients
      if (pref) {
        const { data: customRecipients } = await supabase
          .from("alert_recipients")
          .select("user_id")
          .eq("notification_pref_id", pref.id);
        // Filter out STAFF
        const staffIds = new Set((members || []).filter(m => m.role === "STAFF").map(m => m.user_id));
        (customRecipients || []).forEach(cr => {
          if (!staffIds.has(cr.user_id)) recipientUserIds.push(cr.user_id);
        });
      }
    } else {
      // OWNERS_MANAGERS (default)
      (members || []).forEach(m => {
        if (m.role === "OWNER" || m.role === "MANAGER") recipientUserIds.push(m.user_id);
      });
    }

    if (recipientUserIds.length === 0) {
      toast.info("No eligible recipients found.");
      setNotifying(false);
      return;
    }

    const topItems = suggestions.slice(0, 5).map(s => s.item_name);
    const severity: "WARNING" | "INFO" = majorCount > 0 || fluctuatingCount >= 3 ? "WARNING" : "INFO";

    const notifData = {
      list_id: selectedList !== "all" ? selectedList : null,
      location_id: currentLocation?.id || null,
      changed_count: totalChanges,
      fluctuating_count: fluctuatingCount,
      major_count: majorCount,
      top_items: topItems,
    };

    const message = `${totalChanges} item${totalChanges !== 1 ? "s" : ""} updated`
      + (fluctuatingCount > 0 ? ` (${fluctuatingCount} fluctuating` : "")
      + (fluctuatingCount > 0 && majorCount > 0 ? `, ${majorCount} major)` : fluctuatingCount > 0 ? ")" : "")
      + (fluctuatingCount === 0 && majorCount > 0 ? ` (${majorCount} major)` : "")
      + `. Review in PAR Suggestions.`;

    const notifications = recipientUserIds.map(uid => ({
      restaurant_id: currentRestaurant.id,
      user_id: uid,
      type: "PAR_SUGGESTIONS",
      title: "PAR suggestions changed",
      message,
      severity,
      data: notifData,
    }));

    const { error } = await supabase.from("notifications").insert(notifications);
    if (error) {
      toast.error(`Failed to send notifications: ${error.message}`);
    } else {
      toast.success(`Notified ${recipientUserIds.length} team member${recipientUserIds.length !== 1 ? "s" : ""}`);
    }
    setNotifying(false);
  };

  // ─── Selection helpers ──────────────────────────────────────────────────
  const toggleItem = (name: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedItems.size === filteredSuggestions.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(filteredSuggestions.map(s => s.item_name)));
    }
  };

  // ─── Badges ─────────────────────────────────────────────────────────────
  const confidenceBadge = (c: "high" | "medium" | "low") => {
    if (c === "high") return <Badge className="bg-success/15 text-success border-success/30 border text-[10px]">High</Badge>;
    if (c === "medium") return <Badge className="bg-warning/15 text-warning border-warning/30 border text-[10px]">Medium</Badge>;
    return <Badge className="bg-muted text-muted-foreground text-[10px]">Low</Badge>;
  };

  const riskBadge = (risk: string | null) => {
    if (risk === "stockout") return <Badge className="bg-destructive/15 text-destructive border-destructive/30 border text-[10px]">Stockout Risk</Badge>;
    if (risk === "overstock") return <Badge className="bg-warning/15 text-warning border-warning/30 border text-[10px]">Overstock</Badge>;
    if (risk === "missing_par") return <Badge className="bg-primary/15 text-primary border-primary/30 border text-[10px]">Missing PAR</Badge>;
    return null;
  };

  const changeIcon = (amt: number) => {
    if (amt > 0.5) return <TrendingUp className="h-3.5 w-3.5 text-success" />;
    if (amt < -0.5) return <TrendingDown className="h-3.5 w-3.5 text-destructive" />;
    return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
  };

  // ─── Summary metrics ──────────────────────────────────────────────────
  const majorChanges = suggestions.filter(s => Math.abs(s.change_pct) >= 20);
  const stockoutRisks = suggestions.filter(s => s.risk_type === "stockout");
  const overstockRisks = suggestions.filter(s => s.risk_type === "overstock");
  const fluctuatingItems = suggestions.filter(s => s.is_fluctuating);

  // ─── Filter tab buttons ────────────────────────────────────────────────
  const filterOptions: { key: FilterMode; label: string; count: number; icon: any }[] = [
    { key: "all", label: "All", count: suggestions.length, icon: ListFilter },
    { key: "changed", label: "Changed", count: suggestions.filter(s => Math.abs(s.change_pct) >= 10).length, icon: TrendingUp },
    { key: "major", label: "Major", count: majorChanges.length, icon: AlertTriangle },
    { key: "stockout", label: "Stockout Risk", count: stockoutRisks.length, icon: PackageMinus },
    { key: "overstock", label: "Overstock", count: overstockRisks.length, icon: PackageCheck },
    { key: "missing_par", label: "Missing PAR", count: suggestions.filter(s => s.risk_type === "missing_par").length, icon: Sparkles },
  ];

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            PAR AI Suggestions
          </h1>
          <p className="page-description">AI-powered PAR level recommendations based on approved inventory history</p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Inventory List</Label>
              <Select value={selectedList} onValueChange={setSelectedList}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Lists</SelectItem>
                  {lists.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">PAR Guide</Label>
              <Select value={selectedGuide} onValueChange={setSelectedGuide} disabled={selectedList === "all"}>
                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Guides</SelectItem>
                  {parGuides.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button
                onClick={generateSuggestions}
                disabled={loading}
                className="bg-gradient-amber shadow-amber gap-2 w-full sm:w-auto"
                size="sm"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                {loading ? "Analyzing…" : "Generate AI Suggestions"}
              </Button>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground mt-3">
            Uses last 4 approved inventory sessions · Lead time: {parSettings?.default_lead_time_days ?? 2}d (from PAR settings)
          </p>
        </CardContent>
      </Card>

      {/* Loading */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-14 rounded-xl" />)}
        </div>
      )}

      {/* Summary KPIs */}
      {generated && suggestions.length > 0 && !loading && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <BarChart3 className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-lg font-bold leading-tight">{suggestions.length}</p>
                  <p className="text-[11px] text-muted-foreground">Total Suggestions</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-destructive/15">
              <CardContent className="flex items-center gap-3 p-4">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                <div>
                  <p className="text-lg font-bold leading-tight text-destructive">{majorChanges.length}</p>
                  <p className="text-[11px] text-muted-foreground">Major (≥20%)</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-destructive/15">
              <CardContent className="flex items-center gap-3 p-4">
                <PackageMinus className="h-5 w-5 text-destructive" />
                <div>
                  <p className="text-lg font-bold leading-tight text-destructive">{stockoutRisks.length}</p>
                  <p className="text-[11px] text-muted-foreground">Stockout Risk</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-warning/15">
              <CardContent className="flex items-center gap-3 p-4">
                <PackageCheck className="h-5 w-5 text-warning" />
                <div>
                  <p className="text-lg font-bold leading-tight text-warning">{overstockRisks.length}</p>
                  <p className="text-[11px] text-muted-foreground">Overstock Risk</p>
                </div>
              </CardContent>
            </Card>
            <Card className={fluctuatingItems.length > 0 ? "border-warning/15" : ""}>
              <CardContent className="flex items-center gap-3 p-4">
                <Sparkles className={`h-5 w-5 ${fluctuatingItems.length > 0 ? "text-warning" : "text-muted-foreground"}`} />
                <div>
                  <p className="text-lg font-bold leading-tight">{fluctuatingItems.length}</p>
                  <p className="text-[11px] text-muted-foreground">Fluctuating</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Filter tabs */}
          <div className="flex flex-wrap gap-2">
            {filterOptions.map(f => (
              <Button
                key={f.key}
                variant={filterMode === f.key ? "default" : "outline"}
                size="sm"
                className="text-xs gap-1.5 h-8"
                onClick={() => setFilterMode(f.key)}
              >
                <f.icon className="h-3 w-3" />
                {f.label}
                {f.count > 0 && <Badge variant="secondary" className="text-[10px] ml-1 px-1.5 py-0">{f.count}</Badge>}
              </Button>
            ))}
          </div>

          {/* PAR Health (clickable → filter) */}
          <div className="rounded-lg border border-border/80 bg-muted/20 px-3 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">PAR health</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant={filterMode === "missing_par" ? "default" : "outline"}
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={() => setFilterMode("missing_par")}
              >
                Missing PAR
                <Badge variant="secondary" className="text-[10px] tabular-nums">{parHealthCounts.missing}</Badge>
              </Button>
              <Button
                type="button"
                variant={filterMode === "likely_low" ? "default" : "outline"}
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={() => setFilterMode("likely_low")}
              >
                Likely too low
                <Badge variant="secondary" className="text-[10px] tabular-nums">{parHealthCounts.likelyLow}</Badge>
              </Button>
              <Button
                type="button"
                variant={filterMode === "likely_high" ? "default" : "outline"}
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={() => setFilterMode("likely_high")}
              >
                Likely too high
                <Badge variant="secondary" className="text-[10px] tabular-nums">{parHealthCounts.likelyHigh}</Badge>
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">
              Based on current suggestion types (increase / decrease / stockout / overstock / missing — same engine as the table).
            </p>
          </div>

          {/* Action bar */}
          {isManagerPlus && (
            <div className="flex gap-2 flex-wrap items-center">
              <Button
                onClick={openApplyDialogForVisible}
                disabled={filteredSuggestions.length === 0}
                size="sm"
                className="gap-2 text-xs bg-gradient-amber shadow-amber text-primary-foreground"
              >
                <CheckSquare className="h-3.5 w-3.5" />
                Apply visible suggestions ({filteredSuggestions.length})
              </Button>
              <Button
                onClick={openApplyDialogForSelected}
                disabled={selectedItems.size === 0}
                size="sm"
                variant="outline"
                className="gap-2 text-xs"
              >
                <CheckSquare className="h-3.5 w-3.5" />
                Apply selected ({selectedItems.size})
              </Button>
              <Button
                onClick={handleNotify}
                disabled={notifying}
                variant="outline"
                size="sm"
                className="gap-2 text-xs"
              >
                <BellRing className="h-3.5 w-3.5" />
                {notifying ? "Notifying…" : "Notify Team"}
              </Button>
            </div>
          )}

          {/* Mobile: compact cards */}
          {isCompact && (
            <div className="space-y-3 md:hidden">
              {filteredSuggestions.map((s, idx) => (
                <Card key={`m-${s.catalog_item_id ?? ""}:${s.item_name}:${idx}`} className="border-border/80">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-sm leading-snug">{s.item_name}</p>
                        {s.category && <p className="text-[11px] text-muted-foreground">{s.category}{s.unit ? ` · ${s.unit}` : ""}</p>}
                      </div>
                      {riskBadge(s.risk_type)}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <p className="text-[10px] uppercase text-muted-foreground">Current PAR</p>
                        <p className="font-mono tabular-nums">{s.current_par > 0 ? s.current_par : "—"}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase text-primary">Suggested</p>
                        <p className="font-mono font-semibold tabular-nums">{s.suggested_par.toFixed(1)}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="text-muted-foreground">Confidence</span>
                      {confidenceBadge(confidenceTierFromDataPoints(s.data_points))}
                      <span className="text-muted-foreground">· {s.data_points} count snapshots</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-snug line-clamp-3">{s.reason}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{formatWeeklyUsages(s.weekly_usages)}</p>
                    {isManagerPlus && (
                      <div className="flex items-center gap-2 pt-1 border-t border-border/60">
                        <Checkbox
                          checked={selectedItems.has(s.item_name)}
                          onCheckedChange={() => toggleItem(s.item_name)}
                          id={`mob-par-${idx}`}
                        />
                        <label htmlFor={`mob-par-${idx}`} className="text-xs text-muted-foreground">Include in batch apply</label>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
              {filteredSuggestions.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-6">No items match this filter.</p>
              )}
            </div>
          )}

          {/* Suggestions table (desktop / tablet) */}
          <Card className={`overflow-hidden ${isCompact ? "hidden md:block" : ""}`}>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                AI PAR Recommendations
                <Badge variant="secondary" className="text-[10px]">{filteredSuggestions.length} items</Badge>
              </CardTitle>
              {isManagerPlus && selectedItems.size > 0 && (
                <span className="text-[11px] text-muted-foreground">{selectedItems.size} selected</span>
              )}
            </CardHeader>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    {isManagerPlus && (
                      <TableHead className="w-10">
                        <Checkbox
                          checked={selectedItems.size === filteredSuggestions.length && filteredSuggestions.length > 0}
                          onCheckedChange={toggleAll}
                          aria-label="Select all"
                        />
                      </TableHead>
                    )}
                    <TableHead className="text-xs font-semibold">Item</TableHead>
                    <TableHead className="text-xs font-semibold">Category</TableHead>
                    <TableHead className="text-xs font-semibold text-right min-w-[120px]">PAR change</TableHead>
                    <TableHead className="text-xs font-semibold text-center">Change</TableHead>
                    <TableHead className="text-xs font-semibold text-center">Risk</TableHead>
                    <TableHead className="text-xs font-semibold text-center">Confidence</TableHead>
                    <TableHead className="text-xs font-semibold text-center hidden md:table-cell">Data pts</TableHead>
                    <TableHead className="text-xs font-semibold hidden lg:table-cell min-w-[140px]">Weekly usage (est.)</TableHead>
                    <TableHead className="text-xs font-semibold hidden lg:table-cell min-w-[160px]">Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSuggestions.map((s) => (
                    <TableRow
                      key={`${s.catalog_item_id ?? ""}:${s.item_name}`}
                      className={`hover:bg-muted/20 transition-colors ${
                        Math.abs(s.change_pct) >= 20 ? "bg-warning/5" : ""
                      } ${s.risk_type === "stockout" ? "bg-destructive/5" : ""}`}
                    >
                      {isManagerPlus && (
                        <TableCell>
                          <Checkbox
                            checked={selectedItems.has(s.item_name)}
                            onCheckedChange={() => toggleItem(s.item_name)}
                            aria-label={`Select ${s.item_name}`}
                          />
                        </TableCell>
                      )}
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{s.item_name}</span>
                          {s.is_fluctuating && (
                            <Badge className="bg-warning/15 text-warning border-warning/30 border text-[9px] px-1.5">
                              Fluctuating
                            </Badge>
                          )}
                        </div>
                        {s.unit && <span className="text-[10px] text-muted-foreground">{s.unit}</span>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{s.category || "—"}</TableCell>
                      <TableCell className="text-right align-top">
                        <div className="inline-flex flex-col gap-1.5 items-end text-left min-w-[7.5rem]">
                          <div className="rounded-md border border-border/80 bg-muted/30 px-2 py-1.5 w-full">
                            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Current PAR</span>
                            <p className="font-mono text-sm tabular-nums text-muted-foreground">
                              {s.current_par > 0 ? s.current_par : "—"}
                            </p>
                          </div>
                          <div className="rounded-md border border-primary/25 bg-primary/5 px-2 py-1.5 w-full">
                            <span className="text-[10px] font-medium text-primary uppercase tracking-wide">Suggested PAR</span>
                            <p className="font-mono text-sm font-semibold tabular-nums text-foreground">{s.suggested_par.toFixed(1)}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          {changeIcon(s.change_amount)}
                          <span className={`text-xs font-medium ${
                            s.change_amount > 0 ? "text-success" : s.change_amount < 0 ? "text-destructive" : "text-muted-foreground"
                          }`}>
                            {s.change_amount > 0 ? "+" : ""}{s.change_amount.toFixed(1)}
                            {s.current_par > 0 ? ` (${s.change_pct.toFixed(0)}%)` : ""}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex flex-col items-center gap-0.5">
                          {riskBadge(s.risk_type)}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">{confidenceBadge(confidenceTierFromDataPoints(s.data_points))}</TableCell>
                      <TableCell className="text-center text-xs font-mono tabular-nums hidden md:table-cell">
                        {s.data_points}
                      </TableCell>
                      <TableCell className="text-[10px] text-muted-foreground hidden lg:table-cell max-w-[200px] leading-snug">
                        {formatWeeklyUsages(s.weekly_usages)}
                      </TableCell>
                      <TableCell className="text-[11px] text-muted-foreground hidden lg:table-cell max-w-xs leading-snug">
                        {s.reason}
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredSuggestions.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={isManagerPlus ? 10 : 9}
                        className="text-center text-sm text-muted-foreground py-8"
                      >
                        No items match this filter.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </>
      )}

      {/* Empty state after generation */}
      {generated && suggestions.length === 0 && !loading && (
        <Card>
          <CardContent className="empty-state py-16">
            <BarChart3 className="empty-state-icon" />
            <p className="empty-state-title">No significant PAR changes suggested</p>
            <p className="empty-state-description">
              Current PAR levels appear aligned with inventory history. Ensure you have at least 3 approved sessions for better analysis.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Initial state */}
      {!generated && !loading && (
        <Card>
          <CardContent className="empty-state py-16">
            <Sparkles className="empty-state-icon" />
            <p className="empty-state-title">Generate PAR AI Suggestions</p>
            <p className="empty-state-description">
              Select your inventory list and click "Generate AI Suggestions" to analyze your last 4 approved counts and recommend optimal PAR levels.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Apply Confirmation Dialog */}
      <Dialog
        open={applyDialogOpen}
        onOpenChange={(open) => {
          setApplyDialogOpen(open);
          if (!open) setItemsPendingApply([]);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply PAR Changes</DialogTitle>
            <DialogDescription>
              This will update {itemsPendingApply.length} PAR level{itemsPendingApply.length !== 1 ? "s" : ""} in the{" "}
              {selectedGuide !== "all" ? "selected" : "first available"} PAR guide
              {selectedGuide === "all" && selectedList === "all" ? " (a new guide will be created if needed)" : ""}.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-48 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Item</TableHead>
                  <TableHead className="text-xs text-right">Current PAR</TableHead>
                  <TableHead className="text-xs text-right">Suggested PAR</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {itemsPendingApply.map(s => (
                  <TableRow key={`${s.catalog_item_id ?? ""}:${s.item_name}`}>
                    <TableCell className="text-sm">{s.item_name}</TableCell>
                    <TableCell className="text-right">
                      <span className="inline-block rounded-md border border-border/80 bg-muted/30 px-2 py-1 font-mono text-sm tabular-nums text-muted-foreground">
                        {s.current_par > 0 ? s.current_par : "—"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="inline-block rounded-md border border-primary/25 bg-primary/5 px-2 py-1 font-mono text-sm font-semibold tabular-nums">
                        {s.suggested_par.toFixed(1)}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApplyDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleConfirmApply} disabled={applying || itemsPendingApply.length === 0} className="gap-2">
              <CheckSquare className="h-3.5 w-3.5" />
              {applying ? "Applying…" : "Confirm & Apply"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
