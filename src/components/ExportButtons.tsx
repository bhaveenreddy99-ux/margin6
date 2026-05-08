import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Download } from "lucide-react";
import { exportToCSV, exportToExcel, exportToPDF, exportToVendorEmail } from "@/lib/export-utils";

interface ExportButtonsProps {
  items: any[];
  filename: string;
  type?: "inventory" | "smartorder";
  meta?: { listName?: string; sessionName?: string; date?: string };
  vendorName?: string;
  restaurantName?: string;
  totalEstCost?: number;
}

export function ExportButtons({ items, filename, type = "inventory", meta, vendorName, restaurantName, totalEstCost }: ExportButtonsProps) {
  if (items.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1">
          <Download className="h-3.5 w-3.5" /> Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {type === "smartorder" && (
          <DropdownMenuItem
            onClick={() =>
              exportToVendorEmail(items, { ...meta, vendorName, restaurantName, totalEstCost })
            }
          >
            📧 Email Order to Vendor
          </DropdownMenuItem>
        )}
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
