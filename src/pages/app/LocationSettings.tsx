import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import {
  Building2,
  ChevronDown,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { useRestaurant } from "@/contexts/RestaurantContext";
import {
  DEFAULT_ASSIGNMENT_PERMISSIONS,
  useLocationSettings,
  type Invitation,
  type LocationWithSettings,
  type TeamMember,
} from "@/hooks/useLocationSettings";
import type { LocationPermissions } from "@/contexts/RestaurantContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

export default function LocationSettingsPage() {
  const { currentRestaurant, refetchLocations } = useRestaurant();
  const restaurantId = currentRestaurant?.id;
  const isOwner = currentRestaurant?.role === "OWNER";

  const hook = useLocationSettings(isOwner ? restaurantId : undefined);
  const {
    locations,
    inactiveLocations,
    teamMembers,
    pendingInvitations,
    addLocation,
    updateLocation,
    deactivateLocation,
    inviteMember,
    assignMember,
    removeMemberFromLocation,
    cancelInvitation,
    updatePermissions,
    loading,
    error,
    refetch,
  } = hook;

  const [tab, setTab] = useState("locations");
  const [teamFilterLocationId, setTeamFilterLocationId] = useState<string | null>(null);

  const afterLocationMutation = useCallback(async () => {
    await refetchLocations();
    refetch();
  }, [refetch, refetchLocations]);

  if (!isOwner) {
    return <Navigate to="/app/dashboard" replace />;
  }

  if (!restaurantId) {
    return (
      <Card>
        <CardContent className="empty-state py-16">
          <Building2 className="empty-state-icon" />
          <p className="empty-state-title">Select a restaurant</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-5xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">Locations &amp; Team</h1>
          <p className="page-description">{currentRestaurant?.name}</p>
          <p className="text-xs text-muted-foreground mt-2">
            For invites with per-location permissions and the full invite form, use{" "}
            <Link to="/app/staff" className="text-primary font-medium hover:underline">
              Users &amp; Permissions
            </Link>
            .
          </p>
        </div>
      </div>

      {error ? (
        <p className="text-xs text-destructive font-mono leading-relaxed">{error}</p>
      ) : null}

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="locations" className="gap-2">
            <MapPin className="h-4 w-4" />
            Locations
          </TabsTrigger>
          <TabsTrigger value="team" className="gap-2">
            <Users className="h-4 w-4" />
            Team
          </TabsTrigger>
        </TabsList>

        <TabsContent value="locations" className="mt-6 space-y-6">
          <LocationsTab
            locations={locations}
            inactiveLocations={inactiveLocations}
            loading={loading}
            teamFilterLocationId={teamFilterLocationId}
            onSwitchToTeam={(locId) => {
              setTeamFilterLocationId(locId);
              setTab("team");
            }}
            onMutate={afterLocationMutation}
            addLocation={addLocation}
            updateLocation={updateLocation}
            deactivateLocation={deactivateLocation}
          />
        </TabsContent>

        <TabsContent value="team" className="mt-6 space-y-6">
          <TeamTab
            locations={locations}
            teamMembers={teamMembers}
            pendingInvitations={pendingInvitations}
            loading={loading}
            filterLocationId={teamFilterLocationId}
            onClearFilter={() => setTeamFilterLocationId(null)}
            refetch={refetch}
            inviteMember={inviteMember}
            assignMember={assignMember}
            removeMemberFromLocation={removeMemberFromLocation}
            cancelInvitation={cancelInvitation}
            updatePermissions={updatePermissions}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function LocationsTab({
  locations,
  inactiveLocations,
  loading,
  teamFilterLocationId,
  onSwitchToTeam,
  onMutate,
  addLocation,
  updateLocation,
  deactivateLocation,
}: {
  locations: LocationWithSettings[];
  inactiveLocations: LocationWithSettings[];
  loading: boolean;
  teamFilterLocationId: string | null;
  onSwitchToTeam: (locationId: string) => void;
  onMutate: () => Promise<void>;
  addLocation: ReturnType<typeof useLocationSettings>["addLocation"];
  updateLocation: ReturnType<typeof useLocationSettings>["updateLocation"];
  deactivateLocation: ReturnType<typeof useLocationSettings>["deactivateLocation"];
}) {
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
      setForm({
        name: "",
        address: "",
        city: "",
        state: "",
        brand: "Other",
        food_cost_target_pct: "30",
        count_frequency_days: "3",
        count_overdue_alert_hrs: "72",
      });
      await onMutate();
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
      ) : (
        <div className="space-y-3">
          {locations.map((loc) => (
            <LocationCard
              key={loc.id}
              loc={loc}
              highlight={teamFilterLocationId === loc.id}
              onMutate={onMutate}
              updateLocation={updateLocation}
              deactivateLocation={deactivateLocation}
              onManageTeam={() => onSwitchToTeam(loc.id)}
            />
          ))}
        </div>
      )}

      {inactiveLocations.length > 0 ? (
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
                    <p className="text-xs text-muted-foreground">
                      {[loc.city, loc.state].filter(Boolean).join(", ") || "—"}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      try {
                        await updateLocation(loc.id, { is_active: true });
                        toast.success("Location reactivated");
                        await onMutate();
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
      ) : null}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
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
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BRAND_OPTIONS.map((b) => (
                    <SelectItem key={b} value={b}>
                      {b}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-xs">Food cost target %</Label>
                <Input
                  type="number"
                  value={form.food_cost_target_pct}
                  onChange={(e) => setForm((f) => ({ ...f, food_cost_target_pct: e.target.value }))}
                  className="h-9"
                />
              </div>
              <div>
                <Label className="text-xs">Count every (days)</Label>
                <Input
                  type="number"
                  value={form.count_frequency_days}
                  onChange={(e) => setForm((f) => ({ ...f, count_frequency_days: e.target.value }))}
                  className="h-9"
                />
              </div>
              <div>
                <Label className="text-xs">Overdue alert (hrs)</Label>
                <Input
                  type="number"
                  value={form.count_overdue_alert_hrs}
                  onChange={(e) => setForm((f) => ({ ...f, count_overdue_alert_hrs: e.target.value }))}
                  className="h-9"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button className="bg-gradient-amber shadow-amber" onClick={() => void handleAdd()}>
              Save location
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LocationCard({
  loc,
  highlight,
  onMutate,
  updateLocation,
  deactivateLocation,
  onManageTeam,
}: {
  loc: LocationWithSettings;
  highlight: boolean;
  onMutate: () => Promise<void>;
  updateLocation: ReturnType<typeof useLocationSettings>["updateLocation"];
  deactivateLocation: ReturnType<typeof useLocationSettings>["deactivateLocation"];
  onManageTeam: () => void;
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
    if (!v || v === loc.name) {
      setEditingName(false);
      setNameDraft(loc.name);
      return;
    }
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
    <Card className={highlight ? "ring-2 ring-primary/30" : ""}>
      <CardHeader className="pb-2 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            {editingName ? (
              <Input
                className="h-8 text-base font-semibold max-w-xs"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={() => void saveName()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveName();
                }}
                autoFocus
              />
            ) : (
              <button type="button" className="flex items-center gap-1.5 text-left group" onClick={() => setEditingName(true)}>
                <CardTitle className="text-base">{loc.name}</CardTitle>
                <Pencil className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
              </button>
            )}
            <CardDescription>
              {[loc.city, loc.state].filter(Boolean).join(", ") || "—"}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {loc.brand ? (
              <Badge variant="secondary" className="text-[10px]">
                {loc.brand}
              </Badge>
            ) : null}
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
            <Input
              className="h-8 mt-0.5"
              type="number"
              value={foodCost}
              onChange={(e) => setFoodCost(e.target.value)}
              onBlur={() =>
                void saveSettings({ food_cost_target_pct: Number(foodCost) || 30 })
              }
            />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">Every X days</Label>
            <Input
              className="h-8 mt-0.5"
              type="number"
              value={freq}
              onChange={(e) => setFreq(e.target.value)}
              onBlur={() => void saveSettings({ count_frequency_days: Math.max(1, Number(freq) || 3) })}
            />
            <p className="text-[10px] text-muted-foreground mt-0.5">Count frequency</p>
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">Overdue after (hrs)</Label>
            <Input
              className="h-8 mt-0.5"
              type="number"
              value={alertHrs}
              onChange={(e) => setAlertHrs(e.target.value)}
              onBlur={() => void saveSettings({ count_overdue_alert_hrs: Number(alertHrs) || 72 })}
            />
          </div>
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">Brand</Label>
          <Select
            value={loc.brand ?? "Other"}
            onValueChange={(v) => void saveSettings({ brand: v === "Other" ? null : v })}
          >
            <SelectTrigger className="h-8 mt-0.5 w-full max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BRAND_OPTIONS.map((b) => (
                <SelectItem key={b} value={b}>
                  {b}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" className="text-xs gap-1" onClick={onManageTeam}>
          Manage team →
        </Button>
      </CardContent>
    </Card>
  );
}

function TeamTab({
  locations,
  teamMembers,
  pendingInvitations,
  loading,
  filterLocationId,
  onClearFilter,
  refetch,
  inviteMember,
  assignMember,
  removeMemberFromLocation,
  cancelInvitation,
  updatePermissions,
}: {
  locations: LocationWithSettings[];
  teamMembers: TeamMember[];
  pendingInvitations: Invitation[];
  loading: boolean;
  filterLocationId: string | null;
  onClearFilter: () => void;
  refetch: () => void;
  inviteMember: ReturnType<typeof useLocationSettings>["inviteMember"];
  assignMember: ReturnType<typeof useLocationSettings>["assignMember"];
  removeMemberFromLocation: ReturnType<typeof useLocationSettings>["removeMemberFromLocation"];
  cancelInvitation: (id: string, source: Invitation["source"]) => Promise<void>;
  updatePermissions: ReturnType<typeof useLocationSettings>["updatePermissions"];
}) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"MANAGER" | "STAFF">("MANAGER");
  const [permMember, setPermMember] = useState<TeamMember | null>(null);

  const filteredMembers = useMemo(() => {
    if (!filterLocationId) return teamMembers;
    return teamMembers.filter((m) => m.assignments.some((a) => a.location_id === filterLocationId));
  }, [teamMembers, filterLocationId]);

  const handleInvite = async () => {
    if (!inviteEmail.trim()) {
      toast.error("Email required");
      return;
    }
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
      {filterLocationId ? (
        <div className="flex items-center gap-2 text-sm">
          <Badge variant="outline">Filtered by location</Badge>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClearFilter}>
            Clear filter
          </Button>
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button size="sm" className="gap-1.5" onClick={() => setInviteOpen(true)}>
          <Plus className="h-4 w-4" />
          Invite Team Member
        </Button>
      </div>

      {loading && teamMembers.length === 0 ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-3">
          {filteredMembers.map((m) => (
            <TeamMemberCard
              key={m.member_id}
              member={m}
              locations={locations}
              filterLocationId={filterLocationId}
              onEditPermissions={() => setPermMember(m)}
              assignMember={assignMember}
              removeMemberFromLocation={removeMemberFromLocation}
              refetch={refetch}
            />
          ))}
        </div>
      )}

      {pendingInvitations.length > 0 ? (
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
                    {inv.role} · {inv.source === "user_invite" ? "user invite" : "legacy invite"} · sent{" "}
                    {formatDistanceToNow(new Date(inv.created_at), { addSuffix: true })}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs"
                    onClick={() => toast.message("Invite link ready", { description: "Email delivery is not enabled for MVP." })}
                  >
                    Resend
                  </Button>
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
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite team member</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Email *</Label>
              <Input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} className="h-9" />
            </div>
            <div>
              <Label className="text-xs">Role</Label>
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as "MANAGER" | "STAFF")}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MANAGER">Manager</SelectItem>
                  <SelectItem value="STAFF">Staff</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <p className="text-[11px] text-muted-foreground">
              After they accept the invite, assign them to locations here on the Team tab.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>
              Close
            </Button>
            <Button onClick={() => void handleInvite()}>Send invitation</Button>
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
  filterLocationId,
  onEditPermissions,
  assignMember,
  removeMemberFromLocation,
  refetch,
}: {
  member: TeamMember;
  locations: LocationWithSettings[];
  filterLocationId: string | null;
  onEditPermissions: () => void;
  assignMember: ReturnType<typeof useLocationSettings>["assignMember"];
  removeMemberFromLocation: ReturnType<typeof useLocationSettings>["removeMemberFromLocation"];
  refetch: () => void;
}) {
  const [assignOpen, setAssignOpen] = useState(false);
  const [pickLoc, setPickLoc] = useState<string>("");
  const [pickRole, setPickRole] = useState<"MANAGER" | "STAFF">("MANAGER");
  const [removeTarget, setRemoveTarget] = useState<{ userId: string; locationId: string; label: string } | null>(null);

  const showUnassigned =
    member.role !== "OWNER" && member.assignments.length === 0;

  const displayAssignments = filterLocationId
    ? member.assignments.filter((a) => a.location_id === filterLocationId)
    : member.assignments;

  const assignableLocations = locations.filter(
    (l) => !member.assignments.some((a) => a.location_id === l.id),
  );

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-semibold">{member.full_name || member.email || "Member"}</p>
            <p className="text-xs text-muted-foreground">{member.email}</p>
            <Badge variant="outline" className="text-[10px] mt-1">
              {member.role}
            </Badge>
            {showUnassigned ? (
              <Badge variant="destructive" className="text-[10px] ml-2">
                Unassigned
              </Badge>
            ) : null}
          </div>
          {member.role !== "OWNER" && member.assignments.length > 0 ? (
            <Button variant="outline" size="sm" className="text-xs" onClick={onEditPermissions}>
              Edit permissions →
            </Button>
          ) : null}
        </div>
        {displayAssignments.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {displayAssignments.map((a) => (
              <Badge key={a.assignment_id} variant="secondary" className="text-[10px] gap-1 pr-1">
                {a.location_name}
                <button
                  type="button"
                  className="ml-1 rounded hover:bg-muted px-0.5"
                  aria-label="Remove assignment"
                  onClick={() =>
                    setRemoveTarget({
                      userId: member.user_id,
                      locationId: a.location_id,
                      label: a.location_name,
                    })
                  }
                >
                  ×
                </button>
              </Badge>
            ))}
          </div>
        ) : null}
        {member.role !== "OWNER" && assignableLocations.length > 0 ? (
          <Button variant="ghost" size="sm" className="text-xs h-7 px-2" onClick={() => setAssignOpen(true)}>
            Assign to location
          </Button>
        ) : null}

        <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Assign to location</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Location</Label>
                <Select value={pickLoc} onValueChange={setPickLoc}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Choose location" />
                  </SelectTrigger>
                  <SelectContent>
                    {assignableLocations.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Role at location</Label>
                <Select value={pickRole} onValueChange={(v) => setPickRole(v as "MANAGER" | "STAFF")}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MANAGER">Manager</SelectItem>
                    <SelectItem value="STAFF">Staff</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAssignOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  if (!pickLoc) {
                    toast.error("Pick a location");
                    return;
                  }
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
              <AlertDialogDescription>
                Remove this member from {removeTarget?.label}?
              </AlertDialogDescription>
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
    if (!open || !member || member.assignments.length === 0) {
      setSelectedLocId(null);
      return;
    }
    setSelectedLocId((prev) => {
      if (prev && member.assignments.some((a) => a.location_id === prev)) return prev;
      return member.assignments[0].location_id;
    });
  }, [open, member?.member_id]);

  useEffect(() => {
    if (selected) {
      setThresholdDraft(
        selected.permissions.order_approval_threshold != null
          ? String(selected.permissions.order_approval_threshold)
          : "",
      );
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
          <SheetTitle>
            Permissions for {member.full_name || member.email} at {locName}
          </SheetTitle>
          <SheetDescription>Changes apply to the selected location only.</SheetDescription>
        </SheetHeader>
        {assignments.length > 1 ? (
          <div className="mt-4">
            <Label className="text-xs">Location</Label>
            <Select value={selectedLocId ?? undefined} onValueChange={setSelectedLocId}>
              <SelectTrigger className="h-9 mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {assignments.map((a) => (
                  <SelectItem key={a.location_id} value={a.location_id}>
                    {a.location_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        {selected ? (
          <div className="mt-6 space-y-6">
            {saving ? (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Saving…
              </p>
            ) : null}
            <PermRow
              label="Approve orders independently"
              description="Manager can submit orders without your approval"
              checked={selected.permissions.can_approve_orders}
              onCheckedChange={(v) => void patch({ can_approve_orders: v })}
            />
            <PermRow
              label="See invoice costs"
              description="Manager can see unit prices and totals on invoices"
              checked={selected.permissions.can_see_costs}
              onCheckedChange={(v) => void patch({ can_see_costs: v })}
            />
            <PermRow
              label="See food cost %"
              description="Manager can see food cost percentage reports for their location"
              checked={selected.permissions.can_see_food_cost_pct}
              onCheckedChange={(v) => void patch({ can_see_food_cost_pct: v })}
            />
            <PermRow
              label="See inventory value"
              description="Manager can see total dollar value of inventory"
              checked={selected.permissions.can_see_inventory_value}
              onCheckedChange={(v) => void patch({ can_see_inventory_value: v })}
            />
            <PermRow
              label="Edit PAR levels"
              description="Manager can adjust PAR guide levels for their location"
              checked={selected.permissions.can_edit_par}
              onCheckedChange={(v) => void patch({ can_edit_par: v })}
            />
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Order approval threshold</Label>
              <p className="text-[11px] text-muted-foreground">Require your approval for orders above this amount. Leave blank for no limit.</p>
              <Input
                className="h-9"
                type="number"
                placeholder="No limit"
                value={thresholdDraft}
                onChange={(e) => setThresholdDraft(e.target.value)}
                onBlur={() => {
                  const n = thresholdDraft.trim() === "" ? null : Number(thresholdDraft);
                  void patch({
                    order_approval_threshold: n != null && !Number.isNaN(n) ? n : null,
                  });
                }}
              />
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function PermRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
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
