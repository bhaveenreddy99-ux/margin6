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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import {
  Building2, MapPin, Package, BookOpen,
  ShoppingCart, FileUp, Users, AlertTriangle, Plus, Trash2, Star,
  X, Check, Pencil, Power, CalendarClock, ChevronRight,
} from "lucide-react";
import { InventoryScheduleSection } from "@/pages/app/settings/InventorySchedule";

const TOP_NAV = [
  { key: "general",   label: "Business Profile",    icon: Building2,    desc: "Restaurant name, contact info, timezone & currency" },
  { key: "locations", label: "Locations",            icon: MapPin,       desc: "Manage store locations for multi-location inventory" },
  { key: "inventory", label: "Inventory",            icon: Package,      desc: "Default categories, units, and entry behavior" },
  { key: "users",     label: "Users & Permissions",  icon: Users,        desc: "Team roles and default location assignments" },
  { key: "schedule",  label: "Inventory Schedule",   icon: CalendarClock, desc: "Reminders and auto-session scheduling", managerOnly: true },
];

const ADVANCED_NAV = [
  { key: "par",        label: "PAR Defaults",        icon: BookOpen,     desc: "Lead time, reorder threshold and auto-apply settings" },
  { key: "smartorder", label: "Smart Order Defaults", icon: ShoppingCart, desc: "Risk thresholds and automation for order generation" },
  { key: "imports",    label: "Imports & Mapping",    icon: FileUp,       desc: "Saved column mappings from previous file imports" },
  { key: "danger",     label: "Danger Zone",          icon: AlertTriangle, desc: "Irreversible actions — delete history or restaurant", ownerOnly: true },
];

export default function SettingsPage() {
  const { currentRestaurant } = useRestaurant();
  const { user } = useAuth();
  const [section, setSection] = useState("general");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const isOwner = currentRestaurant?.role === "OWNER";
  const isManager = currentRestaurant?.role === "MANAGER" || isOwner;

  // Auto-open advanced section if an advanced item is selected
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
          {TOP_NAV.filter(item => !item.managerOnly || isManager).map(item => (
            <NavButton key={item.key} navKey={item.key} label={item.label} icon={item.icon} desc={item.desc} />
          ))}

          {/* Advanced Settings collapsible — OWNER/MANAGER only */}
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
          {section === "general"    && <GeneralSection restaurantId={currentRestaurant?.id} isManager={isManager} restaurantName={currentRestaurant?.name} />}
          {section === "locations"  && <LocationsSection restaurantId={currentRestaurant?.id} isManager={isManager} />}
          {section === "inventory"  && <InventorySection restaurantId={currentRestaurant?.id} isManager={isManager} />}
          {section === "par"        && <PARSection restaurantId={currentRestaurant?.id} isManager={isManager} />}
          {section === "smartorder" && <SmartOrderSection restaurantId={currentRestaurant?.id} isManager={isManager} />}
          {section === "imports"    && <ImportsSection restaurantId={currentRestaurant?.id} isManager={isManager} />}
          {section === "users"      && <UsersSection restaurantId={currentRestaurant?.id} isOwner={isOwner} isManager={isManager} />}
          {section === "schedule"   && isManager && <InventoryScheduleSection restaurantId={currentRestaurant?.id} isManager={isManager} />}
          {section === "danger"     && isOwner && <DangerSection restaurantId={currentRestaurant?.id} isOwner={isOwner} isManager={isManager} />}
        </div>
      </div>
    </div>
  );
}

