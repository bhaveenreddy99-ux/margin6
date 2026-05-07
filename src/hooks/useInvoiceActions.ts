import { useCallback, useEffect, useRef, useState } from "react";
import { PO_MATCH_WINDOW_DAYS } from "@/lib/constants";
import type { Dispatch, SetStateAction } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  matchRawInvoiceLinesStrong,
  resolveStrongCatalogMatchForLine,
} from "@/domain/invoices/strongMatchInvoiceItems";
import type { RawInvoiceLineInput, VendorMappingRow } from "@/domain/invoices/strongMatchInvoiceItems";
import {
  buildInvoiceIngestionRow,
  buildInvoiceInsertPayload,
  buildInvoiceItemInsertRows,
  buildInvoicePatchFromParse,
  flattenInvoiceListRows,
  normalizeSpreadsheetRows,
  parseInvoiceItemsToInsertRows,
  parseInvoicePayloadError,
  sanitizeStorageFilename,
  scorePurchaseOrderCandidates,
  vendorNamesMatchForPoLink,
} from "@/domain/invoices/invoicesPageHelpers";
import type {
  InvoiceCatalogItem,
  InvoiceItemRow,
  InvoiceListQueryRow,
  InvoiceListRow,
  InvoiceSaveIntent,
  ParseInvoiceResult,
  PurchaseOrderCandidateRow,
  PurchaseOrderCatalogLinkRow,
} from "@/domain/invoices/invoicesPageTypes";
import type { InvoiceHeader, InvoiceItem } from "@/components/invoices/types";

type UseInvoiceActionsArgs = {
  currentRestaurantId: string | null | undefined;
  userId: string | null | undefined;
  createOpen: boolean;
  editingPurchaseId: string | null;
  header: InvoiceHeader;
  items: InvoiceItem[];
  catalogItems: InvoiceCatalogItem[];
  vendorMappings: VendorMappingRow[];
  parsedPoNumberFromPdf: string | null;
  setHeader: Dispatch<SetStateAction<InvoiceHeader>>;
  setItems: Dispatch<SetStateAction<InvoiceItem[]>>;
  setParsedPoNumberFromPdf: Dispatch<SetStateAction<string | null>>;
  setCreateOpen: Dispatch<SetStateAction<boolean>>;
  loadInvoiceItems: (invoiceId: string) => Promise<InvoiceItemRow[]>;
  refreshPurchases: () => Promise<void>;
  onResetCreateForm: () => void;
  onOpenEditorForInvoice: (invoice: InvoiceListRow, parsedPoForHeader: string | null) => Promise<void>;
};

