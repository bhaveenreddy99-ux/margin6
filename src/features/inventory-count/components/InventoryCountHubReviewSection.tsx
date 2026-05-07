import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ClipboardCheck, Eye, CheckCircle, XCircle, MoreHorizontal } from "lucide-react";
import type { InventorySessionListRow, SessionStats } from "@/domain/inventory/enterInventoryTypes";
import { formatSessionRowDate } from "@/domain/inventory/enterInventoryHelpers";

type Props = {
  reviewSessions: InventorySessionListRow[];
  sessionStats: SessionStats;
  isManagerOrOwner: boolean;
  onView: (session: InventorySessionListRow) => void;
  onApprove: (sessionId: string) => void;
  onReject: (sessionId: string) => void;
};

export function InventoryCountHubReviewSection({
  reviewSessions,
  sessionStats,
  isManagerOrOwner,
  onView,
  onApprove,
  onReject,
}: Props) {
  const [pendingApproveId, setPendingApproveId] = useState<string | null>(null);

  const pendingSession = reviewSessions.find((s) => s.id === pendingApproveId);

  return (
    <>
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-tight">
            {isManagerOrOwner ? "Review" : "Submitted for Review"}
          </h2>
          {reviewSessions.length > 0 && (
            <Badge variant="secondary" className="text-[10px] font-normal tabular-nums">
              {reviewSessions.length}
            </Badge>
          )}
        </div>
        <Card className="border shadow-sm overflow-hidden">
          {reviewSessions.length === 0 ? (
            <CardContent className="py-10 text-center px-4">
              <ClipboardCheck className="h-9 w-9 text-muted-foreground/25 mb-2 mx-auto" />
              <p className="text-sm text-muted-foreground">Nothing waiting for review</p>
              <p className="text-xs text-muted-foreground/80 mt-1">Submitted counts will appear here for approval.</p>
            </CardContent>
          ) : (
            <div className="divide-y divide-border/60">
              {reviewSessions.map((s) => {
                const stats = sessionStats[s.id];
                const total = stats?.total ?? 0;
                return (
                  <div
                    key={s.id}
                    className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 hover:bg-muted/20 transition-colors"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-sm truncate">{s.name || "Count session"}</p>
                        <Badge className="bg-primary/10 text-primary border-0 text-[10px] shrink-0">In review</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        List: {s.inventory_lists?.name || "—"}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {s.locations?.name ? <span>{s.locations.name} · </span> : null}
                        Submitted {formatSessionRowDate(s.updated_at)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 sm:justify-end shrink-0">
                      <span className="text-xs text-muted-foreground tabular-nums">{total} items</span>
                      <Button size="sm" variant="default" className="h-9 gap-1.5" onClick={() => onView(s)}>
                        <Eye className="h-3.5 w-3.5" /> {isManagerOrOwner ? "Review" : "View"}
                      </Button>
                      {isManagerOrOwner && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="icon" className="h-9 w-9 shrink-0">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setPendingApproveId(s.id)}>
                              <CheckCircle className="h-3.5 w-3.5 mr-2 text-success" /> Approve
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive" onClick={() => onReject(s.id)}>
                              <XCircle className="h-3.5 w-3.5 mr-2" /> Send back
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </section>

      <AlertDialog
        open={!!pendingApproveId}
        onOpenChange={(open) => { if (!open) setPendingApproveId(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve this count?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingSession ? (
                <>
                  <span className="font-semibold text-foreground">{pendingSession.name || "This session"}</span>
                  {pendingSession.inventory_lists?.name ? ` (${pendingSession.inventory_lists.name})` : ""}
                  {" "}will become the official inventory snapshot for this location.
                  {" "}This sets the stock truth that drives smart orders and usage reports.
                </>
              ) : (
                "This will become the official inventory snapshot. Smart orders and usage reports will use these quantities."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-success text-success-foreground hover:bg-success/90"
              onClick={() => {
                const id = pendingApproveId;
                setPendingApproveId(null);
                if (id) onApprove(id);
              }}
            >
              Approve Count
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
