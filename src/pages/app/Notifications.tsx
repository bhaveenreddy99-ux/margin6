import { useNotifications, Notification } from "@/hooks/useNotifications";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bell, AlertTriangle, Clock, CheckCheck } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const severityConfig = {
  CRITICAL: { color: "bg-destructive text-destructive-foreground", icon: AlertTriangle },
  WARNING: { color: "bg-warning text-warning-foreground", icon: AlertTriangle },
  INFO: { color: "bg-primary/10 text-primary", icon: Bell },
};

function NotificationItem({ n, onRead }: { n: Notification; onRead: (id: string) => void }) {
  const config = severityConfig[n.severity] || severityConfig.INFO;
  const Icon = config.icon;
  return (
    <div
      className={`flex gap-3 p-4 rounded-lg transition-colors cursor-pointer ${n.read_at ? "opacity-60" : "bg-card hover:bg-muted/50"}`}
      onClick={() => !n.read_at && onRead(n.id)}
    >
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${config.color}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{n.title}</span>
          {!n.read_at && <div className="h-2 w-2 rounded-full bg-primary" />}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
        <div className="flex items-center gap-2 mt-1.5">
          <Badge variant="outline" className="text-[10px]">{n.type}</Badge>
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
    if (tab === "critical") return notifications.filter(n => n.severity === "CRITICAL");
    if (tab === "reminders") return notifications.filter(n => n.type === "REMINDER");
    return notifications;
  };

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
          <TabsTrigger value="critical">Critical</TabsTrigger>
          <TabsTrigger value="reminders">Reminders</TabsTrigger>
        </TabsList>

        {["all", "critical", "reminders"].map((tab) => (
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