export function useInvoiceActions({
  currentRestaurantId,
  userId,
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
  onResetCreateForm,
  onOpenEditorForInvoice,
}: UseInvoiceActionsArgs) {
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [intakeUploading, setIntakeUploading] = useState(false);

  const lastDraftAutoMatchInvoiceIdRef = useRef<string | null>(null);
  const editingPurchaseIdRef = useRef<string | null>(null);
  const headerRef = useRef(header);
  const parsedPoRef = useRef<string | null>(parsedPoNumberFromPdf);

  useEffect(() => {
    editingPurchaseIdRef.current = editingPurchaseId;
  }, [editingPurchaseId]);

  useEffect(() => {
    headerRef.current = header;
  }, [header]);

  useEffect(() => {
    parsedPoRef.current = parsedPoNumberFromPdf;
  }, [parsedPoNumberFromPdf]);

  const fileToBase64Raw = useCallback(async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    const chunkSize = 8192;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return btoa(binary);
  }, []);

  const applyParseInvoiceResult = useCallback(
    (result: ParseInvoiceResult, mode: "pdf" | "image") => {
      if (result.error) throw new Error(result.error);
      if (result.vendor_name) setHeader((current) => ({ ...current, vendor_name: result.vendor_name as string }));
      if (result.invoice_number) {
        setHeader((current) => ({ ...current, invoice_number: result.invoice_number as string }));
      }
      if (result.invoice_date) {
        setHeader((current) => ({ ...current, invoice_date: result.invoice_date as string }));
      }
      if (result.po_number != null && String(result.po_number).trim()) {
        const purchaseOrderNumber = String(result.po_number).trim();
        setParsedPoNumberFromPdf(purchaseOrderNumber);
        setHeader((current) => ({ ...current, po_number: purchaseOrderNumber }));
      }
      if (result.items?.length) {
        setItems(
          matchRawInvoiceLinesStrong(
            result.items as RawInvoiceLineInput[],
            catalogItems,
            vendorMappings,
          ),
        );
        toast.success(`AI extracted ${result.items.length} items`);
      } else if (mode === "image") {
        setHeader((current) => ({
          ...current,
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
    },
    [catalogItems, setHeader, setItems, setParsedPoNumberFromPdf, vendorMappings],
  );

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

      const { data: invoicePoCheck } = (await supabase
        .from("invoices")
        .select("purchase_order_id")
        .eq("id", args.invoiceId)
        .maybeSingle()) as unknown as {
        data: { purchase_order_id: string | null } | null;
      };
      if (invoicePoCheck?.purchase_order_id) return;

      const purchaseOrderNumber =
        (args.manualPoNumber?.trim() || args.parsedPoFromPdf?.trim() || "") || "";

      const linkPurchaseOrder = async (purchaseOrderId: string, purchaseOrderLabel: string | null) => {
        const { error: updateError } = await supabase
          .from("invoices")
          .update({ purchase_order_id: purchaseOrderId, updated_at: new Date().toISOString() })
          .eq("id", args.invoiceId);
        if (updateError) {
          toast.warning("Invoice saved — could not attach purchase order.");
          console.error("invoice purchase_order_id update", updateError);
          return false;
        }
        toast.success(`Linked to PO ${purchaseOrderLabel ?? "—"}`);
        await refreshPurchases();
        return true;
      };

      if (purchaseOrderNumber) {
        const { data: purchaseOrderRows, error } = (await supabase
          .from("purchase_orders")
          .select("id, po_number, created_at")
          .eq("restaurant_id", args.restaurantId)
          .ilike("po_number", purchaseOrderNumber)
          .order("created_at", { ascending: false })) as unknown as {
          data: Array<Pick<PurchaseOrderCandidateRow, "id" | "po_number" | "created_at">> | null;
          error: unknown;
        };

        if (error) {
          toast.warning("Invoice saved — could not look up purchase order.");
          console.error("purchase_orders po_number lookup", error);
        } else if (purchaseOrderRows?.length) {
          const best = purchaseOrderRows[0];
          await linkPurchaseOrder(best.id, best.po_number ?? purchaseOrderNumber);
          return;
        }
      }

      const vendorName = args.vendorName.trim();
      if (!vendorName) {
        toast.info("Invoice saved — add a vendor name to auto-link by purchase order, or link manually.");
        return;
      }

      const fourteenDaysAgo = new Date();
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - PO_MATCH_WINDOW_DAYS);

      const { data: rows, error: vendorLookupError } = (await supabase
        .from("purchase_orders")
        .select("id, po_number, vendor_name, created_at")
        .eq("restaurant_id", args.restaurantId)
        .gte("created_at", fourteenDaysAgo.toISOString())
        .not("status", "in", '("cancelled","closed")')) as unknown as {
        data: PurchaseOrderCandidateRow[] | null;
        error: unknown;
      };

      if (vendorLookupError) {
        toast.warning("Invoice saved — could not search purchase orders.");
        console.error("purchase_orders vendor window lookup", vendorLookupError);
        return;
      }

      const candidates = (rows ?? []).filter((row) =>
        vendorNamesMatchForPoLink(row.vendor_name, vendorName),
      );

      if (candidates.length === 0) {
        toast.info("Invoice saved — no matching PO found. Link manually if needed.");
        return;
      }

      const { data: invoiceItems, error: invoiceItemsError } = (await supabase
        .from("invoice_items")
        .select("catalog_item_id")
        .eq("invoice_id", args.invoiceId)) as unknown as {
        data: Array<{ catalog_item_id: string | null }> | null;
        error: unknown;
      };
      if (invoiceItemsError) {
        console.error("invoice_items catalog lookup for PO scoring", invoiceItemsError);
        toast.info("Could not match purchase order — please link manually");
        return;
      }

      const invoiceCatalogIds = new Set(
        (invoiceItems ?? [])
          .map((row) => row.catalog_item_id)
          .filter((catalogItemId): catalogItemId is string => catalogItemId != null && String(catalogItemId).trim() !== ""),
      );

      const candidateIds = candidates.map((candidate) => candidate.id);
      const { data: purchaseOrderItems, error: purchaseOrderItemsError } = (await supabase
        .from("purchase_order_items")
        .select("purchase_order_id, catalog_item_id")
        .in("purchase_order_id", candidateIds)) as unknown as {
        data: PurchaseOrderCatalogLinkRow[] | null;
        error: unknown;
      };
      if (purchaseOrderItemsError) {
        console.error("purchase_order_items lookup for PO scoring", purchaseOrderItemsError);
        toast.info("Could not match purchase order — please link manually");
        return;
      }

      const scored = scorePurchaseOrderCandidates(
        candidates,
        invoiceCatalogIds,
        purchaseOrderItems ?? [],
      );

      if (candidates.length === 1) {
        const only = scored[0];
        if (invoiceCatalogIds.size > 0 && only.overlap === 0) {
          toast.info("Invoice saved — no confident PO match (line items do not match the order). Link manually if needed.");
          return;
        }
        await linkPurchaseOrder(only.id, only.po_number);
        return;
      }

      const best = scored[0];
      const second = scored[1];
      if (best.overlap > 0 && best.overlap > second.overlap) {
        await linkPurchaseOrder(best.id, best.po_number);
        return;
      }

      toast.info("Multiple POs found — please link manually");
    },
    [refreshPurchases],
  );

  const runDraftAutoMatchPersist = useCallback(
    async (invoiceId: string) => {
      if (!currentRestaurantId) return;

      const lines = await loadInvoiceItems(invoiceId);
      if (!lines.length) return;

      const rowsToUpdate: { id: string; catalog_item_id: string; match_status: string }[] = [];
      for (const row of lines) {
        if (row.match_status === "MANUAL") continue;
        if (row.match_status === "MATCHED") continue;

        const match = resolveStrongCatalogMatchForLine(
          {
            catalog_item_id: row.catalog_item_id,
            product_number: row.product_number,
            match_status: row.match_status,
          },
          catalogItems,
          vendorMappings,
        );
        if (!match) continue;
        rowsToUpdate.push({ id: row.id, catalog_item_id: match.catalog_item_id, match_status: "MATCHED" });
      }

      if (rowsToUpdate.length > 0) {
        await Promise.all(
          rowsToUpdate.map((rowToUpdate) =>
            supabase
              .from("invoice_items")
              .update({
                catalog_item_id: rowToUpdate.catalog_item_id,
                match_status: rowToUpdate.match_status,
              })
              .eq("id", rowToUpdate.id),
          ),
        );
      }

      if (editingPurchaseIdRef.current !== invoiceId) return;

      if (rowsToUpdate.length > 0) {
        const refreshedItems = await loadInvoiceItems(invoiceId);
        if (editingPurchaseIdRef.current === invoiceId) {
          setItems(
            refreshedItems.map((row) => ({
              product_number:
                row.product_number != null && String(row.product_number).trim() !== ""
                  ? String(row.product_number).trim()
                  : null,
              item_name: row.item_name,
              quantity: Number(row.quantity_invoiced),
              unit_cost: row.unit_cost != null ? Number(row.unit_cost) : null,
              line_total: row.total_cost != null ? Number(row.total_cost) : null,
              unit: row.unit ?? null,
              pack_size: row.pack_size,
              brand_name: row.brand_name ?? null,
              catalog_item_id: row.catalog_item_id,
              match_status: row.match_status === "MATCHED" || row.match_status === "MANUAL"
                ? row.match_status
                : "UNMATCHED",
              catalog_match_name: row.catalog_item_id
                ? catalogItems.find((catalogItem) => catalogItem.id === row.catalog_item_id)?.item_name
                : undefined,
            })),
          );
        }
      }

      const { data: invoiceMeta } = (await supabase
        .from("invoices")
        .select("vendor_name")
        .eq("id", invoiceId)
        .maybeSingle()) as unknown as {
        data: { vendor_name: string | null } | null;
      };
      const headerSnapshot = headerRef.current;
      const hadManualPoLink = !!headerSnapshot.linked_smart_order_id?.trim();
      await applyAutoPoLinkAfterSave({
        invoiceId,
        restaurantId: currentRestaurantId,
        hadManualPoLink,
        manualPoNumber: headerSnapshot.po_number.trim() || null,
        parsedPoFromPdf: parsedPoRef.current,
        vendorName: (invoiceMeta?.vendor_name ?? headerSnapshot.vendor_name).trim() || "",
      });

      const { data: invoiceAfterPo } = (await supabase
        .from("invoices")
        .select("purchase_orders(po_number, smart_order_run_id)")
        .eq("id", invoiceId)
        .maybeSingle()) as unknown as {
        data: { purchase_orders?: { po_number: string | null; smart_order_run_id: string | null } | null } | null;
      };
      if (invoiceAfterPo?.purchase_orders?.po_number != null && editingPurchaseIdRef.current === invoiceId) {
        const purchaseOrderNumber = invoiceAfterPo.purchase_orders.po_number;
        setHeader((current) => ({ ...current, po_number: purchaseOrderNumber ?? current.po_number }));
      }

      refreshPurchases();
    },
    [
      applyAutoPoLinkAfterSave,
      catalogItems,
      currentRestaurantId,
      loadInvoiceItems,
      refreshPurchases,
      setHeader,
      setItems,
      vendorMappings,
    ],
  );

  useEffect(() => {
    if (!createOpen) lastDraftAutoMatchInvoiceIdRef.current = null;
  }, [createOpen]);

  useEffect(() => {
    if (!createOpen || !editingPurchaseId || !currentRestaurantId) return;
    if (lastDraftAutoMatchInvoiceIdRef.current === editingPurchaseId) return;
    if (catalogItems.length === 0) return;

    const invoiceId = editingPurchaseId;
    let cancelled = false;
    (async () => {
      try {
        await runDraftAutoMatchPersist(invoiceId);
      } finally {
        if (!cancelled) lastDraftAutoMatchInvoiceIdRef.current = invoiceId;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [catalogItems, createOpen, currentRestaurantId, editingPurchaseId, runDraftAutoMatchPersist]);

  const handleImportedFile = useCallback(
    async (file: File) => {
      setParsedPoNumberFromPdf(null);

      const isSpreadsheet = /\.(csv|xlsx|xls)$/i.test(file.name);
      const isPDF = /\.pdf$/i.test(file.name);

      if (isSpreadsheet) {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data);
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet);

        if (rows.length === 0) {
          toast.error("No data found in file");
          return;
        }

        const parsed = normalizeSpreadsheetRows(rows);
        setItems(matchRawInvoiceLinesStrong(parsed as RawInvoiceLineInput[], catalogItems, vendorMappings));
        toast.success(`Parsed ${parsed.length} items from file`);
        return;
      }

      if (isPDF) {
        setParsing(true);
        try {
          const base64 = await fileToBase64Raw(file);
          const { data: result, error } = await supabase.functions.invoke("parse-invoice", {
            body: { content: base64, file_type: "PDF" },
          });
          if (error) throw error;
          applyParseInvoiceResult((result || {}) as ParseInvoiceResult, "pdf");
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "Failed to parse PDF";
          toast.error(message);
        }
        setParsing(false);
        return;
      }

      toast.error("Unsupported file type. Use PDF, CSV, or Excel.");
    },
    [
      applyParseInvoiceResult,
      catalogItems,
      fileToBase64Raw,
      setItems,
      setParsedPoNumberFromPdf,
      vendorMappings,
    ],
  );

  const handleCapturedPhoto = useCallback(
    async (file: File) => {
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
      } catch (error: unknown) {
        toast.error("Could not read invoice — try again");
        console.error("parse-invoice IMAGE", error);
      } finally {
        setParsing(false);
      }
    },
    [applyParseInvoiceResult, fileToBase64Raw, setParsedPoNumberFromPdf],
  );

  const handleSaveInvoice = useCallback(
    async (intent: InvoiceSaveIntent) => {
      if (!currentRestaurantId || !userId) return;
      if (items.length === 0) {
        toast.error("No items to save");
        return;
      }
      if (!header.vendor_name.trim()) {
        toast.error("Vendor name is required");
        return;
      }

      setSaving(true);
      try {
        const capturedParsedPo = parsedPoNumberFromPdf;
        const capturedManualPo = header.po_number.trim() || null;
        const capturedVendor = header.vendor_name.trim();

        let purchaseOrderId: string | null = null;
        if (header.linked_smart_order_id) {
          const { data: purchaseOrder } = (await supabase
            .from("purchase_orders")
            .select("id")
            .eq("smart_order_run_id", header.linked_smart_order_id.trim())
            .maybeSingle()) as unknown as {
            data: { id: string } | null;
          };
          purchaseOrderId = purchaseOrder?.id ?? null;
        }

        const invoicePayload = buildInvoiceInsertPayload({
          restaurantId: currentRestaurantId,
          userId,
          header,
          purchaseOrderId,
          intent,
        });

        let invoiceId: string;
        if (editingPurchaseId) {
          const { error: invoiceError } = await supabase
            .from("invoices")
            .update(invoicePayload)
            .eq("id", editingPurchaseId);
          if (invoiceError) throw invoiceError;
          invoiceId = editingPurchaseId;
          await supabase.from("invoice_items").delete().eq("invoice_id", invoiceId);
        } else {
          const { data: invoiceRow, error: invoiceError } = await supabase
            .from("invoices")
            .insert(invoicePayload)
            .select()
            .single();
          if (invoiceError) throw invoiceError;
          invoiceId = invoiceRow.id;
        }

        const invoiceItemRows = buildInvoiceItemInsertRows({
          invoiceId,
          items,
          catalogItems,
        });
        const { error: itemsError } = await supabase.from("invoice_items").insert(invoiceItemRows);
        if (itemsError) throw itemsError;

        await applyAutoPoLinkAfterSave({
          invoiceId,
          restaurantId: currentRestaurantId,
          hadManualPoLink: purchaseOrderId != null,
          manualPoNumber: capturedManualPo,
          parsedPoFromPdf: capturedParsedPo,
          vendorName: capturedVendor,
        });

        const statusLabel = intent === "RECEIVED" ? "submitted for review" : "saved as draft";
        toast.success(`Invoice ${statusLabel.toLowerCase()} successfully`);
        setCreateOpen(false);
        onResetCreateForm();
        refreshPurchases();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Failed to save invoice";
        toast.error(message);
      }
      setSaving(false);
    },
    [
      applyAutoPoLinkAfterSave,
      catalogItems,
      currentRestaurantId,
      editingPurchaseId,
      header,
      items,
      onResetCreateForm,
      parsedPoNumberFromPdf,
      refreshPurchases,
      setCreateOpen,
      userId,
    ],
  );

  const handleIntakeUpload = useCallback(
    async (file: File, sourceKind: "file" | "photo") => {
      if (!currentRestaurantId || !userId) return;
      setIntakeUploading(true);
      let parsedPoForHeader: string | null = null;
      let parseApplied = false;
      try {
        const now = new Date().toISOString();
        const { data: invoice, error: invoiceError } = await supabase
          .from("invoices")
          .insert({
            restaurant_id: currentRestaurantId,
            status: "draft",
            receipt_status: "pending",
            vendor_name: null,
            invoice_number: null,
            invoice_date: null,
            created_by: userId,
            updated_at: now,
          })
          .select()
          .single();
        if (invoiceError) throw invoiceError;
        if (!invoice) throw new Error("Invoice missing");

        const invoiceId = invoice.id;
        const safeName = sanitizeStorageFilename(file.name);
        const storagePath = `${currentRestaurantId}/${invoiceId}/${crypto.randomUUID()}_${safeName}`;

        const { error: uploadError } = await supabase.storage.from("invoice-uploads").upload(storagePath, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type || undefined,
        });
        if (uploadError) {
          await supabase.from("invoices").delete().eq("id", invoiceId);
          throw uploadError;
        }

        const ingestionRow = buildInvoiceIngestionRow({
          restaurantId: currentRestaurantId,
          invoiceId,
          storagePath,
          sourceKind,
          mimeType: file.type || null,
          originalFilename: file.name,
          userId,
        });
        const { error: ingestionError } = await supabase.from("invoice_ingestions").insert(ingestionRow);
        if (ingestionError) {
          await supabase.storage.from("invoice-uploads").remove([storagePath]);
          await supabase.from("invoices").delete().eq("id", invoiceId);
          throw ingestionError;
        }

        const canParseWithEdge = file.type.startsWith("image/") || file.type === "application/pdf";
        if (canParseWithEdge) {
          try {
            const base64 = await fileToBase64Raw(file);
            const { data: parseResult, error: parseFunctionError } = await supabase.functions.invoke("parse-invoice", {
              body: {
                content: base64,
                file_type: file.type.startsWith("image") ? "IMAGE" : "PDF",
              },
            });
            if (parseFunctionError) {
              toast.error(parseFunctionError instanceof Error ? parseFunctionError.message : "Could not parse invoice — edit manually");
            } else {
              const payloadError = parseResult != null ? parseInvoicePayloadError(parseResult) : null;
              if (payloadError) {
                toast.error(payloadError);
              } else if (parseResult && typeof parseResult === "object") {
                const result = parseResult as ParseInvoiceResult;
                if (typeof result.error === "string" && result.error.trim()) {
                  toast.error(result.error);
                } else {
                  const patch = buildInvoicePatchFromParse(result);
                  const { error: updateError } = await supabase.from("invoices").update(patch).eq("id", invoiceId);
                  if (updateError) console.warn("[intake parse] invoice update", updateError);

                  await supabase.from("invoice_items").delete().eq("invoice_id", invoiceId);

                  const rows = parseInvoiceItemsToInsertRows(
                    invoiceId,
                    Array.isArray(result.items) ? result.items : [],
                  );
                  if (rows.length > 0) {
                    const { error: insertError } = await supabase.from("invoice_items").insert(rows);
                    if (insertError) {
                      console.warn("[intake parse] invoice_items insert", insertError);
                      toast.error("Parsed header saved; lines could not be saved — add items manually");
                    }
                  }

                  const purchaseOrderNumber =
                    result.po_number != null && String(result.po_number).trim()
                      ? String(result.po_number).trim()
                      : null;
                  parsedPoForHeader = purchaseOrderNumber;
                  parseApplied = true;
                }
              } else {
                toast.error("Could not parse invoice — edit manually");
              }
            }
          } catch (parseError: unknown) {
            console.warn("[intake parse]", parseError);
            toast.error("Could not parse invoice — edit manually");
          }
        }

        const { data: invoiceJoin } = (await supabase
          .from("invoices")
          .select("*, purchase_orders(po_number, smart_order_run_id)")
          .eq("id", invoiceId)
          .single()) as unknown as {
          data: InvoiceListQueryRow | null;
        };
        if (!invoiceJoin) throw new Error("Invoice missing");

        const row = flattenInvoiceListRows([invoiceJoin])[0];
        toast.success(parseApplied ? "Draft saved — review parsed data" : "Draft saved — review your draft");
        await onOpenEditorForInvoice(row, parsedPoForHeader);
        refreshPurchases();
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Upload failed";
        toast.error(message);
      } finally {
        setIntakeUploading(false);
      }
    },
    [
      currentRestaurantId,
      fileToBase64Raw,
      onOpenEditorForInvoice,
      refreshPurchases,
      userId,
    ],
  );

  const handleDeleteInvoice = useCallback(
    async (invoiceId: string) => {
      await supabase.from("invoice_items").delete().eq("invoice_id", invoiceId);
      await supabase.from("invoices").delete().eq("id", invoiceId);
      toast.success("Invoice deleted");
      refreshPurchases();
    },
    [refreshPurchases],
  );

  return {
    parsing,
    saving,
    intakeUploading,
    handleImportedFile,
    handleCapturedPhoto,
    handleSaveInvoice,
    handleIntakeUpload,
    handleDeleteInvoice,
  };
}
