import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type DrilldownRow = {
  label: string;
  value: number;
  date: string;
  source: string;
};

interface DrilldownSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  rows: DrilldownRow[];
  formula: string;
  loading?: boolean;
}

export function DrilldownSheet({
  open,
  onOpenChange,
  title,
  rows,
  formula,
  loading = false,
}: DrilldownSheetProps) {
  const total = rows.reduce(
    (acc, r) => acc + (Number.isFinite(r.value) ? r.value : 0),
    0,
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            Every line that adds up to the number on the dashboard.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6">
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-10 rounded-md" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">
              No rows to show for this period.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">$</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, i) => (
                  <TableRow key={`${row.label}-${i}`}>
                    <TableCell className="font-medium text-sm">
                      {row.label}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {row.date}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.source}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm font-semibold tabular-nums">
                      ${row.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {!loading && rows.length > 0 && (
          <div className="mt-6 border-t pt-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Total
              </span>
              <span className="text-lg font-bold font-mono tabular-nums">
                ${total.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            </div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1">
              Formula
            </p>
            <code className="block text-xs bg-muted/40 rounded p-2 font-mono leading-relaxed break-words">
              {formula}
            </code>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
