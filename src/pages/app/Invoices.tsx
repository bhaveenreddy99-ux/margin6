import { useCallback, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import {
  FileText, Upload, Plus, Search, Loader2, AlertTriangle,
  Package, Calendar, Truck, Eye, Trash2,
  Info, Plug, PenLine, Save, ClipboardCheck, Camera,
} from "lucide-react";
import { formatNum } from "@/lib/inventory-utils";
import { InvoiceItem, InvoiceHeader } from "@/components/invoices/types";
import InvoiceItemsTable from "@/components/invoices/InvoiceItemsTable";
import VendorConnectTab from "@/components/invoices/VendorConnectTab";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  buildInvoiceEditorItems,
  buildInvoiceHeaderFromRow,
} from "@/domain/invoices/invoicesPageHelpers";
import {
  filterInvoices,
  MAIN_INVOICE_STATUS_UI,
  resolveMainInvoiceStatusKey,
  summarizeInvoices,
} from "@/domain/invoices/invoicesPageSelectors";
import type {
  InvoiceCreateTab,
  InvoiceItemRow,
  InvoiceListRow,
  InvoiceStatusFilter,
} from "@/domain/invoices/invoicesPageTypes";
import { useInvoicesData } from "@/hooks/useInvoicesData";
import { useInvoiceActions } from "@/hooks/useInvoiceActions";

/** PO display from FK + joined row only (list / view). */
function PoLinkBadge(props: {
  purchaseOrderId: string | null | undefined;
  joinedPoNumber: string | null | undefined;
}) {
  const linked = Boolean(props.purchaseOrderId);
  if (!linked) {
    return <span className="text-[11px] text-muted-foreground/80">No purchase order linked</span>;
  }
  const num = props.joinedPoNumber?.trim();
  return (
    <span className="text-[11px] font-mono text-primary/70">PO: {num || "—"}</span>
  );
}

