import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  Upload, FileSpreadsheet, ArrowRight, CheckCircle, AlertTriangle,
  ChevronDown, ChevronUp, Sparkles, Shield, Link2, Search,
} from "lucide-react";
import {
  VENDOR_PRESETS,
  detectVendor,
  autoMapColumnsWithConfidence,
  overallConfidence,
  validateNumericField,
  type CanonicalField,
  type VendorPreset,
  type FieldMapping,
} from "@/lib/vendor-presets";
import { parseFile } from "@/lib/export-utils";

type PARCanonicalField = "item_name" | "par_level" | "category" | "unit" | "pack_size" | "vendor_sku" | "brand";

const PAR_CANONICAL_FIELDS: { key: PARCanonicalField; label: string; required?: boolean; numeric?: boolean }[] = [
  { key: "item_name", label: "Item Name", required: true },
  { key: "par_level", label: "PAR Level", required: true, numeric: true },
  { key: "category", label: "Category" },
  { key: "unit", label: "Unit / UOM" },
  { key: "pack_size", label: "Pack Size" },
  { key: "vendor_sku", label: "Product Number" },
  { key: "brand", label: "Brand" },
];

const PAR_LEVEL_SYNONYMS = [
  "par", "parlevel", "par_level", "par level", "target", "targetlevel",
  "target_level", "target level", "reorder", "reorderlevel", "min",
  "minimum", "minlevel", "min_level",
];

type Step = "upload" | "target" | "mapping" | "review" | "done";

interface MatchedRow {
  rowIdx: number;
  itemName: string;
  parLevel: number | null;
  category: string | null;
  unit: string | null;
  packSize: string | null;
  vendorSku: string | null;
  brand: string | null;
  matchType: "product_number" | "name_pack" | "name_only" | "unmatched";
  catalogItemId: string | null;
  catalogItemName: string | null;
  // For unmatched items: user action
  action: "import_anyway" | "create_catalog" | "map_to_catalog" | "skip";
  manualCatalogId?: string;
}

function confidenceBadge(score: number) {
  if (score >= 90) return <Badge className="bg-success/10 text-success border-0 text-[10px] font-mono">{score}%</Badge>;
  if (score >= 70) return <Badge className="bg-warning/10 text-warning border-0 text-[10px] font-mono">{score}%</Badge>;
  if (score > 0) return <Badge className="bg-destructive/10 text-destructive border-0 text-[10px] font-mono">{score}%</Badge>;
  return <Badge variant="secondary" className="text-[10px] font-mono">—</Badge>;
}

interface PARImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportComplete: () => void;
  /** If provided, import into this existing guide instead of creating new */
  existingGuideId?: string;
  existingGuideName?: string;
  preselectedListId?: string;
}

