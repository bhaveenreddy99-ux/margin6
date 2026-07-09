import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ChefHat, Loader2, MailWarning } from "lucide-react";

// Public /accept-invite page — consumes the LIVE secure invite backend.
// Preview (get_invite_preview) is pre-auth + non-consuming; accept_invite does the
// atomic single-use consume. Three auth cases + five terminal states, below.

type Preview = {
  invited_email: string;
  restaurant_name: string;
  role: "OWNER" | "MANAGER" | "STAFF";
  status: "pending" | "accepted" | "revoked" | "expired";
  expires_at: string;
};

type Phase = "loading" | "invalid" | "expired" | "used" | "revoked" | "ready";

function roleLabel(role: string): string {
  return role === "MANAGER" ? "Manager" : role === "OWNER" ? "Owner" : "Staff";
}

// Centered-card shell, matching Login/Signup exactly (no new styles).
function Shell({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <ChefHat className="h-5 w-5 text-primary" />
            </div>
            <span className="text-xl font-bold tracking-tight">
              Margin<span className="text-gradient-amber">6</span>
            </span>
          </Link>
          <p className="mt-3 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="rounded-xl border border-border/60 bg-card p-6 shadow-card">{children}</div>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> One moment…
    </div>
  );
}

export default function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const { user, loading: authLoading, signOut } = useAuth();
  const { refetch } = useRestaurant();
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>("loading");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [accepting, setAccepting] = useState(false);

  // Load the non-consuming preview once (keyed on token).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        setPhase("invalid");
        return;
      }
      const { data, error } = await supabase.rpc("get_invite_preview", { p_token: token });
      if (cancelled) return;
      const row = data?.[0] as Preview | undefined;
      if (error || !row) {
        setPhase("invalid"); // 0 rows ⇒ bad/unknown token (INV00 analog)
        return;
      }
      setPreview(row);
      if (row.status === "accepted") setPhase("used");
      else if (row.status === "revoked") setPhase("revoked");
      else if (row.status === "expired" || new Date(row.expires_at).getTime() <= Date.now())
        setPhase("expired");
      else setPhase("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleAccept = async () => {
    setAccepting(true);
    const { error } = await supabase.rpc("accept_invite", { p_token: token });
    setAccepting(false);
    if (error) {
      // Branch on the DEFINER RPC's custom SQLSTATE contract. This also covers a
      // race where the invite changed between preview and accept.
      switch (error.code) {
        case "INV00":
          setPhase("invalid");
          return;
        case "INV02":
          setPhase("expired");
          return;
        case "INV03":
          setPhase("used");
          return;
        case "INV04":
          setPhase("revoked");
          return;
        case "INV01":
          // Wrong-email — DETAIL carries the invited_email.
          toast.error(
            `This invite is for ${error.details ?? preview?.invited_email ?? "a different address"}.`,
          );
          return;
        default:
          toast.error(error.message || "Could not accept the invite.");
          return;
      }
    }
    toast.success(`You've joined ${preview?.restaurant_name ?? "the team"}.`);
    await refetch(); // load the new membership before routing in
    // replace: drop the (now-consumed) token URL from forward history.
    navigate("/app", { replace: true });
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (phase === "loading") {
    return (
      <Shell subtitle="Checking your invitation">
        <Spinner />
      </Shell>
    );
  }

  // ── Terminal states: INV00 / INV02 / INV03 / INV04 ──────────────────────────
  if (phase === "invalid" || phase === "expired" || phase === "used" || phase === "revoked") {
    const msg: Record<Exclude<Phase, "loading" | "ready">, string> = {
      invalid: "This invite link is invalid or expired.",
      expired: "This invite has expired — ask for a new one.",
      used: "This invite was already used.",
      revoked: "This invite was revoked.",
    };
    return (
      <Shell subtitle="Invitation">
        <div className="space-y-4 text-center">
          <MailWarning className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-foreground">{msg[phase]}</p>
          <Button asChild variant="outline" className="h-10 w-full">
            <Link to="/login">Go to sign in</Link>
          </Button>
        </div>
      </Shell>
    );
  }

  // ── phase === "ready" (pending invite) ──────────────────────────────────────
  if (authLoading) {
    return (
      <Shell subtitle="Invitation">
        <Spinner />
      </Shell>
    );
  }

  const invited = preview!.invited_email.toLowerCase();
  const encodedRedirect = encodeURIComponent(`/accept-invite?token=${token}`);
  const invitedLine = (
    <p className="text-center text-sm text-muted-foreground">
      You've been invited to join{" "}
      <strong className="text-foreground">{preview!.restaurant_name}</strong> as{" "}
      <strong className="text-foreground">{roleLabel(preview!.role)}</strong>.
    </p>
  );

  // Case 3 — NOT logged in
  if (!user) {
    return (
      <Shell subtitle="You're invited">
        <div className="space-y-4">
          {invitedLine}
          <Button asChild className="h-10 w-full bg-gradient-amber">
            <Link to={`/signup?invite=${encodeURIComponent(token)}`}>Create account &amp; accept</Link>
          </Button>
          <Button asChild variant="outline" className="h-10 w-full">
            <Link to={`/login?redirect=${encodedRedirect}`}>I already have an account</Link>
          </Button>
          <p className="text-center text-xs text-muted-foreground">Invite for {preview!.invited_email}</p>
        </div>
      </Shell>
    );
  }

  // Case 2 — logged in as a DIFFERENT email (not a dead end)
  if ((user.email ?? "").toLowerCase() !== invited) {
    return (
      <Shell subtitle="Wrong account">
        <div className="space-y-4 text-center">
          <MailWarning className="mx-auto h-8 w-8 text-amber-500" />
          <p className="text-sm text-foreground">
            This invite is for <strong>{preview!.invited_email}</strong>. You're signed in as{" "}
            <strong>{user.email}</strong>.
          </p>
          <p className="text-sm text-muted-foreground">
            Sign out and sign in as {preview!.invited_email} to accept.
          </p>
          <Button
            className="h-10 w-full bg-gradient-amber"
            onClick={async () => {
              await signOut();
              navigate(`/login?redirect=${encodedRedirect}`);
            }}
          >
            Sign out
          </Button>
        </div>
      </Shell>
    );
  }

  // Case 1 — logged in AS the invited email
  return (
    <Shell subtitle="You're invited">
      <div className="space-y-4">
        {invitedLine}
        <Button className="h-10 w-full bg-gradient-amber" onClick={handleAccept} disabled={accepting}>
          {accepting ? "Accepting…" : "Accept invitation"}
        </Button>
        <p className="text-center text-xs text-muted-foreground">Signed in as {user.email}</p>
      </div>
    </Shell>
  );
}
