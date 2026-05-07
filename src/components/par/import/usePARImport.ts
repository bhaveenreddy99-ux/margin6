import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { parseFile } from "@/lib/export-utils";
import {
  VENDOR_PRESETS,
  detectVendor,
  overallConfidence,
  type FieldMapping,
  type VendorPreset,
} from "@/lib/vendor-presets";
import {
  autoMapPARFields,
  buildCatalogLookups,
  emptyPARMapping,
  matchRows,
  parMappingsToRecord,
  type CatalogLookupItem,
} from "./par-import-logic";
import {
  createParGuide,
  fetchCatalogItemsForLists,
  fetchInventoryLists,
  importIntoGuide,
  type InventoryListRow,
} from "./par-import-db";
import type {
  MatchedRow,
  PARCanonicalField,
  PARImportResult,
  Step,
  UnmatchedAction,
} from "./types";

interface UsePARImportArgs {
  open: boolean;
  existingGuideId?: string;
  preselectedListId?: string;
}

export function usePARImport({ open, existingGuideId, preselectedListId }: UsePARImportArgs) {
  const { currentRestaurant, locations } = useRestaurant();
  const { user } = useAuth();

  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [vendor, setVendor] = useState<VendorPreset>(
    VENDOR_PRESETS.find(p => p.id === "generic")!,
  );
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([]);
  const [mapping, setMapping] = useState<Record<PARCanonicalField, string | null>>(emptyPARMapping());
  const [showMappingEditor, setShowMappingEditor] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<PARImportResult | null>(null);

  const [lists, setLists] = useState<InventoryListRow[]>([]);
  const [selectedListIds, setSelectedListIds] = useState<string[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");
  const [guideName, setGuideName] = useState("");

  const [matchedRows, setMatchedRows] = useState<MatchedRow[]>([]);
  const [catalogItems, setCatalogItems] = useState<CatalogLookupItem[]>([]);
  const [unmatchedSearch, setUnmatchedSearch] = useState("");

  const reviewRunRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    let ignore = false;
    reviewRunRef.current += 1;

    setStep("upload");
    setFile(null);
    setHeaders([]);
    setRows([]);
    setFieldMappings([]);
    setMapping(emptyPARMapping());
    setShowMappingEditor(false);
    setImporting(false);
    setImportResult(null);
    setSelectedListIds(preselectedListId ? [preselectedListId] : []);
    setSelectedLocationId("");
    setGuideName("");
    setMatchedRows([]);
    setCatalogItems([]);
    setUnmatchedSearch("");

    if (currentRestaurant) {
      fetchInventoryLists(currentRestaurant.id).then(data => {
        if (!ignore) setLists(data);
      });
    }

    return () => {
      ignore = true;
    };
  }, [open, currentRestaurant, preselectedListId, existingGuideId]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    try {
      const { headers: h, rows: r } = await parseFile(f);
      if (h.length === 0) { toast.error("No data found in file"); return; }
      setHeaders(h);
      setRows(r);
      const detected = detectVendor(h);
      setVendor(detected);
      const mappings = autoMapPARFields(h, detected, r);
      setFieldMappings(mappings);
      setMapping(parMappingsToRecord(mappings));
      const totalConf = overallConfidence(mappings);
      const hasItemName = mappings.some(m => m.field === "item_name" && m.column && m.confidence >= 70);
      if (detected.id !== "generic") toast.success(`Detected vendor: ${detected.label} (${totalConf}% confidence)`);
      setShowMappingEditor(totalConf < 80 || !hasItemName);

      if (!guideName) {
        const baseName = f.name.replace(/\.[^.]+$/, "");
        setGuideName(`Imported PAR — ${baseName} — ${new Date().toLocaleDateString()}`);
      }

      setStep("mapping");
    } catch { toast.error("Failed to parse file"); }
  };

  const handleVendorChange = (vendorId: string) => {
    const vp = VENDOR_PRESETS.find(p => p.id === vendorId)!;
    setVendor(vp);
    const mappings = autoMapPARFields(headers, vp, rows);
    setFieldMappings(mappings);
    setMapping(parMappingsToRecord(mappings));
  };

  const handleMappingChange = (field: PARCanonicalField, value: string) => {
    const newCol = value === "__none__" ? null : value;
    setMapping(prev => ({ ...prev, [field]: newCol }));
    setFieldMappings(prev => prev.map(m =>
      m.field === field ? { ...m, column: newCol, confidence: newCol ? 100 : 0, method: "preset" as const } : m
    ));
  };

  const handleProceedToMapping = () => {
    setStep("mapping");
  };

  const handleProceedToReview = async () => {
    if (!mapping.item_name) { toast.error("Item Name mapping is required"); return; }
    if (!mapping.par_level) { toast.error("PAR Level mapping is required"); return; }
    if (!currentRestaurant) return;

    const runId = reviewRunRef.current;
    const listIds = preselectedListId ? [preselectedListId] : [];
    const allCatalog = await fetchCatalogItemsForLists(currentRestaurant.id, listIds);
    if (reviewRunRef.current !== runId) return;

    setCatalogItems(allCatalog);
    const lookups = buildCatalogLookups(allCatalog);
    const matched = matchRows(rows, mapping, lookups);
    setMatchedRows(matched);
    setStep("review");
  };

  const handleUnmatchedAction = (rowIdx: number, action: UnmatchedAction, manualCatalogId?: string) => {
    setMatchedRows(prev => prev.map(r =>
      r.rowIdx === rowIdx ? { ...r, action, manualCatalogId } : r
    ));
  };

  const handleBulkUnmatchedAction = (action: UnmatchedAction) => {
    setMatchedRows(prev => prev.map(r =>
      r.matchType === "unmatched" ? { ...r, action } : r
    ));
  };

  const handleImport = async () => {
    if (!currentRestaurant || !user) return;
    setImporting(true);

    try {
      let createdCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;
      let guidesCreated = 0;

      const rowsToProcess = matchedRows.filter(r => r.action !== "skip");

      if (existingGuideId) {
        const result = await importIntoGuide(
          existingGuideId,
          preselectedListId || "",
          rowsToProcess,
          { restaurantId: currentRestaurant.id },
        );
        createdCount = result.created;
        updatedCount = result.updated;
        skippedCount = matchedRows.length - rowsToProcess.length;
        guidesCreated = 0;
      } else {
        const { data: guide, error } = await createParGuide({
          restaurantId: currentRestaurant.id,
          inventoryListId: null,
          locationId: selectedLocationId || null,
          name: guideName.trim() || `Imported PAR — ${new Date().toLocaleDateString()}`,
          createdBy: user.id,
        });

        if (error || !guide) { toast.error(error?.message || "Failed to create PAR guide"); setImporting(false); return; }
        guidesCreated = 1;

        const result = await importIntoGuide(
          guide.id,
          "",
          rowsToProcess,
          { restaurantId: currentRestaurant.id },
        );
        createdCount = result.created;
        updatedCount = result.updated;
        skippedCount = matchedRows.length - rowsToProcess.length;
      }

      setImportResult({ created: createdCount, updated: updatedCount, skipped: skippedCount, guidesCreated });
      toast.success(`Imported ${createdCount} new, updated ${updatedCount} PAR items`);
      setStep("done");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Import failed";
      toast.error(message);
    }
    setImporting(false);
  };

  const matchedItems = matchedRows.filter(r => r.matchType !== "unmatched");
  const unmatchedItems = matchedRows.filter(r => r.matchType === "unmatched");
  const filteredUnmatched = unmatchedItems.filter(r =>
    !unmatchedSearch || r.itemName.toLowerCase().includes(unmatchedSearch.toLowerCase())
  );

  const totalConf = overallConfidence(fieldMappings);
  const mappedCount = fieldMappings.filter(m => m.column).length;
  const coveragePercent = matchedRows.length > 0
    ? Math.round((matchedItems.length / matchedRows.length) * 100)
    : 0;

  return {
    step, setStep,
    headers,
    rows,
    vendor,
    fieldMappings,
    mapping,
    showMappingEditor, setShowMappingEditor,
    importing,
    importResult,
    guideName, setGuideName,
    matchedRows,
    catalogItems,
    unmatchedSearch, setUnmatchedSearch,
    matchedItems,
    unmatchedItems,
    filteredUnmatched,
    totalConf,
    mappedCount,
    coveragePercent,
    handleFileChange,
    handleMappingChange,
    handleProceedToReview,
    handleUnmatchedAction,
    handleBulkUnmatchedAction,
    handleImport,
  };
}
