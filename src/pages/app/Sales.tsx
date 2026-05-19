import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { addDays, addWeeks, differenceInDays, format, parseISO, startOfWeek, subWeeks } from "date-fns";
import { ChevronLeft, ChevronRight, DollarSign, AlertTriangle, Save, CalendarDays, Clock } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import { weekStartFromDate } from "@/domain/sales/loadSalesForWeek";
import { upsertWeeklySales, upsertDailySales, type SalesOptionalFields } from "@/domain/sales/upsertSales";

type WeekRow = {
  week_start: string;
  gross_sales: number;
  is_partial: boolean;
  entry_method: string;
  entered_at: string;
};

type DailyRow = {
  sale_date: string;
  gross_sales: number;
  entered_at: string;
};

type Mode = "weekly" | "daily";

const MODE_STORAGE_KEY_PREFIX = "salesEntryMode:";
const VARIANCE_THRESHOLD = 0.5;
const EDIT_CONFIRM_DAYS = 7;

function fmtCurrency(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function parseInput(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parseBulk(raw: string): number[] | null {
  const parts = raw.split(/[\s,\t\n]+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length !== 7) return null;
  const nums = parts.map((p) => Number(p.replace(/[$,]/g, "")));
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return nums;
}

export default function SalesPage() {
  const { user } = useAuth();
  const { currentRestaurant, currentLocation, setCurrentLocation, locations } = useRestaurant();
  const role = currentRestaurant?.role;

  // ── Mode persistence ────────────────────────────────────────────────────────
  const modeStorageKey = user ? `${MODE_STORAGE_KEY_PREFIX}${user.id}` : null;
  const [mode, setMode] = useState<Mode>(() => {
    if (typeof window === "undefined" || !modeStorageKey) return "weekly";
    const stored = window.localStorage.getItem(modeStorageKey);
    return stored === "daily" ? "daily" : "weekly";
  });
  useEffect(() => {
    if (!modeStorageKey) return;
    window.localStorage.setItem(modeStorageKey, mode);
  }, [mode, modeStorageKey]);

  // ── Week navigation ─────────────────────────────────────────────────────────
  const [viewingWeek, setViewingWeek] = useState<Date>(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const viewingWeekIso = useMemo(() => weekStartFromDate(viewingWeek), [viewingWeek]);

  // ── Weekly state ────────────────────────────────────────────────────────────
  const [weekHistory, setWeekHistory] = useState<WeekRow[]>([]);
  const [grossInput, setGrossInput] = useState<string>("");
  const [netInput, setNetInput] = useState<string>("");
  const [compsInput, setCompsInput] = useState<string>("");
  const [discountsInput, setDiscountsInput] = useState<string>("");
  const [taxInput, setTaxInput] = useState<string>("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [grossError, setGrossError] = useState<string>("");
  const [savingWeekly, setSavingWeekly] = useState(false);

  // ── Daily state ─────────────────────────────────────────────────────────────
  const [dailyRows, setDailyRows] = useState<DailyRow[]>([]);
  const [dailyInputs, setDailyInputs] = useState<string[]>(["", "", "", "", "", "", ""]);
  const [bulkText, setBulkText] = useState("");
  const [savingDaily, setSavingDaily] = useState(false);

  // ── Audit confirmation ──────────────────────────────────────────────────────
  const [pendingSave, setPendingSave] = useState<{ daysOld: number; onConfirm: () => void } | null>(null);

  // ── Loaders ─────────────────────────────────────────────────────────────────
  const loadWeekHistory = useCallback(async () => {
    if (!currentLocation?.id) return;
    const earliest = format(startOfWeek(subWeeks(new Date(), 7), { weekStartsOn: 1 }), "yyyy-MM-dd");
    const { data, error } = await supabase
      .from("weekly_sales")
      .select("week_start, gross_sales, is_partial, entry_method, entered_at")
      .eq("location_id", currentLocation.id)
      .gte("week_start", earliest)
      .order("week_start", { ascending: false })
      .limit(8);
    if (error) {
      toast.error(`Could not load past sales: ${error.message}`);
      return;
    }
    setWeekHistory(
      (data ?? []).map((row) => ({
        week_start: row.week_start as string,
        gross_sales: Number(row.gross_sales),
        is_partial: Boolean(row.is_partial),
        entry_method: row.entry_method as string,
        entered_at: row.entered_at as string,
      })),
    );
  }, [currentLocation?.id]);

  const loadDailyForWeek = useCallback(async () => {
    if (!currentLocation?.id) return;
    const monday = viewingWeekIso;
    const sunday = format(addDays(parseISO(monday), 6), "yyyy-MM-dd");
    const { data, error } = await supabase
      .from("daily_sales")
      .select("sale_date, gross_sales, entered_at")
      .eq("location_id", currentLocation.id)
      .gte("sale_date", monday)
      .lte("sale_date", sunday)
      .order("sale_date", { ascending: true });
    if (error) {
      toast.error(`Could not load daily sales: ${error.message}`);
      return;
    }
    const rows: DailyRow[] = (data ?? []).map((r) => ({
      sale_date: r.sale_date as string,
      gross_sales: Number(r.gross_sales),
      entered_at: r.entered_at as string,
    }));
    setDailyRows(rows);
    const map = new Map(rows.map((r) => [r.sale_date, r.gross_sales]));
    setDailyInputs(
      Array.from({ length: 7 }, (_, i) => {
        const iso = format(addDays(parseISO(monday), i), "yyyy-MM-dd");
        const v = map.get(iso);
        return v != null ? String(v) : "";
      }),
    );
  }, [currentLocation?.id, viewingWeekIso]);

  // Load on mount + when location/week changes
  useEffect(() => {
    void loadWeekHistory();
  }, [loadWeekHistory]);

  useEffect(() => {
    void loadDailyForWeek();
  }, [loadDailyForWeek]);

  // Sync weekly inputs from history when viewingWeek changes
  useEffect(() => {
    const current = weekHistory.find((w) => w.week_start === viewingWeekIso);
    setGrossInput(current ? String(current.gross_sales) : "");
    setNetInput("");
    setCompsInput("");
    setDiscountsInput("");
    setTaxInput("");
    setGrossError("");
  }, [viewingWeekIso, weekHistory]);

  // ── Permission gates ────────────────────────────────────────────────────────
  if (!currentRestaurant) return <Navigate to="/" replace />;

  if (role !== "OWNER" && role !== "MANAGER") {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <Card>
          <CardContent className="p-6 text-center space-y-2">
            <DollarSign className="h-8 w-8 text-muted-foreground/40 mx-auto" />
            <h2 className="text-lg font-semibold">Sales entry is restricted</h2>
            <p className="text-sm text-muted-foreground">Only Owners and Managers can record sales for this location.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!currentLocation) {
    return (
      <div className="max-w-md mx-auto p-6">
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="text-center space-y-1">
              <CalendarDays className="h-8 w-8 text-muted-foreground/40 mx-auto" />
              <h2 className="text-lg font-semibold">Select a location to enter sales</h2>
              <p className="text-sm text-muted-foreground">Sales are tracked per location.</p>
            </div>
            <Select onValueChange={(id) => setCurrentLocation(locations.find((l) => l.id === id) ?? null)}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a location" />
              </SelectTrigger>
              <SelectContent>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Derived values ──────────────────────────────────────────────────────────
  const currentWeekRow = weekHistory.find((w) => w.week_start === viewingWeekIso) ?? null;
  const priorWeeks = weekHistory.filter((w) => w.week_start < viewingWeekIso).slice(0, 4);
  const priorWeekAvg = priorWeeks.length > 0
    ? priorWeeks.reduce((s, w) => s + w.gross_sales, 0) / priorWeeks.length
    : null;
  const lastWeek = weekHistory.find((w) => w.week_start < viewingWeekIso) ?? null;

  const parsedGross = parseInput(grossInput);
  const varianceHint = (() => {
    if (parsedGross == null || priorWeekAvg == null || priorWeekAvg <= 0) return null;
    const delta = Math.abs(parsedGross - priorWeekAvg) / priorWeekAvg;
    if (delta <= VARIANCE_THRESHOLD) return null;
    return parsedGross > priorWeekAvg ? "much higher" : "much lower";
  })();

  // ── Save handlers ───────────────────────────────────────────────────────────
  const saveWeekly = async () => {
    setGrossError("");
    const gross = parseInput(grossInput);
    if (gross == null || gross < 0) {
      setGrossError("Enter a non-negative number");
      return;
    }
    const optional: SalesOptionalFields = {};
    const net = parseInput(netInput); if (net != null) optional.netSales = net;
    const comps = parseInput(compsInput); if (comps != null) optional.comps = comps;
    const disc = parseInput(discountsInput); if (disc != null) optional.discounts = disc;
    const tax = parseInput(taxInput); if (tax != null) optional.tax = tax;

    const proceed = async () => {
      setSavingWeekly(true);
      const { error } = await upsertWeeklySales({
        supabase,
        restaurantId: currentRestaurant.id,
        locationId: currentLocation.id,
        weekStart: viewingWeekIso,
        enteredByUserId: user!.id,
        grossSales: gross,
        optional: Object.keys(optional).length ? optional : undefined,
      });
      setSavingWeekly(false);
      if (error) { toast.error(error.message); return; }
      toast.success("Sales saved");
      await loadWeekHistory();
    };

    if (currentWeekRow) {
      const daysOld = differenceInDays(new Date(), parseISO(currentWeekRow.entered_at));
      if (daysOld >= EDIT_CONFIRM_DAYS) {
        setPendingSave({ daysOld, onConfirm: proceed });
        return;
      }
    }
    await proceed();
  };

  const handleBulkChange = (raw: string) => {
    setBulkText(raw);
    if (raw.trim() === "") return;
    const nums = parseBulk(raw);
    if (!nums) {
      toast.error("Could not parse — expected 7 numbers");
      return;
    }
    setDailyInputs(nums.map((n) => String(n)));
    toast.success("7 values parsed");
  };

  const saveDaily = async () => {
    const monday = parseISO(viewingWeekIso);
    const dates = Array.from({ length: 7 }, (_, i) => format(addDays(monday, i), "yyyy-MM-dd"));
    const writes: Array<{ date: string; gross: number }> = [];
    for (let i = 0; i < 7; i++) {
      const v = dailyInputs[i].trim();
      if (v === "") continue;
      const n = parseInput(v);
      if (n == null || n < 0) {
        toast.error(`Day ${i + 1}: enter a non-negative number`);
        return;
      }
      writes.push({ date: dates[i], gross: n });
    }
    if (writes.length === 0) {
      toast.error("Enter at least one day to save");
      return;
    }

    const oldEdit = writes.find((w) => {
      const existing = dailyRows.find((r) => r.sale_date === w.date);
      if (!existing) return false;
      return differenceInDays(new Date(), parseISO(existing.entered_at)) >= EDIT_CONFIRM_DAYS;
    });

    const proceed = async () => {
      setSavingDaily(true);
      let firstError: string | null = null;
      for (const w of writes) {
        const { error } = await upsertDailySales({
          supabase,
          restaurantId: currentRestaurant.id,
          locationId: currentLocation.id,
          saleDate: w.date,
          enteredByUserId: user!.id,
          grossSales: w.gross,
        });
        if (error && !firstError) firstError = error.message;
      }
      setSavingDaily(false);
      if (firstError) { toast.error(firstError); return; }
      toast.success(`Saved ${writes.length} day${writes.length === 1 ? "" : "s"}`);
      await Promise.all([loadDailyForWeek(), loadWeekHistory()]);
      setBulkText("");
    };

    if (oldEdit) {
      const existing = dailyRows.find((r) => r.sale_date === oldEdit.date)!;
      const daysOld = differenceInDays(new Date(), parseISO(existing.entered_at));
      setPendingSave({ daysOld, onConfirm: proceed });
      return;
    }
    await proceed();
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  const chartData = [...weekHistory]
    .sort((a, b) => a.week_start.localeCompare(b.week_start))
    .map((w) => ({ label: format(parseISO(w.week_start), "MMM d"), value: w.gross_sales }));

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold">Sales Entry</h1>
          <p className="text-sm text-muted-foreground">{currentLocation.name}</p>
        </div>
      </div>

      <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
        <TabsList>
          <TabsTrigger value="weekly">Weekly</TabsTrigger>
          <TabsTrigger value="daily">Daily</TabsTrigger>
        </TabsList>

        {/* ── Weekly ────────────────────────────────────────────────────────── */}
        <TabsContent value="weekly" className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-base">Week of {format(parseISO(viewingWeekIso), "MMM d, yyyy")}</CardTitle>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" onClick={() => setViewingWeek(subWeeks(viewingWeek, 1))} aria-label="Previous week"><ChevronLeft className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" onClick={() => setViewingWeek(addWeeks(viewingWeek, 1))} aria-label="Next week" disabled={viewingWeekIso >= weekStartFromDate(new Date())}><ChevronRight className="h-4 w-4" /></Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="gross">Gross sales</Label>
                <Input
                  id="gross"
                  type="number"
                  min={0}
                  step={0.01}
                  value={grossInput}
                  onChange={(e) => { setGrossInput(e.target.value); setGrossError(""); }}
                  placeholder={lastWeek ? `Last week: ${fmtCurrency(lastWeek.gross_sales)}` : "0.00"}
                />
                {grossError && <p className="text-xs text-destructive">{grossError}</p>}
                {varianceHint && (
                  <p className="text-xs text-warning flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    This is {varianceHint} than your usual ({fmtCurrency(priorWeekAvg)}).
                  </p>
                )}
                {currentWeekRow?.is_partial && (
                  <Badge variant="outline" className="text-xs">Partial week — built from daily entries</Badge>
                )}
              </div>

              <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="p-0 h-auto text-xs text-muted-foreground hover:bg-transparent">
                    {detailsOpen ? "Hide" : "Show"} optional details (comps, discounts, tax, net sales)
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="grid grid-cols-2 gap-3 pt-3">
                  <div className="space-y-1"><Label htmlFor="comps" className="text-xs">Comps</Label><Input id="comps" type="number" min={0} step={0.01} value={compsInput} onChange={(e) => setCompsInput(e.target.value)} /></div>
                  <div className="space-y-1"><Label htmlFor="discounts" className="text-xs">Discounts</Label><Input id="discounts" type="number" min={0} step={0.01} value={discountsInput} onChange={(e) => setDiscountsInput(e.target.value)} /></div>
                  <div className="space-y-1"><Label htmlFor="tax" className="text-xs">Tax</Label><Input id="tax" type="number" min={0} step={0.01} value={taxInput} onChange={(e) => setTaxInput(e.target.value)} /></div>
                  <div className="space-y-1"><Label htmlFor="net" className="text-xs">Net sales</Label><Input id="net" type="number" min={0} step={0.01} value={netInput} onChange={(e) => setNetInput(e.target.value)} /></div>
                </CollapsibleContent>
              </Collapsible>

              <div className="flex justify-end">
                <Button onClick={saveWeekly} disabled={savingWeekly}>
                  <Save className="h-4 w-4 mr-1.5" />
                  {savingWeekly ? "Saving…" : "Save"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Past 8 weeks</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2 overflow-x-auto pb-2">
                {weekHistory.map((w) => {
                  const isCurrent = w.week_start === viewingWeekIso;
                  return (
                    <button
                      key={w.week_start}
                      onClick={() => setViewingWeek(parseISO(w.week_start))}
                      className={`flex-shrink-0 text-left rounded-md border px-3 py-2 transition-colors ${isCurrent ? "border-primary bg-primary/5" : "border-border/60 hover:border-border"}`}
                    >
                      <div className="text-[11px] text-muted-foreground">{format(parseISO(w.week_start), "MMM d")}</div>
                      <div className="text-sm font-semibold">{fmtCurrency(w.gross_sales)}</div>
                      {w.is_partial && <div className="text-[10px] text-warning">partial</div>}
                    </button>
                  );
                })}
                {weekHistory.length === 0 && <p className="text-sm text-muted-foreground py-3">No history yet.</p>}
              </div>
              {chartData.length >= 2 && (
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                      <XAxis dataKey="label" fontSize={11} stroke="hsl(var(--muted-foreground))" />
                      <YAxis fontSize={11} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => fmtCurrency(v)} width={60} />
                      <Tooltip formatter={(v: number) => fmtCurrency(v)} />
                      <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Daily ─────────────────────────────────────────────────────────── */}
        <TabsContent value="daily" className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-base">Week of {format(parseISO(viewingWeekIso), "MMM d, yyyy")}</CardTitle>
              <div className="flex items-center gap-1">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm"><CalendarDays className="h-4 w-4 mr-1.5" />Jump to week</Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={viewingWeek}
                      onSelect={(d) => d && setViewingWeek(startOfWeek(d, { weekStartsOn: 1 }))}
                    />
                  </PopoverContent>
                </Popover>
                <Button variant="ghost" size="icon" onClick={() => setViewingWeek(subWeeks(viewingWeek, 1))} aria-label="Previous week"><ChevronLeft className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" onClick={() => setViewingWeek(addWeeks(viewingWeek, 1))} aria-label="Next week" disabled={viewingWeekIso >= weekStartFromDate(new Date())}><ChevronRight className="h-4 w-4" /></Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="bulk" className="text-xs">Paste 7 numbers from a spreadsheet (comma, tab, space, or newline separated)</Label>
                <Textarea
                  id="bulk"
                  rows={2}
                  value={bulkText}
                  onChange={(e) => handleBulkChange(e.target.value)}
                  placeholder="e.g. 1200, 1450, 1300, 1500, 2100, 2800, 1900"
                />
              </div>
              <div className="grid grid-cols-7 gap-2">
                {Array.from({ length: 7 }, (_, i) => {
                  const date = addDays(parseISO(viewingWeekIso), i);
                  const dayLabel = format(date, "EEE");
                  const dateLabel = format(date, "MMM d");
                  return (
                    <div key={i} className="space-y-1">
                      <div className="text-center">
                        <div className="text-[11px] font-medium text-muted-foreground">{dayLabel}</div>
                        <div className="text-[10px] text-muted-foreground/60">{dateLabel}</div>
                      </div>
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        value={dailyInputs[i]}
                        onChange={(e) => {
                          const next = [...dailyInputs];
                          next[i] = e.target.value;
                          setDailyInputs(next);
                        }}
                        className="text-center"
                      />
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-end">
                <Button onClick={saveDaily} disabled={savingDaily}>
                  <Save className="h-4 w-4 mr-1.5" />
                  {savingDaily ? "Saving…" : "Save week"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AlertDialog open={!!pendingSave} onOpenChange={(o) => !o && setPendingSave(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><Clock className="h-4 w-4" /> Editing an older entry</AlertDialogTitle>
            <AlertDialogDescription>
              This entry was created {pendingSave?.daysOld} day{pendingSave?.daysOld === 1 ? "" : "s"} ago. Edits will be logged. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingSave(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const fn = pendingSave?.onConfirm;
                setPendingSave(null);
                fn?.();
              }}
            >
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
