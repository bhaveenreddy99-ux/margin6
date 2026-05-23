import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ChefHat } from "lucide-react";

export function Margin6Logo({ className = "" }: { className?: string }) {
  return (
    <Link to="/" className={`flex items-center gap-2.5 ${className}`}>
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-orange">
        <ChefHat className="h-5 w-5 text-white" />
      </div>
      <span className="text-xl font-bold tracking-tight text-foreground">
        Margin<span className="text-gradient-orange">6</span>
      </span>
    </Link>
  );
}

export function MarketingNav() {
  return (
    <header className="border-b border-border/30 bg-white/90 backdrop-blur-md sticky top-0 z-50">
      <div className="container flex h-16 items-center justify-between">
        <Margin6Logo />
        <nav className="hidden sm:flex items-center gap-6">
          <Link
            to="/pricing"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Pricing
          </Link>
        </nav>
        <div className="flex items-center gap-3">
          <Link to="/login">
            <Button variant="ghost" size="sm">Log in</Button>
          </Link>
          <Link to="/signup">
            <Button size="sm" className="bg-gradient-orange shadow-orange text-white hover:opacity-90">
              Start Free
            </Button>
          </Link>
        </div>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-border/30 bg-white py-10">
      <div className="container text-center space-y-3">
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <Link to="/pricing" className="hover:text-foreground transition-colors">Pricing</Link>
          <a href="mailto:hello@margin6.com" className="hover:text-foreground transition-colors">Contact</a>
          <span className="text-muted-foreground/60">Privacy</span>
          <span className="text-muted-foreground/60">Terms</span>
        </div>
        <p className="text-sm text-muted-foreground">© 2026 Margin6. All rights reserved.</p>
      </div>
    </footer>
  );
}
