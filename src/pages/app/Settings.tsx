import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useAuth } from "@/contexts/AuthContext";
import type { LocationPermissions } from "@/contexts/RestaurantContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";
import { format, formatDistanceToNow } from "date-fns";
import {
  Building2, Package, BookOpen, MapPin, Users, Loader2,
  ShoppingCart, FileUp, AlertTriangle, Plus, Trash2,
  X, Pencil, CalendarClock, ChevronRight, ChevronDown, Mail, Copy, UserCircle,
} from "lucide-react";
import { InventoryScheduleSection } from "@/pages/app/settings/InventorySchedule";
import {
  useLocationSettings,
  DEFAULT_ASSIGNMENT_PERMISSIONS,
  type Invitation,
  type LocationWithSettings,
  type TeamMember,
} from "@/hooks/useLocationSettings";

const BRAND_OPTIONS = [
  "Schlotzsky's",
  "McAlister's Deli",
  "Moe's Southwest Grill",
  "Jamba",
  "Cinnabon",
  "Auntie Anne's",
  "Carvel",
  "Other",
] as const;

const TOP_NAV = [
  { key: "profile",   label: "My Profile",          icon: UserCircle,   desc: "Your name, email and password" },
  { key: "general",   label: "Business Profile",    icon: Building2,    desc: "Restaurant name, contact info, timezone & currency" },
  { key: "invoice",   label: "Invoice Settings",    icon: Mail,         desc: "Unique address for vendor invoice delivery" },
  { key: "inventory", label: "Inventory Defaults",   icon: Package,      desc: "Default categories, units, and entry behavior" },
  { key: "schedule",  label: "Inventory Schedule",   icon: CalendarClock, desc: "Reminders and auto-session scheduling", managerOnly: true },
  { key: "locations", label: "Locations",            icon: MapPin,       desc: "Manage restaurant locations and their settings", ownerOnly: true },
  { key: "team",      label: "Team & Permissions",   icon: Users,        desc: "Invite members and manage their assignments", ownerOnly: true },
];

const ADVANCED_NAV = [
  { key: "par",        label: "PAR Defaults",        icon: BookOpen,     desc: "Lead time, reorder threshold and auto-apply settings" },
  { key: "smartorder", label: "Smart Order Defaults", icon: ShoppingCart, desc: "Risk thresholds and automation for order generation" },
  { key: "imports",    label: "Imports & Mapping",    icon: FileUp,       desc: "Saved column mappings from previous file imports" },
  { key: "danger",     label: "Danger Zone",          icon: AlertTriangle, desc: "Irreversible actions — delete history or restaurant", ownerOnly: true },
];

