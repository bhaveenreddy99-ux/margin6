import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { Button } from "@/components/ui/button";
import { ChefHat, ClipboardList, Package, CheckCircle, BarChart3, ArrowRight, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";

const steps = [
  { icon: ClipboardList, title: "Create PAR Guide", desc: "Define target stock levels for each item to maintain optimal inventory." },
  { icon: Package, title: "Create Inventory List", desc: "Organize items by category — Frozen, Cooler, Dry, and custom groups." },
  { icon: CheckCircle, title: "Enter → Review → Approve", desc: "Staff enters counts, managers review, owners approve. Full audit trail." },
  { icon: BarChart3, title: "Smart Order + Reports", desc: "Auto-generate reorder lists and track cost, usage, and consumption." },
];

export default function DemoPage() {
  const { user } = useAuth();
  const { refetch } = useRestaurant();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const handleCreateDemo = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { error } = await supabase.rpc("create_restaurant_with_owner", {
        p_name: "Demo Restaurant",
        p_is_demo: true,
      });
      if (error) throw error;

      await refetch();
      toast.success("Demo workspace created!");
      navigate("/app/dashboard");
    } catch (err: any) {
      toast.error(err.message || "Failed to create demo");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto max-w-3xl animate-fade-in">
        <div className="text-center mb-10">
          <ChefHat className="mx-auto h-12 w-12 text-primary mb-4" />
          <h1 className="text-3xl font-bold">Welcome to Restau<span className="text-gradient-amber">rantIQ</span></h1>
          <p className="mt-2 text-muted-foreground">Here's how the workflow works</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 mb-10">
          {steps.map((step, i) => (
            <motion.div
              key={step.title}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="glass-card rounded-xl p-5"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-primary text-sm font-bold">
                  {i + 1}
                </div>
                <div>
                  <h3 className="font-semibold text-sm">{step.title}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{step.desc}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Button
            onClick={() => navigate("/onboarding/create-restaurant")}
            size="lg"
            className="bg-gradient-amber shadow-amber gap-2"
          >
            Create your first restaurant <ArrowRight className="h-4 w-4" />
          </Button>
          <Button
            onClick={handleCreateDemo}
            size="lg"
            variant="outline"
            disabled={loading}
            className="gap-2"
          >
            <Sparkles className="h-4 w-4" />
            {loading ? "Creating demo..." : "Create demo workspace"}
          </Button>
        </div>
      </div>
    </div>
  );
}