export function PARImportDialog({ open, onOpenChange, onImportComplete, existingGuideId, existingGuideName, preselectedListId }: PARImportDialogProps) {
  const { currentRestaurant, locations } = useRestaurant();
  const { user } = useAuth();

  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [vendor, setVendor] = useState<VendorPreset>(VENDOR_PRESETS.find(p => p.id === "generic")!);
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([]);
  const [mapping, setMapping] = useState<Record<PARCanonicalField, string | null>>({} as any);
  const [showMappingEditor, setShowMappingEditor] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; updated: number; skipped: number; guidesCreated: number } | null>(null);

  // Target selection
  const [lists, setLists] = useState<any[]>([]);
  const [selectedListIds, setSelectedListIds] = useState<string[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");
  const [guideName, setGuideName] = useState("");

  // Matching
  const [matchedRows, setMatchedRows] = useState<MatchedRow[]>([]);
  const [catalogItems, setCatalogItems] = useState<any[]>([]);
  const [unmatchedSearch, setUnmatchedSearch] = useState("");

  useEffect(() => {
    if (open) {
      setStep(existingGuideId ? "upload" : "upload");
      setFile(null);
      setHeaders([]);
      setRows([]);
      setFieldMappings([]);
      setMapping({} as any);
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
        supabase.from("inventory_lists").select("*").eq("restaurant_id", currentRestaurant.id)
          .then(({ data }) => { if (data) setLists(data); });
      }
    }
  }, [open, currentRestaurant, preselectedListId, existingGuideId]);

  const autoMapPARFields = (hdrs: string[], preset: VendorPreset, dataRows: Record<string, any>[]): FieldMapping[] => {
    const catalogMappings = autoMapColumnsWithConfidence(hdrs, preset, dataRows);
    const result: FieldMapping[] = [];
    const usedColumns = new Set<string>();

    for (const field of PAR_CANONICAL_FIELDS) {
      if (field.key === "par_level") {
        const normHeaders = hdrs.map(h => ({ original: h, normalized: h.toLowerCase().replace(/[^a-z0-9]/g, "") }));
        let bestMatch: { column: string; confidence: number; method: FieldMapping["method"] } | null = null;
        for (const syn of PAR_LEVEL_SYNONYMS) {
          const normSyn = syn.replace(/[^a-z0-9]/g, "");
          const match = normHeaders.find(h => h.normalized === normSyn && !usedColumns.has(h.original));
          if (match) { bestMatch = { column: match.original, confidence: 92, method: "synonym" }; break; }
        }
        if (!bestMatch) {
          for (const syn of PAR_LEVEL_SYNONYMS) {
            const normSyn = syn.replace(/[^a-z0-9]/g, "");
            if (normSyn.length < 3) continue;
            const match = normHeaders.find(h => h.normalized.includes(normSyn) && !usedColumns.has(h.original));
            if (match) { bestMatch = { column: match.original, confidence: 78, method: "synonym" }; break; }
          }
        }
        if (bestMatch) { usedColumns.add(bestMatch.column); result.push({ field: "par_level" as CanonicalField, ...bestMatch }); }
        else { result.push({ field: "par_level" as CanonicalField, column: null, confidence: 0, method: "none" }); }
      } else {
        const catalogMapping = catalogMappings.find(m => m.field === field.key);
        if (catalogMapping?.column && !usedColumns.has(catalogMapping.column)) {
          usedColumns.add(catalogMapping.column);
          result.push(catalogMapping);
        } else {
          result.push({ field: field.key as CanonicalField, column: null, confidence: 0, method: "none" });
        }
      }
    }
    return result;
  };

  const parMappingsToRecord = (mappings: FieldMapping[]): Record<PARCanonicalField, string | null> => {
    const rec: Record<string, string | null> = {};
    for (const m of mappings) rec[m.field] = m.column;
    return rec as Record<PARCanonicalField, string | null>;
  };

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

      // Auto-set guide name from file
      if (!guideName) {
        const baseName = f.name.replace(/\.[^.]+$/, "");
        setGuideName(`Imported PAR — ${baseName} — ${new Date().toLocaleDateString()}`);
      }

      // Skip target step if importing into existing guide
      if (existingGuideId) {
        setStep("mapping");
      } else {
        setStep("target");
      }
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

  const getMappedValue = (row: Record<string, any>, field: PARCanonicalField): any => {
    const col = mapping[field];
    return col ? (row[col] ?? null) : null;
  };

  const truncate = (val: any, max: number): string | null => {
    if (val == null) return null;
    const s = String(val).trim();
    return s ? s.substring(0, max) : null;
  };

  const handleProceedToTarget = () => {
    setStep("target");
  };

  const handleProceedToMapping = () => {
    if (!existingGuideId && selectedListIds.length === 0) {
      toast.error("Select at least one inventory list");
      return;
    }
    setStep("mapping");
  };

  const handleProceedToReview = async () => {
    if (!mapping.item_name) { toast.error("Item Name mapping is required"); return; }
    if (!mapping.par_level) { toast.error("PAR Level mapping is required"); return; }
    if (!currentRestaurant) return;

    // Fetch catalog items for all selected lists (for matching)
    const listIds = existingGuideId ? (preselectedListId ? [preselectedListId] : []) : selectedListIds;
    let allCatalog: any[] = [];
    if (listIds.length > 0) {
      const { data } = await supabase
        .from("inventory_catalog_items")
        .select("id, item_name, vendor_sku, pack_size, inventory_list_id")
        .eq("restaurant_id", currentRestaurant.id)
        .in("inventory_list_id", listIds);
      allCatalog = data || [];
    } else {
      // Fallback: get all catalog items for restaurant
      const { data } = await supabase
        .from("inventory_catalog_items")
        .select("id, item_name, vendor_sku, pack_size, inventory_list_id")
        .eq("restaurant_id", currentRestaurant.id);
      allCatalog = data || [];
    }
    setCatalogItems(allCatalog);

    // Build lookup maps
    const bySku = new Map<string, any>();
    const byNamePack = new Map<string, any>();
    const byName = new Map<string, any>();
    for (const c of allCatalog) {
      if (c.vendor_sku) bySku.set(c.vendor_sku.toLowerCase().trim(), c);
      const nameKey = c.item_name.toLowerCase().trim();
      const namePackKey = `${nameKey}|${(c.pack_size || "").toLowerCase().trim()}`;
      if (!byNamePack.has(namePackKey)) byNamePack.set(namePackKey, c);
      if (!byName.has(nameKey)) byName.set(nameKey, c);
    }

    // Match each row
    const matched: MatchedRow[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const itemName = truncate(getMappedValue(row, "item_name"), 200);
      if (!itemName) continue;

      const parLevelRaw = getMappedValue(row, "par_level");
      const { parsed: parLevel } = validateNumericField(parLevelRaw);
      const category = truncate(getMappedValue(row, "category"), 100);
      const unit = truncate(getMappedValue(row, "unit"), 50);
      const packSize = truncate(getMappedValue(row, "pack_size"), 100);
      const vendorSku = truncate(getMappedValue(row, "vendor_sku"), 100);
      const brand = truncate(getMappedValue(row, "brand"), 200);

      let matchType: MatchedRow["matchType"] = "unmatched";
      let catalogItemId: string | null = null;
      let catalogItemName: string | null = null;

      // Priority 1: Product number
      if (vendorSku) {
        const match = bySku.get(vendorSku.toLowerCase().trim());
        if (match) {
          matchType = "product_number";
          catalogItemId = match.id;
          catalogItemName = match.item_name;
        }
      }

      // Priority 2: name + pack_size
      if (matchType === "unmatched") {
        const nameKey = itemName.toLowerCase().trim();
        const namePackKey = `${nameKey}|${(packSize || "").toLowerCase().trim()}`;
        const match = byNamePack.get(namePackKey);
        if (match) {
          matchType = "name_pack";
          catalogItemId = match.id;
          catalogItemName = match.item_name;
        }
      }

      // Priority 3: name only
      if (matchType === "unmatched") {
        const match = byName.get(itemName.toLowerCase().trim());
        if (match) {
          matchType = "name_only";
          catalogItemId = match.id;
          catalogItemName = match.item_name;
        }
      }

      matched.push({
        rowIdx: i,
        itemName,
        parLevel,
        category,
        unit,
        packSize,
        vendorSku,
        brand,
        matchType,
        catalogItemId,
        catalogItemName,
        action: matchType !== "unmatched" ? "import_anyway" : "import_anyway",
      });
    }

    setMatchedRows(matched);
    setStep("review");
  };

  const matchedItems = matchedRows.filter(r => r.matchType !== "unmatched");
  const unmatchedItems = matchedRows.filter(r => r.matchType === "unmatched");
  const filteredUnmatched = unmatchedItems.filter(r =>
    !unmatchedSearch || r.itemName.toLowerCase().includes(unmatchedSearch.toLowerCase())
  );

  const handleUnmatchedAction = (rowIdx: number, action: MatchedRow["action"], manualCatalogId?: string) => {
    setMatchedRows(prev => prev.map(r =>
      r.rowIdx === rowIdx ? { ...r, action, manualCatalogId } : r
    ));
  };

  const handleBulkUnmatchedAction = (action: MatchedRow["action"]) => {
    setMatchedRows(prev => prev.map(r =>
      r.matchType === "unmatched" ? { ...r, action } : r
    ));
  };

  const handleImport = async () => {
    if (!currentRestaurant || !user) return;
    setImporting(true);

    try {
      const targetListIds = existingGuideId ? [] : selectedListIds;
      let createdCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;
      let guidesCreated = 0;

      // Determine which rows to process
      const rowsToProcess = matchedRows.filter(r => r.action !== "skip");

      if (existingGuideId) {
        // Import into existing guide
        const result = await importIntoGuide(existingGuideId, preselectedListId || "", rowsToProcess);
        createdCount = result.created;
        updatedCount = result.updated;
        skippedCount = matchedRows.length - rowsToProcess.length;
        guidesCreated = 0;
      } else {
        // Create new guide(s) for each selected list
        for (const listId of targetListIds) {
          const listName = lists.find(l => l.id === listId)?.name || "";
          const gName = targetListIds.length > 1 ? `${guideName} — ${listName}` : guideName;

          const { data: guide, error } = await supabase.from("par_guides").insert({
            restaurant_id: currentRestaurant.id,
            inventory_list_id: listId,
            location_id: selectedLocationId || null,
            name: gName,
            created_by: user.id,
          }).select().single();

          if (error) { toast.error(error.message); setImporting(false); return; }
          guidesCreated++;

          const result = await importIntoGuide(guide.id, listId, rowsToProcess);
          createdCount += result.created;
          updatedCount += result.updated;
        }
        skippedCount = matchedRows.length - rowsToProcess.length;
      }

      setImportResult({ created: createdCount, updated: updatedCount, skipped: skippedCount, guidesCreated });
      toast.success(`Imported ${createdCount} new, updated ${updatedCount} PAR items`);
      setStep("done");
    } catch (err: any) {
      toast.error(err.message || "Import failed");
    }
    setImporting(false);
  };

  const importIntoGuide = async (guideId: string, listId: string, rowsToProcess: MatchedRow[]) => {
    // Get existing items in this guide
    const { data: existingItems } = await supabase
      .from("par_guide_items").select("id, item_name").eq("par_guide_id", guideId);
    const existingByName = new Map<string, string>();
    (existingItems || []).forEach(e => existingByName.set(e.item_name.toLowerCase().trim(), e.id));

    const toInsert: any[] = [];
    const toUpdate: { id: string; data: any }[] = [];
    let created = 0;
    let updated = 0;

    for (const row of rowsToProcess) {
      // Handle "create_catalog" action: create a new catalog item
      if (row.action === "create_catalog" && row.matchType === "unmatched" && listId && currentRestaurant) {
        const { data: newCatalog } = await supabase.from("inventory_catalog_items").insert({
          restaurant_id: currentRestaurant.id,
          inventory_list_id: listId,
          item_name: row.itemName,
          category: row.category,
          unit: row.unit,
          pack_size: row.packSize,
          vendor_sku: row.vendorSku,
          product_number: row.vendorSku,
          brand_name: row.brand,
        }).select("id").single();
        if (newCatalog) row.catalogItemId = newCatalog.id;
      }

      // Handle "map_to_catalog" action
      if (row.action === "map_to_catalog" && row.manualCatalogId) {
        row.catalogItemId = row.manualCatalogId;
      }

      const existingId = existingByName.get(row.itemName.toLowerCase().trim());
      if (existingId) {
        toUpdate.push({
          id: existingId,
          data: {
            par_level: row.parLevel ?? 0,
            ...(row.category && { category: row.category }),
            ...(row.unit && { unit: row.unit }),
          },
        });
        updated++;
      } else {
        toInsert.push({
          par_guide_id: guideId,
          item_name: row.itemName,
          par_level: row.parLevel ?? 0,
          category: row.category || null,
          unit: row.unit || null,
          brand_name: row.brand || null,
        });
        created++;
      }

      // Update pack_size on catalog item if matched
      if (row.packSize && row.catalogItemId) {
        await supabase.from("inventory_catalog_items").update({ pack_size: row.packSize }).eq("id", row.catalogItemId);
      }
    }

    if (toInsert.length > 0) {
      for (let i = 0; i < toInsert.length; i += 500) {
        const { error } = await supabase.from("par_guide_items").insert(toInsert.slice(i, i + 500));
        if (error) throw error;
      }
    }
    for (const u of toUpdate) {
      await supabase.from("par_guide_items").update(u.data).eq("id", u.id);
    }

    return { created, updated };
  };

  const totalConf = overallConfidence(fieldMappings);
  const mappedCount = fieldMappings.filter(m => m.column).length;

  const matchTypeBadge = (type: MatchedRow["matchType"]) => {
    switch (type) {
      case "product_number": return <Badge className="bg-success/10 text-success border-0 text-[10px]">Product #</Badge>;
      case "name_pack": return <Badge className="bg-primary/10 text-primary border-0 text-[10px]">Name+Pack</Badge>;
      case "name_only": return <Badge className="bg-warning/10 text-warning border-0 text-[10px]">Name</Badge>;
      case "unmatched": return <Badge className="bg-destructive/10 text-destructive border-0 text-[10px]">Unmatched</Badge>;
    }
  };

  const coveragePercent = matchedRows.length > 0
    ? Math.round((matchedItems.length / matchedRows.length) * 100)
    : 0;

  const stepLabels = existingGuideId
    ? ["Upload", "Map Fields", "Match & Review", "Done"]
    : ["Upload", "Select Target", "Map Fields", "Match & Review", "Done"];
  const stepKeys: Step[] = existingGuideId
    ? ["upload", "mapping", "review", "done"]
    : ["upload", "target", "mapping", "review", "done"];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {existingGuideId ? `Import PAR Levels — ${existingGuideName}` : "Import PAR Guide"}
          </DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-1.5 text-xs flex-wrap">
          {stepLabels.map((label, i) => {
            const isActive = stepKeys.indexOf(step) >= i;
            return (
              <div key={label} className="flex items-center gap-1.5">
                {i > 0 && <div className={`h-px w-4 ${isActive ? "bg-primary" : "bg-border"}`} />}
                <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full ${isActive ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground"}`}>
                  <span className={`h-4 w-4 rounded-full flex items-center justify-center text-[9px] font-bold ${isActive ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{i + 1}</span>
                  {label}
                </div>
              </div>
            );
          })}
        </div>

        {/* STEP: Upload */}
        {step === "upload" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-primary" />
              <h2 className="font-semibold text-sm">Upload File</h2>
            </div>
            <div className="space-y-2">
              <Label className="text-sm">Select CSV or Excel file</Label>
              <Input type="file" accept=".csv,.xlsx,.xls" onChange={handleFileChange} className="h-10" />
            </div>
            <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5 text-primary" /> Auto-detects vendor formats (Sysco, US Foods, PFG, R365)</div>
              <div className="flex items-center gap-1.5"><Shield className="h-3.5 w-3.5 text-primary" /> Maps Item Name, PAR Level, Pack Size, Product Number</div>
              <div className="flex items-center gap-1.5"><Link2 className="h-3.5 w-3.5 text-primary" /> Matches items by Product Number, then Name + Pack Size</div>
            </div>
          </div>
        )}

        {/* STEP: Target Selection */}
        {step === "target" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-semibold">PAR Guide Name</Label>
              <Input value={guideName} onChange={e => setGuideName(e.target.value)} placeholder="e.g. Weekday PAR" className="h-10" />
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold">Apply to Inventory List(s)</Label>
              <p className="text-xs text-muted-foreground">Select the lists this PAR guide should apply to. A separate guide will be created for each list.</p>
              <div className="space-y-1.5 max-h-40 overflow-y-auto border rounded-md p-2">
                {lists.map(l => (
                  <label key={l.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer">
                    <Checkbox
                      checked={selectedListIds.includes(l.id)}
                      onCheckedChange={checked => {
                        setSelectedListIds(prev =>
                          checked ? [...prev, l.id] : prev.filter(id => id !== l.id)
                        );
                      }}
                    />
                    <span className="text-sm">{l.name}</span>
                  </label>
                ))}
              </div>
              {selectedListIds.length > 1 && (
                <p className="text-xs text-muted-foreground">
                  {selectedListIds.length} lists selected — a PAR guide will be created for each.
                </p>
              )}
            </div>

            {locations.length > 0 && (
              <div className="space-y-2">
                <Label className="text-sm font-semibold">Location (optional)</Label>
                <Select value={selectedLocationId} onValueChange={setSelectedLocationId}>
                  <SelectTrigger className="h-10"><SelectValue placeholder="All locations" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">All locations</SelectItem>
                    {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => { setStep("upload"); setFile(null); setHeaders([]); setRows([]); }}>Back</Button>
              <Button size="sm" onClick={handleProceedToMapping} className="bg-gradient-amber shadow-amber gap-1.5" disabled={selectedListIds.length === 0 || !guideName.trim()}>
                <ArrowRight className="h-3.5 w-3.5" /> Map Fields
              </Button>
            </div>
          </div>
        )}

        {/* STEP: Column Mapping */}
        {step === "mapping" && (
          <div className="space-y-3">
            <Card className={totalConf >= 80 ? "border-success/30" : "border-warning/30"}>
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {totalConf >= 80 ? <CheckCircle className="h-4 w-4 text-success" /> : <AlertTriangle className="h-4 w-4 text-warning" />}
                    <div>
                      <p className="text-xs font-semibold">
                        {totalConf >= 80 ? `Auto-mapped ${mappedCount} fields (${totalConf}% confidence)` : `Mapped ${mappedCount} fields — review recommended (${totalConf}%)`}
                      </p>
                      <p className="text-[10px] text-muted-foreground">Vendor: {vendor.label} · {rows.length} rows</p>
                    </div>
                  </div>
                  {confidenceBadge(totalConf)}
                </div>
              </CardContent>
            </Card>

            {/* Mapping chips */}
            <div className="flex flex-wrap gap-1.5">
              {fieldMappings.filter(m => m.column).map(m => (
                <div key={m.field} className="flex items-center gap-1 px-2 py-1 rounded-md border border-border/60 bg-card text-[11px]">
                  <span className="font-medium">{PAR_CANONICAL_FIELDS.find(f => f.key === m.field)?.label}</span>
                  <span className="text-muted-foreground">→</span>
                  <span className="font-mono text-primary">{m.column}</span>
                  {confidenceBadge(m.confidence)}
                </div>
              ))}
            </div>

            {/* Vendor selector */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">Vendor</Label>
              <Select value={vendor.id} onValueChange={handleVendorChange}>
                <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
                <SelectContent>{VENDOR_PRESETS.map(v => <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            {/* Edit mapping */}
            <Card>
              <CardContent className="p-0">
                <button className="w-full flex items-center justify-between p-3 text-xs font-medium hover:bg-muted/30 transition-colors" onClick={() => setShowMappingEditor(!showMappingEditor)}>
                  <span className="flex items-center gap-2"><FileSpreadsheet className="h-3.5 w-3.5 text-primary" /> Edit Column Mapping</span>
                  {showMappingEditor ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </button>
                {showMappingEditor && (
                  <div className="px-3 pb-3 space-y-2 border-t pt-2">
                    {PAR_CANONICAL_FIELDS.map(field => (
                      <div key={field.key} className="flex items-center gap-2">
                        <Label className="w-28 text-xs shrink-0">
                          {field.label}{field.required && <span className="text-destructive ml-0.5">*</span>}
                        </Label>
                        <Select value={mapping[field.key] || "__none__"} onValueChange={v => handleMappingChange(field.key, v)}>
                          <SelectTrigger className="h-8 text-xs flex-1"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">— Not mapped —</SelectItem>
                            {headers.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        {fieldMappings.find(m => m.field === field.key)?.column && confidenceBadge(fieldMappings.find(m => m.field === field.key)!.confidence)}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setStep(existingGuideId ? "upload" : "target")}>Back</Button>
              <Button size="sm" onClick={handleProceedToReview} className="bg-gradient-amber shadow-amber gap-1.5">
                <ArrowRight className="h-3.5 w-3.5" /> Match & Review
              </Button>
            </div>
          </div>
        )}

        {/* STEP: Match & Review */}
        {step === "review" && (
          <div className="space-y-4">
            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-2">
              <Card className="border-success/30">
                <CardContent className="p-3 text-center">
                  <p className="text-lg font-bold text-success">{matchedItems.length}</p>
                  <p className="text-[10px] text-muted-foreground">Matched</p>
                </CardContent>
              </Card>
              <Card className={unmatchedItems.length > 0 ? "border-warning/30" : ""}>
                <CardContent className="p-3 text-center">
                  <p className="text-lg font-bold text-warning">{unmatchedItems.length}</p>
                  <p className="text-[10px] text-muted-foreground">Unmatched</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3 text-center">
                  <p className="text-lg font-bold">{coveragePercent}%</p>
                  <p className="text-[10px] text-muted-foreground">Coverage</p>
                </CardContent>
              </Card>
            </div>

            {/* Matched items preview */}
            {matchedItems.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">Matched Items (first 10)</p>
                <div className="overflow-x-auto rounded-lg border max-h-48 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead className="text-[10px]">Item</TableHead>
                        <TableHead className="text-[10px]">PAR</TableHead>
                        <TableHead className="text-[10px]">Match</TableHead>
                        <TableHead className="text-[10px]">Catalog Item</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {matchedItems.slice(0, 10).map(r => (
                        <TableRow key={r.rowIdx}>
                          <TableCell className="text-xs py-1.5">{r.itemName}</TableCell>
                          <TableCell className="text-xs py-1.5 font-mono">{r.parLevel ?? "—"}</TableCell>
                          <TableCell className="py-1.5">{matchTypeBadge(r.matchType)}</TableCell>
                          <TableCell className="text-xs py-1.5 text-muted-foreground">{r.catalogItemName || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {matchedItems.length > 10 && <p className="text-[10px] text-muted-foreground">+ {matchedItems.length - 10} more matched items</p>}
              </div>
            )}

            {/* Unmatched items */}
            {unmatchedItems.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-warning">Unmatched Items ({unmatchedItems.length})</p>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="outline" className="h-7 text-[10px] px-2" onClick={() => handleBulkUnmatchedAction("import_anyway")}>Import All</Button>
                    <Button size="sm" variant="outline" className="h-7 text-[10px] px-2" onClick={() => handleBulkUnmatchedAction("create_catalog")}>Create All in Catalog</Button>
                    <Button size="sm" variant="outline" className="h-7 text-[10px] px-2" onClick={() => handleBulkUnmatchedAction("skip")}>Skip All</Button>
                  </div>
                </div>
                {unmatchedItems.length > 5 && (
                  <div className="relative max-w-xs">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                    <Input value={unmatchedSearch} onChange={e => setUnmatchedSearch(e.target.value)} placeholder="Search unmatched..." className="pl-7 h-7 text-xs" />
                  </div>
                )}
                <div className="overflow-x-auto rounded-lg border max-h-56 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead className="text-[10px]">Item</TableHead>
                        <TableHead className="text-[10px]">PAR</TableHead>
                        <TableHead className="text-[10px]">Action</TableHead>
                        {catalogItems.length > 0 && <TableHead className="text-[10px]">Map to</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredUnmatched.map(r => (
                        <TableRow key={r.rowIdx}>
                          <TableCell className="text-xs py-1.5">{r.itemName}</TableCell>
                          <TableCell className="text-xs py-1.5 font-mono">{r.parLevel ?? "—"}</TableCell>
                          <TableCell className="py-1.5">
                            <Select value={r.action} onValueChange={v => handleUnmatchedAction(r.rowIdx, v as MatchedRow["action"])}>
                              <SelectTrigger className="h-7 text-[10px] w-32"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="import_anyway">Import anyway</SelectItem>
                                <SelectItem value="create_catalog">Create in catalog</SelectItem>
                                <SelectItem value="map_to_catalog">Map to catalog</SelectItem>
                                <SelectItem value="skip">Skip</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          {catalogItems.length > 0 && (
                            <TableCell className="py-1.5">
                              {r.action === "map_to_catalog" && (
                                <Select value={r.manualCatalogId || ""} onValueChange={v => handleUnmatchedAction(r.rowIdx, "map_to_catalog", v)}>
                                  <SelectTrigger className="h-7 text-[10px] w-40"><SelectValue placeholder="Select item" /></SelectTrigger>
                                  <SelectContent>
                                    {catalogItems.slice(0, 50).map(c => (
                                      <SelectItem key={c.id} value={c.id}>{c.item_name}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setStep("mapping")}>Back</Button>
              <Button size="sm" onClick={handleImport} className="bg-gradient-amber shadow-amber gap-1.5" disabled={importing}>
                {importing ? "Importing..." : `Import ${matchedRows.filter(r => r.action !== "skip").length} PAR Items`}
              </Button>
            </div>
          </div>
        )}

        {/* STEP: Done */}
        {step === "done" && (
          <div className="py-6 text-center space-y-3">
            <CheckCircle className="mx-auto h-10 w-10 text-success" />
            <p className="text-base font-semibold">Import Complete!</p>
            {importResult && (
              <div className="flex justify-center gap-3 text-sm flex-wrap">
                {importResult.created > 0 && <Badge className="bg-success/10 text-success border-0">{importResult.created} created</Badge>}
                {importResult.updated > 0 && <Badge className="bg-primary/10 text-primary border-0">{importResult.updated} updated</Badge>}
                {importResult.skipped > 0 && <Badge variant="secondary">{importResult.skipped} skipped</Badge>}
                {importResult.guidesCreated > 0 && <Badge className="bg-primary/10 text-primary border-0">{importResult.guidesCreated} guide(s) created</Badge>}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {existingGuideId
                ? `PAR levels have been imported into "${existingGuideName}".`
                : `PAR guide(s) created and linked to ${selectedListIds.length} list(s).`
              }
            </p>
            <Button size="sm" variant="outline" onClick={() => { onImportComplete(); onOpenChange(false); }}>
              Close
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
