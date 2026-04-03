import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Trash2, CalendarClock, Pencil, Pause, Play, MapPin, Clock, Repeat } from "lucide-react";

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const DAY_LABELS: Record<string, string> = { MON: "Mon", TUE: "Tue", WED: "Wed", THU: "Thu", FRI: "Fri", SAT: "Sat", SUN: "Sun" };
const TZ_LABELS: Record<string, string> = {
  "America/New_York": "Eastern",
  "America/Chicago": "Central",
  "America/Denver": "Mountain",
  "America/Los_Angeles": "Pacific",
};

const BLANK_FORM = {
  name: "",
  inventory_list_id: "",
  location_id: "",
  recurrence_type: "weekly" as "weekly" | "twice_weekly" | "monthly",
  days_of_week: ["MON"] as string[],
  monthly_day: 1,
  time_of_day: "09:00",
  timezone: "America/New_York",
  is_enabled: true,
  recipients_mode: "OWNERS_MANAGERS" as "OWNERS_MANAGERS" | "ALL" | "CUSTOM",
  target_user_ids: [] as string[],
  auto_create_session: false,
  reminder_lead_minutes: 60,
  lock_after_hours: null as number | null,
};

function formatRecurrence(schedule: any): string {
  const days: string[] = schedule.days_of_week || [];
  const monthlyDay = days.find((d: string) => d.startsWith("MONTHLY_"));
  if (monthlyDay) {
    const day = parseInt(monthlyDay.split("_")[1]);
    return `Monthly on the ${day}${day === 1 ? "st" : day === 2 ? "nd" : day === 3 ? "rd" : "th"}`;
  }
  if (days.length === 1) return `Weekly · ${DAY_LABELS[days[0]] || days[0]}`;
  if (days.length === 2) return `Twice weekly · ${days.map(d => DAY_LABELS[d] || d).join(" & ")}`;
  return days.map(d => DAY_LABELS[d] || d).join(", ");
}

function formatTime(timeStr: string, tz: string): string {
  try {
    const [h, m] = timeStr.split(":").map(Number);
    const date = new Date();
    date.setHours(h, m, 0, 0);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + " " + (TZ_LABELS[tz]?.slice(0, 3) || tz);
  } catch {
    return timeStr;
  }
}

