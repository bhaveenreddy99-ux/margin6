import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Download } from "lucide-react";
import { exportToCSV, exportToExcel, exportToPDF } from "@/lib/export-utils";

interface ExportButtonsProps {
  items: any[];
  filename: string;
  type?: "inventory" | "smartorder";
  meta?: { listName?: string; sessionName?: string; date?: string };
}

export function ExportButtons({ items, filename, type = "inventory", meta }: ExportButtonsProps) {
  if (items.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1">
          <Download className="h-3.5 w-3.5" /> Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onClick={() => exportToCSV(items, filename, type)}>
          Export CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => exportToExcel(items, filename, type, meta)}>
          Export Excel (.xlsx)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => exportToPDF(items, filename, type, meta)}>
          Export PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