export default function SettingsPage() {
  const { currentRestaurant, refetchLocations } = useRestaurant();
  const { user } = useAuth();
  const [section, setSection] = useState("profile");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const isOwner = currentRestaurant?.role === "OWNER";
  const isManager = currentRestaurant?.role === "MANAGER" || isOwner;

  const locationHook = useLocationSettings(isOwner ? currentRestaurant?.id : undefined);

  const handleSelect = (key: string) => {
    setSection(key);
    if (ADVANCED_NAV.some(n => n.key === key)) setAdvancedOpen(true);
  };

  const NavButton = ({ navKey, label, icon: Icon, desc, danger }: { navKey: string; label: string; icon: any; desc: string; danger?: boolean }) => (
    <button
      onClick={() => handleSelect(navKey)}
      className={`w-full flex items-start gap-2.5 px-3 py-2.5 rounded-lg text-left transition-all duration-150 ${
        section === navKey
          ? "bg-accent text-accent-foreground font-medium"
          : danger
            ? "text-destructive hover:bg-destructive/5"
            : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      }`}
    >
      <Icon className="h-4 w-4 shrink-0 mt-0.5 opacity-70" />
      <div className="min-w-0">
        <p className="text-[13px] leading-tight">{label}</p>
        <p className={`text-[11px] leading-tight mt-0.5 ${section === navKey ? "text-accent-foreground/60" : "text-muted-foreground/70"}`}>{desc}</p>
      </div>
    </button>
  );

  return (
    <div className="animate-fade-in">
      <div className="page-header mb-6">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-description">Configure your restaurant</p>
        </div>
      </div>
      <div className="flex gap-6 min-h-[600px]">
        {/* Left nav */}
        <nav className="w-56 shrink-0 space-y-0.5">
          {TOP_NAV.filter(item => (!item.managerOnly || isManager) && (!item.ownerOnly || isOwner)).map(item => (
            <NavButton key={item.key} navKey={item.key} label={item.label} icon={item.icon} desc={item.desc} />
          ))}

          {isManager && (
            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger asChild>
                <button className="w-full flex items-center justify-between px-3 py-2.5 mt-3 rounded-lg text-left text-[12px] font-semibold uppercase tracking-wide text-muted-foreground/60 hover:bg-muted/30 transition-all">
                  <span>Advanced Settings</span>
                  <ChevronRight className={`h-3.5 w-3.5 transition-transform duration-200 ${advancedOpen ? "rotate-90" : ""}`} />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-0.5 mt-0.5">
                {ADVANCED_NAV.filter(n => !n.ownerOnly || isOwner).map(item => (
                  <NavButton key={item.key} navKey={item.key} label={item.label} icon={item.icon} desc={item.desc} danger={item.key === "danger"} />
                ))}
              </CollapsibleContent>
            </Collapsible>
          )}
        </nav>

        {/* Right content */}
        <div className="flex-1 min-w-0">
          {section === "profile"    && <ProfileSection />}
          {section === "general"    && <GeneralSection restaurantId={currentRestaurant?.id} isManager={isManager} restaurantName={currentRestaurant?.name} />}
          {section === "invoice"    && <InvoiceSection restaurantId={currentRestaurant?.id} isManager={isManager} restaurantName={currentRestaurant?.name} />}
          {section === "inventory"  && <InventorySection restaurantId={currentRestaurant?.id} isManager={isManager} />}
          {section === "par"        && <PARSection restaurantId={currentRestaurant?.id} isManager={isManager} />}
          {section === "smartorder" && <SmartOrderSection restaurantId={currentRestaurant?.id} isManager={isManager} />}
          {section === "imports"    && <ImportsSection restaurantId={currentRestaurant?.id} isManager={isManager} />}
          {section === "schedule"   && isManager && <InventoryScheduleSection restaurantId={currentRestaurant?.id} isManager={isManager} />}
          {section === "danger"     && isOwner && <DangerSection restaurantId={currentRestaurant?.id} isOwner={isOwner} isManager={isManager} />}
          {section === "locations"  && isOwner && currentRestaurant?.id && (
            <LocationsSection locationHook={locationHook} refetchLocations={refetchLocations} />
          )}
          {section === "team"       && isOwner && currentRestaurant?.id && (
            <TeamSection locationHook={locationHook} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ===== 0) Profile ===== */
function ProfileSection() {
  const { user } = useAuth();
  const [fullName, setFullName] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwError, setPwError] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.full_name) setFullName(data.full_name);
      });
  }, [user?.id]);

  const handleSaveProfile = async () => {
    if (!user) return;
    setSavingProfile(true);
    const { error } = await supabase
      .from("profiles")
      .upsert({ id: user.id, full_name: fullName.trim() }, { onConflict: "id" });
    setSavingProfile(false);
    if (error) toast.error("Could not save");
    else toast.success("Profile updated");
  };

  const handleSavePassword = async () => {
    setPwError("");
    if (newPassword.length < 8) { setPwError("New password must be at least 8 characters"); return; }
    if (newPassword !== confirmPassword) { setPwError("Passwords do not match"); return; }
    setSavingPw(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSavingPw(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Password updated — please sign in again");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    }
  };

  const copyAccountId = async () => {
    if (!user?.id) return;
    try {
      await navigator.clipboard.writeText(user.id);
      toast.success("Account ID copied");
    } catch {
      toast.error("Could not copy");
    }
  };

  const initials = fullName.trim()
    ? fullName.trim()[0].toUpperCase()
    : (user?.email?.[0]?.toUpperCase() ?? "?");

  return (
    <div className="space-y-4">
      {/* Sub-section A — Personal Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Personal Info</CardTitle>
          <CardDescription>Your display name and login email</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-lg font-bold shrink-0 select-none">
              {initials}
            </div>
            <p className="text-xs text-muted-foreground">Your initials are shown as your avatar across Margin6.</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Full Name</Label>
              <Input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="h-9"
                placeholder="Your name"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Email</Label>
              <Input value={user?.email ?? ""} readOnly disabled className="h-9" />
              <p className="text-[11px] text-muted-foreground">Contact support to change your login email</p>
            </div>
          </div>
          <Button onClick={() => void handleSaveProfile()} disabled={savingProfile} className="bg-gradient-amber shadow-amber">
            {savingProfile ? "Saving…" : "Save Changes"}
          </Button>
        </CardContent>
      </Card>

      {/* Sub-section B — Change Password */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Change Password</CardTitle>
          <CardDescription>Update your account password</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Current Password</Label>
            <Input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">New Password</Label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => { setNewPassword(e.target.value); setPwError(""); }}
              autoComplete="new-password"
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Confirm New Password</Label>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => { setConfirmPassword(e.target.value); setPwError(""); }}
              autoComplete="new-password"
              className="h-9"
            />
            {pwError && <p className="text-xs text-destructive">{pwError}</p>}
          </div>
          <Button
            onClick={() => void handleSavePassword()}
            disabled={savingPw || !newPassword}
            className="bg-gradient-amber shadow-amber"
          >
            {savingPw ? "Saving…" : "Save Password"}
          </Button>
        </CardContent>
      </Card>

      {/* Sub-section C — Account Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account Info</CardTitle>
          <CardDescription>Read-only account details</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Account created</span>
            <span className="font-medium">
              {user?.created_at ? format(new Date(user.created_at), "MMM d, yyyy") : "—"}
            </span>
          </div>
          <Separator />
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Last sign in</span>
            <span className="font-medium">
              {user?.last_sign_in_at ? format(new Date(user.last_sign_in_at), "MMM d, yyyy") : "—"}
            </span>
          </div>
          <Separator />
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Account ID</span>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs">{user?.id ? `${user.id.slice(0, 8)}…` : "—"}</span>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => void copyAccountId()}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ===== 1) General ===== */
function GeneralSection({ restaurantId, isManager, restaurantName }: { restaurantId?: string; isManager: boolean; restaurantName?: string }) {
  const [form, setForm] = useState({
    business_email: "",
    phone: "",
    address: "",
    currency: "USD",
    timezone: "America/New_York",
    date_format: "MM/DD/YYYY",
    invoice_email: null as string | null,
  });
  const [name, setName] = useState(restaurantName || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!restaurantId) return;
    setName(restaurantName || "");
    supabase.from("restaurant_settings").select("*").eq("restaurant_id", restaurantId).maybeSingle().then(({ data }) => {
      if (data) {
        setForm({
          business_email: data.business_email || "",
          phone: data.phone || "",
          address: data.address || "",
          currency: data.currency,
          timezone: data.timezone,
          date_format: data.date_format,
          invoice_email: data.invoice_email ?? null,
        });
      }
    });
  }, [restaurantId, restaurantName]);

  const handleSave = async () => {
    if (!restaurantId || !isManager) return;
    setSaving(true);
    await supabase.from("restaurants").update({ name }).eq("id", restaurantId);
    const { error } = await supabase.from("restaurant_settings").upsert({ restaurant_id: restaurantId, ...form }, { onConflict: "restaurant_id" });
    setSaving(false);
    if (error) toast.error("Failed to save settings");
    else toast.success("Settings saved");
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Business Profile</CardTitle><CardDescription>Restaurant name, contact details, timezone and currency</CardDescription></CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5"><Label className="text-xs">Restaurant Name</Label><Input value={name} onChange={e => setName(e.target.value)} disabled={!isManager} className="h-9" /></div>
          <div className="space-y-1.5"><Label className="text-xs">Business Email</Label><Input value={form.business_email} onChange={e => setForm(p => ({ ...p, business_email: e.target.value }))} disabled={!isManager} className="h-9" /></div>
          <div className="space-y-1.5"><Label className="text-xs">Phone Number</Label><Input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} disabled={!isManager} className="h-9" /></div>
          <div className="space-y-1.5"><Label className="text-xs">Address</Label><Input value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} disabled={!isManager} className="h-9" /></div>
          <div className="space-y-1.5"><Label className="text-xs">Default Currency</Label>
            <Select value={form.currency} onValueChange={v => setForm(p => ({ ...p, currency: v }))} disabled={!isManager}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="USD">USD</SelectItem><SelectItem value="EUR">EUR</SelectItem><SelectItem value="GBP">GBP</SelectItem><SelectItem value="CAD">CAD</SelectItem></SelectContent></Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Timezone</Label>
            <Select value={form.timezone} onValueChange={v => setForm(p => ({ ...p, timezone: v }))} disabled={!isManager}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="America/New_York">Eastern</SelectItem><SelectItem value="America/Chicago">Central</SelectItem><SelectItem value="America/Denver">Mountain</SelectItem><SelectItem value="America/Los_Angeles">Pacific</SelectItem></SelectContent></Select>
          </div>
          <div className="space-y-1.5"><Label className="text-xs">Date Format</Label>
            <Select value={form.date_format} onValueChange={v => setForm(p => ({ ...p, date_format: v }))} disabled={!isManager}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem><SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem><SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem></SelectContent></Select>
          </div>
        </div>
        {isManager && <Button onClick={handleSave} disabled={saving} className="bg-gradient-amber shadow-amber mt-2">{saving ? "Saving…" : "Save Changes"}</Button>}
      </CardContent>
    </Card>
  );
}

