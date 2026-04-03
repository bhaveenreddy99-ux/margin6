import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  ChefHat, BarChart3, ClipboardList, Package, ArrowRight, Shield, Zap,
  CheckCircle2, Upload, ListChecks, ShoppingCart, AlertTriangle, Brain,
  FileDown, CalendarClock, Users, TrendingUp, Building2, Rocket, Award,
  MapPin, Eye, Layers
} from "lucide-react";
import { motion } from "framer-motion";

/* ── animation helpers ── */
const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-60px" },
  transition: { duration: 0.5, delay },
});

const stagger = (i: number) => fadeUp(0.08 * i);

/* ── data ── */
const trustBullets = [
  "No credit card required",
  "Built for single & multi-location brands",
  "Enterprise-grade security",
];

const coreFeatures = [
  {
    icon: ClipboardList,
    title: "Smart Inventory Tracking",
    desc: "Track weekly counts with guided workflows and approval controls.",
  },
  {
    icon: Brain,
    title: "AI-Powered Smart Ordering",
    desc: "Automatically generate vendor-ready orders based on PAR and risk analysis.",
  },
  {
    icon: MapPin,
    title: "Multi-Location Visibility",
    desc: "Compare store performance instantly and identify which locations are underperforming.",
  },
];

const steps = [
  { num: "01", icon: Upload, title: "Import or build", desc: "Import or build your inventory list." },
  { num: "02", icon: ListChecks, title: "Count & review", desc: "Enter weekly counts and review PAR levels." },
  { num: "03", icon: ShoppingCart, title: "Order in one click", desc: "Approve and generate smart vendor-ready orders in one click." },
];

const featureGrid = [
  { icon: AlertTriangle, title: "Risk Alerts", desc: "Low / Medium / High" },
  { icon: Brain, title: "Automated PAR Suggestions", desc: "AI-driven reorder levels" },
  { icon: FileDown, title: "Vendor Order Export", desc: "One-click PDF & CSV" },
  { icon: CalendarClock, title: "Weekly Scheduling", desc: "Reminders & deadlines" },
  { icon: Users, title: "Role-Based Permissions", desc: "Owner / Manager / Staff" },
  { icon: BarChart3, title: "Real-time Reports", desc: "Live dashboards & trends" },
];

const growthCallouts = [
  { icon: Rocket, label: "Startup friendly" },
  { icon: Building2, label: "Franchise ready" },
  { icon: Award, label: "Enterprise scalable" },
];

/* ── mock chart data for dashboard ── */
const locationBars = [
  { name: "Downtown", value: 82, color: "hsl(142 65% 40%)" },
  { name: "Midtown", value: 64, color: "hsl(38 92% 50%)" },
  { name: "Uptown", value: 45, color: "hsl(0 72% 51%)" },
  { name: "Airport", value: 91, color: "hsl(142 65% 40%)" },
  { name: "Mall", value: 73, color: "hsl(38 92% 50%)" },
];

const smartOrderPreview = [
  { item: "Chicken Breast", qty: 24, risk: "red" },
  { item: "Olive Oil", qty: 8, risk: "yellow" },
  { item: "Tomato Sauce", qty: 12, risk: "green" },
  { item: "Mozzarella", qty: 18, risk: "red" },
  { item: "Flour (50lb)", qty: 4, risk: "green" },
];

const riskColor = (r: string) =>
  r === "red" ? "bg-risk-red" : r === "yellow" ? "bg-risk-yellow" : "bg-risk-green";

const riskText = (r: string) =>
  r === "red" ? "text-risk-red" : r === "yellow" ? "text-risk-yellow" : "text-risk-green";

