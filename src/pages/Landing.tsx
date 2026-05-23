import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Upload,
  ListChecks,
  Brain,
  TrendingUp,
  TrendingDown,
  FileDown,
  CalendarClock,
} from "lucide-react";
import { MarketingNav, MarketingFooter } from "@/components/MarketingChrome";

const trustBullets = [
  "No credit card required",
  "No POS integration needed",
  "Live in under 10 minutes",
];

const problemCards = [
  {
    icon: AlertTriangle,
    title: "Vendor price hikes go unnoticed",
    desc: "Sysco raises chicken breast 15% and you find out weeks later when margins shrink. By then you've already lost hundreds.",
  },
  {
    icon: TrendingDown,
    title: "Waste adds up silently",
    desc: "3 lbs of tomatoes spoiled Monday. 2 lbs Tuesday. By Friday you've thrown away $32 you never tracked.",
  },
  {
    icon: Brain,
    title: "You're guessing your food cost",
    desc: "You know your rent. You know payroll. But your real food cost percentage? Most owners are off by 3-5 points.",
  },
];

const steps = [
  {
    num: "01",
    icon: Upload,
    title: "Forward your invoices",
    desc: "Email any Sysco, US Foods, or Performance Food invoice to your unique address. We parse every line item in 60 seconds.",
  },
  {
    num: "02",
    icon: ListChecks,
    title: "Count your inventory",
    desc: "Staff count on their phone. You review and approve. 15 minutes on a slow day.",
  },
  {
    num: "03",
    icon: BarChart3,
    title: "See exactly what you lost",
    desc: "Dashboard shows: You lost $342 this week. Price hikes $43. Waste $32. Shrinkage $85. Click any number to see the raw math.",
  },
];

const featureGrid = [
  {
    icon: TrendingUp,
    title: "Price Hike Detection",
    desc: "Alerts you the moment a vendor raises prices. Shows exact $ impact before your next order.",
  },
  {
    icon: AlertTriangle,
    title: "Waste Tracking",
    desc: "Log waste on a phone in 10 seconds. Weekly totals and which items cost you most.",
  },
  {
    icon: Brain,
    title: "AI Invoice Parsing",
    desc: "Forward an email. Every line item appears in 60 seconds. Zero manual data entry.",
  },
  {
    icon: BarChart3,
    title: "Show Your Math",
    desc: "Click any number to see every raw line that built it. Your bookkeeper will trust it.",
  },
  {
    icon: CalendarClock,
    title: "Monday Morning Digest",
    desc: "Every Monday at 7am: 'You lost $342 last week. Top leak: Chicken Breast.' Before you get in the car.",
  },
  {
    icon: FileDown,
    title: "Free Leak Audit",
    desc: "Upload any invoice. No signup. PDF showing your estimated weekly leak in 30 seconds.",
  },
];

const moneyLostRows = [
  { label: "Waste", amount: "$32" },
  { label: "Price hikes", amount: "$43" },
  { label: "Overstock", amount: "$0" },
  { label: "Shrinkage", amount: "$85" },
];

const profitLeaks = [
  { rank: 1, item: "Chicken Breast", badge: "PRICE HIKE", badgeClass: "bg-amber-500/15 text-amber-700", amount: "$21" },
  { rank: 2, item: "Cooking Oil", badge: "PRICE HIKE", badgeClass: "bg-amber-500/15 text-amber-700", amount: "$11" },
  { rank: 3, item: "Tomatoes", badge: "PRICE HIKE", badgeClass: "bg-amber-500/15 text-amber-700", amount: "$11" },
  { rank: 4, item: "Chicken Breast", badge: "WASTE", badgeClass: "bg-destructive/15 text-destructive", amount: "$9" },
  { rank: 5, item: "Cooking Oil", badge: "WASTE", badgeClass: "bg-destructive/15 text-destructive", amount: "$8" },
];

const priceHikes = [
  { item: "Chicken Breast", vendor: "Sysco", pct: "+15.6%", amount: "$21" },
  { item: "Cooking Oil", vendor: "Sysco", pct: "+17.5%", amount: "$11" },
  { item: "Tomatoes", vendor: "Sysco", pct: "+27.5%", amount: "$11" },
];