const INVOICE_EMAIL_DOMAIN = "invoices.margin6.com";

function slugifyRestaurantNameForInvoice(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 20);
  return slug || "restaurant";
}

function randomInvoiceSuffix(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const arr = new Uint8Array(6);
  crypto.getRandomValues(arr);
  return Array.from(arr, (x) => chars[x % chars.length]).join("");
}

/* ===== 2) Invoice ===== */
function InvoiceSection({ restaurantId, isManager, restaurantName }: { restaurantId?: string; isManager: boolean; restaurantName?: string }) {
  const [invoiceEmail, setInvoiceEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [usFoodsOpen, setUsFoodsOpen] = useState(false);
  const [pfgOpen, setPfgOpen] = useState(false);

  const load = useCallback(async () => {
    if (!restaurantId) return;
    setLoading(true);
    const { data } = await supabase.from("restaurant_settings").select("invoice_email").eq("restaurant_id", restaurantId).maybeSingle();
    setInvoiceEmail(data?.invoice_email ?? null);
    setLoading(false);
  }, [restaurantId]);

  useEffect(() => { load(); }, [load]);

  const copyAddress = async () => {
    if (!invoiceEmail) return;
    try {
      await navigator.clipboard.writeText(invoiceEmail);
      toast.success("Address copied");
    } catch {
      toast.error("Could not copy");
    }
  };

  const handleGenerate = async () => {
    if (!restaurantId || !isManager) return;
    setGenerating(true);
    try {
      const slug = slugifyRestaurantNameForInvoice(restaurantName || "restaurant");
      let assigned: string | null = null;
      for (let attempt = 0; attempt < 8; attempt++) {
        const candidate = `${slug}-${randomInvoiceSuffix()}@${INVOICE_EMAIL_DOMAIN}`;
        const { data: existing } = await supabase.from("restaurant_settings").select("restaurant_id").eq("restaurant_id", restaurantId).maybeSingle();
        if (existing) {
          const { error } = await supabase.from("restaurant_settings").update({ invoice_email: candidate }).eq("restaurant_id", restaurantId);
          if (!error) { assigned = candidate; break; }
          if ((error as { code?: string }).code === "23505") continue;
          throw error;
        } else {
          const { error } = await supabase.from("restaurant_settings").insert({ restaurant_id: restaurantId, invoice_email: candidate, currency: "USD", timezone: "America/New_York", date_format: "MM/DD/YYYY" });
          if (!error) { assigned = candidate; break; }
          if ((error as { code?: string }).code === "23505") continue;
          throw error;
        }
      }
      if (!assigned) throw new Error("Could not assign a unique invoice email");
      setInvoiceEmail(assigned);
      toast.success("Invoice email created");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create email");
    }
    setGenerating(false);
  };

  if (!restaurantId) return (
    <Card>
      <CardHeader><CardTitle className="text-base">Invoice Settings</CardTitle></CardHeader>
      <CardContent><p className="text-sm text-muted-foreground">Select a restaurant to view invoice settings.</p></CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invoice Settings</CardTitle>
          <CardDescription>Unique address for distributors to send invoices into Margin6</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : invoiceEmail ? (
            <div className="flex flex-wrap items-center gap-2">
              <code className="text-sm bg-muted px-2.5 py-1.5 rounded-md font-mono break-all">{invoiceEmail}</code>
              <Button type="button" variant="outline" size="sm" className="shrink-0 gap-1.5" onClick={copyAddress}>
                <Copy className="h-3.5 w-3.5" />Copy
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">No invoice email has been assigned yet.</p>
              {isManager && (
                <Button type="button" size="sm" className="bg-gradient-amber shadow-amber" disabled={generating} onClick={handleGenerate}>
                  {generating ? "Creating…" : "Generate invoice email"}
                </Button>
              )}
            </div>
          )}

          <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">How to receive invoices automatically — Sysco</p>
            <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-1.5">
              <li>Copy your unique email address above</li>
              <li>Log into Sysco Shop at sysco.com</li>
              <li>Go to Account → Invoice Preferences</li>
              <li>Replace invoice email with your Margin6 address</li>
              <li>Click Save</li>
            </ol>
            <p className="text-sm text-muted-foreground">Your next Sysco invoice will arrive automatically.</p>
          </div>

          <Collapsible open={usFoodsOpen} onOpenChange={setUsFoodsOpen}>
            <CollapsibleTrigger asChild>
              <button type="button" className="flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm font-medium hover:bg-muted/50 transition-colors">
                <span>US Foods</span>
                <ChevronRight className={`h-4 w-4 transition-transform duration-200 ${usFoodsOpen ? "rotate-90" : ""}`} />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-1.5">
                  <li>Copy your unique email address above</li>
                  <li>Log into US Foods at usfoods.com</li>
                  <li>Open your account settings and find invoice or document delivery preferences</li>
                  <li>Set the invoice email to your Margin6 address</li>
                  <li>Save your changes</li>
                </ol>
                <p className="text-sm text-muted-foreground">Your next US Foods invoice will arrive automatically.</p>
              </div>
            </CollapsibleContent>
          </Collapsible>

          <Collapsible open={pfgOpen} onOpenChange={setPfgOpen}>
            <CollapsibleTrigger asChild>
              <button type="button" className="flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm font-medium hover:bg-muted/50 transition-colors">
                <span>PFG (Performance Foodservice)</span>
                <ChevronRight className={`h-4 w-4 transition-transform duration-200 ${pfgOpen ? "rotate-90" : ""}`} />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-1.5">
                  <li>Copy your unique email address above</li>
                  <li>Log into Performance Foodservice at pfgc.com</li>
                  <li>Open your account profile and locate invoice or e-document preferences</li>
                  <li>Set the invoice email to your Margin6 address</li>
                  <li>Save your changes</li>
                </ol>
                <p className="text-sm text-muted-foreground">Your next PFG invoice will arrive automatically.</p>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>
    </div>
  );
}

