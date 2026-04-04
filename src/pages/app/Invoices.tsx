import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import {
  FileText, Upload, Plus, Search, Loader2, Check, AlertTriangle,
  DollarSign, Package, Calendar, Truck, Eye, Trash2,
  Info, Plug, PenLine, Save, ClipboardCheck, Camera,
} from "lucide-react";
import { formatNum } from "@/lib/inventory-utils";
import * as XLSX from "xlsx";
import { InvoiceItem, InvoiceHeader, InvoiceStatus } from "@/components/invoices/types";
import { useInvoiceMatching } from "@/components/invoices/useInvoiceMatching";
import InvoiceItemsTable from "@/components/invoices/InvoiceItemsTable";
import VendorConnectTab from "@/components/invoices/VendorConnectTab";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";

const STATUS_CONFIG: Record<InvoiceStatus, { label: string; color: string; bgColor: string }> = {
  DRAFT: { label: "Draft", color: "text-warning", bgColor: "bg-warning/10 border-warning/20" },
  RECEIVED: { label: "Received", color: "text-primary", bgColor: "bg-primary/10 border-primary/20" },
  POSTED: { label: "Posted", color: "text-success", bgColor: "bg-success/10 border-success/20" },
};

export default function InvoicesPage() {
  const { currentRestaurant } = useRestaurant();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [purchases, setPurchases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [viewPurchase, setViewPurchase] = useState<any>(null);
  const [viewItems, setViewItems] = useState<any[]>([]);
  const [searchFilter, setSearchFilter] = useState("");
  const [dateRange, setDateRange] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [deliveryIssuePOs, setDeliveryIssuePOs] = useState<Array<{
    purchase_history_id: string;
    po_number: string | null;
    issue_count: number;
  }>>([]);

  // Create invoice state
  const [createTab, setCreateTab] = useState("manual");
  const [header, setHeader] = useState<InvoiceHeader>({
    vendor_name: "", invoice_number: "", invoice_date: new Date().toISOString().split("T")[0],
    po_number: "", location_id: "", linked_smart_order_id: "",
  });
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [catalogItems, setCatalogItems] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [smartOrders, setSmartOrders] = useState<any[]>([]);
  const [linkedSmartOrderItems, setLinkedSmartOrderItems] = useState<any[]>([]);
  const [lastSessionItems, setLastSessionItems] = useState<any[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  /** Set when parse-invoice returns a PO# from a PDF (used for auto-link after save). */
  const [parsedPoNumberFromPdf, setParsedPoNumberFromPdf] = useState<string | null>(null);
  const { matchItems } = useInvoiceMatching(catalogItems);

  // Editing existing draft
  const [editingPurchaseId, setEditingPurchaseId] = useState<string | null>(null);

  const fetchPurchases = useCallback(async () => {
    if (!currentRestaurant) return;
    setLoading(true);
    let query = supabase.from("invoices").select("*, purchase_orders(po_number, smart_order_run_id)")
      .eq("restaurant_id", currentRestaurant.id)
      .order("created_at", { ascending: false });

    if (dateRange !== "all") {
      const now = new Date();
      let start: Date;
      if (dateRange === "7") start = new Date(now.getTime() - 7 * 86400000);
      else if (dateRange === "30") start = new Date(now.getTime() - 30 * 86400000);
      else start = new Date(now.getTime() - 90 * 86400000);
      query = query.gte("created_at", start.toISOString());
    }

    const { data } = await query;
    if (data) {
      setPurchases(data.map((row: any) => ({
        ...row,
        po_number: row.purchase_orders?.po_number ?? row.po_number ?? null,
        smart_order_run_id: row.purchase_orders?.smart_order_run_id ?? null,
      })));
    }
    setLoading(false);
  }, [currentRestaurant, dateRange]);

  useEffect(() => { fetchPurchases(); }, [fetchPurchases]);

  useEffect(() => {
    if (!currentRestaurant) return;
    supabase
      .rpc('get_delivery_issue_pos', { p_restaurant_id: currentRestaurant.id })
      .then(({ data, error }) => {
        if (!error && data) setDeliveryIssuePOs(data);
      });
  }, [currentRestaurant]);

  useEffect(() => {
    if (!currentRestaurant) return;
    Promise.all([
    supabase.from("inventory_catalog_items").select("id, item_name, vendor_sku, product_number, brand_name, vendor_name, unit, pack_size, default_unit_cost")
        .eq("restaurant_id", currentRestaurant.id),
      supabase.from("locations").select("id, name").eq("restaurant_id", currentRestaurant.id).eq("is_active", true),
      supabase.from("smart_order_runs").select("id, created_at, inventory_list_id, inventory_lists(name)")
        .eq("restaurant_id", currentRestaurant.id).order("created_at", { ascending: false }).limit(10),
    ]).then(([catRes, locRes, soRes]) => {
      if (catRes.data) setCatalogItems(catRes.data);
      if (locRes.data) setLocations(locRes.data);
      if (soRes.data) setSmartOrders(soRes.data);
    });
  }, [currentRestaurant]);

  // Last session items for expected on-hand
  useEffect(() => {
    if (!currentRestaurant) return;
    supabase.from("inventory_sessions").select("id").eq("restaurant_id", currentRestaurant.id)
      .eq("status", "APPROVED").order("approved_at", { ascending: false }).limit(1)
      .then(({ data: sessions }) => {
        if (sessions?.length) {
          supabase.from("inventory_session_items").select("item_name, current_stock")
            .eq("session_id", sessions[0].id).then(({ data }) => { if (data) setLastSessionItems(data); });
        }
      });
  }, [currentRestaurant]);

  // Load linked PO / smart order lines for variance (normalize to suggested_order)
  useEffect(() => {
    if (!header.linked_smart_order_id) { setLinkedSmartOrderItems([]); return; }
    (async () => {
      const { data: po } = await supabase.from("purchase_orders").select("id").eq("smart_order_run_id", header.linked_smart_order_id).maybeSingle();
      if (po?.id) {
        const { data: poi } = await supabase.from("purchase_order_items").select("*").eq("purchase_order_id", po.id);
        setLinkedSmartOrderItems((poi || []).map((p: any) => ({ ...p, suggested_order: p.quantity_ordered })));
      } else {
        const { data: sri } = await supabase.from("smart_order_run_items").select("*").eq("run_id", header.linked_smart_order_id);
        setLinkedSmartOrderItems(sri || []);
      }
    })();
  }, [header.linked_smart_order_id]);

  /** After invoice rows are saved: auto-link PO when not manually linked. Never throws. */
  const applyAutoPoLinkAfterSave = useCallback(
    async (args: {
      invoiceId: string;
      restaurantId: string;
      hadManualPoLink: boolean;
      manualPoNumber: string | null;
      parsedPoFromPdf: string | null;
      vendorName: string;
    }) => {
      if (args.hadManualPoLink) return;

      const poTrim =
        (args.manualPoNumber?.trim() || args.parsedPoFromPdf?.trim() || "") || "";

      const linkPurchaseOrder = async (poId: string, poLabel: string | null) => {
        const { error: updErr } = await supabase
          .from("invoices")
          .update({ purchase_order_id: poId, updated_at: new Date().toISOString() })
          .eq("id", args.invoiceId);
        if (updErr) {
          toast.warning("Invoice saved — could not attach purchase order.");
          console.error("invoice purchase_order_id update", updErr);
          return false;
        }
        toast.success(`Linked to PO ${poLabel ?? "—"}`);
        await fetchPurchases();
        return true;
      };

      // Method 1 — match by PO number (manual field takes precedence over parsed PDF)
      if (poTrim) {
        const { data: poRows, error } = await supabase
          .from("purchase_orders")
          .select("id, po_number, created_at")
          .eq("restaurant_id", args.restaurantId)
          .eq("po_number", poTrim)
          .order("created_at", { ascending: false });

        if (error) {
          toast.warning("Invoice saved — could not look up purchase order.");
          console.error("purchase_orders po_number lookup", error);
          // fall through to Method 2
        } else if (poRows?.length) {
          const best = poRows[0];
          await linkPurchaseOrder(best.id, best.po_number ?? poTrim);
          return;
        }
        // Not found by PO# — continue to Method 2
      }

      // Method 2 — vendor + date window (only when Method 1 did not link)
      const fourteenDaysAgo = new Date();
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

      const { data: rows, error: vErr } = await supabase
        .from("purchase_orders")
        .select("id, po_number, vendor_name, created_at")
        .eq("restaurant_id", args.restaurantId)
        .gte("created_at", fourteenDaysAgo.toISOString());

      if (vErr) {
        toast.warning("Invoice saved — could not search purchase orders.");
        console.error("purchase_orders vendor window lookup", vErr);
        return;
      }

      const inv = args.vendorName.trim().toLowerCase();
      const pool = rows ?? [];
      const candidates = pool.filter((r) => {
        const vn = r.vendor_name;
        if (vn == null || String(vn).trim() === "") return true;
        if (!inv) return false;
        return String(vn).toLowerCase().includes(inv);
      });

      if (candidates.length === 0) {
        toast.info("Invoice saved — no matching PO found");
        return;
      }
      if (candidates.length > 1) {
        toast.info("Multiple POs found — please link manually");
        return;
      }

      await linkPurchaseOrder(candidates[0].id, candidates[0].po_number);
    },
    [fetchPurchases],
  );

  /** Raw file bytes → base64 (same encoding as PDF path). */
  const fileToBase64Raw = async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  };

  type ParseInvoiceResult = {
    vendor_name?: string;
    invoice_number?: string;
    invoice_date?: string;
    po_number?: string | null;
    items?: unknown[];
    error?: string;
  };

  const applyParseInvoiceResult = (result: ParseInvoiceResult, mode: "pdf" | "image") => {
    if (result.error) throw new Error(result.error);
    if (result.vendor_name) setHeader((h) => ({ ...h, vendor_name: result.vendor_name as string }));
    if (result.invoice_number) setHeader((h) => ({ ...h, invoice_number: result.invoice_number as string }));
    if (result.invoice_date) setHeader((h) => ({ ...h, invoice_date: result.invoice_date as string }));
    if (result.po_number != null && String(result.po_number).trim()) {
      const po = String(result.po_number).trim();
      setParsedPoNumberFromPdf(po);
      setHeader((h) => ({ ...h, po_number: po }));
    }
    if (result.items?.length) {
      setItems(matchItems(result.items as Parameters<typeof matchItems>[0]));
      toast.success(`AI extracted ${result.items.length} items`);
    } else if (mode === "image") {
      setHeader((h) => ({
        ...h,
        vendor_name: "",
        invoice_number: "",
        invoice_date: new Date().toISOString().split("T")[0],
        po_number: "",
      }));
      setItems([]);
      setParsedPoNumberFromPdf(null);
      toast.error("Could not read — please fill in manually");
    } else {
      toast.error("AI could not extract items from this PDF");
    }
  };

  // Parse CSV/Excel file
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setParsedPoNumberFromPdf(null);

    const isSpreadsheet = /\.(csv|xlsx|xls)$/i.test(file.name);
    const isPDF = /\.pdf$/i.test(file.name);

    if (isSpreadsheet) {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws);

      if (rows.length === 0) { toast.error("No data found in file"); return; }

      const headers = Object.keys(rows[0]).map(h => h.toLowerCase());
      const findCol = (keys: string[]) => {
        const original = Object.keys(rows[0]);
        for (const k of keys) {
          const idx = headers.findIndex(h => h.includes(k));
          if (idx >= 0) return original[idx];
        }
        return null;
      };

      const nameCol = findCol(["item", "description", "product name", "desc"]);
      const qtyCol = findCol(["qty", "quantity", "shipped", "ship"]);
      const priceCol = findCol(["price", "unit cost", "cost", "unit price"]);
      const totalCol = findCol(["total", "extended", "amount", "ext"]);
      const skuCol = findCol(["product number", "sku", "item number", "item #", "product #", "prod"]);
      const unitCol = findCol(["unit", "uom", "measure"]);
      const packCol = findCol(["pack", "size", "pack size"]);
      const brandCol = findCol(["brand", "manufacturer", "mfg", "brand name"]);

      const parsed = rows.map(row => ({
        product_number: skuCol ? String(row[skuCol] || "") : null,
        item_name: nameCol ? String(row[nameCol] || "") : "",
        quantity: qtyCol ? Number(row[qtyCol]) || 0 : 0,
        unit_cost: priceCol ? Number(String(row[priceCol]).replace(/[$,]/g, "")) || null : null,
        line_total: totalCol ? Number(String(row[totalCol]).replace(/[$,]/g, "")) || null : null,
        unit: unitCol ? String(row[unitCol] || "") : null,
        pack_size: packCol ? String(row[packCol] || "") : null,
        brand_name: brandCol ? String(row[brandCol] || "") : null,
      })).filter(r => r.item_name);

      setItems(matchItems(parsed));
      toast.success(`Parsed ${parsed.length} items from file`);
    } else if (isPDF) {
      setParsing(true);
      try {
        const base64 = await fileToBase64Raw(file);
        const { data: result, error } = await supabase.functions.invoke("parse-invoice", {
          body: { content: base64, file_type: "PDF" },
        });
        if (error) throw error;
        applyParseInvoiceResult((result || {}) as ParseInvoiceResult, "pdf");
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Failed to parse PDF";
        toast.error(message);
      }
      setParsing(false);
    } else {
      toast.error("Unsupported file type. Use PDF, CSV, or Excel.");
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleTakePhotoClick = () => {
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches) {
      toast.error("Use Upload PDF instead on desktop");
      return;
    }
    photoInputRef.current?.click();
  };

  const handlePhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setParsedPoNumberFromPdf(null);
    setParsing(true);
    try {
      const base64 = await fileToBase64Raw(file);
      const { data: result, error } = await supabase.functions.invoke("parse-invoice", {
        body: { content: base64, file_type: "IMAGE" },
      });
      if (error) {
        toast.error("Could not read invoice — try again");
        console.error("parse-invoice IMAGE", error);
        return;
      }
      applyParseInvoiceResult((result || {}) as ParseInvoiceResult, "image");
    } catch (err: unknown) {
      toast.error("Could not read invoice — try again");
      console.error("parse-invoice IMAGE", err);
    } finally {
      setParsing(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  };

  const addManualItem = () => {
    setItems(prev => [...prev, {
      product_number: null, item_name: "", quantity: 1, unit_cost: null,
      line_total: null, unit: null, pack_size: null,
      catalog_item_id: null, match_status: "MANUAL",
    }]);
  };

  const updateItem = (index: number, field: string, value: any) => {
    setItems(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item));
  };

  const removeItem = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  const mapItemToCatalog = (index: number, catalogId: string) => {
    const cat = catalogItems.find(c => c.id === catalogId);
    if (!cat) return;
    setItems(prev => prev.map((item, i) =>
      i === index ? { ...item, catalog_item_id: catalogId, match_status: "MATCHED" as const, catalog_match_name: cat.item_name } : item
    ));
  };

  // Save invoice with status
  const handleSave = async (status: InvoiceStatus) => {
    if (!currentRestaurant || !user) return;
    const unmatchedCount = items.filter(i => i.match_status === "UNMATCHED").length;

    // Block POST if unmatched items exist
    if (status === "POSTED" && unmatchedCount > 0) {
      toast.error(`${unmatchedCount} unmatched item(s). Map all items before posting.`);
      return;
    }
    if (items.length === 0) { toast.error("No items to save"); return; }
    if (!header.vendor_name.trim()) { toast.error("Vendor name is required"); return; }

    setSaving(true);
    try {
      const capturedParsedPo = parsedPoNumberFromPdf;
      const capturedManualPo = header.po_number.trim() || null;
      const capturedVendor = header.vendor_name.trim();

      let purchaseOrderId: string | null = null;
      if (header.linked_smart_order_id) {
        const { data: po } = await supabase.from("purchase_orders").select("id").eq("smart_order_run_id", header.linked_smart_order_id.trim()).maybeSingle();
        purchaseOrderId = po?.id ?? null;
      }

      const workflowStatus =
        status === "POSTED" ? "ready_to_receive" : status === "RECEIVED" ? "review" : "draft";

      const invData: Record<string, unknown> = {
        restaurant_id: currentRestaurant.id,
        vendor_name: header.vendor_name.trim(),
        invoice_number: header.invoice_number.trim() || null,
        invoice_date: header.invoice_date || null,
        location_id: header.location_id || null,
        purchase_order_id: purchaseOrderId,
        created_by: user.id,
        status: workflowStatus,
        receipt_status: "pending",
        updated_at: new Date().toISOString(),
      };

      let purchaseId: string;

      if (editingPurchaseId) {
        const { error: invError } = await supabase.from("invoices")
          .update(invData).eq("id", editingPurchaseId);
        if (invError) throw invError;
        purchaseId = editingPurchaseId;
        await supabase.from("invoice_items").delete().eq("invoice_id", purchaseId);
      } else {
        const { data: invRow, error: invError } = await supabase.from("invoices")
          .insert(invData).select().single();
        if (invError) throw invError;
        purchaseId = invRow.id;
      }

      const invRows = items.map(i => {
        const cat = i.catalog_item_id ? catalogItems.find(c => c.id === i.catalog_item_id) : null;
        const brandName = (i as any).brand_name || cat?.brand_name || null;
        return {
          invoice_id: purchaseId,
          item_name: i.item_name,
          quantity: i.quantity,
          unit_cost: i.unit_cost,
          total_cost: i.line_total ?? (i.unit_cost ? i.unit_cost * i.quantity : null),
          pack_size: i.pack_size,
          catalog_item_id: i.catalog_item_id,
          match_status: i.match_status,
          brand_name: brandName,
        };
      });

      const { error: itemsError } = await supabase.from("invoice_items").insert(invRows);
      if (itemsError) throw itemsError;

      await applyAutoPoLinkAfterSave({
        invoiceId: purchaseId,
        restaurantId: currentRestaurant.id,
        hadManualPoLink: purchaseOrderId != null,
        manualPoNumber: capturedManualPo,
        parsedPoFromPdf: capturedParsedPo,
        vendorName: capturedVendor,
      });

      const statusLabel = status === "POSTED" ? "Posted" : status === "RECEIVED" ? "Received" : "Draft saved";
      toast.success(`Invoice ${statusLabel.toLowerCase()} successfully`);
      setCreateOpen(false);
      resetCreateForm();
      fetchPurchases();
    } catch (err: any) {
      toast.error(err.message || "Failed to save invoice");
    }
    setSaving(false);
  };

  const resetCreateForm = () => {
    setHeader({ vendor_name: "", invoice_number: "", invoice_date: new Date().toISOString().split("T")[0], po_number: "", location_id: "", linked_smart_order_id: "" });
    setItems([]);
    setCreateTab("manual");
    setEditingPurchaseId(null);
    setParsedPoNumberFromPdf(null);
  };

  // Open existing invoice for editing (DRAFT or RECEIVED)
  const handleEditInvoice = async (p: any) => {
    const { data: phItems } = await supabase.from("invoice_items").select("*").eq("invoice_id", p.id);
    setEditingPurchaseId(p.id);
    setParsedPoNumberFromPdf(null);
    const runId = p.smart_order_run_id || p.purchase_orders?.smart_order_run_id || "";
    setHeader({
      vendor_name: p.vendor_name || "",
      invoice_number: p.invoice_number || "",
      invoice_date: p.invoice_date || new Date().toISOString().split("T")[0],
      po_number: typeof p.po_number === "string" ? p.po_number : "",
      location_id: p.location_id || "",
      linked_smart_order_id: runId,
    });
    if (phItems) {
      setItems(phItems.map((i: any) => ({
        product_number: null,
        item_name: i.item_name,
        quantity: Number(i.quantity),
        unit_cost: i.unit_cost != null ? Number(i.unit_cost) : null,
        line_total: i.total_cost != null ? Number(i.total_cost) : null,
        unit: null,
        pack_size: i.pack_size,
        catalog_item_id: i.catalog_item_id,
        match_status: (i.match_status as any) || "MANUAL",
        catalog_match_name: i.catalog_item_id ? catalogItems.find(c => c.id === i.catalog_item_id)?.item_name : undefined,
      })));
    }
    setCreateTab("manual");
    setCreateOpen(true);
  };

  const handleViewPurchase = async (p: any) => {
    const { data } = await supabase.from("invoice_items").select("*").eq("invoice_id", p.id);
    setViewItems(data || []);
    setViewPurchase(p);
  };

  const handleDeletePurchase = async (id: string) => {
    await supabase.from("invoice_items").delete().eq("invoice_id", id);
    await supabase.from("invoices").delete().eq("id", id);
    toast.success("Invoice deleted");
    fetchPurchases();
  };

  // Handle vendor import callback
  const handleVendorImport = (importedItems: InvoiceItem[], vendorName: string, invoiceNumber: string, invoiceDate: string) => {
    setItems(importedItems);
    setHeader(h => ({ ...h, vendor_name: vendorName, invoice_number: invoiceNumber, invoice_date: invoiceDate }));
    setParsedPoNumberFromPdf(null);
    // Switch to manual tab to show the review table
    setCreateTab("manual");
  };

  // Filter purchases
  const filteredPurchases = useMemo(() => {
    let filtered = purchases;
    if (searchFilter) {
      const lower = searchFilter.toLowerCase();
      filtered = filtered.filter(p =>
        (p.vendor_name || "").toLowerCase().includes(lower) ||
        (p.invoice_number || "").toLowerCase().includes(lower)
      );
    }
    if (statusFilter !== "all") {
      filtered = filtered.filter((p: any) => {
        const s = p.status || "review";
        if (statusFilter === "PENDING") return s === "draft" || s === "review" || s === "ready_to_receive";
        if (statusFilter === "DRAFT") return s === "draft";
        if (statusFilter === "RECEIVED") return s === "review";
        if (statusFilter === "COMPLETE") return s === "confirmed";
        return s === String(statusFilter).toLowerCase();
      });
    }
    return filtered;
  }, [purchases, searchFilter, statusFilter]);

  // Stats
  const draftCount = purchases.filter((p: any) => p.status === "draft").length;
  const receivedCount = purchases.filter((p: any) => p.status === "review" || p.status === "ready_to_receive").length;
  const pendingReviewCount = purchases.filter((p: any) => p.status !== "confirmed" && (!p.receipt_status || p.receipt_status === "pending" || p.receipt_status === "reviewing")).length;
  const unmatchedCount = items.filter(i => i.match_status === "UNMATCHED").length;
  const canPost = items.length > 0 && unmatchedCount === 0 && header.vendor_name.trim();

  const getStatusBadge = (status: string) => {
    const normalized =
      status === "confirmed" ? "POSTED"
        : status === "ready_to_receive" ? "RECEIVED"
          : status === "review" ? "RECEIVED"
            : status === "draft" ? "DRAFT"
              : status === "COMPLETE" ? "POSTED"
                : status === "RECEIVED" ? "RECEIVED"
                  : status === "DRAFT" ? "DRAFT"
                    : "POSTED";
    const s = normalized as InvoiceStatus;
    const config = STATUS_CONFIG[s] || STATUS_CONFIG.POSTED;
    return <Badge className={`${config.bgColor} ${config.color} text-[10px] border`}>{config.label}</Badge>;
  };

  const getReceiptStatusBadge = (status: string | null | undefined) => {
    switch (status) {
      case "confirmed": return <Badge className="bg-success/10 text-success border-0 text-[10px]">Confirmed</Badge>;
      case "issues_reported": return <Badge className="bg-orange-500/10 text-orange-600 border-0 text-[10px]">Issues</Badge>;
      case "reviewing": return <Badge className="bg-blue-500/10 text-blue-600 border-0 text-[10px]">Reviewing</Badge>;
      default: return null;
    }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Invoices (Receiving)</h1>
          <p className="page-description">Upload vendor invoices, match items, and track spend</p>
        </div>
        <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) resetCreateForm(); }}>
          <DialogTrigger asChild>
            <Button className="bg-gradient-amber shadow-amber gap-2" size="sm">
              <Plus className="h-4 w-4" /> New Invoice
            </Button>
          </DialogTrigger>
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
                        {(so as any).inventory_lists?.name || "Smart Order"} — {new Date(so.created_at).toLocaleDateString()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* 3 Input Tabs */}
            <Tabs value={createTab} onValueChange={setCreateTab}>
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
                    <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,.pdf" onChange={handleFileUpload} className="hidden" id="invoice-upload" />
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
                    onChange={handlePhotoCapture}
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
              onRemoveItem={removeItem}
              onMapItem={mapItemToCatalog}
              onAddManualItem={addManualItem}
            />

            {/* Save Actions */}
            <DialogFooter className="gap-2 flex-wrap">
              <Button variant="outline" onClick={() => { setCreateOpen(false); resetCreateForm(); }}>Cancel</Button>
              <Button
                variant="outline"
                onClick={() => handleSave("DRAFT")}
                disabled={saving || items.length === 0}
                className="gap-2"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Draft
              </Button>
              <Button
                variant="secondary"
                onClick={() => handleSave("RECEIVED")}
                disabled={saving || items.length === 0 || !header.vendor_name.trim()}
                className="gap-2"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
                Mark Received
              </Button>
              <Button
                onClick={() => handleSave("POSTED")}
                disabled={saving || !canPost}
                className="bg-gradient-amber shadow-amber gap-2"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Post Invoice
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
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-36 h-9 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="PENDING">Pending (Draft/Received)</SelectItem>
                  <SelectItem value="DRAFT">Draft</SelectItem>
                  <SelectItem value="RECEIVED">Received</SelectItem>
                  <SelectItem value="COMPLETE">Posted</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Date Range</Label>
              <Select value={dateRange} onValueChange={setDateRange}>
                <SelectTrigger className="w-36 h-9 text-xs"><SelectValue /></SelectTrigger>
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
              <p className="text-2xl font-bold">{new Set(purchases.map(p => p.vendor_name).filter(Boolean)).size}</p>
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
                {purchases.length > 0 ? new Date(purchases[0].created_at).toLocaleDateString() : "—"}
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
              <span className="font-semibold">{pendingReviewCount} invoice{pendingReviewCount > 1 ? "s" : ""}</span> pending receipt review. Click <strong>Review</strong> on each invoice to confirm delivery and report issues.
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
            <p className="empty-state-description">Upload your first vendor invoice to start tracking spend and receiving.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredPurchases.map(p => {
            const status = p.status || "review";
            const isEditable = status !== "confirmed";
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
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          {p.invoice_number && <span className="font-mono">#{p.invoice_number}</span>}
                          {p.po_number && <span className="font-mono text-primary/70">PO: {p.po_number}</span>}
                          <span>{new Date(p.created_at).toLocaleDateString()}</span>
                          {p.invoice_date && <span>· Invoice: {new Date(p.invoice_date).toLocaleDateString()}</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getStatusBadge(status)}
                    {getReceiptStatusBadge(p.receipt_status)}
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
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive" onClick={() => handleDeletePurchase(p.id)}>
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
              {viewPurchase && getStatusBadge(viewPurchase.status || "review")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              {viewPurchase?.invoice_date && <span>Invoice Date: {new Date(viewPurchase.invoice_date).toLocaleDateString()}</span>}
              <span>Recorded: {viewPurchase && new Date(viewPurchase.created_at).toLocaleDateString()}</span>
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