const foundingFeatures = [
  "Unlimited AI invoice parsing",
  "Money Lost dashboard",
  "Price hike alerts",
  "Shrinkage detection",
  "Monday 7am digest email",
  "Show Your Math audit trail",
  "Free Leak Audit tool",
  "Multiple restaurants",
  "14-day free trial",
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      <MarketingNav />

      {/* HERO */}
      <section className="landing-section overflow-hidden">
        <div className="container">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.08] text-foreground">
              Find out exactly how much money your restaurant lost this week.
            </h1>
            <p className="mt-6 text-lg sm:text-xl text-muted-foreground leading-relaxed max-w-2xl mx-auto">
              Margin6 connects your invoices, inventory, and sales to show you where every dollar is going — and why. No POS required. Live in 10 minutes.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row justify-center gap-4">
              <Link to="/signup">
                <Button size="lg" className="bg-gradient-orange shadow-orange text-white gap-2 w-full sm:w-auto text-base px-8 h-12 hover:opacity-90">
                  Start Free <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link to="/demo-live">
                <Button size="lg" variant="outline" className="w-full sm:w-auto text-base px-8 h-12 border-border/60">
                  See Live Demo
                </Button>
              </Link>
            </div>
            <div className="mt-4 flex justify-center">
              <Link
                to="/audit"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-[hsl(25,95%,53%)] hover:underline"
              >
                Free Leak Audit — see your weekly loss in 30 seconds <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            <div className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2">
              {trustBullets.map((t) => (
                <span key={t} className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  {t}
                </span>
              ))}
            </div>
          </div>

          {/* Dashboard mockup */}
          <div className="mt-16 mx-auto max-w-5xl rounded-2xl border border-border/40 bg-white dashboard-mockup-shadow overflow-hidden">
            <div className="bg-foreground/[0.03] border-b border-border/30 px-5 py-3 flex items-center gap-2">
              <div className="flex gap-1.5">
                <div className="h-3 w-3 rounded-full bg-risk-red/60" />
                <div className="h-3 w-3 rounded-full bg-risk-yellow/60" />
                <div className="h-3 w-3 rounded-full bg-risk-green/60" />
              </div>
              <span className="text-xs text-muted-foreground ml-2 font-medium">Margin6 — Dashboard</span>
            </div>
            <div className="p-6 grid md:grid-cols-3 gap-5">
              {/* Panel 1 — Money Lost */}
              <div className="rounded-xl border border-border/40 p-4 bg-white">
                <p className="text-[10px] font-bold text-destructive uppercase tracking-wider mb-2">
                  Money Lost This Period
                </p>
                <p className="text-3xl font-extrabold text-destructive mb-4">$342</p>
                <div className="space-y-2">
                  {moneyLostRows.map((row) => (
                    <div key={row.label} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{row.label}</span>
                      <span className="flex items-center gap-1 font-semibold text-[hsl(25,95%,53%)]">
                        {row.amount}
                        <span className="text-muted-foreground/50">→</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Panel 2 — Top Profit Leaks */}
              <div className="rounded-xl border border-border/40 p-4 bg-white">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  Top Profit Leaks
                </p>
                <div className="space-y-2">
                  {profitLeaks.map((row) => (
                    <div key={`${row.rank}-${row.item}-${row.badge}`} className="flex items-center gap-2 text-xs">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                        {row.rank}
                      </span>
                      <span className="flex-1 truncate font-medium text-foreground">{row.item}</span>
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold ${row.badgeClass}`}>
                        {row.badge}
                      </span>
                      <span className="shrink-0 font-semibold text-[hsl(25,95%,53%)]">{row.amount}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Panel 3 — Price Hike Alerts */}
              <div className="rounded-xl border border-border/40 p-4 bg-white">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Price Hike Alerts
                  </p>
                  <span className="rounded-full bg-[hsl(25,95%,53%)]/15 px-2 py-0.5 text-[9px] font-bold text-[hsl(25,95%,53%)]">
                    3 PRICE HIKES THIS WEEK
                  </span>
                </div>
                <div className="space-y-3">
                  {priceHikes.map((row) => (
                    <div key={row.item} className="flex items-start justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <p className="font-medium text-foreground truncate">{row.item}</p>
                        <p className="text-[10px] text-muted-foreground">{row.vendor}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">
                          {row.pct}
                        </span>
                        <span className="font-semibold text-[hsl(25,95%,53%)]">{row.amount}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* THE PROBLEM */}
      <section className="landing-section-alt">
        <div className="container">
          <div className="text-center mb-14">
            <p className="text-sm font-semibold text-gradient-orange uppercase tracking-wider mb-3">The problem</p>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
              You know something is wrong.
              <br className="hidden sm:block" />
              You just don&apos;t know where.
            </h2>
          </div>
          <div className="grid gap-6 md:grid-cols-3 max-w-5xl mx-auto">
            {problemCards.map((f) => (
              <div
                key={f.title}
                className="group rounded-2xl border border-border/50 bg-white p-7 hover:shadow-landing transition-all duration-300"
              >
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-orange/10 group-hover:bg-gradient-orange group-hover:text-white transition-all duration-300">
                  <f.icon className="h-6 w-6 text-[hsl(25,95%,53%)] group-hover:text-white transition-colors" />
                </div>
                <h3 className="mb-2 text-lg font-bold text-foreground">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="landing-section">
        <div className="container">
          <div className="text-center mb-14">
            <p className="text-sm font-semibold text-gradient-orange uppercase tracking-wider mb-3">How it works</p>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
              From zero to knowing your number in 10 minutes.
            </h2>
          </div>
          <div className="grid gap-8 md:grid-cols-3 max-w-4xl mx-auto">
            {steps.map((s) => (
              <div key={s.num} className="text-center">
                <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-orange shadow-orange text-white">
                  <s.icon className="h-7 w-7" />
                </div>
                <span className="text-xs font-bold text-gradient-orange uppercase tracking-widest">Step {s.num}</span>
                <h3 className="mt-2 text-lg font-bold text-foreground">{s.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="landing-section-alt">
        <div className="container">
          <div className="text-center mb-14">
            <p className="text-sm font-semibold text-gradient-orange uppercase tracking-wider mb-3">Features</p>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
              Everything you need. Nothing you don&apos;t.
            </h2>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 max-w-5xl mx-auto">
            {featureGrid.map((f) => (
              <div
                key={f.title}
                className="flex items-start gap-4 rounded-2xl border border-border/50 bg-white p-5 hover:shadow-landing transition-all duration-300"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-orange/10">
                  <f.icon className="h-5 w-5 text-[hsl(25,95%,53%)]" />
                </div>
                <div>
                  <h3 className="font-bold text-foreground text-[15px]">{f.title}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SOCIAL PROOF */}
      <section className="landing-navy py-20 lg:py-28">
        <div className="container">
          <div className="text-center mb-14">
            <p className="text-sm font-semibold text-[hsl(25,95%,53%)] uppercase tracking-wider mb-3">
              Built for independent operators
            </p>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
              Not chains. Not franchises. Real restaurants.
            </h2>
          </div>
          <div className="grid gap-6 sm:grid-cols-3 max-w-3xl mx-auto">
            {[
              { stat: "$400/week", label: "Average weekly leak found" },
              { stat: "10 min", label: "Average setup time" },
              { stat: "No POS", label: "Required. Ever." },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-8 text-center"
              >
                <p className="text-3xl sm:text-4xl font-extrabold text-white">{item.stat}</p>
                <p className="mt-2 text-sm text-white/60">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING TEASER */}
      <section className="landing-section">
        <div className="container">
          <div className="text-center mb-10">
            <p className="text-sm font-semibold text-gradient-orange uppercase tracking-wider mb-3">Simple pricing</p>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
              One plan. Everything included.
            </h2>
          </div>
          <div className="mx-auto max-w-md">
            <div className="rounded-2xl border-2 border-[hsl(25,95%,53%)] bg-white p-8 shadow-landing text-center">
              <span className="inline-block rounded-full bg-[hsl(25,95%,53%)]/15 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-[hsl(25,95%,53%)]">
                Founding Member · First 100 only
              </span>
              <p className="mt-6 text-5xl font-extrabold text-foreground">$69.99<span className="text-lg font-medium text-muted-foreground">/month</span></p>
              <p className="mt-2 text-sm text-muted-foreground">
                Locked in forever · Goes to $99 after first 100 members
              </p>
              <ul className="mt-8 space-y-2.5 text-left text-sm">
                {foundingFeatures.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-success mt-0.5" />
                    <span className="text-foreground/90">{f}</span>
                  </li>
                ))}
              </ul>
              <Link to="/signup" className="block mt-8">
                <Button className="w-full bg-gradient-orange shadow-orange text-white h-11 hover:opacity-90">
                  Start Free Trial →
                </Button>
              </Link>
              <p className="mt-3 text-xs text-muted-foreground">No credit card required · Cancel anytime</p>
            </div>
            <p className="mt-6 text-center text-xs text-muted-foreground leading-relaxed">
              MarketMan: $239/mo · Restaurant365: $499/mo · Margin6: $69.99/mo
            </p>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="landing-navy py-20 lg:py-28">
        <div className="container">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
              Find out what you&apos;re losing this week. Free.
            </h2>
            <p className="mt-4 text-base text-white/60 leading-relaxed">
              Upload any invoice — no signup, no credit card. See your estimated weekly leak in 30 seconds.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row justify-center gap-4">
              <Link to="/audit">
                <Button size="lg" className="bg-gradient-orange shadow-orange text-white gap-2 w-full sm:w-auto text-base px-8 h-12 hover:opacity-90">
                  Free Leak Audit →
                </Button>
              </Link>
              <Link to="/signup">
                <Button size="lg" variant="outline" className="w-full sm:w-auto text-base px-8 h-12 border-white/20 text-white hover:bg-white/10 hover:text-white">
                  Start Free Trial
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