/* ===== 3) Inventory Defaults ===== */
function InventorySection({ restaurantId, isManager }: { restaurantId?: string; isManager: boolean }) {
  const [form, setForm] = useState({ categories: ["Frozen", "Cooler", "Dry", "Bar", "Produce", "Dairy"] as string[], units: ["kg", "lb", "oz", "case", "each", "liter", "gallon"] as string[], auto_category_enabled: false, autosave_enabled: false });
  const [newCat, setNewCat] = useState("");
  const [newUnit, setNewUnit] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!restaurantId) return;
    supabase.from("inventory_settings").select("*").eq("restaurant_id", restaurantId).maybeSingle().then(({ data }) => {
      if (data) setForm({ categories: (data.categories as string[]) || [], units: (data.units as string[]) || [], auto_category_enabled: data.auto_category_enabled, autosave_enabled: data.autosave_enabled });
    });
  }, [restaurantId]);

  const handleSave = async () => {
    if (!restaurantId || !isManager) return;
    setSaving(true);
    const { error } = await supabase.from("inventory_settings").upsert({ restaurant_id: restaurantId, categories: form.categories, units: form.units, auto_category_enabled: form.auto_category_enabled, autosave_enabled: form.autosave_enabled }, { onConflict: "restaurant_id" });
    setSaving(false);
    if (error) toast.error("Failed to save"); else toast.success("Inventory settings saved");
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Inventory Defaults</CardTitle><CardDescription>Configure default categories, units, and behavior</CardDescription></CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label className="text-xs font-semibold">Default Categories</Label>
          <div className="flex flex-wrap gap-1.5">{form.categories.map(c => (
            <Badge key={c} variant="secondary" className="text-xs gap-1">{c}{isManager && <X className="h-3 w-3 cursor-pointer" onClick={() => setForm(p => ({ ...p, categories: p.categories.filter(x => x !== c) }))} />}</Badge>
          ))}</div>
          {isManager && <div className="flex gap-2"><Input value={newCat} onChange={e => setNewCat(e.target.value)} placeholder="Add category" className="h-8 text-xs w-40" onKeyDown={e => { if (e.key === "Enter" && newCat.trim()) { setForm(p => ({ ...p, categories: [...p.categories, newCat.trim()] })); setNewCat(""); } }} /><Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { if (newCat.trim()) { setForm(p => ({ ...p, categories: [...p.categories, newCat.trim()] })); setNewCat(""); } }}>Add</Button></div>}
        </div>
        <Separator />
        <div className="space-y-2">
          <Label className="text-xs font-semibold">Default Units</Label>
          <div className="flex flex-wrap gap-1.5">{form.units.map(u => (
            <Badge key={u} variant="secondary" className="text-xs gap-1">{u}{isManager && <X className="h-3 w-3 cursor-pointer" onClick={() => setForm(p => ({ ...p, units: p.units.filter(x => x !== u) }))} />}</Badge>
          ))}</div>
          {isManager && <div className="flex gap-2"><Input value={newUnit} onChange={e => setNewUnit(e.target.value)} placeholder="Add unit" className="h-8 text-xs w-40" onKeyDown={e => { if (e.key === "Enter" && newUnit.trim()) { setForm(p => ({ ...p, units: [...p.units, newUnit.trim()] })); setNewUnit(""); } }} /><Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { if (newUnit.trim()) { setForm(p => ({ ...p, units: [...p.units, newUnit.trim()] })); setNewUnit(""); } }}>Add</Button></div>}
        </div>
        <Separator />
        <div className="space-y-3">
          <div className="flex items-center justify-between"><div><Label className="text-xs font-semibold">Auto-category suggestions</Label><p className="text-[11px] text-muted-foreground">Suggest category based on item name keywords</p></div><Switch checked={form.auto_category_enabled} onCheckedChange={v => setForm(p => ({ ...p, auto_category_enabled: v }))} disabled={!isManager} /></div>
          <div className="flex items-center justify-between"><div><Label className="text-xs font-semibold">Auto-save inventory entries</Label><p className="text-[11px] text-muted-foreground">Automatically save changes as you enter counts</p></div><Switch checked={form.autosave_enabled} onCheckedChange={v => setForm(p => ({ ...p, autosave_enabled: v }))} disabled={!isManager} /></div>
        </div>
        {isManager && <Button onClick={handleSave} disabled={saving} className="bg-gradient-amber shadow-amber">{saving ? "Saving…" : "Save Changes"}</Button>}
      </CardContent>
    </Card>
  );
}

/* ===== 4) PAR Defaults ===== */
function PARSection({ restaurantId, isManager }: { restaurantId?: string; isManager: boolean }) {
  const [form, setForm] = useState({ default_lead_time_days: 2, default_reorder_threshold: 80, auto_apply_last_par: false });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!restaurantId) return;
    supabase.from("par_settings").select("*").eq("restaurant_id", restaurantId).maybeSingle().then(({ data }) => {
      if (data) setForm({ default_lead_time_days: data.default_lead_time_days, default_reorder_threshold: Number(data.default_reorder_threshold), auto_apply_last_par: data.auto_apply_last_par });
    });
  }, [restaurantId]);

  const handleSave = async () => {
    if (!restaurantId || !isManager) return;
    setSaving(true);
    const { error } = await supabase.from("par_settings").upsert({ restaurant_id: restaurantId, ...form }, { onConflict: "restaurant_id" });
    setSaving(false);
    if (error) toast.error("Failed to save"); else toast.success("PAR settings saved");
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">PAR Defaults</CardTitle><CardDescription>Default values for PAR guide creation</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5"><Label className="text-xs">Default Lead Time (days)</Label><Input type="number" value={form.default_lead_time_days} onChange={e => setForm(p => ({ ...p, default_lead_time_days: Number(e.target.value) }))} disabled={!isManager} className="h-9" /></div>
          <div className="space-y-1.5"><Label className="text-xs">Default Reorder Threshold (%)</Label><Input type="number" value={form.default_reorder_threshold} onChange={e => setForm(p => ({ ...p, default_reorder_threshold: Number(e.target.value) }))} disabled={!isManager} className="h-9" /></div>
        </div>
        <div className="flex items-center justify-between"><div><Label className="text-xs font-semibold">Auto-apply last used PAR guide</Label><p className="text-[11px] text-muted-foreground">When entering inventory, auto-select the last PAR guide used for that list</p></div><Switch checked={form.auto_apply_last_par} onCheckedChange={v => setForm(p => ({ ...p, auto_apply_last_par: v }))} disabled={!isManager} /></div>
        {isManager && <Button onClick={handleSave} disabled={saving} className="bg-gradient-amber shadow-amber">{saving ? "Saving…" : "Save Changes"}</Button>}
      </CardContent>
    </Card>
  );
}