export default function InvoicesPage() {
  const { currentRestaurant } = useRestaurant();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [viewPurchase, setViewPurchase] = useState<InvoiceListRow | null>(null);
  const [viewItems, setViewItems] = useState<InvoiceItemRow[]>([]);
  const [searchFilter, setSearchFilter] = useState("");
  const [dateRange, setDateRange] = useState("all");
  const [statusFilter, setStatusFilter] = useState<InvoiceStatusFilter>("all");
  const [createTab, setCreateTab] = useState<InvoiceCreateTab>("manual");
  const [header, setHeader] = useState<InvoiceHeader>({
    vendor_name: "", invoice_number: "", invoice_date: new Date().toISOString().split("T")[0],
    po_number: "", location_id: "", linked_smart_order_id: "",
  });
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const intakeFileRef = useRef<HTMLInputElement>(null);
  const intakePhotoRef = useRef<HTMLInputElement>(null);
  const [parsedPoNumberFromPdf, setParsedPoNumberFromPdf] = useState<string | null>(null);
  const [editingPurchaseId, setEditingPurchaseId] = useState<string | null>(null);
  const {
    purchases,
    loading,
    deliveryIssuePOs,
    catalogItems,
    locations,
    smartOrders,
    lastSessionItems,
    linkedSmartOrderItems,
    vendorMappings,
    refreshPurchases,
    loadInvoiceItems,
  } = useInvoicesData({
    currentRestaurantId: currentRestaurant?.id,
    dateRange,
    linkedSmartOrderId: header.linked_smart_order_id,
  });

  const resetCreateForm = useCallback(() => {
    setHeader({
      vendor_name: "",
      invoice_number: "",
      invoice_date: new Date().toISOString().split("T")[0],
      po_number: "",
      location_id: "",
      linked_smart_order_id: "",
    });
    setItems([]);
    setCreateTab("manual");
    setEditingPurchaseId(null);
    setParsedPoNumberFromPdf(null);
  }, []);

  const openInvoiceEditor = useCallback(
    async (invoice: InvoiceListRow, parsedPoForHeader: string | null) => {
      const invoiceItems = await loadInvoiceItems(invoice.id);
      setEditingPurchaseId(invoice.id);
      setParsedPoNumberFromPdf(null);
      setHeader(buildInvoiceHeaderFromRow(invoice));
      setItems(invoiceItems.length > 0 ? buildInvoiceEditorItems(invoiceItems, catalogItems) : []);
      setCreateTab("manual");
      setCreateOpen(true);
      if (parsedPoForHeader) {
        setParsedPoNumberFromPdf(parsedPoForHeader);
        setHeader((current) => ({ ...current, po_number: parsedPoForHeader }));
      }
    },
    [catalogItems, loadInvoiceItems],
  );

  const {
    parsing,
    saving,
    intakeUploading,
    handleImportedFile,
    handleCapturedPhoto,
    handleSaveInvoice,
    handleIntakeUpload,
    handleDeleteInvoice,
  } = useInvoiceActions({
    currentRestaurantId: currentRestaurant?.id,
    userId: user?.id,
    createOpen,
    editingPurchaseId,
    header,
    items,
    catalogItems,
    vendorMappings,
    parsedPoNumberFromPdf,
    setHeader,
    setItems,
    setParsedPoNumberFromPdf,
    setCreateOpen,
    loadInvoiceItems,
    refreshPurchases,
    onResetCreateForm: resetCreateForm,
    onOpenEditorForInvoice: openInvoiceEditor,
  });

  const handleTakePhotoClick = useCallback(() => {
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches) {
      toast.error("Use Upload PDF instead on desktop");
      return;
    }
    photoInputRef.current?.click();
  }, []);

  const onImportFilePicked = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      await handleImportedFile(file);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [handleImportedFile],
  );

  const onImportPhotoPicked = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      await handleCapturedPhoto(file);
      if (photoInputRef.current) photoInputRef.current.value = "";
    },
    [handleCapturedPhoto],
  );

  const onIntakeFilePicked = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      await handleIntakeUpload(file, "file");
      if (intakeFileRef.current) intakeFileRef.current.value = "";
    },
    [handleIntakeUpload],
  );

  const onIntakePhotoPicked = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      await handleIntakeUpload(file, "photo");
      if (intakePhotoRef.current) intakePhotoRef.current.value = "";
    },
    [handleIntakeUpload],
  );

  const addManualItem = useCallback(() => {
    setItems((current) => [
      ...current,
      {
        product_number: null,
        item_name: "",
        quantity: 1,
        unit_cost: null,
        line_total: null,
        unit: null,
        pack_size: null,
        catalog_item_id: null,
        match_status: "MANUAL",
      },
    ]);
  }, []);

  const updateItem = useCallback(
    <K extends keyof InvoiceItem,>(index: number, field: K, value: InvoiceItem[K]) => {
      setItems((current) =>
        current.map((item, itemIndex) =>
          itemIndex === index ? { ...item, [field]: value } : item,
        ),
      );
    },
    [],
  );

  const onItemQuantityChange = useCallback((index: number, quantity: number) => {
    const nextQuantity = Number.isFinite(quantity) ? quantity : 0;
    setItems((current) =>
      current.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        return {
          ...item,
          quantity: nextQuantity,
          line_total: item.unit_cost != null ? item.unit_cost * nextQuantity : null,
        };
      }),
    );
  }, []);

  const onItemUnitCostChange = useCallback((index: number, unitCost: number | null) => {
    setItems((current) =>
      current.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        return {
          ...item,
          unit_cost: unitCost,
          line_total: unitCost != null ? unitCost * item.quantity : null,
        };
      }),
    );
  }, []);

  const removeItem = useCallback((index: number) => {
    setItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }, []);

  const mapItemToCatalog = useCallback(
    (index: number, catalogId: string) => {
      const catalogItem = catalogItems.find((item) => item.id === catalogId);
      if (!catalogItem) return;
      setItems((current) =>
        current.map((item, itemIndex) =>
          itemIndex === index
            ? {
                ...item,
                catalog_item_id: catalogId,
                match_status: "MATCHED",
                catalog_match_name: catalogItem.item_name,
              }
            : item,
        ),
      );
    },
    [catalogItems],
  );

  const handleEditInvoice = useCallback(
    async (invoice: InvoiceListRow) => {
      await openInvoiceEditor(invoice, null);
    },
    [openInvoiceEditor],
  );

  const handleViewPurchase = useCallback(
    async (invoice: InvoiceListRow) => {
      const invoiceItems = await loadInvoiceItems(invoice.id);
      setViewItems(invoiceItems);
      setViewPurchase(invoice);
    },
    [loadInvoiceItems],
  );

  const handleVendorImport = useCallback(
    (importedItems: InvoiceItem[], vendorName: string, invoiceNumber: string, invoiceDate: string) => {
      setItems(importedItems);
      setHeader((current) => ({
        ...current,
        vendor_name: vendorName,
        invoice_number: invoiceNumber,
        invoice_date: invoiceDate,
      }));
      setParsedPoNumberFromPdf(null);
      setCreateTab("manual");
    },
    [],
  );

  const filteredPurchases = useMemo(
    () => filterInvoices(purchases, searchFilter, statusFilter),
    [purchases, searchFilter, statusFilter],
  );

  const { draftCount, receivedCount, pendingReviewCount, activeVendors, lastInvoiceDate } = useMemo(
    () => summarizeInvoices(purchases),
    [purchases],
  );

  const getStatusBadge = useCallback((status: string) => {
    const key = resolveMainInvoiceStatusKey(status);
    const config = MAIN_INVOICE_STATUS_UI[key];
    return <Badge className={`${config.bgColor} ${config.color} text-[10px] border`}>{config.label}</Badge>;
  }, []);

  const getIssuesReportedBadge = useCallback((receiptStatus: string | null | undefined) => {
    if (receiptStatus !== "issues_reported") return null;
    return (
      <Badge className="bg-orange-500/10 text-orange-600 border-0 text-[10px]">Issues Reported</Badge>
    );
  }, []);

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Invoices (Receiving)</h1>
          <p className="page-description">Upload vendor invoices, match items, and track spend</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={intakeFileRef}
            type="file"
            accept=".pdf,.csv,application/pdf,text/csv"
            className="hidden"
            onChange={onIntakeFilePicked}
          />
          <input
            ref={intakePhotoRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onIntakePhotoPicked}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={intakeUploading || !currentRestaurant}
            onClick={() => intakeFileRef.current?.click()}
          >
            {intakeUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Upload File
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={intakeUploading || !currentRestaurant}
            onClick={() => intakePhotoRef.current?.click()}
          >
            {intakeUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            Upload Photo
          </Button>
          <Button
            type="button"
            className="bg-gradient-amber shadow-amber gap-2"
            size="sm"
            onClick={() => {
              resetCreateForm();
              setCreateOpen(true);
            }}
          >
            <PenLine className="h-4 w-4" /> Enter Manually
          </Button>
        </div>

        <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) resetCreateForm(); }}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                {editingPurchaseId ? "Edit Invoice" : "Record Invoice"}
              </DialogTitle>
            </DialogHeader>

            {/* Header Fields */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-medium">Vendor Name *</Label>
                <Input value={header.vendor_name} onChange={e => setHeader(h => ({ ...h, vendor_name: e.target.value }))} placeholder="e.g. Sysco" className="h-9 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">PO #</Label>
                <Input value={header.po_number} onChange={e => setHeader(h => ({ ...h, po_number: e.target.value }))} placeholder="Optional — auto-link" className="h-9 text-sm font-mono" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Invoice #</Label>
                <Input value={header.invoice_number} onChange={e => setHeader(h => ({ ...h, invoice_number: e.target.value }))} placeholder="INV-001" className="h-9 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Invoice Date</Label>
                <Input type="date" value={header.invoice_date} onChange={e => setHeader(h => ({ ...h, invoice_date: e.target.value }))} className="h-9 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Location</Label>
                <Select value={header.location_id || "none"} onValueChange={v => setHeader(h => ({ ...h, location_id: v === "none" ? "" : v }))}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Optional" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Optional Smart Order Link */}
            {smartOrders.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs font-medium flex items-center gap-1">
                  Link to Smart Order
                  <Tooltip><TooltipTrigger><Info className="h-3 w-3 text-muted-foreground" /></TooltipTrigger>
                    <TooltipContent>Link to compare estimated vs actual costs</TooltipContent></Tooltip>
                </Label>
                <Select value={header.linked_smart_order_id || "none"} onValueChange={v => setHeader(h => ({ ...h, linked_smart_order_id: v === "none" ? "" : v }))}>
                  <SelectTrigger className="h-9 text-sm w-full"><SelectValue placeholder="Optional — select to compare costs" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {smartOrders.map(so => (
                      <SelectItem key={so.id} value={so.id}>
                        {so.inventory_lists?.name || "Smart Order"} — {new Date(so.created_at).toLocaleDateString()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* 3 Input Tabs */}
            <Tabs value={createTab} onValueChange={(value) => setCreateTab(value as InvoiceCreateTab)}>
              <TabsList className="w-full">
                <TabsTrigger value="manual" className="flex-1 gap-1.5 text-xs">
                  <PenLine className="h-3.5 w-3.5" /> Manual
                </TabsTrigger>
                <TabsTrigger value="import" className="flex-1 gap-1.5 text-xs">
                  <Upload className="h-3.5 w-3.5" /> Import File
                </TabsTrigger>
                <TabsTrigger value="vendor" className="flex-1 gap-1.5 text-xs">
                  <Plug className="h-3.5 w-3.5" /> Vendor Connect
                </TabsTrigger>
              </TabsList>

              <TabsContent value="manual" className="space-y-3">
                {items.length === 0 && (
                  <Button variant="outline" size="sm" onClick={addManualItem} className="gap-1.5 text-xs">
                    <Plus className="h-3.5 w-3.5" /> Add First Item
                  </Button>
                )}
              </TabsContent>

              <TabsContent value="import" className="space-y-3">
                <div className="space-y-2">
                  <Label className="text-xs font-medium text-muted-foreground">Upload PDF or spreadsheet</Label>
                  <div className="border-2 border-dashed border-border rounded-xl p-8 text-center hover:border-primary/40 transition-colors">
                    <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,.pdf" onChange={onImportFilePicked} className="hidden" id="invoice-upload" />
                    <label htmlFor="invoice-upload" className="cursor-pointer space-y-2">
                      {parsing ? (
                        <Loader2 className="h-8 w-8 mx-auto text-primary animate-spin" />
                      ) : (
                        <Upload className="h-8 w-8 mx-auto text-muted-foreground/40" />
                      )}
                      <p className="text-sm font-medium">{parsing ? "AI is parsing your invoice..." : "Drop or click to upload"}</p>
                      <p className="text-xs text-muted-foreground">PDF, CSV, or Excel files supported</p>
                    </label>
                  </div>
                </div>
                <div className="space-y-2">
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    id="invoice-photo"
                    onChange={onImportPhotoPicked}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full gap-2"
                    disabled={parsing}
                    onClick={handleTakePhotoClick}
                  >
                    <Camera className="h-4 w-4" />
                    Take Photo
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="vendor">
                <VendorConnectTab
                  catalogItems={catalogItems}
                  onImportItems={handleVendorImport}
                />
              </TabsContent>
            </Tabs>

            {/* Items Table (shared across all tabs) */}
            <InvoiceItemsTable
              items={items}
              catalogItems={catalogItems}
              linkedSmartOrderItems={linkedSmartOrderItems}
              lastSessionItems={lastSessionItems}
              onUpdateItem={updateItem}
              onItemQuantityChange={onItemQuantityChange}
              onItemUnitCostChange={onItemUnitCostChange}
              onRemoveItem={removeItem}
              onMapItem={mapItemToCatalog}
              onAddManualItem={addManualItem}
            />

            {/* Save Actions */}
            <DialogFooter className="gap-2 flex-wrap">
              <Button variant="outline" onClick={() => { setCreateOpen(false); resetCreateForm(); }}>Cancel</Button>
              <Button
                variant="outline"
                onClick={() => handleSaveInvoice("DRAFT")}
                disabled={saving || items.length === 0}
                className="gap-2"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Draft
              </Button>
              <Button
                variant="secondary"
                onClick={() => handleSaveInvoice("RECEIVED")}
                disabled={saving || items.length === 0 || !header.vendor_name.trim()}
                className="gap-2"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
                Submit for Review
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as InvoiceStatusFilter)}>
                <SelectTrigger className="w-40 h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="pending_review">Pending Review</SelectItem>
                  <SelectItem value="posted">Posted</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Date Range</Label>
              <Select value={dateRange} onValueChange={setDateRange}>
                <SelectTrigger className="w-40 h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Time</SelectItem>
                  <SelectItem value="7">Last 7 Days</SelectItem>
                  <SelectItem value="30">Last 30 Days</SelectItem>
                  <SelectItem value="90">Last 90 Days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 flex-1 min-w-[180px]">
              <Label className="text-xs">Search</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <Input value={searchFilter} onChange={e => setSearchFilter(e.target.value)}
                  placeholder="Search by vendor or invoice #..." className="h-9 text-xs pl-8" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/8">
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{purchases.length}</p>
              <p className="text-xs text-muted-foreground">Total Invoices</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-warning/8">
              <AlertTriangle className="h-5 w-5 text-warning" />
            </div>
            <div>
              <p className="text-2xl font-bold">{draftCount + receivedCount}</p>
              <p className="text-xs text-muted-foreground">Pending</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-success/8">
              <Truck className="h-5 w-5 text-success" />
            </div>
            <div>
              <p className="text-2xl font-bold">{activeVendors}</p>
              <p className="text-xs text-muted-foreground">Active Vendors</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/8">
              <Calendar className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">
                {lastInvoiceDate ? new Date(lastInvoiceDate).toLocaleDateString() : "—"}
              </p>
              <p className="text-xs text-muted-foreground">Last Invoice</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Pending Review Banner */}
      {pendingReviewCount > 0 && (
        <Card className="border-warning/30 bg-warning/5">
          <CardContent className="flex items-center gap-3 p-4">
            <AlertTriangle className="h-5 w-5 text-warning flex-shrink-0" />
            <p className="text-sm text-warning flex-1">
              <span className="font-semibold">{pendingReviewCount} invoice{pendingReviewCount > 1 ? "s" : ""}</span> awaiting review. Click <strong>Review</strong> on each to verify lines and delivery details. Submitting for review from the editor only advances workflow — it does not post stock or costs.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Delivery Issues Banner */}
      {deliveryIssuePOs.length > 0 && (
        <Alert className="border-destructive/30 bg-destructive/5">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <AlertDescription className="text-sm flex flex-col gap-1">
            <span className="font-semibold text-destructive">
              {deliveryIssuePOs.length} purchase order{deliveryIssuePOs.length > 1 ? 's' : ''} have unresolved delivery issues
            </span>
            <div className="flex flex-wrap gap-2 mt-1">
              {deliveryIssuePOs.map((po) => (
                <button
                  key={po.purchase_history_id}
                  onClick={() => navigate(`/app/invoices/${po.purchase_history_id}/review`)}
                  className="text-destructive underline underline-offset-2 hover:opacity-70 text-xs font-mono"
                >
                  {po.po_number ?? 'PO'} ({po.issue_count} issue{po.issue_count !== 1 ? 's' : ''}) →
                </button>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Invoice List */}
      {loading ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">Loading...</CardContent></Card>
      ) : filteredPurchases.length === 0 ? (
        <Card>
          <CardContent className="empty-state">
            <FileText className="empty-state-icon" />
            <p className="empty-state-title">No invoices yet</p>
            <p className="empty-state-description">Upload your first vendor invoice to start tracking spend.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredPurchases.map(p => {
            const status = p.status || "review";
            const isPosted = status === "confirmed" || status === "COMPLETE";
            const isEditable = !isPosted;
            return (
              <Card key={p.id} className="hover:shadow-card transition-all duration-200">
                <CardContent className="flex items-center justify-between p-4">
                  <div className="cursor-pointer flex-1" onClick={() => handleViewPurchase(p)}>
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/8">
                        <FileText className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{p.vendor_name || "Unknown Vendor"}</p>
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
                          {p.invoice_number && <span className="font-mono">#{p.invoice_number}</span>}
                          <PoLinkBadge
                            purchaseOrderId={p.purchase_order_id}
                            joinedPoNumber={p.purchase_orders?.po_number ?? null}
                          />
                          <span>{new Date(p.created_at).toLocaleDateString()}</span>
                          {p.invoice_date && <span>· Invoice: {new Date(p.invoice_date).toLocaleDateString()}</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getStatusBadge(status)}
                    {getIssuesReportedBadge(p.receipt_status)}
                    {isEditable && (
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => handleEditInvoice(p)}>
                        <PenLine className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 gap-1 text-[11px]"
                      onClick={() => navigate(`/app/invoices/${p.id}/review`)}
                    >
                      <ClipboardCheck className="h-3.5 w-3.5" /> Review
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => handleViewPurchase(p)}>
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive" onClick={() => handleDeleteInvoice(p.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* View Invoice Dialog */}
      <Dialog open={!!viewPurchase} onOpenChange={() => { setViewPurchase(null); setViewItems([]); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {viewPurchase?.vendor_name || "Invoice"} {viewPurchase?.invoice_number ? `#${viewPurchase.invoice_number}` : ""}
              {viewPurchase && (
                <>
                  {getStatusBadge(viewPurchase.status || "review")}
                  {getIssuesReportedBadge(viewPurchase.receipt_status)}
                </>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground items-center">
              {viewPurchase?.invoice_date && <span>Invoice Date: {new Date(viewPurchase.invoice_date).toLocaleDateString()}</span>}
              <span>Recorded: {viewPurchase && new Date(viewPurchase.created_at).toLocaleDateString()}</span>
              {viewPurchase && (
                <PoLinkBadge
                  purchaseOrderId={viewPurchase.purchase_order_id}
                  joinedPoNumber={viewPurchase.purchase_orders?.po_number ?? null}
                />
              )}
            </div>
            <div className="rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/20">
                    <TableHead className="text-[10px] font-semibold uppercase">Item</TableHead>
                    <TableHead className="text-[10px] font-semibold uppercase text-right">Qty</TableHead>
                    <TableHead className="text-[10px] font-semibold uppercase text-right">Unit Cost</TableHead>
                    <TableHead className="text-[10px] font-semibold uppercase text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {viewItems.map(i => (
                    <TableRow key={i.id}>
                      <TableCell className="text-sm">{i.item_name}</TableCell>
                      <TableCell className="text-sm text-right font-mono">{formatNum(i.quantity)}</TableCell>
                      <TableCell className="text-sm text-right font-mono">{i.unit_cost != null ? `$${formatNum(i.unit_cost)}` : "—"}</TableCell>
                      <TableCell className="text-sm text-right font-mono font-semibold">${formatNum(i.total_cost || 0)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="text-right text-sm font-semibold font-mono">
              Total: ${formatNum(viewItems.reduce((s, i) => s + Number(i.total_cost || 0), 0))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
