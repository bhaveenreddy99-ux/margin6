import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface AlertItem {
  item_name: string;
  current_stock: number;
  par_level: number;
  unit: string | null;
  category: string | null;
  ratio: number;
  session_name: string;
}

export default function ParAlertsBanner() {
  const { currentRestaurant } = useRestaurant();
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!currentRestaurant) return;
    const fetchAlerts = async () => {
      const { data: sessions } = await supabase
        .from("inventory_sessions")
        .select("id, name")
        .eq("restaurant_id", currentRestaurant.id)
        .eq("status", "APPROVED")
        .order("approved_at", { ascending: false })
        .limit(1);

      if (!sessions?.length) return;

      const allAlerts: AlertItem[] = [];
      for (const session of sessions) {
        const { data: items } = await supabase
          .from("inventory_session_items")
          .select("item_name, current_stock, par_level, unit, category")
          .eq("session_id", session.id);

        if (items) {
          items.forEach((item) => {
            const ratio = item.par_level > 0 ? item.current_stock / item.par_level : 1;
            if (ratio < 1) {
              allAlerts.push({ ...item, ratio, session_name: session.name });
            }
          });
        }
      }
      // Deduplicate by item_name, keep lowest ratio
      const map = new Map<string, AlertItem>();
      allAlerts.forEach((a) => {
        const existing = map.get(a.item_name);
        if (!existing || a.ratio < existing.ratio) map.set(a.item_name, a);
      });
      setAlerts(Array.from(map.values()).sort((a, b) => a.ratio - b.ratio));
    };
    fetchAlerts();
  }, [currentRestaurant]);

  if (alerts.length === 0) return null;

  const critical = alerts.filter((a) => a.ratio < 0.5);
  const low = alerts.filter((a) => a.ratio >= 0.5);

  return (
    <div className="mb-4 rounded-xl border border-destructive/20 bg-destructive/5 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-destructive/10 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <span className="text-sm font-medium">
            {alerts.length} item{alerts.length !== 1 ? "s" : ""} below PAR threshold
          </span>
          {critical.length > 0 && (
            <Badge variant="destructive" className="text-[10px]">
              {critical.length} critical
            </Badge>
          )}
          {low.length > 0 && (
            <Badge className="bg-warning text-warning-foreground text-[10px]">
              {low.length} low
            </Badge>
          )}
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {expanded && (
        <div className="px-4 pb-3 space-y-1">
          {alerts.map((item, i) => (
            <div
              key={i}
              className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-muted/30 transition-colors text-sm"
            >
              <div className="flex items-center gap-2">
                <Badge
                  variant={item.ratio < 0.5 ? "destructive" : "default"}
                  className={`text-[10px] w-12 justify-center ${item.ratio >= 0.5 ? "bg-warning text-warning-foreground" : ""}`}
                >
                  {item.ratio < 0.5 ? "CRIT" : "LOW"}
                </Badge>
                <span>{item.item_name}</span>
                {item.category && <span className="text-xs text-muted-foreground">({item.category})</span>}
              </div>
              <span className="font-mono text-xs">
                {item.current_stock}/{item.par_level} {item.unit || ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