/* ===== 5) Smart Order Defaults ===== */
function SmartOrderSection({ restaurantId, isManager }: { restaurantId?: string; isManager: boolean }) {
  const [form, setForm] = useState({ auto_create_purchase_history: true, auto_calculate_cost: true, red_threshold: 50, yellow_threshold: 100 });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!restaurantId) return;
    supabase.from("smart_order_settings").select("*").eq("restaurant_id", restaurantId).maybeSingle().then(({ data }) => {
      if (data) setForm({ auto_create_purchase_history: data.auto_create_purchase_history, auto_calculate_cost: data.auto_calculate_cost, red_threshold: Number(data.red_threshold), yellow_threshold: Number(data.yellow_threshold) });
    });
  }, [restaurantId]);

  const handleSave = async () => {
    if (!restaurantId || !isManager) return;
    setSaving(true);
    const { error } = await supabase.from("smart_order_settings").upsert({ restaurant_id: restaurantId, ...form }, { onConflict: "restaurant_id" });
    setSaving(false);
    if (error) toast.error("Failed to save"); else toast.success("Smart Order settings saved");
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Smart Order Defaults</CardTitle><CardDescription>Control how smart orders are generated</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between"><div><Label className="text-xs font-semibold">Auto-create purchase history</Label><p className="text-[11px] text-muted-foreground">Automatically create a purchase history entry when a Smart Order is created</p></div><Switch checked={form.auto_create_purchase_history} onCheckedChange={v => setForm(p => ({ ...p, auto_create_purchase_history: v }))} disabled={!isManager} /></div>
        <div className="flex items-center justify-between"><div><Label className="text-xs font-semibold">Auto-calculate estimated cost</Label><p className="text-[11px] text-muted-foreground">Calculate costs automatically from catalog unit costs</p></div><Switch checked={form.auto_calculate_cost} onCheckedChange={v => setForm(p => ({ ...p, auto_calculate_cost: v }))} disabled={!isManager} /></div>
        <Separator />
        <Label className="text-xs font-semibold">Risk Thresholds</Label>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5"><Label className="text-xs text-destructive">RED threshold (%)</Label><Input type="number" value={form.red_threshold} onChange={e => setForm(p => ({ ...p, red_threshold: Number(e.target.value) }))} disabled={!isManager} className="h-9" /><p className="text-[10px] text-muted-foreground">Items below this % of PAR are flagged RED</p></div>
          <div className="space-y-1.5"><Label className="text-xs text-warning">YELLOW threshold (%)</Label><Input type="number" value={form.yellow_threshold} onChange={e => setForm(p => ({ ...p, yellow_threshold: Number(e.target.value) }))} disabled={!isManager} className="h-9" /><p className="text-[10px] text-muted-foreground">Items below this % of PAR are flagged YELLOW</p></div>
        </div>
        {isManager && <Button onClick={handleSave} disabled={saving} className="bg-gradient-amber shadow-amber">{saving ? "Saving…" : "Save Changes"}</Button>}
      </CardContent>
    </Card>
  );
}

