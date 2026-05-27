import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { InvoiceItem } from "./types";
import type { InvoiceListOption } from "@/domain/invoices/invoicesPageTypes";

type AddToCatalogForm = {
  item_name: string;
  brand_name: string;
  sku: string;
  pack_size: string;
  unit: string;
  unit_cost: string;
  selected_list_id: string;
};

type AddToCatalogSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceItem: InvoiceItem | null;
  restaurantId: string | null;
  vendorName: string;
  inventoryLists: InvoiceListOption[];
  onSuccess: (catalogItemId: string, catalogItemName: string) => void;
};

function buildFormFromItem(item: InvoiceItem | null, defaultListId: string): AddToCatalogForm {
  return {
    item_name: item?.item_name ?? "",
    brand_name: item?.brand_name ?? "",
    sku: item?.product_number ?? "",
    pack_size: item?.pack_size ?? "",
    unit: item?.unit ?? "",
    unit_cost: item?.unit_cost != null ? String(item.unit_cost) : "",
    selected_list_id: defaultListId,
  };
}

export default function AddToCatalogSheet({
  open,
  onOpenChange,
  invoiceItem,
  restaurantId,
  vendorName,
  inventoryLists,
  onSuccess,
}: AddToCatalogSheetProps) {
  const defaultListId = useMemo(
    () => (inventoryLists.length === 1 ? inventoryLists[0].id : ""),
    [inventoryLists],
  );
  const [form, setForm] = useState<AddToCatalogForm>(() => buildFormFromItem(invoiceItem, defaultListId));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(buildFormFromItem(invoiceItem, defaultListId));
    }
  }, [open, invoiceItem, defaultListId]);

  const handleSubmit = async () => {
    if (!restaurantId) return;
    if (!form.item_name.trim()) {
      toast.error("Item name is required");
      return;
    }
    if (!form.selected_list_id) {
      toast.error("Select an inventory list");
      return;
    }

    setSaving(true);
    try {
      const unitCostParsed = form.unit_cost.trim() !== "" ? Number(form.unit_cost) : null;
      const unitCost =
        unitCostParsed != null && Number.isFinite(unitCostParsed) ? unitCostParsed : null;

      const { data: newCatalogItem, error: catalogError } = await supabase
        .from("inventory_catalog_items")
        .insert({
          restaurant_id: restaurantId,
          inventory_list_id: form.selected_list_id,
          item_name: form.item_name.trim(),
          brand_name: form.brand_name.trim() || null,
          vendor_sku: form.sku.trim() || null,
          product_number: form.sku.trim() || null,
          pack_size: form.pack_size.trim() || null,
          unit: form.unit.trim() || null,
          default_unit_cost: unitCost,
          default_par_level: 0,
          sort_order: 9999,
          cost_unit: "case",
          vendor_name: vendorName.trim() || null,
        })
        .select("id, item_name")
        .single();

      if (catalogError || !newCatalogItem) {
        throw catalogError ?? new Error("Could not add item to catalog");
      }

      if (invoiceItem?.id) {
        const { error: invoiceItemError } = await supabase
          .from("invoice_items")
          .update({
            catalog_item_id: newCatalogItem.id,
            match_status: "MATCHED",
          })
          .eq("id", invoiceItem.id);

        if (invoiceItemError) {
          console.warn("[AddToCatalogSheet] invoice_items update", invoiceItemError);
        }
      }

      toast.success(`Added ${newCatalogItem.item_name} to catalog and matched`);
      onSuccess(newCatalogItem.id, newCatalogItem.item_name);
      onOpenChange(false);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Could not add to catalog";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Add Item to Catalog</SheetTitle>
          <SheetDescription>
            This item will be added to your inventory list and matched to this invoice line.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-1.5">
            <Label htmlFor="catalog-item-name">Item Name *</Label>
            <Input
              id="catalog-item-name"
              value={form.item_name}
              onChange={(event) => setForm((current) => ({ ...current, item_name: event.target.value }))}
              placeholder="e.g. Chicken Breast 40lb"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="catalog-brand-name">Brand Name</Label>
            <Input
              id="catalog-brand-name"
              value={form.brand_name}
              onChange={(event) => setForm((current) => ({ ...current, brand_name: event.target.value }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="catalog-sku">Vendor SKU (used for auto-matching future invoices)</Label>
            <Input
              id="catalog-sku"
              value={form.sku}
              onChange={(event) => setForm((current) => ({ ...current, sku: event.target.value }))}
              className="font-mono"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="catalog-pack-size">Pack Size</Label>
              <Input
                id="catalog-pack-size"
                value={form.pack_size}
                onChange={(event) => setForm((current) => ({ ...current, pack_size: event.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="catalog-unit">Unit</Label>
              <Input
                id="catalog-unit"
                value={form.unit}
                onChange={(event) => setForm((current) => ({ ...current, unit: event.target.value }))}
                placeholder="CS, LB, EA"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="catalog-unit-cost">Unit Cost</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
              <Input
                id="catalog-unit-cost"
                type="number"
                min={0}
                step="0.01"
                value={form.unit_cost}
                onChange={(event) => setForm((current) => ({ ...current, unit_cost: event.target.value }))}
                className="pl-7"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Which inventory list? *</Label>
            <Select
              value={form.selected_list_id || undefined}
              onValueChange={(value) => setForm((current) => ({ ...current, selected_list_id: value }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a list" />
              </SelectTrigger>
              <SelectContent>
                {inventoryLists.map((list) => (
                  <SelectItem key={list.id} value={list.id}>
                    {list.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <SheetFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="button"
            className="bg-gradient-amber shadow-amber"
            onClick={() => void handleSubmit()}
            disabled={saving || inventoryLists.length === 0}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add to Catalog →"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