export function InventoryScheduleSection({ restaurantId, isManager }: { restaurantId?: string; isManager: boolean }) {
  const { user } = useAuth();
  const [schedules, setSchedules] = useState<any[]>([]);
  const [lists, setLists] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ ...BLANK_FORM });

  const fetchAll = useCallback(async () => {
    if (!restaurantId) return;
    const [{ data: s }, { data: l }, { data: loc }, { data: m }] = await Promise.all([
      supabase
        .from("reminders")
        .select("*, reminder_targets(user_id), inventory_lists(name), locations(name)")
        .eq("restaurant_id", restaurantId)
        .not("inventory_list_id", "is", null)
        .order("created_at", { ascending: false }),
      supabase.from("inventory_lists").select("id, name").eq("restaurant_id", restaurantId),
      supabase.from("locations").select("id, name").eq("restaurant_id", restaurantId).eq("is_active", true),
      supabase.from("restaurant_members").select("user_id, role, profiles(email, full_name)").eq("restaurant_id", restaurantId),
    ]);
    if (s) setSchedules(s);
    if (l) setLists(l);
    if (loc) setLocations(loc);
    if (m) setMembers(m);
  }, [restaurantId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const resetForm = () => { setForm({ ...BLANK_FORM }); setEditId(null); };

  const getDaysOfWeek = (): string[] => {
    if (form.recurrence_type === "monthly") return [`MONTHLY_${form.monthly_day}`];
    return form.days_of_week;
  };

  const toggleDay = (day: string) => {
    const maxDays = form.recurrence_type === "weekly" ? 1 : 2;
    setForm(p => {
      if (p.days_of_week.includes(day)) {
        return { ...p, days_of_week: p.days_of_week.filter(d => d !== day) };
      }
      if (p.days_of_week.length >= maxDays) {
        return { ...p, days_of_week: [...p.days_of_week.slice(1), day] };
      }
      return { ...p, days_of_week: [...p.days_of_week, day] };
    });
  };

  const toggleTarget = (uid: string) => {
    setForm(p => ({ ...p, target_user_ids: p.target_user_ids.includes(uid) ? p.target_user_ids.filter(u => u !== uid) : [...p.target_user_ids, uid] }));
  };

  const handleSave = async () => {
    if (!restaurantId || !user || !form.name.trim()) { toast.error("Schedule name is required"); return; }
    if (!form.inventory_list_id) { toast.error("Please select an inventory list"); return; }
    if (form.recurrence_type !== "monthly" && form.days_of_week.length === 0) { toast.error("Select at least one day"); return; }

    setSaving(true);
    const payload = {
      name: form.name,
      inventory_list_id: form.inventory_list_id,
      location_id: form.location_id || null,
      days_of_week: getDaysOfWeek(),
      time_of_day: form.time_of_day,
      timezone: form.timezone,
      is_enabled: form.is_enabled,
      recipients_mode: form.recipients_mode,
      auto_create_session: form.auto_create_session,
      reminder_lead_minutes: form.reminder_lead_minutes,
      lock_after_hours: form.lock_after_hours || null,
    };

    let reminderId = editId;
    if (editId) {
      const { error } = await supabase.from("reminders").update(payload).eq("id", editId);
      if (error) { toast.error("Failed to update schedule"); setSaving(false); return; }
    } else {
      const { data, error } = await supabase.from("reminders").insert({
        ...payload,
        restaurant_id: restaurantId,
        created_by: user.id,
      }).select("id").single();
      if (error || !data) { toast.error("Failed to create schedule"); setSaving(false); return; }
      reminderId = data.id;
    }

    // Update reminder_targets
    if (reminderId) {
      await supabase.from("reminder_targets").delete().eq("reminder_id", reminderId);
      if (form.recipients_mode === "CUSTOM" && form.target_user_ids.length > 0) {
        await supabase.from("reminder_targets").insert(form.target_user_ids.map(uid => ({ reminder_id: reminderId!, user_id: uid })));
      }
    }

    toast.success(editId ? "Schedule updated" : "Schedule created");
    setSaving(false);
    resetForm();
    setOpen(false);
    fetchAll();
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    await supabase.from("reminders").update({ is_enabled: !enabled }).eq("id", id);
    fetchAll();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this schedule? Existing sessions won't be affected.")) return;
    await supabase.from("reminder_targets").delete().eq("reminder_id", id);
    await supabase.from("reminders").delete().eq("id", id);
    toast.success("Schedule deleted");
    fetchAll();
  };

  const openEdit = (s: any) => {
    const days: string[] = s.days_of_week || [];
    const monthlyDay = days.find((d: string) => d.startsWith("MONTHLY_"));
    setEditId(s.id);
    setForm({
      name: s.name,
      inventory_list_id: s.inventory_list_id || "",
      location_id: s.location_id || "",
      recurrence_type: monthlyDay ? "monthly" : days.length <= 1 ? "weekly" : "twice_weekly",
      days_of_week: monthlyDay ? ["MON"] : days,
      monthly_day: monthlyDay ? parseInt(monthlyDay.split("_")[1]) : 1,
      time_of_day: s.time_of_day || "09:00",
      timezone: s.timezone || "America/New_York",
      is_enabled: s.is_enabled,
      recipients_mode: s.recipients_mode || "OWNERS_MANAGERS",
      target_user_ids: s.reminder_targets?.map((t: any) => t.user_id) || [],
      auto_create_session: s.auto_create_session ?? false,
      reminder_lead_minutes: s.reminder_lead_minutes ?? 60,
      lock_after_hours: s.lock_after_hours ?? null,
    });
    setOpen(true);
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Inventory Schedules</h1>
          <p className="page-description">Automate recurring inventory counts with smart scheduling</p>
        </div>
        {isManager && (
          <Button size="sm" className="bg-gradient-amber shadow-amber gap-1.5" onClick={() => { resetForm(); setOpen(true); }}>
            <Plus className="h-3.5 w-3.5" /> Create Schedule
          </Button>
        )}
      </div>

      {schedules.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <CalendarClock className="h-10 w-10 text-muted-foreground/25 mx-auto mb-4" />
            <p className="text-sm font-semibold text-muted-foreground">No inventory schedules</p>
            <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs mx-auto">Create a schedule to automate recurring inventory counts for your team and get notified automatically.</p>
            {isManager && (
              <Button size="sm" className="bg-gradient-amber shadow-amber gap-1.5 mt-4" onClick={() => { resetForm(); setOpen(true); }}>
                <Plus className="h-3.5 w-3.5" /> Create Schedule
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {schedules.map(s => (
            <Card key={s.id} className={`border shadow-sm transition-opacity ${s.is_enabled ? "" : "opacity-60"}`}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-sm font-semibold truncate">{s.name}</CardTitle>
                      <Badge
                        className={`text-[10px] border shrink-0 ${s.is_enabled ? "bg-success/10 text-success border-success/30" : "bg-muted/60 text-muted-foreground border-border"}`}
                      >
                        {s.is_enabled ? "Active" : "Paused"}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      {s.inventory_lists?.name || "—"}
                      {s.locations?.name ? ` · ${s.locations.name}` : ""}
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                <div className="flex flex-col gap-1.5 text-[11px] text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <Repeat className="h-3 w-3 shrink-0" />
                    <span>{formatRecurrence(s)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3 w-3 shrink-0" />
                    <span>{formatTime(s.time_of_day, s.timezone)}</span>
                  </div>
                  {s.location_id && s.locations?.name && (
                    <div className="flex items-center gap-1.5">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span>{s.locations.name}</span>
                    </div>
                  )}
                </div>
                <div className="flex gap-1.5 flex-wrap mt-1">
                  {s.auto_create_session && (
                    <Badge variant="secondary" className="text-[10px]">Auto-session</Badge>
                  )}
                  {s.reminder_lead_minutes > 0 && (
                    <Badge variant="secondary" className="text-[10px]">
                      Remind {s.reminder_lead_minutes >= 60 ? `${Math.floor(s.reminder_lead_minutes / 60)}h` : `${s.reminder_lead_minutes}m`} before
                    </Badge>
                  )}
                  {s.lock_after_hours && (
                    <Badge variant="secondary" className="text-[10px]">Lock after {s.lock_after_hours}h</Badge>
                  )}
                </div>
                {isManager && (
                  <div className="flex gap-1.5 pt-1">
                    <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={() => openEdit(s)}>
                      <Pencil className="h-3 w-3" /> Edit
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={() => handleToggle(s.id, s.is_enabled)}>
                      {s.is_enabled ? <><Pause className="h-3 w-3" /> Pause</> : <><Play className="h-3 w-3" /> Resume</>}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 gap-1 text-[11px] text-destructive hover:text-destructive ml-auto" onClick={() => handleDelete(s.id)}>
                      <Trash2 className="h-3 w-3" /> Delete
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={open} onOpenChange={v => { if (!v) resetForm(); setOpen(v); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? "Edit Schedule" : "Create Inventory Schedule"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            {/* Section 1: Basic Info */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Basic Info</p>
              <div className="space-y-1.5">
                <Label className="text-xs">Schedule Name *</Label>
                <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Weekly Count – Main Kitchen" className="h-9" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Inventory List *</Label>
                  <Select value={form.inventory_list_id} onValueChange={v => setForm(p => ({ ...p, inventory_list_id: v }))}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Select list" /></SelectTrigger>
                    <SelectContent>
                      {lists.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Location (optional)</Label>
                  <Select value={form.location_id || "none"} onValueChange={v => setForm(p => ({ ...p, location_id: v === "none" ? "" : v }))}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Any location" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Any location</SelectItem>
                      {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Section 2: Recurrence */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Recurrence</p>
              <div className="flex gap-1.5">
                {(["weekly", "twice_weekly", "monthly"] as const).map(rt => (
                  <button
                    key={rt}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border ${form.recurrence_type === rt ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border hover:bg-muted/50"}`}
                    onClick={() => {
                      setForm(p => ({
                        ...p,
                        recurrence_type: rt,
                        days_of_week: rt === "weekly" ? [p.days_of_week[0] || "MON"] : rt === "twice_weekly" ? p.days_of_week.slice(0, 2) : p.days_of_week,
                      }));
                    }}
                  >
                    {rt === "weekly" ? "Weekly" : rt === "twice_weekly" ? "Twice Weekly" : "Monthly"}
                  </button>
                ))}
              </div>

              {form.recurrence_type !== "monthly" ? (
                <div className="space-y-1.5">
                  <Label className="text-xs">Day{form.recurrence_type === "twice_weekly" ? "s" : ""} of Week {form.recurrence_type === "twice_weekly" ? "(pick 2)" : ""}</Label>
                  <div className="flex gap-1.5 flex-wrap">
                    {DAYS.map(d => (
                      <button
                        key={d}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${form.days_of_week.includes(d) ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border hover:bg-muted/50"}`}
                        onClick={() => toggleDay(d)}
                      >
                        {DAY_LABELS[d]}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label className="text-xs">Day of Month (1–31)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    value={form.monthly_day}
                    onChange={e => setForm(p => ({ ...p, monthly_day: Math.min(31, Math.max(1, parseInt(e.target.value) || 1)) }))}
                    className="h-9 w-24"
                  />
                </div>
              )}
            </div>

            {/* Section 3: Time */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Time</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Time of Day</Label>
                  <Input type="time" value={form.time_of_day} onChange={e => setForm(p => ({ ...p, time_of_day: e.target.value }))} className="h-9" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Timezone</Label>
                  <Select value={form.timezone} onValueChange={v => setForm(p => ({ ...p, timezone: v }))}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="America/New_York">Eastern</SelectItem>
                      <SelectItem value="America/Chicago">Central</SelectItem>
                      <SelectItem value="America/Denver">Mountain</SelectItem>
                      <SelectItem value="America/Los_Angeles">Pacific</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Section 4: Recipients */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Notify</p>
              <div className="space-y-1.5">
                <Label className="text-xs">Recipients</Label>
                <Select value={form.recipients_mode} onValueChange={(v: "OWNERS_MANAGERS" | "ALL" | "CUSTOM") => setForm(p => ({ ...p, recipients_mode: v }))}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="OWNERS_MANAGERS">Owners & Managers only</SelectItem>
                    <SelectItem value="ALL">All team members (incl. Staff)</SelectItem>
                    <SelectItem value="CUSTOM">Custom selection</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.recipients_mode === "CUSTOM" && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Select users</Label>
                  <div className="space-y-1 max-h-28 overflow-y-auto border rounded-md p-2">
                    {members.map((m: any) => (
                      <label key={m.user_id} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-muted/50 cursor-pointer">
                        <Checkbox checked={form.target_user_ids.includes(m.user_id)} onCheckedChange={() => toggleTarget(m.user_id)} />
                        <span className="text-xs flex-1 truncate">{m.profiles?.full_name || m.profiles?.email}</span>
                        <Badge variant="secondary" className="text-[9px]">{m.role}</Badge>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Section 5: Automation */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Automation</p>

              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="text-xs font-medium">Auto-create inventory session</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Automatically start a count session when the schedule triggers</p>
                </div>
                <Switch checked={form.auto_create_session} onCheckedChange={v => setForm(p => ({ ...p, auto_create_session: v }))} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Reminder before start</Label>
                  <Select value={String(form.reminder_lead_minutes)} onValueChange={v => setForm(p => ({ ...p, reminder_lead_minutes: parseInt(v) }))}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">No reminder</SelectItem>
                      <SelectItem value="60">1 hour before</SelectItem>
                      <SelectItem value="120">2 hours before</SelectItem>
                      <SelectItem value="240">4 hours before</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.auto_create_session && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Mark overdue after (hours)</Label>
                    <Input
                      type="number"
                      min={1}
                      max={48}
                      placeholder="e.g. 4"
                      value={form.lock_after_hours ?? ""}
                      onChange={e => setForm(p => ({ ...p, lock_after_hours: e.target.value ? parseInt(e.target.value) : null }))}
                      className="h-9"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => { resetForm(); setOpen(false); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} className="bg-gradient-amber shadow-amber">
              {saving ? "Saving…" : editId ? "Update Schedule" : "Create Schedule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function InventorySchedulePage() {
  const { currentRestaurant } = useRestaurant();
  const isManager = currentRestaurant?.role === "OWNER" || currentRestaurant?.role === "MANAGER";

  return <InventoryScheduleSection restaurantId={currentRestaurant?.id} isManager={isManager} />;
}
