import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ChefHat, MailCheck } from "lucide-react";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [emailLocked, setEmailLocked] = useState(false);
  const [sent, setSent] = useState(false);
  const [inviteRestaurant, setInviteRestaurant] = useState("");
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const inviteToken = params.get("invite") ?? "";
  // Where to land after signup when this is an invite acceptance.
  const acceptPath = inviteToken ? `/accept-invite?token=${encodeURIComponent(inviteToken)}` : "";

  // Invite signups pre-fill AND lock the email to the invited address (the invite is
  // email-bound; accept_invite rejects any other address). Fetched via the pre-auth
  // non-consuming preview RPC.
  useEffect(() => {
    if (!inviteToken) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.rpc("get_invite_preview", { p_token: inviteToken });
      const row = data?.[0];
      if (!cancelled && row?.invited_email) {
        setEmail(row.invited_email);
        setEmailLocked(true);
        setInviteRestaurant(row.restaurant_name ?? "");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteToken]);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    // Faster activation: disable "Confirm email" in Supabase Dashboard →
    // Authentication → Providers → Email → Confirm email (off).
    // For invites, redirect the confirmation link back to the accept page so the
    // token survives the email round-trip.
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: acceptPath ? `${window.location.origin}${acceptPath}` : window.location.origin,
      },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }

    if (data.session && data.user) {
      // Session established immediately (email confirmation off) → go straight to
      // accept if this is an invite, otherwise into restaurant setup.
      toast.success(acceptPath ? "Account created — accepting your invite" : "Account created — let's set up your restaurant");
      navigate(acceptPath || "/onboarding/create-restaurant");
      return;
    }

    if (data.user) {
      // Email confirmation is required. For invites, show a clear in-place
      // "confirm your email" step (the token lives in the emailed confirmation
      // link, so it survives until they return). Non-invite signups keep the
      // existing behavior.
      if (inviteToken) {
        setSent(true);
        return;
      }
      toast.success("Check your email to continue");
      toast.message("Didn't get it? Check spam or try again.");
      navigate("/login");
    }
  };

  // Clear confirm-your-email step for invite signups (not a dead end — the
  // confirmation email link carries the token straight back to /accept-invite).
  if (sent) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm animate-fade-in">
          <div className="text-center mb-8">
            <Link to="/" className="inline-flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <ChefHat className="h-5 w-5 text-primary" />
              </div>
              <span className="text-xl font-bold tracking-tight">Margin<span className="text-gradient-amber">6</span></span>
            </Link>
            <p className="mt-3 text-sm text-muted-foreground">Confirm your email</p>
          </div>
          <div className="rounded-xl border border-border/60 bg-card p-6 shadow-card text-center space-y-4">
            <MailCheck className="mx-auto h-8 w-8 text-primary" />
            <p className="text-sm text-foreground">
              Almost there — we sent a confirmation link to <strong>{email}</strong>.
            </p>
            <p className="text-sm text-muted-foreground">
              Click it to finish{inviteRestaurant ? <> joining <strong>{inviteRestaurant}</strong></> : " creating your account"}.
              You can close this tab.
            </p>
            <p className="text-xs text-muted-foreground">Didn't get it? Check spam, or the original invite email still works.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
              <ChefHat className="h-5 w-5 text-primary" />
            </div>
            <span className="text-xl font-bold tracking-tight">Margin<span className="text-gradient-amber">6</span></span>
          </Link>
          <p className="mt-3 text-sm text-muted-foreground">Create your account</p>
        </div>
        <div className="rounded-xl border border-border/60 bg-card p-6 shadow-card">
          <form onSubmit={handleSignup} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name" className="text-sm">Full Name</Label>
              <Input id="name" value={fullName} onChange={e => setFullName(e.target.value)} required placeholder="John Doe" className="h-10" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm">Email</Label>
              <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@example.com" className="h-10" readOnly={emailLocked} />
              {emailLocked && (
                <p className="text-xs text-muted-foreground">This invite is for {email}.</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm">Password</Label>
              <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} placeholder="••••••••" className="h-10" />
            </div>
            <Button type="submit" className="w-full bg-gradient-amber h-10" disabled={loading}>
              {loading ? "Creating account..." : "Sign Up"}
            </Button>
          </form>
        </div>
        <p className="text-center text-sm text-muted-foreground mt-5">
          Already have an account?{" "}
          <Link
            to={acceptPath ? `/login?redirect=${encodeURIComponent(acceptPath)}` : "/login"}
            className="text-primary hover:underline font-medium"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