/* ===== 6) Imports & Mapping ===== */
function ImportsSection({ restaurantId, isManager }: { restaurantId?: string; isManager: boolean }) {
  const [templates, setTemplates] = useState<any[]>([]);
  useEffect(() => {
    if (!restaurantId) return;
    supabase.from("import_templates").select("*").eq("restaurant_id", restaurantId).order("last_used_at", { ascending: false, nullsFirst: false }).then(({ data }) => { if (data) setTemplates(data); });
  }, [restaurantId]);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this import mapping?")) return;
    await supabase.from("import_templates").delete().eq("id", id);
    setTemplates(p => p.filter(t => t.id !== id));
    toast.success("Mapping deleted");
  };

  const handleClearCache = async () => {
    if (!restaurantId || !confirm("Clear all import mappings? This cannot be undone.")) return;
    await supabase.from("import_templates").delete().eq("restaurant_id", restaurantId);
    setTemplates([]);
    toast.success("Import cache cleared");
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div><CardTitle className="text-base">Imports & Mapping</CardTitle><CardDescription>Saved import column mappings</CardDescription></div>
        {isManager && templates.length > 0 && <Button size="sm" variant="destructive" className="gap-1.5 text-xs" onClick={handleClearCache}><Trash2 className="h-3.5 w-3.5" />Clear All</Button>}
      </CardHeader>
      <CardContent>
        {templates.length === 0 ? (
          <div className="empty-state"><FileUp className="empty-state-icon" /><p className="empty-state-title">No saved mappings</p><p className="empty-state-description">Import mappings are created when you import inventory files.</p></div>
        ) : (
          <Table>
            <TableHeader><TableRow className="bg-muted/30"><TableHead className="text-xs font-semibold">Vendor / Name</TableHead><TableHead className="text-xs font-semibold">Last Used</TableHead><TableHead className="text-xs font-semibold">File Type</TableHead><TableHead className="w-10"></TableHead></TableRow></TableHeader>
            <TableBody>{templates.map(t => (
              <TableRow key={t.id} className="hover:bg-muted/30 transition-colors">
                <TableCell className="font-medium text-sm">{t.vendor_name || t.name}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{t.last_used_at ? new Date(t.last_used_at).toLocaleDateString() : "—"}</TableCell>
                <TableCell><Badge variant="secondary" className="text-[10px]">{t.file_type || "csv"}</Badge></TableCell>
                <TableCell>{isManager && <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => handleDelete(t.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/* ===== 7) Danger Zone ===== */
function DangerSection({ restaurantId, isOwner, isManager }: { restaurantId?: string; isOwner: boolean; isManager: boolean }) {
  const [confirmText, setConfirmText] = useState("");
  const [activeAction, setActiveAction] = useState<string | null>(null);

  const actions = [
    { key: "smart_orders", label: "Delete All Smart Order History", description: "Remove all smart order runs and their items for this restaurant.", confirm: "DELETE SMART ORDERS", role: isManager },
    { key: "purchase_history", label: "Delete All Purchase History", description: "Remove all purchase history records and items.", confirm: "DELETE PURCHASES", role: isManager },
    { key: "restaurant", label: "Delete Restaurant", description: "Permanently delete this restaurant and ALL associated data. This cannot be undone.", confirm: "DELETE RESTAURANT", role: isOwner },
  ];

  const handleConfirm = async () => {
    if (!restaurantId) return;
    const action = actions.find(a => a.key === activeAction);
    if (!action || confirmText !== action.confirm) { toast.error(`Type "${action?.confirm}" to confirm`); return; }

    if (activeAction === "smart_orders") {
      const { data: runs } = await supabase.from("smart_order_runs").select("id").eq("restaurant_id", restaurantId);
      if (runs?.length) {
        for (const r of runs) await supabase.from("smart_order_run_items").delete().eq("run_id", r.id);
        await supabase.from("smart_order_runs").delete().eq("restaurant_id", restaurantId);
      }
      toast.success("Smart order history deleted");
    } else if (activeAction === "purchase_history") {
      const { data: phs } = await supabase.from("purchase_history").select("id").eq("restaurant_id", restaurantId);
      if (phs?.length) {
        for (const p of phs) await supabase.from("purchase_history_items").delete().eq("purchase_history_id", p.id);
        await supabase.from("purchase_history").delete().eq("restaurant_id", restaurantId);
      }
      toast.success("Purchase history deleted");
    } else if (activeAction === "restaurant") {
      const { error } = await supabase.rpc("delete_restaurant_cascade", { p_restaurant_id: restaurantId });
      if (error) { toast.error("Failed to delete restaurant: " + error.message); setActiveAction(null); setConfirmText(""); return; }
      toast.success("Restaurant deleted");
      window.location.href = "/app";
      return;
    }
    setActiveAction(null);
    setConfirmText("");
  };

  return (
    <div className="space-y-4">
      {actions.filter(a => a.role).map(action => (
        <Card key={action.key} className="border-destructive/30">
          <CardContent className="flex items-center justify-between py-4">
            <div>
              <p className="text-sm font-medium text-destructive">{action.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{action.description}</p>
            </div>
            <Button variant="destructive" size="sm" className="text-xs" onClick={() => { setActiveAction(action.key); setConfirmText(""); }}>{action.label}</Button>
          </CardContent>
        </Card>
      ))}

      <Dialog open={!!activeAction} onOpenChange={v => { if (!v) { setActiveAction(null); setConfirmText(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle className="text-destructive">Confirm Destructive Action</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Type <span className="font-mono font-bold text-destructive">{actions.find(a => a.key === activeAction)?.confirm}</span> to confirm.</p>
          <Input value={confirmText} onChange={e => setConfirmText(e.target.value)} className="h-9 font-mono" placeholder="Type confirmation text" />
          <DialogFooter><Button variant="destructive" onClick={handleConfirm} disabled={confirmText !== actions.find(a => a.key === activeAction)?.confirm}>Confirm Delete</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ===== 8) Locations ===== */
function LocationsSection({
  locationHook,
  refetchLocations,
}: {
  locationHook: ReturnType<typeof useLocationSettings>;
  refetchLocations: () => Promise<void>;
}) {
  const { locations, inactiveLocations, loading, addLocation, updateLocation, deactivateLocation } = locationHook;
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    address: "",
    city: "",
    state: "",
    brand: "Other" as string,
    food_cost_target_pct: "30",
    count_frequency_days: "3",
    count_overdue_alert_hrs: "72",
  });

  const afterMutation = useCallback(async () => {
    await refetchLocations();
  }, [refetchLocations]);

  const resetForm = () => setForm({ name: "", address: "", city: "", state: "", brand: "Other", food_cost_target_pct: "30", count_frequency_days: "3", count_overdue_alert_hrs: "72" });

  const handleAdd = async () => {
    if (!form.name.trim() || !form.city.trim() || !form.state.trim()) {
      toast.error("Name, city, and state are required");
      return;
    }
    try {
      await addLocation({
        name: form.name.trim(),
        address: form.address.trim(),
        city: form.city.trim(),
        state: form.state.trim(),
        brand: form.brand === "Other" ? null : form.brand,
        food_cost_target_pct: Number(form.food_cost_target_pct) || 30,
        count_frequency_days: Math.max(1, Number(form.count_frequency_days) || 3),
        count_overdue_alert_hrs: Number(form.count_overdue_alert_hrs) || 72,
      });
      toast.success("Location added");
      setAddOpen(false);
      resetForm();
      await afterMutation();
    } catch {
      toast.error("Could not add location");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" className="gap-1.5 bg-gradient-amber shadow-amber" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" />
          Add Location
        </Button>
      </div>

      {loading && locations.length === 0 ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : locations.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <MapPin className="h-10 w-10 text-muted-foreground/25 mx-auto mb-4" />
            <p className="text-sm font-semibold text-muted-foreground">No locations yet</p>
            <p className="text-xs text-muted-foreground/70 mt-1">Add your first location to get started.</p>
            <Button size="sm" className="gap-1.5 bg-gradient-amber shadow-amber mt-4" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" /> Add Location
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {locations.map((loc) => (
            <LocationCard key={loc.id} loc={loc} onMutate={afterMutation} updateLocation={updateLocation} deactivateLocation={deactivateLocation} />
          ))}
        </div>
      )}

      {inactiveLocations.length > 0 && (
        <Collapsible className="rounded-lg border border-border/60">
          <CollapsibleTrigger className="group flex w-full items-center gap-2 px-4 py-3 text-sm font-medium hover:bg-muted/40">
            <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
            Inactive locations ({inactiveLocations.length})
          </CollapsibleTrigger>
          <CollapsibleContent className="px-4 pb-4 space-y-2">
            {inactiveLocations.map((loc) => (
              <Card key={loc.id} className="opacity-80">
                <CardContent className="p-4 flex justify-between items-center">
                  <div>
                    <p className="font-medium">{loc.name}</p>
                    <p className="text-xs text-muted-foreground">{[loc.city, loc.state].filter(Boolean).join(", ") || "—"}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      try {
                        await updateLocation(loc.id, { is_active: true });
                        toast.success("Location reactivated");
                        await afterMutation();
                      } catch {
                        toast.error("Could not reactivate");
                      }
                    }}
                  >
                    Reactivate
                  </Button>
                </CardContent>
              </Card>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}

      <Dialog open={addOpen} onOpenChange={(v) => { if (!v) resetForm(); setAddOpen(v); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add location</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Name *</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="h-9" />
            </div>
            <div>
              <Label className="text-xs">Address</Label>
              <Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} className="h-9" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">City *</Label>
                <Input value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} className="h-9" />
              </div>
              <div>
                <Label className="text-xs">State *</Label>
                <Input value={form.state} onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))} className="h-9" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Brand</Label>
              <Select value={form.brand} onValueChange={(v) => setForm((f) => ({ ...f, brand: v }))}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BRAND_OPTIONS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-xs">Food cost target %</Label>
                <Input type="number" value={form.food_cost_target_pct} onChange={(e) => setForm((f) => ({ ...f, food_cost_target_pct: e.target.value }))} className="h-9" />
              </div>
              <div>
                <Label className="text-xs">Count every (days)</Label>
                <Input type="number" value={form.count_frequency_days} onChange={(e) => setForm((f) => ({ ...f, count_frequency_days: e.target.value }))} className="h-9" />
              </div>
              <div>
                <Label className="text-xs">Overdue alert (hrs)</Label>
                <Input type="number" value={form.count_overdue_alert_hrs} onChange={(e) => setForm((f) => ({ ...f, count_overdue_alert_hrs: e.target.value }))} className="h-9" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { resetForm(); setAddOpen(false); }}>Cancel</Button>
            <Button className="bg-gradient-amber shadow-amber" onClick={() => void handleAdd()}>Save location</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LocationCard({
  loc,
  onMutate,
  updateLocation,
  deactivateLocation,
}: {
  loc: LocationWithSettings;
  onMutate: () => Promise<void>;
  updateLocation: ReturnType<typeof useLocationSettings>["updateLocation"];
  deactivateLocation: ReturnType<typeof useLocationSettings>["deactivateLocation"];
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(loc.name);
  const [foodCost, setFoodCost] = useState(String(loc.food_cost_target_pct));
  const [freq, setFreq] = useState(String(loc.count_frequency_days));
  const [alertHrs, setAlertHrs] = useState(String(loc.count_overdue_alert_hrs));

  useEffect(() => {
    setNameDraft(loc.name);
    setFoodCost(String(loc.food_cost_target_pct));
    setFreq(String(loc.count_frequency_days));
    setAlertHrs(String(loc.count_overdue_alert_hrs));
  }, [loc.id, loc.name, loc.food_cost_target_pct, loc.count_frequency_days, loc.count_overdue_alert_hrs]);

  const saveName = async () => {
    const v = nameDraft.trim();
    if (!v || v === loc.name) { setEditingName(false); setNameDraft(loc.name); return; }
    try {
      await updateLocation(loc.id, { name: v });
      toast.success("Location updated");
      await onMutate();
    } catch {
      toast.error("Could not save name");
    }
    setEditingName(false);
  };

  const saveSettings = async (patch: Partial<LocationWithSettings>) => {
    try {
      await updateLocation(loc.id, patch);
      toast.success("Saved");
      await onMutate();
    } catch {
      toast.error("Could not save");
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            {editingName ? (
              <Input
                className="h-8 text-base font-semibold max-w-xs"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={() => void saveName()}
                onKeyDown={(e) => { if (e.key === "Enter") void saveName(); }}
                autoFocus
              />
            ) : (
              <button type="button" className="flex items-center gap-1.5 text-left group" onClick={() => setEditingName(true)}>
                <CardTitle className="text-base">{loc.name}</CardTitle>
                <Pencil className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
              </button>
            )}
            <CardDescription>{[loc.city, loc.state].filter(Boolean).join(", ") || "—"}</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {loc.brand && <Badge variant="secondary" className="text-[10px]">{loc.brand}</Badge>}
            <div className="flex items-center gap-2">
              <Label className="text-[10px] text-muted-foreground whitespace-nowrap">Active</Label>
              <Switch
                checked={loc.is_active}
                onCheckedChange={async (on) => {
                  if (!on) {
                    try {
                      await deactivateLocation(loc.id);
                      toast.success("Location deactivated");
                      await onMutate();
                    } catch {
                      toast.error("Could not deactivate");
                    }
                  }
                }}
              />
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <div className="grid sm:grid-cols-3 gap-3">
          <div>
            <Label className="text-[10px] text-muted-foreground">Food cost target %</Label>
            <Input className="h-8 mt-0.5" type="number" value={foodCost} onChange={(e) => setFoodCost(e.target.value)} onBlur={() => void saveSettings({ food_cost_target_pct: Number(foodCost) || 30 })} />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">Every X days</Label>
            <Input className="h-8 mt-0.5" type="number" value={freq} onChange={(e) => setFreq(e.target.value)} onBlur={() => void saveSettings({ count_frequency_days: Math.max(1, Number(freq) || 3) })} />
            <p className="text-[10px] text-muted-foreground mt-0.5">Count frequency</p>
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">Overdue after (hrs)</Label>
            <Input className="h-8 mt-0.5" type="number" value={alertHrs} onChange={(e) => setAlertHrs(e.target.value)} onBlur={() => void saveSettings({ count_overdue_alert_hrs: Number(alertHrs) || 72 })} />
          </div>
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">Brand</Label>
          <Select value={loc.brand ?? "Other"} onValueChange={(v) => void saveSettings({ brand: v === "Other" ? null : v })}>
            <SelectTrigger className="h-8 mt-0.5 w-full max-w-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {BRAND_OPTIONS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}

/* ===== 9) Team & Permissions ===== */
function TeamSection({ locationHook }: { locationHook: ReturnType<typeof useLocationSettings> }) {
  const { locations, teamMembers, pendingInvitations, loading, inviteMember, assignMember, removeMemberFromLocation, cancelInvitation, updatePermissions, refetch } = locationHook;
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"MANAGER" | "STAFF">("MANAGER");
  const [permMember, setPermMember] = useState<TeamMember | null>(null);

  const handleInvite = async () => {
    if (!inviteEmail.trim()) { toast.error("Email required"); return; }
    try {
      await inviteMember({ email: inviteEmail.trim(), role: inviteRole });
      toast.success(`Invitation sent to ${inviteEmail.trim()}`);
      setInviteOpen(false);
      setInviteEmail("");
    } catch {
      toast.error("Could not send invitation");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button size="sm" className="gap-1.5 bg-gradient-amber shadow-amber" onClick={() => setInviteOpen(true)}>
          <Plus className="h-4 w-4" />
          Invite Team Member
        </Button>
      </div>

      {loading && teamMembers.length === 0 ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : teamMembers.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Users className="h-10 w-10 text-muted-foreground/25 mx-auto mb-4" />
            <p className="text-sm font-semibold text-muted-foreground">No team members yet</p>
            <p className="text-xs text-muted-foreground/70 mt-1">Invite your first team member to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {teamMembers.map((m) => (
            <TeamMemberCard
              key={m.member_id}
              member={m}
              locations={locations}
              onEditPermissions={() => setPermMember(m)}
              assignMember={assignMember}
              removeMemberFromLocation={removeMemberFromLocation}
              refetch={refetch}
            />
          ))}
        </div>
      )}

      {pendingInvitations.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Pending invites</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingInvitations.map((inv) => (
              <div key={inv.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/50 p-3">
                <div>
                  <p className="text-sm font-medium">{inv.email}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {inv.role} · sent {formatDistanceToNow(new Date(inv.created_at), { addSuffix: true })}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs text-destructive"
                  onClick={async () => {
                    try {
                      await cancelInvitation(inv.id, inv.source);
                      toast.success("Invitation cancelled");
                    } catch {
                      toast.error("Could not cancel");
                    }
                  }}
                >
                  Cancel
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite team member</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Email *</Label>
              <Input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} className="h-9" placeholder="member@example.com" type="email" />
            </div>
            <div>
              <Label className="text-xs">Role</Label>
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as "MANAGER" | "STAFF")}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MANAGER">Manager</SelectItem>
                  <SelectItem value="STAFF">Staff</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-[11px] text-muted-foreground">
              After they accept, you can assign them to specific locations from the Team tab.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>Close</Button>
            <Button className="bg-gradient-amber shadow-amber" onClick={() => void handleInvite()} disabled={!inviteEmail.trim()}>
              Send invitation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PermissionsSheet
        member={permMember}
        locations={locations}
        open={!!permMember}
        onOpenChange={(o) => !o && setPermMember(null)}
        updatePermissions={updatePermissions}
        refetch={refetch}
      />
    </div>
  );
}

function TeamMemberCard({
  member,
  locations,
  onEditPermissions,
  assignMember,
  removeMemberFromLocation,
  refetch,
}: {
  member: TeamMember;
  locations: LocationWithSettings[];
  onEditPermissions: () => void;
  assignMember: ReturnType<typeof useLocationSettings>["assignMember"];
  removeMemberFromLocation: ReturnType<typeof useLocationSettings>["removeMemberFromLocation"];
  refetch: () => void;
}) {
  const [assignOpen, setAssignOpen] = useState(false);
  const [pickLoc, setPickLoc] = useState<string>("");
  const [pickRole, setPickRole] = useState<"MANAGER" | "STAFF">("MANAGER");
  const [removeTarget, setRemoveTarget] = useState<{ userId: string; locationId: string; label: string } | null>(null);

  const assignableLocations = locations.filter((l) => !member.assignments.some((a) => a.location_id === l.id));

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-semibold">{member.full_name || member.email || "Member"}</p>
            <p className="text-xs text-muted-foreground">{member.email}</p>
            <Badge variant="outline" className="text-[10px] mt-1">{member.role}</Badge>
            {member.role !== "OWNER" && member.assignments.length === 0 && (
              <Badge variant="destructive" className="text-[10px] ml-2">Unassigned</Badge>
            )}
          </div>
          {member.role !== "OWNER" && member.assignments.length > 0 && (
            <Button variant="outline" size="sm" className="text-xs" onClick={onEditPermissions}>
              Edit permissions →
            </Button>
          )}
        </div>

        {member.assignments.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {member.assignments.map((a) => (
              <Badge key={a.assignment_id} variant="secondary" className="text-[10px] gap-1 pr-1">
                {a.location_name}
                <button
                  type="button"
                  className="ml-1 rounded hover:bg-muted px-0.5"
                  aria-label="Remove assignment"
                  onClick={() => setRemoveTarget({ userId: member.user_id, locationId: a.location_id, label: a.location_name })}
                >
                  ×
                </button>
              </Badge>
            ))}
          </div>
        )}

        {member.role !== "OWNER" && assignableLocations.length > 0 && (
          <Button variant="ghost" size="sm" className="text-xs h-7 px-2" onClick={() => setAssignOpen(true)}>
            Assign to location
          </Button>
        )}

        <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Assign to location</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Location</Label>
                <Select value={pickLoc} onValueChange={setPickLoc}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Choose location" /></SelectTrigger>
                  <SelectContent>
                    {assignableLocations.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Role at location</Label>
                <Select value={pickRole} onValueChange={(v) => setPickRole(v as "MANAGER" | "STAFF")}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MANAGER">Manager</SelectItem>
                    <SelectItem value="STAFF">Staff</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAssignOpen(false)}>Cancel</Button>
              <Button
                onClick={async () => {
                  if (!pickLoc) { toast.error("Pick a location"); return; }
                  try {
                    await assignMember(member.user_id, pickLoc, pickRole, { ...DEFAULT_ASSIGNMENT_PERMISSIONS });
                    toast.success("Assigned");
                    setAssignOpen(false);
                    setPickLoc("");
                    refetch();
                  } catch {
                    toast.error("Could not assign");
                  }
                }}
              >
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={!!removeTarget} onOpenChange={(o) => !o && setRemoveTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove from location?</AlertDialogTitle>
              <AlertDialogDescription>Remove this member from {removeTarget?.label}?</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  if (!removeTarget) return;
                  try {
                    await removeMemberFromLocation(removeTarget.userId, removeTarget.locationId);
                    toast.success("Removed from location");
                    setRemoveTarget(null);
                    refetch();
                  } catch {
                    toast.error("Could not remove");
                  }
                }}
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

function PermissionsSheet({
  member,
  locations,
  open,
  onOpenChange,
  updatePermissions,
  refetch,
}: {
  member: TeamMember | null;
  locations: LocationWithSettings[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  updatePermissions: ReturnType<typeof useLocationSettings>["updatePermissions"];
  refetch: () => void;
}) {
  const [selectedLocId, setSelectedLocId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [thresholdDraft, setThresholdDraft] = useState("");

  const assignments = member?.assignments ?? [];
  const selected = assignments.find((a) => a.location_id === selectedLocId) ?? assignments[0];

  useEffect(() => {
    if (!open || !member || member.assignments.length === 0) { setSelectedLocId(null); return; }
    setSelectedLocId((prev) => {
      if (prev && member.assignments.some((a) => a.location_id === prev)) return prev;
      return member.assignments[0].location_id;
    });
  }, [open, member?.member_id]);

  useEffect(() => {
    if (selected) {
      setThresholdDraft(selected.permissions.order_approval_threshold != null ? String(selected.permissions.order_approval_threshold) : "");
    }
  }, [selected?.location_id, selected?.permissions.order_approval_threshold]);

  const patch = async (partial: Partial<LocationPermissions>) => {
    if (!member || !selectedLocId) return;
    setSaving(true);
    try {
      await updatePermissions(member.user_id, selectedLocId, partial);
      refetch();
    } catch {
      toast.error("Could not save permissions");
    } finally {
      setSaving(false);
    }
  };

  if (!member || assignments.length === 0) return null;

  const locName = locations.find((l) => l.id === selectedLocId)?.name ?? selected?.location_name ?? "Location";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Permissions for {member.full_name || member.email} at {locName}</SheetTitle>
          <SheetDescription>Changes apply to the selected location only.</SheetDescription>
        </SheetHeader>
        {assignments.length > 1 && (
          <div className="mt-4">
            <Label className="text-xs">Location</Label>
            <Select value={selectedLocId ?? undefined} onValueChange={setSelectedLocId}>
              <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {assignments.map((a) => <SelectItem key={a.location_id} value={a.location_id}>{a.location_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        {selected && (
          <div className="mt-6 space-y-6">
            {saving && <p className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Saving…</p>}
            <PermRow label="Approve orders independently" description="Can submit orders without owner approval" checked={selected.permissions.can_approve_orders} onCheckedChange={(v) => void patch({ can_approve_orders: v })} />
            <PermRow label="See invoice costs" description="Can see unit prices and totals on invoices" checked={selected.permissions.can_see_costs} onCheckedChange={(v) => void patch({ can_see_costs: v })} />
            <PermRow label="See food cost %" description="Can see food cost percentage reports" checked={selected.permissions.can_see_food_cost_pct} onCheckedChange={(v) => void patch({ can_see_food_cost_pct: v })} />
            <PermRow label="See inventory value" description="Can see total dollar value of inventory" checked={selected.permissions.can_see_inventory_value} onCheckedChange={(v) => void patch({ can_see_inventory_value: v })} />
            <PermRow label="Edit PAR levels" description="Can adjust PAR guide levels" checked={selected.permissions.can_edit_par} onCheckedChange={(v) => void patch({ can_edit_par: v })} />
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Order approval threshold</Label>
              <p className="text-[11px] text-muted-foreground">Require approval for orders above this amount. Leave blank for no limit.</p>
              <Input
                className="h-9"
                type="number"
                placeholder="No limit"
                value={thresholdDraft}
                onChange={(e) => setThresholdDraft(e.target.value)}
                onBlur={() => {
                  const n = thresholdDraft.trim() === "" ? null : Number(thresholdDraft);
                  void patch({ order_approval_threshold: n != null && !Number.isNaN(n) ? n : null });
                }}
              />
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function PermRow({ label, description, checked, onCheckedChange }: { label: string; description: string; checked: boolean; onCheckedChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border/50 p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} className="shrink-0" />
    </div>
  );
}
