import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Check, AlertTriangle, X, TrendingUp, TrendingDown, Package, Info, Plus
} from "lucide-react";
import { formatNum } from "@/lib/inventory-utils";
import { InvoiceItem } from "./types";

interface InvoiceItemsTableProps {
  items: InvoiceItem[];
  catalogItems: any[];
  linkedSmartOrderItems: any[];
  lastSessionItems: any[];
  onUpdateItem: (index: number, field: string, value: any) => void;
  onRemoveItem: (index: number) => void;
  onMapItem: (index: number, catalogId: string) => void;
  onAddManualItem: () => void;
}

export default function InvoiceItemsTable({
  items, catalogItems, linkedSmartOrderItems, lastSessionItems,
  onUpdateItem, onRemoveItem, onMapItem, onAddManualItem,
}: InvoiceItemsTableProps) {
  const unmatchedCount = items.filter(i => i.match_status === "UNMATCHED").length;
  const matchedCount = items.filter(i => i.match_status === "MATCHED").length;
  const invoiceTotal = items.reduce((sum, i) => sum + (i.line_total ?? (i.unit_cost ? i.unit_cost * i.quantity : 0)), 0);

  const getExpectedOnHand = (itemName: string, qtyReceived: number) => {
    const sessionItem = lastSessionItems.find(s =>
      s.item_name.toLowerCase() === itemName.toLowerCase()
    );
    if (!sessionItem) return null;
    return Number(sessionItem.current_stock) + qtyReceived;
  };

  if (items.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="text-xs gap-1">
            <Package className="h-3 w-3" /> {items.length} items
          </Badge>
          {matchedCount > 0 && (
            <Badge className="bg-success/10 text-success text-xs border-0 gap-1">
              <Check className="h-3 w-3" /> {matchedCount} matched
            </Badge>
          )}
          {unmatchedCount > 0 && (
            <Badge className="bg-destructive/10 text-destructive text-xs border-0 gap-1">
              <AlertTriangle className="h-3 w-3" /> {unmatchedCount} unmatched
            </Badge>
          )}
        </div>
        <div className="text-sm font-semibold font-mono">
          Total: ${formatNum(invoiceTotal)}
        </div>
      </div>

      <div className="rounded-lg border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/20">
              <TableHead className="text-[10px] font-semibold uppercase w-8">Status</TableHead>
              <TableHead className="text-[10px] font-semibold uppercase">SKU</TableHead>
              <TableHead className="text-[10px] font-semibold uppercase">Item Name</TableHead>
              <TableHead className="text-[10px] font-semibold uppercase text-right">Qty</TableHead>
              <TableHead className="text-[10px] font-semibold uppercase text-right">Unit Cost</TableHead>
              <TableHead className="text-[10px] font-semibold uppercase text-right">Total</TableHead>
              <TableHead className="text-[10px] font-semibold uppercase">Match</TableHead>
              {lastSessionItems.length > 0 && (
                <TableHead className="text-[10px] font-semibold uppercase text-right">
                  <Tooltip><TooltipTrigger className="flex items-center gap-1">Est. On-Hand <Info className="h-3 w-3" /></TooltipTrigger>
                    <TooltipContent>Expected on-hand after delivery (informational only)</TooltipContent></Tooltip>
                </TableHead>
              )}
              {linkedSmartOrderItems.length > 0 && (
                <TableHead className="text-[10px] font-semibold uppercase text-right">Variance</TableHead>
              )}
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item, idx) => {
              const expectedOH = getExpectedOnHand(item.item_name, item.quantity);
              const soItem = linkedSmartOrderItems.find(s =>
                s.item_name.toLowerCase() === item.item_name.toLowerCase()
              );
              const costVariance = soItem && item.unit_cost != null && soItem.unit_cost != null
                ? ((item.unit_cost - soItem.unit_cost) / soItem.unit_cost) * 100
                : null;

              return (
                <TableRow key={idx} className={item.match_status === "UNMATCHED" ? "bg-destructive/5" : ""}>
                  <TableCell>
                    {item.match_status === "MATCHED" ? (
                      <Check className="h-4 w-4 text-success" />
                    ) : item.match_status === "MANUAL" ? (
                      <Badge variant="secondary" className="text-[9px]">M</Badge>
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {item.match_status === "MANUAL" ? (
                      <Input value={item.product_number || ""} onChange={e => onUpdateItem(idx, "product_number", e.target.value)}
                        className="h-7 text-xs w-20" placeholder="SKU" />
                    ) : (
                      item.product_number || "—"
                    )}
                  </TableCell>
                  <TableCell>
                    {item.match_status === "MANUAL" ? (
                      <Input value={item.item_name} onChange={e => onUpdateItem(idx, "item_name", e.target.value)}
                        className="h-7 text-xs" placeholder="Item name" />
                    ) : (
                      <div>
                        <span className="text-sm">{item.item_name}</span>
                        {item.catalog_match_name && item.catalog_match_name !== item.item_name && (
                          <span className="text-[10px] text-muted-foreground block">→ {item.catalog_match_name}</span>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {item.match_status === "MANUAL" ? (
                      <Input type="number" value={item.quantity || ""} onChange={e => onUpdateItem(idx, "quantity", Number(e.target.value))}
                        className="h-7 text-xs w-16 text-right" min={0} />
                    ) : (
                      <span className="font-mono text-sm">{formatNum(item.quantity)}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {item.match_status === "MANUAL" ? (
                      <Input type="number" value={item.unit_cost ?? ""} onChange={e => onUpdateItem(idx, "unit_cost", e.target.value ? Number(e.target.value) : null)}
                        className="h-7 text-xs w-20 text-right" min={0} step="0.01" />
                    ) : (
                      <span className="font-mono text-sm">{item.unit_cost != null ? `$${formatNum(item.unit_cost)}` : "—"}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    ${formatNum(item.line_total ?? (item.unit_cost ? item.unit_cost * item.quantity : 0))}
                  </TableCell>
                  <TableCell>
                    {item.match_status === "UNMATCHED" ? (
                      <Select onValueChange={v => onMapItem(idx, v)}>
                        <SelectTrigger className="h-7 text-[10px] w-32"><SelectValue placeholder="Map to item..." /></SelectTrigger>
                        <SelectContent>
                          {catalogItems.map(c => (
                            <SelectItem key={c.id} value={c.id} className="text-xs">{c.item_name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : item.match_status === "MANUAL" ? (
                      <Select value={item.catalog_item_id || "none"} onValueChange={v => onMapItem(idx, v === "none" ? "" : v)}>
                        <SelectTrigger className="h-7 text-[10px] w-32"><SelectValue placeholder="Link item..." /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {catalogItems.map(c => (
                            <SelectItem key={c.id} value={c.id} className="text-xs">{c.item_name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-xs text-success">✓ {item.catalog_match_name}</span>
                    )}
                  </TableCell>
                  {lastSessionItems.length > 0 && (
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">
                      {expectedOH != null ? formatNum(expectedOH) : "—"}
                    </TableCell>
                  )}
                  {linkedSmartOrderItems.length > 0 && (
                    <TableCell className="text-right">
                      {costVariance != null ? (
                        <span className={`text-xs font-mono flex items-center justify-end gap-0.5 ${
                          costVariance > 5 ? "text-destructive" : costVariance < -2 ? "text-success" : "text-muted-foreground"
                        }`}>
                          {costVariance > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                          {costVariance > 0 ? "+" : ""}{formatNum(costVariance)}%
                        </span>
                      ) : "—"}
                    </TableCell>
                  )}
                  <TableCell>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => onRemoveItem(idx)}>
                      <X className="h-3 w-3" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Button variant="outline" size="sm" onClick={onAddManualItem} className="gap-1.5 text-xs">
        <Plus className="h-3.5 w-3.5" /> Add Item
      </Button>
    </div>
  );
}
