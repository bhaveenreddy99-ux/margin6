import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Flag, Loader2 } from "lucide-react";
import type { InvoiceReviewComparison } from "@/domain/invoices/invoiceReviewTypes";
import { ISSUE_TYPES } from "@/domain/invoices/invoiceStatusLifecycle";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reportItem: InvoiceReviewComparison | null;
  issueType: string;
  onIssueTypeChange: (val: string) => void;
  notes: string;
  onNotesChange: (val: string) => void;
  saving: boolean;
  onSave: () => void;
};

export function ReportIssueSheet({
  open,
  onOpenChange,
  reportItem,
  issueType,
  onIssueTypeChange,
  notes,
  onNotesChange,
  saving,
  onSave,
}: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[380px] sm:max-w-[380px]">
        <SheetHeader>
          <SheetTitle>Report Issue</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 mt-4">
          <div>
            <Label className="text-xs text-muted-foreground">Item</Label>
            <p className="text-sm font-medium mt-1">{reportItem?.item_name}</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Issue Type</Label>
            <Select value={issueType} onValueChange={onIssueTypeChange}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ISSUE_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Notes (optional)</Label>
            <Textarea
              placeholder="Describe the issue..."
              value={notes}
              onChange={(e) => onNotesChange(e.target.value)}
              className="text-sm min-h-[80px]"
            />
          </div>
        </div>
        <SheetFooter className="mt-6 flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="flex-1" disabled={saving} onClick={onSave}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Flag className="h-4 w-4 mr-2" />
            )}
            Report Issue
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
