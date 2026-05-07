import { useNotifications, Notification } from "@/hooks/useNotifications";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bell, AlertTriangle, Clock, CheckCheck, TrendingUp, TrendingDown, DollarSign, Package } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useNavigate } from "react-router-dom";

const severityConfig = {
  CRITICAL: { color: "bg-destructive text-destructive-foreground", icon: AlertTriangle },
  WARNING:  { color: "bg-warning text-warning-foreground",           icon: AlertTriangle },
  INFO:     { color: "bg-primary/10 text-primary",                   icon: Bell },
};

// Per-type icon overrides — layered on top of severity config
const typeIconConfig: Record<string, { icon: React.ElementType; color: string }> = {
  PRICE_INCREASE: { icon: TrendingUp,   color: "bg-orange-500/15 text-orange-600" },
  PRICE_DECREASE: { icon: TrendingDown, color: "bg-emerald-500/15 text-emerald-600" },
  DELIVERY_ISSUE: { icon: Package,      color: "bg-destructive/15 text-destructive" },
  LOW_STOCK:      { icon: AlertTriangle,color: "bg-warning/15 text-warning" },
};

// Expand price-change notification data into readable item rows
function PriceChangeDetail({ n }: { n: Notification }) {
  const items: Array<{ item_name: string; old_cost?: number; new_cost: number; pct_change?: number }> =
    n.data?.items ?? [];
  if (!items.length) return null;
  const isIncrease = n.type === "PRICE_INCREASE";
  return (
    <div className="mt-2 space-y-1 rounded-md border border-border/60 bg-muted/30 px-3 py-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-center justify-between text-[11px]">
          <span className="font-medium text-foreground/80 truncate max-w-[55%]">{item.item_name}</span>
          <span className={`font-mono font-semibold ${isIncrease ? "text-orange-600" : "text-emerald-600"}`}>
            {item.old_cost != null ? `${item.old_cost.toFixed(2)} → ` : ""}
            ${item.new_cost.toFixed(2)}
            {item.pct_change != null && (
              <span className="ml-1 opacity-70">
                ({isIncrease ? "+" : ""}{item.pct_change}%)
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

function NotificationItem({ n, onRead }: { n: Notification; onRead: (id: string) => void }) {
  const navigate = useNavigate();
  const severityCfg = severityConfig[n.severity] || severityConfig.INFO;
  const typeCfg = typeIconConfig[n.type];
  const iconColor = typeCfg?.color ?? severityCfg.color;
  const Icon = typeCfg?.icon ?? severityCfg.icon;

  const isPriceNotif = n.type === "PRICE_INCREASE" || n.type === "PRICE_DECREASE";
  const isDeliveryIssue = n.type === "DELIVERY_ISSUE";
  const invoiceId = n.data?.invoice_id ?? n.data?.purchase_history_id;

  const handleClick = () => {
    if (!n.read_at) onRead(n.id);
    if (isDeliveryIssue && invoiceId) navigate(`/app/invoices/${invoiceId}/review`);
  };

  return (
    <div
      className={`flex gap-3 p-4 rounded-lg transition-colors cursor-pointer ${
        n.read_at ? "opacity-60" : "bg-card hover:bg-muted/50"
      }`}
      onClick={handleClick}
    >
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconColor}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{n.title}</span>
          {!n.read_at && <div className="h-2 w-2 rounded-full bg-primary" />}
        </div>
        {/* For price notifications show the item-level breakdown; others show plain message */}
        {isPriceNotif ? (
          <PriceChangeDetail n={n} />
        ) : (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
        )}
        <div className="flex items-center gap-2 mt-1.5">
          <Badge variant="outline" className="text-[10px]">{n.type.replace(/_/g, " ")}</Badge>
          {isDeliveryIssue && invoiceId && (
            <Badge variant="outline" className="text-[10px] text-primary cursor-pointer">View invoice →</Badge>
          )}
          <span className="text-[10px] text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function NotificationsPage() {
  const { notifications, unreadCount, markRead, markAllRead, loading } = useNotifications();

  const filterNotifications = (tab: string): Notification[] => {
    if (tab === "critical")  return notifications.filter(n => n.severity === "CRITICAL");
    if (tab === "reminders") return notifications.filter(n => n.type === "REMINDER");
    if (tab === "invoices")  return notifications.filter(n =>
      ["PRICE_INCREASE", "PRICE_DECREASE", "DELIVERY_ISSUE"].includes(n.type)
    );
    return notifications;
  };

  const invoiceNotifCount = notifications.filter(n =>
    ["PRICE_INCREASE", "PRICE_DECREASE", "DELIVERY_ISSUE"].includes(n.type) && !n.read_at
  ).length;

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Notifications</h1>
          <p className="page-description">{unreadCount} unread notification{unreadCount !== 1 ? "s" : ""}</p>
        </div>
        {unreadCount > 0 && (
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={markAllRead}>
            <CheckCheck className="h-3.5 w-3.5" /> Mark all read
          </Button>
        )}
      </div>

      <Tabs defaultValue="all">
        <TabsList className="mb-4">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="invoices" className="gap-1.5">
            <DollarSign className="h-3 w-3" />
            Invoices
            {invoiceNotifCount > 0 && (
              <span className="ml-0.5 rounded-full bg-orange-500 text-white text-[9px] px-1.5 py-0.5 font-bold">
                {invoiceNotifCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="critical">Critical</TabsTrigger>
          <TabsTrigger value="reminders">Reminders</TabsTrigger>
        </TabsList>

        {["all", "invoices", "critical", "reminders"].map((tab) => (
          <TabsContent key={tab} value={tab}>
            <Card>
              <CardContent className="p-2">
                {loading ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">Loading…</div>
                ) : filterNotifications(tab).length === 0 ? (
                  <div className="empty-state py-12">
                    <Bell className="empty-state-icon h-8 w-8" />
                    <p className="empty-state-title">No notifications</p>
                    <p className="empty-state-description">You're all caught up!</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {filterNotifications(tab).map((n) => (
                      <NotificationItem key={n.id} n={n} onRead={markRead} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