/* ===== 1) General ===== */
function GeneralSection({ restaurantId, isManager, restaurantName }: { restaurantId?: string; isManager: boolean; restaurantName?: string }) {
  const [form, setForm] = useState({ business_email: "", phone: "", address: "", currency: "USD", timezone: "America/New_York", date_format: "MM/DD/YYYY" });
  const [name, setName] = useState(restaurantName || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!restaurantId) return;
    setName(restaurantName || "");
    supabase.from("restaurant_settings").select("*").eq("restaurant_id", restaurantId).maybeSingle().then(({ data }) => {
      if (data) {
        setForm({ business_email: data.business_email || "", phone: data.phone || "", address: data.address || "", currency: data.currency, timezone: data.timezone, date_format: data.date_format });
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

/* ===== 2) Locations ===== */
function LocationsSection({ restaurantId, isManager }: { restaurantId?: string; isManager: boolean }) {
  const [locations, setLocations] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", address: "", city: "", state: "", zip: "", storage_types: ["Cooler", "Freezer", "Dry Storage", "Bar"] });
  const [customStorage, setCustomStorage] = useState("");

  const fetch = useCallback(async () => {
    if (!restaurantId) return;
    const { data } = await supabase.from("locations").select("*").eq("restaurant_id", restaurantId).order("created_at");
    if (data) setLocations(data);
  }, [restaurantId]);
  useEffect(() => { fetch(); }, [fetch]);

  const resetForm = () => { setForm({ name: "", address: "", city: "", state: "", zip: "", storage_types: ["Cooler", "Freezer", "Dry Storage", "Bar"] }); setEditId(null); setCustomStorage(""); };

  const handleSave = async () => {
    if (!restaurantId || !form.name.trim()) { toast.error("Location name is required"); return; }
    if (editId) {
      const { error } = await supabase.from("locations").update({ name: form.name, address: form.address, city: form.city, state: form.state, zip: form.zip, storage_types: form.storage_types }).eq("id", editId);
      if (error) toast.error("Failed to update"); else toast.success("Location updated");
    } else {
      const { error } = await supabase.from("locations").insert({ restaurant_id: restaurantId, name: form.name, address: form.address, city: form.city, state: form.state, zip: form.zip, storage_types: form.storage_types });
      if (error) toast.error("Failed to add location"); else toast.success("Location added");
    }
    resetForm(); setOpen(false); fetch();
  };

  const handleSetDefault = async (id: string) => {
    await supabase.from("locations").update({ is_default: false }).eq("restaurant_id", restaurantId!);
    await supabase.from("locations").update({ is_default: true }).eq("id", id);
    toast.success("Default location set"); fetch();
  };

  const handleToggleActive = async (id: string, active: boolean) => {
    await supabase.from("locations").update({ is_active: !active }).eq("id", id);
    fetch();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this location? Linked inventory items will be unlinked.")) return;
    await supabase.from("locations").delete().eq("id", id);
    toast.success("Location deleted"); fetch();
  };

  const toggleStorage = (s: string) => {
    setForm(p => ({ ...p, storage_types: p.storage_types.includes(s) ? p.storage_types.filter(x => x !== s) : [...p.storage_types, s] }));
  };
  const addCustomStorage = () => {
    if (customStorage.trim() && !form.storage_types.includes(customStorage.trim())) {
      setForm(p => ({ ...p, storage_types: [...p.storage_types, customStorage.trim()] }));
      setCustomStorage("");
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div><CardTitle className="text-base">Locations</CardTitle><CardDescription>Manage store locations for multi-location inventory</CardDescription></div>
          {isManager && <Button size="sm" className="bg-gradient-amber shadow-amber gap-1.5" onClick={() => { resetForm(); setOpen(true); }}><Plus className="h-3.5 w-3.5" />Add Location</Button>}
        </CardHeader>
        <CardContent>
          {locations.length === 0 ? (
            <div className="empty-state"><MapPin className="empty-state-icon" /><p className="empty-state-title">No locations added</p><p className="empty-state-description">Add your first store location to organize inventory by site.</p></div>
          ) : (
            <Table>
              <TableHeader><TableRow className="bg-muted/30"><TableHead className="text-xs font-semibold">Location Name</TableHead><TableHead className="text-xs font-semibold">Address</TableHead><TableHead className="text-xs font-semibold">Status</TableHead><TableHead className="text-xs font-semibold">Default</TableHead><TableHead className="text-xs font-semibold w-40">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {locations.map(loc => (
                  <TableRow key={loc.id} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="font-medium text-sm">{loc.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{[loc.address, loc.city, loc.state, loc.zip].filter(Boolean).join(", ") || "—"}</TableCell>
                    <TableCell><Badge variant={loc.is_active ? "default" : "secondary"} className="text-[10px]">{loc.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                    <TableCell>{loc.is_default && <Star className="h-4 w-4 text-warning fill-warning" />}</TableCell>
                    <TableCell className="flex gap-1">
                      {isManager && (
                        <>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setEditId(loc.id); setForm({ name: loc.name, address: loc.address || "", city: loc.city || "", state: loc.state || "", zip: loc.zip || "", storage_types: (loc.storage_types as string[]) || [] }); setOpen(true); }}><Pencil className="h-3.5 w-3.5" /></Button>
                          {!loc.is_default && <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => handleSetDefault(loc.id)}><Star className="h-3.5 w-3.5" /></Button>}
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => handleToggleActive(loc.id, loc.is_active)}><Power className="h-3.5 w-3.5" /></Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => handleDelete(loc.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
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
        <DialogContent>
          <DialogHeader><DialogTitle>{editId ? "Edit Location" : "Add Location"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label className="text-xs">Location Name *</Label><Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className="h-9" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-xs">Address</Label><Input value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} className="h-9" /></div>
              <div className="space-y-1.5"><Label className="text-xs">City</Label><Input value={form.city} onChange={e => setForm(p => ({ ...p, city: e.target.value }))} className="h-9" /></div>
              <div className="space-y-1.5"><Label className="text-xs">State</Label><Input value={form.state} onChange={e => setForm(p => ({ ...p, state: e.target.value }))} className="h-9" /></div>
              <div className="space-y-1.5"><Label className="text-xs">Zip</Label><Input value={form.zip} onChange={e => setForm(p => ({ ...p, zip: e.target.value }))} className="h-9" /></div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Storage Types</Label>
              <div className="flex flex-wrap gap-2">
                {["Cooler", "Freezer", "Dry Storage", "Bar"].map(s => (
                  <Badge key={s} variant={form.storage_types.includes(s) ? "default" : "outline"} className="cursor-pointer text-xs" onClick={() => toggleStorage(s)}>{s}{form.storage_types.includes(s) && <Check className="h-3 w-3 ml-1" />}</Badge>
                ))}
                {form.storage_types.filter(s => !["Cooler", "Freezer", "Dry Storage", "Bar"].includes(s)).map(s => (
                  <Badge key={s} variant="default" className="cursor-pointer text-xs" onClick={() => toggleStorage(s)}>{s}<X className="h-3 w-3 ml-1" /></Badge>
                ))}
              </div>
              <div className="flex gap-2 mt-1">
                <Input value={customStorage} onChange={e => setCustomStorage(e.target.value)} placeholder="Custom type" className="h-8 text-xs" onKeyDown={e => e.key === "Enter" && addCustomStorage()} />
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={addCustomStorage}>Add</Button>
              </div>
            </div>
          </div>
          <DialogFooter><Button onClick={handleSave} className="bg-gradient-amber shadow-amber">{editId ? "Update" : "Add Location"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ===== 3) Inventory Settings ===== */
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
      <CardHeader><CardTitle className="text-base">Inventory Settings</CardTitle><CardDescription>Configure default categories, units, and behavior</CardDescription></CardHeader>
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

/* ===== 7) Users & Permissions ===== */
function UsersSection({ restaurantId, isOwner, isManager }: { restaurantId?: string; isOwner: boolean; isManager: boolean }) {
  const [members, setMembers] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);

  const fetch = useCallback(async () => {
    if (!restaurantId) return;
    const [{ data: m }, { data: l }] = await Promise.all([
      supabase.from("restaurant_members").select("*, profiles(email, full_name)").eq("restaurant_id", restaurantId),
      supabase.from("locations").select("id, name").eq("restaurant_id", restaurantId).eq("is_active", true),
    ]);
    if (m) setMembers(m);
    if (l) setLocations(l);
  }, [restaurantId]);
  useEffect(() => { fetch(); }, [fetch]);

  const handleRoleChange = async (memberId: string, newRole: "OWNER" | "MANAGER" | "STAFF") => {
    if (!isOwner) { toast.error("Only owners can change roles"); return; }
    await supabase.from("restaurant_members").update({ role: newRole }).eq("id", memberId);
    fetch();
  };

  const handleLocationChange = async (memberId: string, locationId: string) => {
    if (!isOwner) { toast.error("Only owners can assign locations"); return; }
    await supabase.from("restaurant_members").update({ default_location_id: locationId === "none" ? null : locationId }).eq("id", memberId);
    fetch();
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Users & Permissions</CardTitle><CardDescription>Manage team roles and default locations</CardDescription></CardHeader>
      <CardContent>
        {members.length === 0 ? (
          <div className="empty-state"><Users className="empty-state-icon" /><p className="empty-state-title">No members</p></div>
        ) : (
          <Table>
            <TableHeader><TableRow className="bg-muted/30"><TableHead className="text-xs font-semibold">Name</TableHead><TableHead className="text-xs font-semibold">Email</TableHead><TableHead className="text-xs font-semibold">Role</TableHead><TableHead className="text-xs font-semibold">Default Location</TableHead></TableRow></TableHeader>
            <TableBody>{members.map(m => (
              <TableRow key={m.id} className="hover:bg-muted/30 transition-colors">
                <TableCell className="font-medium text-sm">{m.profiles?.full_name || "—"}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{m.profiles?.email}</TableCell>
                <TableCell>
                  <Select value={m.role} onValueChange={(v: "OWNER" | "MANAGER" | "STAFF") => handleRoleChange(m.id, v)} disabled={!isOwner}>
                    <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="OWNER">Owner</SelectItem><SelectItem value="MANAGER">Manager</SelectItem><SelectItem value="STAFF">Staff</SelectItem></SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Select value={m.default_location_id || "none"} onValueChange={v => handleLocationChange(m.id, v)} disabled={!isOwner}>
                    <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="No default" /></SelectTrigger>
                    <SelectContent><SelectItem value="none">No default</SelectItem>{locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
                  </Select>
                </TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/* ===== 8) Danger Zone ===== */
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
