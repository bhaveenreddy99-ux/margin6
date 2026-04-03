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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Trash2, Clock, Pencil } from "lucide-react";

const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const RECIPIENTS_LABELS: Record<string, string> = {
  OWNERS_MANAGERS: "Owners & Managers",
  ALL: "All Members",
  CUSTOM: "Custom",
};

export default function ReminderSettingsPage() {
  const { currentRestaurant } = useRestaurant();
  const { user } = useAuth();
  const [reminders, setReminders] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    days_of_week: ["MON", "WED", "FRI"] as string[],
    time_of_day: "21:00",
    timezone: "America/New_York",
    is_enabled: true,
    recipients_mode: "OWNERS_MANAGERS" as "OWNERS_MANAGERS" | "ALL" | "CUSTOM",
    target_user_ids: [] as string[],
  });

  const isManager = currentRestaurant?.role === "OWNER" || currentRestaurant?.role === "MANAGER";

  const fetchAll = useCallback(async () => {
    if (!currentRestaurant) return;
    const [{ data: r }, { data: m }] = await Promise.all([
      supabase.from("reminders").select("*, reminder_targets(user_id)").eq("restaurant_id", currentRestaurant.id),
      supabase.from("restaurant_members").select("user_id, role, profiles(email, full_name)").eq("restaurant_id", currentRestaurant.id),
    ]);
    if (r) setReminders(r);
    if (m) setMembers(m);
  }, [currentRestaurant]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const resetForm = () => {
    setForm({ name: "", days_of_week: ["MON", "WED", "FRI"], time_of_day: "21:00", timezone: "America/New_York", is_enabled: true, recipients_mode: "OWNERS_MANAGERS", target_user_ids: [] });
    setEditId(null);
  };

  const handleSave = async () => {
    if (!currentRestaurant || !user || !form.name.trim()) { toast.error("Name is required"); return; }
    if (editId) {
      await supabase.from("reminders").update({
        name: form.name, days_of_week: form.days_of_week, time_of_day: form.time_of_day,
        timezone: form.timezone, is_enabled: form.is_enabled, recipients_mode: form.recipients_mode,
      }).eq("id", editId);
      // Update targets for CUSTOM mode
      await supabase.from("reminder_targets").delete().eq("reminder_id", editId);
      if (form.recipients_mode === "CUSTOM" && form.target_user_ids.length > 0) {
        await supabase.from("reminder_targets").insert(form.target_user_ids.map(uid => ({ reminder_id: editId, user_id: uid })));
      }
      toast.success("Reminder updated");
    } else {
      const { data } = await supabase.from("reminders").insert({
        restaurant_id: currentRestaurant.id, created_by: user.id, name: form.name,
        days_of_week: form.days_of_week, time_of_day: form.time_of_day, timezone: form.timezone,
        is_enabled: form.is_enabled, recipients_mode: form.recipients_mode,
      }).select("id").single();
      if (data && form.recipients_mode === "CUSTOM" && form.target_user_ids.length > 0) {
        await supabase.from("reminder_targets").insert(form.target_user_ids.map(uid => ({ reminder_id: data.id, user_id: uid })));
      }
      toast.success("Reminder created");
    }
    resetForm(); setOpen(false); fetchAll();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this reminder?")) return;
    await supabase.from("reminders").delete().eq("id", id);
    toast.success("Reminder deleted"); fetchAll();
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    await supabase.from("reminders").update({ is_enabled: !enabled }).eq("id", id);
    fetchAll();
  };

  const toggleDay = (day: string) => {
    setForm(p => ({ ...p, days_of_week: p.days_of_week.includes(day) ? p.days_of_week.filter(d => d !== day) : [...p.days_of_week, day] }));
  };

  const toggleTarget = (uid: string) => {
    setForm(p => ({ ...p, target_user_ids: p.target_user_ids.includes(uid) ? p.target_user_ids.filter(u => u !== uid) : [...p.target_user_ids, uid] }));
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Inventory Reminders</h1>
          <p className="page-description">Schedule inventory entry reminders for your team</p>
        </div>
        {isManager && (
          <Button size="sm" className="bg-gradient-amber shadow-amber gap-1.5" onClick={() => { resetForm(); setOpen(true); }}>
            <Plus className="h-3.5 w-3.5" /> Add Reminder
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="pt-6">
          {reminders.length === 0 ? (
            <div className="empty-state py-12">
              <Clock className="empty-state-icon h-8 w-8" />
              <p className="empty-state-title">No reminders set</p>
              <p className="empty-state-description">Create a reminder to notify staff when it's time to enter inventory.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="text-xs font-semibold">Name</TableHead>
                  <TableHead className="text-xs font-semibold">Schedule</TableHead>
                  <TableHead className="text-xs font-semibold">Time</TableHead>
                  <TableHead className="text-xs font-semibold">Recipients</TableHead>
                  <TableHead className="text-xs font-semibold">Status</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reminders.map((r: any) => (
                  <TableRow key={r.id} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="font-medium text-sm">{r.name}</TableCell>
                    <TableCell className="text-sm">
                      <div className="flex gap-1 flex-wrap">
                        {(r.days_of_week as string[])?.map((d: string) => (
                          <Badge key={d} variant="secondary" className="text-[10px]">{d}</Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm font-mono">{r.time_of_day}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {RECIPIENTS_LABELS[(r as any).recipients_mode] || "Owners & Managers"}
                      {(r as any).recipients_mode === "CUSTOM" && ` (${r.reminder_targets?.length || 0})`}
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.is_enabled ? "default" : "secondary"} className="text-[10px]">
                        {r.is_enabled ? "Active" : "Paused"}
                      </Badge>
                    </TableCell>
                    <TableCell className="flex gap-1">
                      {isManager && (
                        <>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => {
                            setEditId(r.id);
                            setForm({
                              name: r.name,
                              days_of_week: r.days_of_week || [],
                              time_of_day: r.time_of_day,
                              timezone: r.timezone,
                              is_enabled: r.is_enabled,
                              recipients_mode: (r as any).recipients_mode || "OWNERS_MANAGERS",
                              target_user_ids: r.reminder_targets?.map((t: any) => t.user_id) || [],
                            });
                            setOpen(true);
                          }}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => handleToggle(r.id, r.is_enabled)}>
                            <Switch checked={r.is_enabled} className="scale-75" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => handleDelete(r.id)}>
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={v => { if (!v) resetForm(); setOpen(v); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editId ? "Edit Reminder" : "New Reminder"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5"><Label className="text-xs">Name *</Label><Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Evening Count" className="h-9" /></div>
            <div className="space-y-1.5">
              <Label className="text-xs">Days of Week</Label>
              <div className="flex gap-1.5 flex-wrap">
                {DAYS.map(d => (
                  <Badge key={d} variant={form.days_of_week.includes(d) ? "default" : "outline"} className="cursor-pointer text-xs" onClick={() => toggleDay(d)}>{d}</Badge>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-xs">Time</Label><Input type="time" value={form.time_of_day} onChange={e => setForm(p => ({ ...p, time_of_day: e.target.value }))} className="h-9" /></div>
              <div className="space-y-1.5"><Label className="text-xs">Timezone</Label>
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
            <div className="space-y-1.5">
              <Label className="text-xs">Recipients</Label>
              <Select
                value={form.recipients_mode}
                onValueChange={(v: "OWNERS_MANAGERS" | "ALL" | "CUSTOM") => setForm(p => ({ ...p, recipients_mode: v }))}
              >
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="OWNERS_MANAGERS">Owners &amp; Managers only</SelectItem>
                  <SelectItem value="ALL">All team members (incl. Staff)</SelectItem>
                  <SelectItem value="CUSTOM">Custom selection</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.recipients_mode === "CUSTOM" && (
              <div className="space-y-1.5">
                <Label className="text-xs">Select users</Label>
                <div className="space-y-1 max-h-32 overflow-y-auto border rounded-md p-2">
                  {members.map((m: any) => (
                    <label key={m.user_id} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-muted/50 cursor-pointer">
                      <Checkbox
                        checked={form.target_user_ids.includes(m.user_id)}
                        onCheckedChange={() => toggleTarget(m.user_id)}
                      />
                      <span className="text-xs">{m.profiles?.full_name || m.profiles?.email}</span>
                      <Badge variant="secondary" className="text-[9px] ml-auto">{m.role}</Badge>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter><Button onClick={handleSave} className="bg-gradient-amber shadow-amber">{editId ? "Update" : "Create Reminder"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
