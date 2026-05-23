import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { CheckCircle2, X, Check, ArrowRight } from "lucide-react";
import { MarketingNav, MarketingFooter } from "@/components/MarketingChrome";

const foundingFeatures = [
  "Unlimited invoice parsing via email",
  "AI price hike detection",
  "Money Lost dashboard",
  "Top 5 profit leaks ranked",
  "Waste tracking with cost",
  "Shrinkage and variance alerts",
  "Monday 7am digest email",
  "Show Your Math audit trail",
  "Free Leak Audit tool",
  "Multiple restaurants (one login)",
  "Mobile inventory counts",
  "Smart Order generation",
  "14-day free trial",
  "Email support",
];

type CompareRow = {
  feature: string;
  margin6: string;
  marketman: string;
  r365: string;
  marginedge: string;
  margin6Highlight?: boolean;
};

const compareRows: CompareRow[] = [
  { feature: "Monthly price", margin6: "$69.99", marketman: "$239+", r365: "$499+", marginedge: "$330+" },
  { feature: "Setup time", margin6: "10 min", marketman: "2-4 wks", r365: "4+ wks", marginedge: "2-3 wks" },
  { feature: "POS required", margin6: "no", marketman: "yes", r365: "yes", marginedge: "yes" },
  { feature: "AI invoice parsing", margin6: "yes", marketman: "limited", r365: "limited", marginedge: "yes" },
  { feature: "Money Lost dashboard", margin6: "yes", marketman: "no", r365: "no", marginedge: "no" },
  { feature: "Free trial (no CC)", margin6: "yes", marketman: "no", r365: "no", marginedge: "no" },
  { feature: "Price hike alerts", margin6: "yes", marketman: "yes", r365: "yes", marginedge: "yes" },
  { feature: "Show Your Math", margin6: "yes", marketman: "no", r365: "no", marginedge: "no" },
  { feature: "Monday digest email", margin6: "yes", marketman: "no", r365: "no", marginedge: "no" },
];

function CellValue({ value }: { value: string }) {
  if (value === "yes") return <Check className="h-4 w-4 text-success mx-auto" />;
  if (value === "no") return <X className="h-4 w-4 text-destructive mx-auto" />;
  if (value === "limited") return <span className="text-xs text-muted-foreground">Limited</span>;
  return <span className="text-sm font-medium">{value}</span>;
}

const faqs = [
  {
    q: "Do I need a POS system?",
    a: "No. Margin6 works with any restaurant — no POS required. You forward vendor invoices by email and enter sales manually (2 minutes per week).",
  },
  {
    q: "How long does setup take?",
    a: "Under 10 minutes. Create account, forward one invoice, do one inventory count. You'll see your first real number the same day.",
  },
  {
    q: "What invoices do you support?",
    a: "Any Sysco, US Foods, Performance Food Group, Restaurant Depot, or other vendor invoice — PDF or photo. AI reads every line item.",
  },
  {
    q: "Can I add multiple restaurants?",
    a: "Yes. One login, multiple restaurants. Each is completely separate. Switch in one click.",
  },
  {
    q: "Is the founding member price really locked in?",
    a: "Yes. If you sign up at $69.99/month that price never increases for your account — even when we raise the standard price to $99.",
  },
  {
    q: "What if I want to cancel?",
    a: "Cancel anytime from Settings → Billing. No contracts. No cancellation fees.",
  },
];

