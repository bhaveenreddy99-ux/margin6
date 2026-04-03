import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

export default function AlertSettingsPage() {
  const { currentRestaurant } = useRestaurant();
  const { user } = useAuth();
  const [form, setForm] = useState({
    channel_in_app: true,
    channel_email: true,
    email_digest_mode: "IMMEDIATE" as "IMMEDIATE" | "DAILY_DIGEST",
    digest_hour: 8,
    timezone: "America/New_York",
    low_stock_red: true,
    low_stock_yellow: false,
    recipients_mode: "OWNERS_MANAGERS" as "OWNERS_MANAGERS" | "ALL" | "CUSTOM",
    custom_user_ids: [] as string[],
  });
  const [saving, setSaving] = useState(false);
  const [prefId, setPrefId] = useState<string | null>(null);
  const [members, setMembers] = useState<any[]>([]);

  useEffect(() => {
    if (!currentRestaurant || !user) return;
    Promise.all([
      supabase
        .from("notification_preferences")
        .select("*, alert_recipients(user_id)")
        .eq("restaurant_id", currentRestaurant.id)
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("restaurant_members")
        .select("user_id, role, profiles(email, full_name)")
        .eq("restaurant_id", currentRestaurant.id),
    ]).then(([{ data: pref }, { data: m }]) => {
      if (pref) {
        setPrefId(pref.id);
        setForm({
          channel_in_app: pref.channel_in_app,
          channel_email: pref.channel_email,
          email_digest_mode: pref.email_digest_mode,
          digest_hour: pref.digest_hour,
          timezone: pref.timezone,
          low_stock_red: pref.low_stock_red,
          low_stock_yellow: pref.low_stock_yellow,
          recipients_mode: (pref as any).recipients_mode || "OWNERS_MANAGERS",
          custom_user_ids: (pref as any).alert_recipients?.map((r: any) => r.user_id) || [],
        });
      }
      if (m) setMembers(m);
    });
  }, [currentRestaurant, user]);

  const toggleCustomUser = (uid: string) => {
    setForm(p => ({
      ...p,
      custom_user_ids: p.custom_user_ids.includes(uid)
        ? p.custom_user_ids.filter(u => u !== uid)
        : [...p.custom_user_ids, uid],
    }));
  };

  const handleSave = async () => {
    if (!currentRestaurant || !user) return;
    setSaving(true);
    const payload = {
      channel_in_app: form.channel_in_app,
      channel_email: form.channel_email,
      email_digest_mode: form.email_digest_mode,
      digest_hour: form.digest_hour,
      timezone: form.timezone,
      low_stock_red: form.low_stock_red,
      low_stock_yellow: form.low_stock_yellow,
      recipients_mode: form.recipients_mode,
      restaurant_id: currentRestaurant.id,
      user_id: user.id,
      updated_at: new Date().toISOString(),
    };

    let currentPrefId = prefId;
    if (prefId) {
      await supabase.from("notification_preferences").update(payload).eq("id", prefId);
    } else {
      const { data } = await supabase.from("notification_preferences").insert(payload).select("id").single();
      if (data) { setPrefId(data.id); currentPrefId = data.id; }
    }

    // Update custom recipients
    if (currentPrefId) {
      await supabase.from("alert_recipients").delete().eq("notification_pref_id", currentPrefId);
      if (form.recipients_mode === "CUSTOM" && form.custom_user_ids.length > 0) {
        await supabase.from("alert_recipients").insert(
          form.custom_user_ids.map(uid => ({ notification_pref_id: currentPrefId!, user_id: uid }))
        );
      }
    }

    setSaving(false);
    toast.success("Alert preferences saved");
  };

  const staffMembers = members.filter(m => m.role === "STAFF");
  const managerOwnerMembers = members.filter(m => m.role === "OWNER" || m.role === "MANAGER");

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Alert Settings</h1>
          <p className="page-description">Configure low stock alerts for {currentRestaurant?.name}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Stock Alert Thresholds</CardTitle>
          <CardDescription>Choose which alert levels to receive</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div><Label className="text-xs font-semibold text-destructive">Critical (RED) alerts</Label><p className="text-[11px] text-muted-foreground">Items below 50% of PAR level</p></div>
            <Switch checked={form.low_stock_red} onCheckedChange={v => setForm(p => ({ ...p, low_stock_red: v }))} />
          </div>
          <div className="flex items-center justify-between">
            <div><Label className="text-xs font-semibold text-warning">Low (YELLOW) alerts</Label><p className="text-[11px] text-muted-foreground">Items below 100% of PAR level</p></div>
            <Switch checked={form.low_stock_yellow} onCheckedChange={v => setForm(p => ({ ...p, low_stock_yellow: v }))} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recipients</CardTitle>
          <CardDescription>Who should receive low stock alerts</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Recipients Mode</Label>
            <Select
              value={form.recipients_mode}
              onValueChange={(v: "OWNERS_MANAGERS" | "ALL" | "CUSTOM") => setForm(p => ({ ...p, recipients_mode: v }))}
            >
              <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="OWNERS_MANAGERS">Owners &amp; Managers only</SelectItem>
                <SelectItem value="ALL">All team members (incl. Staff)</SelectItem>
                <SelectItem value="CUSTOM">Custom selection</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {form.recipients_mode === "OWNERS_MANAGERS" && (
            <p className="text-xs text-muted-foreground">
              Alerts will be sent to {managerOwnerMembers.length} owner/manager member{managerOwnerMembers.length !== 1 ? "s" : ""}.
              Staff will not receive alerts.
            </p>
          )}

          {form.recipients_mode === "ALL" && (
            <p className="text-xs text-muted-foreground">
              Alerts will be sent to all {members.length} team members, including {staffMembers.length} staff member{staffMembers.length !== 1 ? "s" : ""}.
            </p>
          )}

          {form.recipients_mode === "CUSTOM" && (
            <div className="space-y-1.5">
              <Label className="text-xs">Select recipients</Label>
              <div className="space-y-1 max-h-40 overflow-y-auto border rounded-md p-2">
                {members.map((m: any) => (
                  <label key={m.user_id} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-muted/50 cursor-pointer">
                    <Checkbox
                      checked={form.custom_user_ids.includes(m.user_id)}
                      onCheckedChange={() => toggleCustomUser(m.user_id)}
                    />
                    <span className="text-xs">{m.profiles?.full_name || m.profiles?.email}</span>
                    <Badge variant="secondary" className="text-[9px] ml-auto">{m.role}</Badge>
                  </label>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Delivery Preferences</CardTitle>
          <CardDescription>How you want to receive alerts</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div><Label className="text-xs font-semibold">In-app notifications</Label></div>
            <Switch checked={form.channel_in_app} onCheckedChange={v => setForm(p => ({ ...p, channel_in_app: v }))} />
          </div>
          <div className="flex items-center justify-between">
            <div><Label className="text-xs font-semibold">Email notifications</Label></div>
            <Switch checked={form.channel_email} onCheckedChange={v => setForm(p => ({ ...p, channel_email: v }))} />
          </div>
          {form.channel_email && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">Email mode</Label>
                <Select value={form.email_digest_mode} onValueChange={(v: "IMMEDIATE" | "DAILY_DIGEST") => setForm(p => ({ ...p, email_digest_mode: v }))}>
                  <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="IMMEDIATE">Immediate</SelectItem>
                    <SelectItem value="DAILY_DIGEST">Daily Digest</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.email_digest_mode === "DAILY_DIGEST" && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Digest hour (0-23)</Label>
                    <Input type="number" min={0} max={23} value={form.digest_hour} onChange={e => setForm(p => ({ ...p, digest_hour: Number(e.target.value) }))} className="h-9 w-24" />
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
              )}
            </>
          )}
          <Button onClick={handleSave} disabled={saving} className="bg-gradient-amber shadow-amber">{saving ? "Saving…" : "Save Preferences"}</Button>
        </CardContent>
      </Card>
    </div>
  );
}
