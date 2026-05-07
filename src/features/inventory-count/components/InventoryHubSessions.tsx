import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CalendarClock, ChevronRight, ClipboardList, Package, Play } from "lucide-react";
import {
  formatCountdown,
  formatSessionRowDate,
  getScheduleStatus,
} from "@/domain/inventory/enterInventoryHelpers";
import type { buildLandingFocus, findNextSchedule } from "@/domain/inventory/enterInventoryHelpers";
import type { InventoryListRow, InventorySessionListRow } from "@/domain/inventory/enterInventoryTypes";

type NextSchedule = NonNullable<ReturnType<typeof findNextSchedule>>;
type LandingFocus = ReturnType<typeof buildLandingFocus>;

type InventoryHubSessionsProps = {
  nextSchedule: NextSchedule | null;
  landingFocus: LandingFocus;
  lists: InventoryListRow[];
  inProgressSessions: InventorySessionListRow[];
  startingListId: string | null;
  onSelectLandingList: (id: string) => void;
  onOpenEditor: (session: InventorySessionListRow) => Promise<void>;
  onStartCountFromList: (listId: string) => Promise<void>;
  onOpenNewCountNameDialog: (listId: string, listName?: string | null) => void;
  onRequestClearInProgress: (sessionId: string) => void;
  navigate: (path: string) => void;
  /** When true, actions that start a new count (not "Continue") are disabled. */
  blockNewCountWithoutLocation?: boolean;
};