/* ── COMPONENT ── */
export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* ═══ NAV ═══ */}
      <header className="border-b border-border/30 bg-white/90 backdrop-blur-md sticky top-0 z-50">
        <div className="container flex h-16 items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-orange">
              <ChefHat className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight text-foreground">
              Restaurant<span className="text-gradient-orange">IQ</span>
            </span>
          </Link>
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

      {/* ═══ HERO ═══ */}
      <section className="landing-section overflow-hidden">
        <div className="container">
          <motion.div {...fadeUp()} className="mx-auto max-w-3xl text-center">
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[1.05] text-foreground">
              Turn inventory into{" "}
              <span className="text-gradient-orange">profit.</span>
            </h1>
            <p className="mt-6 text-lg sm:text-xl text-muted-foreground leading-relaxed max-w-2xl mx-auto">
              Cut food waste, automate ordering, and compare every location — all in one intelligent platform built for modern restaurant operators.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row justify-center gap-4">
              <Link to="/signup">
                <Button size="lg" className="bg-gradient-orange shadow-orange text-white gap-2 w-full sm:w-auto text-base px-8 h-12 hover:opacity-90">
                  Start Free <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link to="/demo">
                <Button size="lg" variant="outline" className="w-full sm:w-auto text-base px-8 h-12 border-border/60">
                  Book a Demo
                </Button>
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
          </motion.div>

          {/* Dashboard Mockup */}
          <motion.div
            {...fadeUp(0.2)}
            className="mt-16 mx-auto max-w-5xl rounded-2xl border border-border/40 bg-white dashboard-mockup-shadow overflow-hidden"
          >
            <div className="bg-foreground/[0.03] border-b border-border/30 px-5 py-3 flex items-center gap-2">
              <div className="flex gap-1.5">
                <div className="h-3 w-3 rounded-full bg-risk-red/60" />
                <div className="h-3 w-3 rounded-full bg-risk-yellow/60" />
                <div className="h-3 w-3 rounded-full bg-risk-green/60" />
              </div>
              <span className="text-xs text-muted-foreground ml-2 font-medium">RestaurantIQ — Dashboard</span>
            </div>
            <div className="p-6 grid md:grid-cols-3 gap-5">
              {/* Risk Summary */}
              <div className="rounded-xl border border-border/40 p-4 bg-white">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Risk Overview</p>
                <div className="space-y-2.5">
                  {[
                    { label: "Critical", count: 4, color: "bg-risk-red", w: "w-[85%]" },
                    { label: "Warning", count: 8, color: "bg-risk-yellow", w: "w-[60%]" },
                    { label: "Healthy", count: 22, color: "bg-risk-green", w: "w-[95%]" },
                  ].map((r) => (
                    <div key={r.label}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-muted-foreground">{r.label}</span>
                        <span className="font-semibold text-foreground">{r.count}</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted/40 overflow-hidden">
                        <motion.div
                          className={`h-full rounded-full ${r.color}`}
                          initial={{ width: 0 }}
                          whileInView={{ width: r.w.replace("w-[", "").replace("]", "") }}
                          viewport={{ once: true }}
                          transition={{ duration: 0.8, delay: 0.3 }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Location Comparison */}
              <div className="rounded-xl border border-border/40 p-4 bg-white">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Location Comparison</p>
                <div className="space-y-2">
                  {locationBars.map((loc, i) => (
                    <div key={loc.name} className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-16 truncate">{loc.name}</span>
                      <div className="flex-1 h-5 rounded bg-muted/30 overflow-hidden">
                        <motion.div
                          className="h-full rounded"
                          style={{ backgroundColor: loc.color }}
                          initial={{ width: 0 }}
                          whileInView={{ width: `${loc.value}%` }}
                          viewport={{ once: true }}
                          transition={{ duration: 0.6, delay: 0.3 + i * 0.08 }}
                        />
                      </div>
                      <span className="text-xs font-semibold text-foreground w-8 text-right">{loc.value}%</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Smart Order Preview */}
              <div className="rounded-xl border border-border/40 p-4 bg-white">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Smart Order Preview</p>
                <div className="space-y-1.5">
                  <div className="flex text-[10px] font-semibold text-muted-foreground uppercase tracking-wider pb-1 border-b border-border/30">
                    <span className="flex-1">Item</span>
                    <span className="w-10 text-center">Qty</span>
                    <span className="w-10 text-center">Risk</span>
                  </div>
                  {smartOrderPreview.map((item) => (
                    <div key={item.item} className="flex items-center text-xs py-1">
                      <span className="flex-1 text-foreground truncate">{item.item}</span>
                      <span className="w-10 text-center font-medium text-foreground">{item.qty}</span>
                      <span className="w-10 flex justify-center">
                        <span className={`h-2.5 w-2.5 rounded-full ${riskColor(item.risk)}`} />
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ═══ SECTION 1 – BUILT FOR MODERN RESTAURANTS ═══ */}
      <section className="landing-section-alt">
        <div className="container">
          <motion.div {...fadeUp()} className="text-center mb-14">
            <p className="text-sm font-semibold text-gradient-orange uppercase tracking-wider mb-3">Built for modern restaurants</p>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
              From single store to 50+ locations — scale with confidence
            </h2>
          </motion.div>
          <div className="grid gap-6 md:grid-cols-3 max-w-5xl mx-auto">
            {coreFeatures.map((f, i) => (
              <motion.div
                key={f.title}
                {...stagger(i)}
                className="group rounded-2xl border border-border/50 bg-white p-7 hover:shadow-landing transition-all duration-300"
              >
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-orange/10 group-hover:bg-gradient-orange group-hover:text-white transition-all duration-300">
                  <f.icon className="h-6 w-6 text-[hsl(25,95%,53%)] group-hover:text-white transition-colors" />
                </div>
                <h3 className="mb-2 text-lg font-bold text-foreground">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ SECTION 2 – HOW IT WORKS ═══ */}
      <section className="landing-section">
        <div className="container">
          <motion.div {...fadeUp()} className="text-center mb-14">
            <p className="text-sm font-semibold text-gradient-orange uppercase tracking-wider mb-3">How it works</p>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
              Simple for managers. Powerful for owners.
            </h2>
          </motion.div>
          <div className="grid gap-8 md:grid-cols-3 max-w-4xl mx-auto">
            {steps.map((s, i) => (
              <motion.div key={s.num} {...stagger(i)} className="text-center">
                <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-orange shadow-orange text-white">
                  <s.icon className="h-7 w-7" />
                </div>
                <span className="text-xs font-bold text-gradient-orange uppercase tracking-widest">Step {s.num}</span>
                <h3 className="mt-2 text-lg font-bold text-foreground">{s.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{s.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ SECTION 3 – MULTI-LOCATION DASHBOARD ═══ */}
      <section className="landing-navy py-20 lg:py-28">
        <div className="container">
          <motion.div {...fadeUp()} className="text-center mb-14">
            <p className="text-sm font-semibold text-[hsl(25,95%,53%)] uppercase tracking-wider mb-3">Multi-Location Intelligence</p>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
              See every store. In one place.
            </h2>
          </motion.div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4 max-w-5xl mx-auto">
            {[
              { icon: BarChart3, title: "Inventory Value by Location", desc: "Compare stock value across every store." },
              { icon: AlertTriangle, title: "Risk Heatmap", desc: "Spot critical shortages across all locations instantly." },
              { icon: TrendingUp, title: "Store Rankings", desc: "See which locations are outperforming and which need attention." },
              { icon: Eye, title: "Waste Trends", desc: "Track waste patterns over time per location." },
            ].map((card, i) => (
              <motion.div
                key={card.title}
                {...stagger(i)}
                className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm p-6 hover:bg-white/10 transition-colors duration-300"
              >
                <card.icon className="h-8 w-8 text-[hsl(25,95%,53%)] mb-4" />
                <h3 className="font-bold text-white text-sm mb-1.5">{card.title}</h3>
                <p className="text-xs text-white/60 leading-relaxed">{card.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ SECTION 4 – FEATURES THAT DRIVE PROFIT ═══ */}
      <section className="landing-section">
        <div className="container">
          <motion.div {...fadeUp()} className="text-center mb-14">
            <p className="text-sm font-semibold text-gradient-orange uppercase tracking-wider mb-3">Features</p>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
              Features that drive profit
            </h2>
          </motion.div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 max-w-5xl mx-auto">
            {featureGrid.map((f, i) => (
              <motion.div
                key={f.title}
                {...stagger(i)}
                className="flex items-start gap-4 rounded-2xl border border-border/50 bg-white p-5 hover:shadow-landing transition-all duration-300"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-orange/10">
                  <f.icon className="h-5 w-5 text-[hsl(25,95%,53%)]" />
                </div>
                <div>
                  <h3 className="font-bold text-foreground text-[15px]">{f.title}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">{f.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ SECTION 5 – BUILT FOR GROWTH ═══ */}
      <section className="landing-section-alt">
        <div className="container">
          <motion.div {...fadeUp()} className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold text-gradient-orange uppercase tracking-wider mb-3">Built for growth</p>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
              Designed for restaurants that are growing.
            </h2>
            <p className="mt-5 text-base text-muted-foreground leading-relaxed">
              Whether you operate one store or manage a growing group, RestaurantIQ gives you the control, automation, and intelligence needed to scale efficiently.
            </p>
          </motion.div>
          <div className="mt-12 flex flex-wrap justify-center gap-6">
            {growthCallouts.map((c, i) => (
              <motion.div
                key={c.label}
                {...stagger(i)}
                className="flex items-center gap-3 rounded-2xl border border-border/50 bg-white px-6 py-4 shadow-landing"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-orange text-white">
                  <c.icon className="h-5 w-5" />
                </div>
                <span className="font-bold text-foreground">{c.label}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ FINAL CTA ═══ */}
      <section className="landing-navy py-20 lg:py-28">
        <div className="container">
          <motion.div {...fadeUp()} className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
              Ready to simplify your restaurant operations?
            </h2>
            <p className="mt-4 text-base text-white/60 leading-relaxed">
              Start free today or schedule a demo to see RestaurantIQ in action.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row justify-center gap-4">
              <Link to="/signup">
                <Button size="lg" className="bg-gradient-orange shadow-orange text-white gap-2 w-full sm:w-auto text-base px-8 h-12 hover:opacity-90">
                  Start Free <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link to="/demo">
                <Button size="lg" variant="outline" className="w-full sm:w-auto text-base px-8 h-12 border-white/20 text-white hover:bg-white/10 hover:text-white">
                  Book a Demo
                </Button>
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ═══ FOOTER ═══ */}
      <footer className="border-t border-border/30 bg-white py-10">
        <div className="container text-center text-sm text-muted-foreground">
          © 2026 RestaurantIQ. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
