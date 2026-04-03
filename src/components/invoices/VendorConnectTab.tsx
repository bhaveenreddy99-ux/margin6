import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Loader2, Plug, Download, Check, AlertTriangle, Calendar } from "lucide-react";
import { InvoiceItem, VendorInvoiceSummary } from "./types";
import { useInvoiceMatching } from "./useInvoiceMatching";
import { formatNum } from "@/lib/inventory-utils";

interface VendorConnectTabProps {
  catalogItems: any[];
  onImportItems: (items: InvoiceItem[], vendorName: string, invoiceNumber: string, invoiceDate: string) => void;
}

export default function VendorConnectTab({ catalogItems, onImportItems }: VendorConnectTabProps) {
  const { currentRestaurant } = useRestaurant();
  const { matchItems } = useInvoiceMatching(catalogItems);
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [selectedIntegration, setSelectedIntegration] = useState("");
  const [dateRange, setDateRange] = useState("30");
  const [invoices, setInvoices] = useState<VendorInvoiceSummary[]>([]);
  const [selectedInvoices, setSelectedInvoices] = useState<Set<string>>(new Set());
  const [fetching, setFetching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [loadingIntegrations, setLoadingIntegrations] = useState(true);

  // Load vendor integrations
  useEffect(() => {
    if (!currentRestaurant) return;
    supabase.from("vendor_integrations")
      .select("*")
      .eq("restaurant_id", currentRestaurant.id)
      .eq("is_enabled", true)
      .then(({ data }) => {
        if (data) setIntegrations(data);
        setLoadingIntegrations(false);
      });
  }, [currentRestaurant]);

  // Also show built-in demo vendors if no integrations exist
  const demoVendors = [
    { id: "demo-sysco", vendor_name: "Sysco", is_demo: true },
    { id: "demo-usfoods", vendor_name: "US Foods", is_demo: true },
    { id: "demo-pfg", vendor_name: "PFG", is_demo: true },
  ];

  const allVendors = integrations.length > 0 ? integrations : demoVendors;

  const fetchInvoices = async () => {
    const vendor = allVendors.find(v => v.id === selectedIntegration);
    if (!vendor) return;
    setFetching(true);
    setInvoices([]);
    setSelectedInvoices(new Set());

    try {
      const { data, error } = await supabase.functions.invoke("vendor-import-invoices", {
        body: {
          vendor_name: vendor.vendor_name,
          integration_id: vendor.id,
          date_range_days: Number(dateRange),
        },
      });
      if (error) throw error;
      if (data?.invoices) {
        setInvoices(data.invoices);
        if (data.is_mock) {
          toast.info("Showing demo data — connect a real vendor for live invoices");
        }
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to fetch invoices");
    }
    setFetching(false);
  };

  const toggleInvoice = (invoiceNumber: string) => {
    setSelectedInvoices(prev => {
      const next = new Set(prev);
      if (next.has(invoiceNumber)) next.delete(invoiceNumber);
      else next.add(invoiceNumber);
      return next;
    });
  };

  const importSelected = async () => {
    if (selectedInvoices.size === 0) return;
    setImporting(true);

    try {
      // Import the first selected invoice (user can import more)
      const invoiceNumber = Array.from(selectedInvoices)[0];
      const { data, error } = await supabase.functions.invoke("vendor-import-invoice-details", {
        body: { invoice_number: invoiceNumber },
      });
      if (error) throw error;
      if (data?.items) {
        const matched = matchItems(data.items);
        onImportItems(matched, data.vendor_name, data.invoice_number, data.invoice_date);
        toast.success(`Imported ${data.items.length} items from ${data.invoice_number}`);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to import invoice details");
    }
    setImporting(false);
  };

  if (loadingIntegrations) {
    return <div className="space-y-3"><Skeleton className="h-10" /><Skeleton className="h-32" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs font-medium">Vendor</Label>
          <Select value={selectedIntegration} onValueChange={setSelectedIntegration}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue placeholder="Select vendor..." />
            </SelectTrigger>
            <SelectContent>
              {allVendors.map(v => (
                <SelectItem key={v.id} value={v.id} className="text-sm">
                  <div className="flex items-center gap-2">
                    {v.vendor_name}
                    {(v as any).is_demo && <Badge variant="secondary" className="text-[9px]">Demo</Badge>}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-medium">Date Range</Label>
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 Days</SelectItem>
              <SelectItem value="30">Last 30 Days</SelectItem>
              <SelectItem value="90">Last 90 Days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button
        onClick={fetchInvoices}
        disabled={!selectedIntegration || fetching}
        size="sm"
        className="gap-2"
      >
        {fetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
        Fetch Invoices
      </Button>

      {invoices.length > 0 && (
        <div className="space-y-3">
          <div className="rounded-lg border divide-y">
            {invoices.map(inv => (
              <label
                key={inv.invoice_number}
                className="flex items-center gap-3 p-3 hover:bg-muted/30 transition-colors cursor-pointer"
              >
                <Checkbox
                  checked={selectedInvoices.has(inv.invoice_number)}
                  onCheckedChange={() => toggleInvoice(inv.invoice_number)}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium font-mono">{inv.invoice_number}</span>
                    <Badge variant="secondary" className="text-[10px]">{inv.item_count} items</Badge>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                    <Calendar className="h-3 w-3" />
                    {new Date(inv.invoice_date).toLocaleDateString()}
                  </div>
                </div>
                <span className="text-sm font-mono font-semibold">${formatNum(inv.total)}</span>
              </label>
            ))}
          </div>

          <Button
            onClick={importSelected}
            disabled={selectedInvoices.size === 0 || importing}
            className="gap-2"
            size="sm"
          >
            {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Import {selectedInvoices.size} Invoice{selectedInvoices.size !== 1 ? "s" : ""}
          </Button>
        </div>
      )}

      {!fetching && invoices.length === 0 && selectedIntegration && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Plug className="h-8 w-8 mx-auto mb-2 opacity-20" />
            <p className="text-sm">Select a vendor and fetch invoices to get started</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