export function InventoryHubSessions({
  nextSchedule,
  landingFocus,
  lists,
  inProgressSessions,
  startingListId,
  onSelectLandingList,
  onOpenEditor,
  onStartCountFromList,
  onOpenNewCountNameDialog,
  onRequestClearInProgress,
  navigate,
  blockNewCountWithoutLocation = false,
}: InventoryHubSessionsProps) {
  return (
    <>
      {nextSchedule && (() => {
        const status = getScheduleStatus(nextSchedule.nextDate);
        const statusConfig = {
          upcoming: { label: "Upcoming", cls: "bg-primary/10 text-primary border-primary/20" },
          ready: { label: "Ready to Start", cls: "bg-success/10 text-success border-success/30" },
          overdue: { label: "Overdue", cls: "bg-destructive/10 text-destructive border-destructive/30" },
        }[status];
        const existingSession = inProgressSessions.find(
          (s) => s.inventory_list_id === nextSchedule.inventory_list_id,
        );
        return (
          <div
            className={`rounded-lg border p-4 ${
              status === "overdue"
                ? "border-destructive/30 bg-destructive/5"
                : status === "ready"
                ? "border-success/30 bg-success/5"
                : "border-border bg-card"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <CalendarClock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Next Scheduled Count
                  </p>
                  <Badge className={`text-[10px] border ${statusConfig.cls}`}>
                    {statusConfig.label}
                  </Badge>
                </div>
                <p className="font-semibold text-sm">{nextSchedule.name}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {nextSchedule.inventory_lists?.name}
                  {nextSchedule.locations?.name ? ` · ${nextSchedule.locations.name}` : ""}
                  {" · "}
                  {nextSchedule.nextDate.toLocaleDateString([], {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                  {" at "}
                  {nextSchedule.nextDate.toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {status === "overdue"
                    ? "This count is past due"
                    : `Starts in ${formatCountdown(nextSchedule.nextDate)}`}
                </p>
              </div>
              <Button
                size="sm"
                className="shrink-0 h-8 text-xs gap-1.5 bg-blue-600 text-white shadow-md shadow-blue-600/20 hover:bg-blue-700"
                disabled={!existingSession && blockNewCountWithoutLocation}
                onClick={() => {
                  if (existingSession) void onOpenEditor(existingSession);
                  else if (nextSchedule.inventory_list_id) {
                    onOpenNewCountNameDialog(
                      nextSchedule.inventory_list_id,
                      nextSchedule.inventory_lists?.name ?? null,
                    );
                  }
                }}
              >
                {existingSession ? (
                  <><ChevronRight className="h-3.5 w-3.5" />Continue</>
                ) : (
                  <><Play className="h-3.5 w-3.5" />Start now</>
                )}
              </Button>
            </div>
          </div>
        );
      })()}

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-tight">In progress</h2>
          {inProgressSessions.length > 0 && (
            <Badge variant="secondary" className="text-[10px] font-normal tabular-nums">
              {inProgressSessions.length}
            </Badge>
          )}
        </div>
        <Card className="border shadow-sm overflow-hidden">
          {lists.length === 0 ? (
            <CardContent className="py-12 text-center px-4">
              <Package className="h-10 w-10 text-muted-foreground/20 mb-3 mx-auto" />
              <p className="text-sm font-medium text-muted-foreground">No inventory lists yet</p>
              <p className="text-xs text-muted-foreground/80 mt-1 max-w-sm mx-auto">
                Create a list in List Management, then count it from here without leaving this page.
              </p>
              <Button
                variant="outline"
                className="mt-5 gap-1.5"
                onClick={() => navigate("/app/inventory/lists")}
              >
                <ClipboardList className="h-4 w-4" /> Go to List Management
              </Button>
            </CardContent>
          ) : landingFocus.focusList ? (
            <CardContent className="p-4 sm:p-5 space-y-4">
              <div className="space-y-2 max-w-md">
                <Label className="text-[11px] font-medium text-muted-foreground">View by</Label>
                <Select
                  value={landingFocus.effectiveLandingListId || undefined}
                  onValueChange={onSelectLandingList}
                >
                  <SelectTrigger className="h-10 w-full sm:w-[min(100%,320px)]">
                    <SelectValue placeholder="Select a list" />
                  </SelectTrigger>
                  <SelectContent>
                    {lists.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {(() => {
                const { focusList, focusInProgressSession, focusReviewSession, meta, stats } =
                  landingFocus;
                const total = stats?.total ?? 0;
                const counted = stats?.counted ?? 0;
                let statusText = "No active count in progress for this list.";
                let lastLine: string;
                if (focusInProgressSession) {
                  statusText = "Count in progress — continue or clear to start over.";
                  lastLine = [
                    focusInProgressSession.locations?.name,
                    `Updated ${formatSessionRowDate(focusInProgressSession.updated_at)}`,
                  ]
                    .filter(Boolean)
                    .join(" · ");
                } else if (focusReviewSession) {
                  statusText = "A count for this list is in review.";
                  lastLine = `Submitted ${formatSessionRowDate(focusReviewSession.updated_at)}`;
                } else if (meta.lastCountedAt) {
                  lastLine = `Last approved count ${format(new Date(meta.lastCountedAt), "MMM d, yyyy")}`;
                } else {
                  lastLine = "No approved count yet for this list";
                }
                const catalogCount = meta.itemCount;
                const itemLine =
                  focusInProgressSession && total > 0
                    ? `${counted}/${total} lines with quantity · ${total} rows in session`
                    : `${catalogCount} items on list`;

                return (
                  <div className="space-y-3 rounded-lg border border-border/60 bg-muted/25 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-sm truncate">
                        {focusInProgressSession?.name || focusList.name}
                      </p>
                      {focusInProgressSession && (
                        <Badge className="bg-warning/15 text-warning border-0 text-[10px] shrink-0">
                          In progress
                        </Badge>
                      )}
                      {focusReviewSession && !focusInProgressSession && (
                        <Badge className="bg-primary/10 text-primary border-0 text-[10px] shrink-0">
                          In review
                        </Badge>
                      )}
                    </div>
                    {focusInProgressSession && (
                      <p className="text-[11px] text-muted-foreground truncate">
                        List: {focusList.name}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">{statusText}</p>
                    <p className="text-[11px] text-muted-foreground">{lastLine}</p>
                    <p className="text-[11px] text-muted-foreground tabular-nums">{itemLine}</p>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Button
                        size="sm"
                        className="bg-blue-600 text-white shadow-md shadow-blue-600/20 hover:bg-blue-700 gap-1.5 h-9"
                        disabled={
                          !!startingListId ||
                          (!focusInProgressSession && blockNewCountWithoutLocation)
                        }
                        onClick={() =>
                          focusInProgressSession
                            ? void onOpenEditor(focusInProgressSession)
                            : void onStartCountFromList(focusList.id)
                        }
                      >
                        {focusInProgressSession ? (
                          <><ChevronRight className="h-3.5 w-3.5" /> Continue count</>
                        ) : (
                          <><Play className="h-3.5 w-3.5" /> Start new count</>
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9"
                        disabled={!focusInProgressSession}
                        onClick={() =>
                          focusInProgressSession &&
                          onRequestClearInProgress(focusInProgressSession.id)
                        }
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                );
              })()}
            </CardContent>
          ) : null}
        </Card>
      </section>
    </>
  );
}
