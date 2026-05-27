import { useMemo, useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import type { InvoiceCatalogItem } from "@/domain/invoices/invoicesPageTypes";

type CatalogItemMapComboboxProps = {
  catalogItems: InvoiceCatalogItem[];
  onSelect: (catalogId: string) => void;
  onAddToCatalog: () => void;
  className?: string;
};

function buildSearchValue(item: InvoiceCatalogItem): string {
  return [item.item_name, item.brand_name, item.vendor_sku, item.product_number]
    .filter(Boolean)
    .join(" ");
}

export default function CatalogItemMapCombobox({
  catalogItems,
  onSelect,
  onAddToCatalog,
  className,
}: CatalogItemMapComboboxProps) {
  const [open, setOpen] = useState(false);

  const sortedItems = useMemo(
    () => [...catalogItems].sort((a, b) => a.item_name.localeCompare(b.item_name)),
    [catalogItems],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          className={cn("h-7 justify-between text-[10px] w-36 px-2 font-normal", className)}
        >
          Map to item...
          <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="start">
        <Command
          filter={(value, search) => {
            if (!search.trim()) return 1;
            return value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Search items..." autoFocus />
          <CommandList className="max-h-[300px]">
            <CommandEmpty className="py-4 px-3 space-y-3">
              <p className="text-sm text-muted-foreground">No matching items found</p>
              <Button type="button" size="sm" variant="outline" className="w-full" onClick={() => {
                setOpen(false);
                onAddToCatalog();
              }}>
                + Add to Catalog
              </Button>
            </CommandEmpty>
            <CommandGroup>
              {sortedItems.map((catalogItem) => {
                const sku = catalogItem.vendor_sku ?? catalogItem.product_number ?? "—";
                const brand = catalogItem.brand_name ?? "—";
                return (
                  <CommandItem
                    key={catalogItem.id}
                    value={buildSearchValue(catalogItem)}
                    onSelect={() => {
                      onSelect(catalogItem.id);
                      setOpen(false);
                    }}
                  >
                    <div className="flex flex-col gap-0.5">
                      <div className="font-medium text-sm">{catalogItem.item_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {brand} · {sku}
                      </div>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