function FeatureList({ features }: { features: string[] }) {
  return (
    <ul className="mt-6 space-y-2.5 text-left text-sm">
      {features.map((f) => (
        <li key={f} className="flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success mt-0.5" />
          <span>{f}</span>
        </li>
      ))}
    </ul>
  );
}

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-white">
      <MarketingNav />

      <section className="landing-section">
        <div className="container max-w-5xl">
          <div className="text-center mb-10">
            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-foreground">
              Simple, honest pricing.
            </h1>
            <p className="mt-4 text-lg text-muted-foreground">
              One plan. Everything included. No POS required. Cancel anytime.
            </p>
          </div>

          <div className="rounded-2xl border border-amber-200/80 bg-amber-50/80 dark:bg-amber-950/20 dark:border-amber-800/50 p-6 sm:p-8 mb-12">
            <p className="text-sm sm:text-base text-foreground/90 leading-relaxed text-center max-w-3xl mx-auto">
              A restaurant doing $75,000/month in food sales running food cost at 34% instead of 31% loses{" "}
              <strong>$2,250/month</strong>. Margin6 costs $69.99/month. If we find you 1 percentage point of
              improvement you save <strong>$750/month</strong> — 10x what you pay us.
            </p>
          </div>

          <div className="grid gap-8 lg:grid-cols-2 max-w-4xl mx-auto">
            {/* Founding */}
            <div className="rounded-2xl border-2 border-[hsl(25,95%,53%)] bg-white p-8 shadow-landing relative">
              <span className="inline-block rounded-full bg-[hsl(25,95%,53%)]/15 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-[hsl(25,95%,53%)]">
                Founding Member
              </span>
              <p className="mt-2 text-sm text-muted-foreground">First 100 customers only</p>
              <p className="mt-6 text-5xl font-extrabold">$69.99<span className="text-lg font-medium text-muted-foreground">/month</span></p>
              <p className="mt-1 text-sm font-medium text-foreground">Locked in forever</p>
              <p className="mt-2 text-sm text-muted-foreground">$699/year (save 2 months)</p>
              <FeatureList features={foundingFeatures} />
              <Link to="/signup" className="block mt-8">
                <Button className="w-full bg-gradient-orange shadow-orange text-white h-11 hover:opacity-90">
                  Start Free Trial →
                </Button>
              </Link>
              <p className="mt-3 text-center text-xs text-muted-foreground">No credit card required</p>
            </div>

            {/* Standard */}
            <div className="rounded-2xl border border-border/60 bg-white p-8 shadow-sm">
              <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Standard</p>
              <p className="mt-6 text-5xl font-extrabold">$99<span className="text-lg font-medium text-muted-foreground">/month</span></p>
              <p className="mt-2 text-sm text-muted-foreground">After founding member slots fill</p>
              <FeatureList features={foundingFeatures} />
              <Link to="/signup" className="block mt-8">
                <Button variant="outline" className="w-full h-11">
                  Start Free Trial →
                </Button>
              </Link>
              <p className="mt-3 text-center text-xs text-muted-foreground">No credit card required</p>
            </div>
          </div>
        </div>
      </section>

      {/* Comparison table */}
      <section className="landing-section-alt">
        <div className="container max-w-5xl">
          <h2 className="text-3xl font-extrabold tracking-tight text-center mb-10">How we compare</h2>
          <div className="overflow-x-auto rounded-xl border border-border/50 bg-white">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border/40 bg-muted/30">
                  <th className="text-left p-4 font-semibold">Feature</th>
                  <th className="p-4 font-semibold border-l-4 border-[hsl(25,95%,53%)] bg-[hsl(25,95%,53%)]/5">Margin6</th>
                  <th className="p-4 font-semibold text-muted-foreground">MarketMan</th>
                  <th className="p-4 font-semibold text-muted-foreground">Restaurant365</th>
                  <th className="p-4 font-semibold text-muted-foreground">MarginEdge</th>
                </tr>
              </thead>
              <tbody>
                {compareRows.map((row) => (
                  <tr key={row.feature} className="border-b border-border/30 last:border-0">
                    <td className="p-4 text-muted-foreground">{row.feature}</td>
                    <td className="p-4 text-center border-l-4 border-[hsl(25,95%,53%)]/40 bg-[hsl(25,95%,53%)]/[0.03]">
                      <CellValue value={row.margin6} />
                    </td>
                    <td className="p-4 text-center"><CellValue value={row.marketman} /></td>
                    <td className="p-4 text-center"><CellValue value={row.r365} /></td>
                    <td className="p-4 text-center"><CellValue value={row.marginedge} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="landing-section">
        <div className="container max-w-2xl">
          <h2 className="text-3xl font-extrabold tracking-tight text-center mb-10">Common questions</h2>
          <Accordion type="single" collapsible className="w-full">
            {faqs.map((faq, i) => (
              <AccordionItem key={faq.q} value={`item-${i}`}>
                <AccordionTrigger className="text-left">{faq.q}</AccordionTrigger>
                <AccordionContent className="text-muted-foreground leading-relaxed">{faq.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      {/* Final CTA */}
      <section className="landing-navy py-20">
        <div className="container max-w-2xl text-center">
          <h2 className="text-3xl font-extrabold text-white">Start your free trial today.</h2>
          <p className="mt-3 text-white/60">14 days free. No credit card. Cancel anytime.</p>
          <Link to="/signup" className="inline-block mt-8">
            <Button size="lg" className="bg-gradient-orange shadow-orange text-white gap-2 px-8 h-12 hover:opacity-90">
              Start Free Trial <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <p className="mt-4">
            <Link to="/audit" className="text-sm text-[hsl(25,95%,53%)] hover:underline">
              Or try Free Leak Audit — no signup →
            </Link>
          </p>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
