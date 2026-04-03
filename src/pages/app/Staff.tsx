import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Users, Trash2, Mail, Clock, Loader2 } from "lucide-react";

export default function StaffPage() {
  const { currentRestaurant } = useRestaurant();
  const [members, setMembers] = useState<any[]>([]);
  const [invitations, setInvitations] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("MANAGER");
  const [sending, setSending] = useState(false);

  const fetchMembers = async () => {
    if (!currentRestaurant) return;
    const { data } = await supabase
      .from("restaurant_members")
      .select("*, profiles(email, full_name)")
      .eq("restaurant_id", currentRestaurant.id);
    if (data) setMembers(data);
  };

  const fetchInvitations = async () => {
    if (!currentRestaurant) return;
    const { data } = await supabase
      .from("invitations")
      .select("*")
      .eq("restaurant_id", currentRestaurant.id)
      .eq("status", "PENDING")
      .order("created_at", { ascending: false });
    if (data) setInvitations(data);
  };

  useEffect(() => {
    fetchMembers();
    fetchInvitations();
  }, [currentRestaurant]);

  const handleInvite = async () => {
    if (!currentRestaurant || !email.trim()) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-invite", {
        body: {
          email: email.trim().toLowerCase(),
          role,
          restaurant_id: currentRestaurant.id,
          app_url: window.location.origin,
        },
      });

      if (error) {
        toast.error("Failed to send invite: " + error.message);
        return;
      }

      if (data?.error) {
        toast.error(data.error);
        return;
      }

      if (data?.email_sent) {
        toast.success(`Invitation sent to ${email}`);
      } else {
        toast.success("Invitation created (email delivery may be delayed)");
      }

      setEmail("");
      setRole("MANAGER");
      setOpen(false);
      fetchInvitations();
    } catch (err: any) {
      toast.error("Failed to send invite");
    } finally {
      setSending(false);
    }
  };

  const handleRevokeInvite = async (invitationId: string) => {
    const { error } = await supabase
      .from("invitations")
      .update({ status: "REVOKED" as any })
      .eq("id", invitationId);
    if (error) toast.error("Failed to revoke invitation");
    else {
      toast.success("Invitation revoked");
      fetchInvitations();
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

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Staff Management</h1>
          <p className="page-description">Manage team members and roles</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="bg-gradient-amber shadow-amber gap-2" size="sm">
              <Plus className="h-4 w-4" /> Invite
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite Staff</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
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
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MANAGER">Manager</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={handleInvite}
                className="w-full bg-gradient-amber"
                disabled={!email.trim() || sending}
              >
                {sending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Mail className="h-4 w-4 mr-2" />
                    Send Invite
                  </>
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Pending Invitations */}
      {invitations.length > 0 && (
        <Card className="overflow-hidden">
          <div className="px-4 py-3 border-b bg-muted/30">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              Pending Invitations
            </h3>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/20">
                <TableHead className="text-xs font-semibold">Email</TableHead>
                <TableHead className="text-xs font-semibold">Role</TableHead>
                <TableHead className="text-xs font-semibold">Sent</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitations.map((inv) => (
                <TableRow key={inv.id} className="hover:bg-muted/30 transition-colors">
                  <TableCell className="text-sm">{inv.email}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs">
                      {inv.role}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(inv.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      onClick={() => handleRevokeInvite(inv.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Active Members */}
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
                  <TableCell className="font-medium text-sm">
                    {m.profiles?.full_name || "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {m.profiles?.email}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={m.role === "STAFF" ? "MANAGER" : m.role}
                      onValueChange={(v: "OWNER" | "MANAGER" | "STAFF") =>
                        handleRoleChange(m.id, v)
                      }
                    >
                      <SelectTrigger className="w-28 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="OWNER">Owner</SelectItem>
                        <SelectItem value="MANAGER">Manager</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    {m.role !== "OWNER" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        onClick={() => handleRemove(m.id)}
                      >
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
