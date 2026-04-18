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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { InventorySessionListRow, ParGuideRow } from "@/domain/inventory/enterInventoryTypes";

type Props = {
  newCountNameDialogOpen: boolean;
  onNewCountNameDialogOpenChange: (open: boolean) => void;
  newCountNameInput: string;
  onNewCountNameInputChange: (value: string) => void;
  /** When set, primary action is disabled (session creation in flight). */
  startingListId: string | null | undefined;
  onConfirmNewCountSessionName: () => void;

  smartOrderSession: InventorySessionListRow | null;
  onSmartOrderDialogOpenChange: (open: boolean) => void;
  smartOrderSelectedPar: string;
  onSmartOrderSelectedParChange: (value: string) => void;
  smartOrderParGuides: ParGuideRow[];
  onCreateSmartOrder: () => void;
  smartOrderCreating: boolean;

  clearEntriesSessionId: string | null;
  onClearEntriesOpenChange: (open: boolean) => void;
  onConfirmClearEntries: () => void;

  clearInProgressSessionId: string | null;
  onClearInProgressOpenChange: (open: boolean) => void;
  onConfirmClearInProgressSession: () => void;

  deleteSessionId: string | null;
  onDeleteSessionOpenChange: (open: boolean) => void;
  onConfirmDeleteSession: () => void;
};

export function InventoryCountHubModals({
  newCountNameDialogOpen,
  onNewCountNameDialogOpenChange,
  newCountNameInput,
  onNewCountNameInputChange,
  startingListId,
  onConfirmNewCountSessionName,
  smartOrderSession,
  onSmartOrderDialogOpenChange,
  smartOrderSelectedPar,
  onSmartOrderSelectedParChange,
  smartOrderParGuides,
  onCreateSmartOrder,
  smartOrderCreating,
  clearEntriesSessionId,
  onClearEntriesOpenChange,
  onConfirmClearEntries,
  clearInProgressSessionId,
  onClearInProgressOpenChange,
  onConfirmClearInProgressSession,
  deleteSessionId,
  onDeleteSessionOpenChange,
  onConfirmDeleteSession,
}: Props) {
  return (
    <>
      <Dialog open={newCountNameDialogOpen} onOpenChange={onNewCountNameDialogOpenChange}>
        <DialogContent className="sm:max-w-md" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Name this count</DialogTitle>
            <DialogDescription>
              This names the specific count you are starting. Your saved list stays the master item list; this title is only for this run.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <Label htmlFor="new-count-session-name">Count session name</Label>
            <Input
              id="new-count-session-name"
              value={newCountNameInput}
              onChange={(e) => onNewCountNameInputChange(e.target.value)}
              placeholder="e.g. Monday morning count"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void onConfirmNewCountSessionName();
                }
              }}
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onNewCountNameDialogOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-gradient-amber shadow-amber"
              disabled={!newCountNameInput.trim() || !!startingListId}
              onClick={() => void onConfirmNewCountSessionName()}
            >
              Start count
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!smartOrderSession} onOpenChange={(o) => !o && onSmartOrderDialogOpenChange(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Smart Order</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                Session: <span className="font-medium text-foreground">{smartOrderSession?.name}</span>
              </p>
              <p className="text-sm text-muted-foreground">
                List: <span className="font-medium text-foreground">{smartOrderSession?.inventory_lists?.name}</span>
              </p>
            </div>
            <div className="space-y-2">
              <Label>Select PAR Guide</Label>
              <Select value={smartOrderSelectedPar} onValueChange={onSmartOrderSelectedParChange}>
                <SelectTrigger className="h-10">
                  <SelectValue placeholder="Choose PAR guide" />
                </SelectTrigger>
                <SelectContent>
                  {smartOrderParGuides.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {smartOrderParGuides.length === 0 && (
                <p className="text-xs text-muted-foreground">No PAR guides found for this list. Create one in PAR Management first.</p>
              )}
            </div>
            <Button
              onClick={onCreateSmartOrder}
              className="w-full bg-gradient-amber"
              disabled={!smartOrderSelectedPar || smartOrderCreating}
            >
              {smartOrderCreating ? "Creating..." : "Create Smart Order"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!clearEntriesSessionId} onOpenChange={onClearEntriesOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all entries?</AlertDialogTitle>
            <AlertDialogDescription>
              This will reset all current stock values to 0 for this session. The item rows will be kept so you can recount.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirmClearEntries}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Clear Entries
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!clearInProgressSessionId} onOpenChange={onClearInProgressOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear this count?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the in-progress session and its entered quantities for this list. Your saved list in List Management is not deleted. You can start a fresh count afterward.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void onConfirmClearInProgressSession()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Clear count
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteSessionId} onOpenChange={onDeleteSessionOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this session?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this session and all its items. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No, keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirmDeleteSession}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Yes, delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
