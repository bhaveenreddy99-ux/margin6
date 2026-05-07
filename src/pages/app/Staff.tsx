import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Plus, Users, Trash2, Mail, Clock, Loader2 } from "lucide-react";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";

type UserInviteRow = Tables<"user_invites">;

export default function StaffPage() {
  const { user } = useAuth();
  const { currentRestaurant, locations } = useRestaurant();
  const [members, setMembers] = useState<any[]>([]);
  const [invites, setInvites] = useState<UserInviteRow[]>([]);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"MANAGER" | "STAFF">("MANAGER");
  const [locationId, setLocationId] = useState<string>("");
  const [canApproveOrders, setCanApproveOrders] = useState(true);
  const [canSeeCosts, setCanSeeCosts] = useState(false);
  const [canSeeFoodCostPct, setCanSeeFoodCostPct] = useState(true);
  const [canSeeInventoryValue, setCanSeeInventoryValue] = useState(false);
  const [canEditPar, setCanEditPar] = useState(true);
  const [sending, setSending] = useState(false);

  const restaurantLocations = locations.filter(
    (l) => l.restaurant_id === currentRestaurant?.id && l.is_active,
  );

  const fetchMembers = async () => {
    if (!currentRestaurant) return;
    const { data } = await supabase
      .from("restaurant_members")
      .select("*, profiles(email, full_name)")
      .eq("restaurant_id", currentRestaurant.id);
    if (data) setMembers(data);
  };

  const fetchInvites = async () => {
    if (!currentRestaurant) return;
    const { data, error } = await supabase
      .from("user_invites")
      .select("*")
      .eq("restaurant_id", currentRestaurant.id)
      .eq("status", "PENDING")
      .order("created_at", { ascending: false });
    if (error) {
      console.error(error);
      return;
    }
    if (data) setInvites(data as UserInviteRow[]);
  };

  useEffect(() => {
    fetchMembers();
    fetchInvites();
  }, [currentRestaurant]);

  useEffect(() => {
    if (!locationId && restaurantLocations.length > 0) {
      setLocationId(restaurantLocations[0].id);
    }
  }, [restaurantLocations, locationId]);

  const resetInviteForm = () => {
    setEmail("");
    setRole("MANAGER");
    setCanApproveOrders(true);
    setCanSeeCosts(false);
    setCanSeeFoodCostPct(true);
    setCanSeeInventoryValue(false);
    setCanEditPar(true);
    if (restaurantLocations[0]) setLocationId(restaurantLocations[0].id);
  };

  const handleInvite = async () => {
    if (!currentRestaurant || !user?.id || !email.trim() || !locationId) {
      toast.error("Email and location are required.");
      return;
    }
    setSending(true);
    try {
      const row: TablesInsert<"user_invites"> = {
        restaurant_id: currentRestaurant.id,
        email: email.trim().toLowerCase(),
        role,
        location_id: locationId,
        invited_by: user.id,
        can_approve_orders: canApproveOrders,
        can_see_costs: canSeeCosts,
        can_see_food_cost_pct: canSeeFoodCostPct,
        can_see_inventory_value: canSeeInventoryValue,
        can_edit_par: canEditPar,
        order_approval_threshold: null,
        status: "PENDING",
      };
      const { error } = await supabase.from("user_invites").insert(row);
      if (error) {
        if (error.code === "23505") {
          toast.error("A pending invite already exists for that email.");
        } else {
          toast.error(error.message);
        }
        return;
      }
      toast.success("Invite saved. They will join on next login.");
      resetInviteForm();
      setOpen(false);
      fetchInvites();
    } finally {
      setSending(false);
    }
  };

  const handleRevokeInvite = async (inviteId: string) => {
    const { error } = await supabase
      .from("user_invites")
      .update({ status: "REVOKED" })
      .eq("id", inviteId);
    if (error) toast.error("Failed to revoke invite");
    else {
      toast.success("Invite revoked");
      fetchInvites();
    }
  };

  const handleRemove = async (memberId: string) => {
    if (currentRestaurant?.role !== "OWNER") {
      toast.error("Only owners can remove staff members");
      return;
    }
    const { error } = await supabase.from("restaurant_members").delete().eq("id", memberId);
    if (error) toast.error("Failed to remove member.");
    else {
      toast.success("Member removed");
      fetchMembers();
    }
  };

  const handleRoleChange = async (memberId: string, newRole: "OWNER" | "MANAGER" | "STAFF") => {
    if (currentRestaurant?.role !== "OWNER") {
      toast.error("Only owners can change roles");
      return;
    }
    const { error } = await supabase.from("restaurant_members").update({ role: newRole }).eq("id", memberId);
    if (error) toast.error("Failed to update role.");
    else fetchMembers();
  };

  const locationName = (id: string) => restaurantLocations.find((l) => l.id === id)?.name ?? id.slice(0, 8);

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Users &amp; Permissions</h1>
          <p className="page-description">Manage team members and invites</p>
          <p className="text-xs text-muted-foreground mt-2">
            Locations, storage types, and assignments:{" "}
            <Link to="/app/locations" className="text-primary font-medium hover:underline">
              Locations &amp; Team
            </Link>
            .
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-gradient-amber shadow-amber gap-2" size="sm">
              <Plus className="h-4 w-4" /> Invite User
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Invite user</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 text-sm">
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="staff@example.com"
                  className="h-10"
                  type="email"
                />
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={role} onValueChange={(v) => setRole(v as "MANAGER" | "STAFF")}>
                  <SelectTrigger className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MANAGER">Manager</SelectItem>
                    <SelectItem value="STAFF">Staff</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Location</Label>
                <Select value={locationId} onValueChange={setLocationId} disabled={restaurantLocations.length === 0}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="Select location" />
                  </SelectTrigger>
                  <SelectContent>
                    {restaurantLocations.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {restaurantLocations.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Add an active location for this restaurant first.</p>
                ) : null}
              </div>
              <div className="space-y-2 rounded-md border border-border/60 p-3">
                <p className="text-xs font-medium text-muted-foreground">Location permissions</p>
                <div className="flex items-center gap-2">
                  <Checkbox id="iap" checked={canApproveOrders} onCheckedChange={(v) => setCanApproveOrders(!!v)} />
                  <Label htmlFor="iap" className="font-normal cursor-pointer">
                    Approve orders
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="isc" checked={canSeeCosts} onCheckedChange={(v) => setCanSeeCosts(!!v)} />
                  <Label htmlFor="isc" className="font-normal cursor-pointer">
                    See costs
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="ifc" checked={canSeeFoodCostPct} onCheckedChange={(v) => setCanSeeFoodCostPct(!!v)} />
                  <Label htmlFor="ifc" className="font-normal cursor-pointer">
                    See food cost %
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="iiv" checked={canSeeInventoryValue} onCheckedChange={(v) => setCanSeeInventoryValue(!!v)} />
                  <Label htmlFor="iiv" className="font-normal cursor-pointer">
                    See inventory value
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="iep" checked={canEditPar} onCheckedChange={(v) => setCanEditPar(!!v)} />
                  <Label htmlFor="iep" className="font-normal cursor-pointer">
                    Edit PAR
                  </Label>
                </div>
              </div>
              <Button
                onClick={() => void handleInvite()}
                className="w-full bg-gradient-amber"
                disabled={!email.trim() || !locationId || sending || restaurantLocations.length === 0}
              >
                {sending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <Mail className="h-4 w-4 mr-2" />
                    Create invite
                  </>
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {invites.length > 0 && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b bg-muted/30">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              Pending invites
            </h3>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/20">
                <TableHead className="text-xs font-semibold">Email</TableHead>
                <TableHead className="text-xs font-semibold">Role</TableHead>
                <TableHead className="text-xs font-semibold">Location</TableHead>
                <TableHead className="text-xs font-semibold">Sent</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invites.map((inv) => (
                <TableRow key={inv.id} className="hover:bg-muted/30 transition-colors">
                  <TableCell className="text-sm">{inv.email}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs">
                      {inv.role}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{locationName(inv.location_id)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(inv.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => void handleRevokeInvite(inv.id)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {members.length === 0 ? (
        <Card>
          <CardContent className="empty-state">
            <Users className="empty-state-icon" />
            <p className="empty-state-title">No staff members</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead className="text-xs font-semibold">Name</TableHead>
                <TableHead className="text-xs font-semibold">Email</TableHead>
                <TableHead className="text-xs font-semibold">Role</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.id} className="hover:bg-muted/30 transition-colors">
                  <TableCell className="font-medium text-sm">{m.profiles?.full_name || "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{m.profiles?.email}</TableCell>
                  <TableCell>
                    <Select
                      value={m.role}
                      onValueChange={(v: "OWNER" | "MANAGER" | "STAFF") => void handleRoleChange(m.id, v)}
                      disabled={currentRestaurant?.role !== "OWNER"}
                    >
                      <SelectTrigger className="w-28 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="OWNER">Owner</SelectItem>
                        <SelectItem value="MANAGER">Manager</SelectItem>
                        <SelectItem value="STAFF">Staff</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    {m.role !== "OWNER" && currentRestaurant?.role === "OWNER" && (
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => void handleRemove(m.id)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
