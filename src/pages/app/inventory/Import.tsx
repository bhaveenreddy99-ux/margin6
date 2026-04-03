import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurant } from "@/contexts/RestaurantContext";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Upload, FileSpreadsheet, ArrowRight, CheckCircle, AlertTriangle, ArrowLeft, ChevronDown, ChevronUp, Sparkles, Shield, Ban } from "lucide-react";
import {
  VENDOR_PRESETS,
  CANONICAL_FIELDS,
  detectVendor,
  autoMapColumnsWithConfidence,
  fieldMappingsToRecord,
  overallConfidence,
  createHeaderFingerprint,
  validateNumericField,
  isIgnoredColumn,
  type CanonicalField,
  type VendorPreset,
  type FieldMapping,
} from "@/lib/vendor-presets";
import { parseFile } from "@/lib/export-utils";

type Step = "upload" | "mapping" | "preview" | "done";

const CONFIDENCE_THRESHOLD = 80;

function confidenceBadge(score: number) {
  if (score >= 90) return <Badge className="bg-success/10 text-success border-0 text-[10px] font-mono">{score}%</Badge>;
  if (score >= 70) return <Badge className="bg-warning/10 text-warning border-0 text-[10px] font-mono">{score}%</Badge>;
  if (score > 0) return <Badge className="bg-destructive/10 text-destructive border-0 text-[10px] font-mono">{score}%</Badge>;
  return <Badge variant="secondary" className="text-[10px] font-mono">—</Badge>;
}

function methodLabel(method: FieldMapping["method"]) {
  const labels: Record<string, string> = {
    preset: "Vendor match",
    synonym: "Synonym",
    fuzzy: "Fuzzy match",
    type_inference: "Type inferred",
    template: "Remembered",
    none: "",
  };
  return labels[method] || "";
}

export default function ImportPage() {
  const { listId } = useParams<{ listId: string }>();
  const navigate = useNavigate();
  const { currentRestaurant } = useRestaurant();
  const { user } = useAuth();
  const [listName, setListName] = useState("");
  const [step, setStep] = useState<Step>("upload");

  // Upload state
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, any>[]>([]);

  // Mapping state
  const [vendor, setVendor] = useState<VendorPreset>(VENDOR_PRESETS.find(p => p.id === "generic")!);
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([]);
  const [mapping, setMapping] = useState<Record<CanonicalField, string | null>>({} as any);
  const [showMappingEditor, setShowMappingEditor] = useState(false);
  const [ignoredColumns, setIgnoredColumns] = useState<string[]>([]);

  // Templates
  const [templates, setTemplates] = useState<any[]>([]);
  const [rememberMapping, setRememberMapping] = useState(true);
  const [matchedTemplate, setMatchedTemplate] = useState<any>(null);

  // Validation warnings
  const [warnings, setWarnings] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; updated: number; skipped: number } | null>(null);

  useEffect(() => {
    if (!currentRestaurant) return;
    if (listId) {
      supabase.from("inventory_lists").select("name").eq("id", listId).single()
        .then(({ data }) => { if (data) setListName(data.name); });
    }
    supabase.from("import_templates").select("*")
      .eq("restaurant_id", currentRestaurant.id)
      .order("last_used_at", { ascending: false, nullsFirst: false })
      .then(({ data }) => { if (data) setTemplates(data); });
  }, [currentRestaurant, listId]);

  const findBestTemplate = (headers: string[], detectedVendor: VendorPreset): any | null => {
    const fingerprint = createHeaderFingerprint(headers);
    const exactMatch = templates.find(t =>
      t.header_fingerprint === fingerprint &&
      (t.inventory_list_id === listId || !t.inventory_list_id)
    );
    if (exactMatch) return exactMatch;
    const vendorListMatch = templates.find(t =>
      t.vendor_name === detectedVendor.id &&
      t.inventory_list_id === listId
    );
    if (vendorListMatch) return vendorListMatch;
    const vendorMatch = templates.find(t => t.vendor_name === detectedVendor.id);
    if (vendorMatch) return vendorMatch;
    return null;
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

      // Detect ignored columns
      const ignored = h.filter(col => isIgnoredColumn(col));
      setIgnoredColumns(ignored);

      const detected = detectVendor(h);
      setVendor(detected);

      const bestTemplate = findBestTemplate(h, detected);
      setMatchedTemplate(bestTemplate);

      const savedMapping = bestTemplate?.mapping_json as Record<CanonicalField, string | null> | null;
      const mappings = autoMapColumnsWithConfidence(h, detected, r, savedMapping);
      setFieldMappings(mappings);
      setMapping(fieldMappingsToRecord(mappings));

      const totalConf = overallConfidence(mappings);
      const hasItemName = mappings.some(m => m.field === "item_name" && m.column && m.confidence >= 70);

      if (detected.id !== "generic") {
        toast.success(`Detected vendor: ${detected.label} (${totalConf}% confidence)`);
      }

      if (ignored.length > 0) {
        toast.info(`${ignored.length} column(s) ignored (stock/PAR/order data)`);
      }

      if (totalConf >= CONFIDENCE_THRESHOLD && hasItemName) {
        setShowMappingEditor(false);
        setStep("mapping");
      } else {
        setShowMappingEditor(true);
        setStep("mapping");
      }
    } catch { toast.error("Failed to parse file"); }
  };

  const handleVendorChange = (vendorId: string) => {
    const vp = VENDOR_PRESETS.find(p => p.id === vendorId)!;
    setVendor(vp);
    const mappings = autoMapColumnsWithConfidence(headers, vp, rows);
    setFieldMappings(mappings);
    setMapping(fieldMappingsToRecord(mappings));
  };

  const handleMappingChange = (field: CanonicalField, value: string) => {
    const newCol = value === "__none__" ? null : value;
    setMapping(prev => ({ ...prev, [field]: newCol }));
    setFieldMappings(prev => prev.map(m =>
      m.field === field ? { ...m, column: newCol, confidence: newCol ? 100 : 0, method: "preset" as const } : m
    ));
  };

  const handleProceedToPreview = () => {
    if (!mapping.item_name) { toast.error("item_name mapping is required"); return; }
    const w: string[] = [];
    const numericFields: CanonicalField[] = ["unitCost"];
    for (const field of numericFields) {
      const col = mapping[field];
      if (!col) continue;
      let invalidCount = 0;
      for (const row of rows.slice(0, 100)) {
        const v = row[col];
        if (v !== "" && v != null && isNaN(Number(String(v).replace(/[$,\s]/g, "")))) invalidCount++;
      }
      if (invalidCount > 0) w.push(`${CANONICAL_FIELDS.find(f => f.key === field)?.label}: ${invalidCount} non-numeric values in first 100 rows`);
    }
    setWarnings(w);
    setStep("preview");
  };

  const getMappedValue = (row: Record<string, any>, field: CanonicalField): any => {
    const col = mapping[field];
    return col ? (row[col] ?? null) : null;
  };

  const truncate = (val: any, max: number): string | null => {
    if (val == null) return null;
    const s = String(val).trim();
    return s ? s.substring(0, max) : null;
  };

  const sanitizeMetadata = (row: Record<string, any>, extraCols: string[]): Record<string, any> | null => {
    const metadata: Record<string, any> = {};
    let count = 0;
    for (const col of extraCols) {
      if (count >= 20) break;
      // Don't store ignored columns in metadata either
      if (isIgnoredColumn(col)) continue;
      if (row[col] !== "" && row[col] != null) {
        metadata[col.substring(0, 100)] = String(row[col]).substring(0, 500);
        count++;
      }
    }
    return Object.keys(metadata).length > 0 ? metadata : null;
  };

  const handleImport = async () => {
    if (!currentRestaurant || !user || !listId) return;
    setImporting(true);
    let createdCount = 0;
    let updatedCount = 0;
    const skippedCount = 0;
    try {
      const mappedCols = Object.values(mapping).filter(Boolean) as string[];
      const extraCols = headers.filter(h => !mappedCols.includes(h));

      // Catalog-only import
      const catalogItems = rows.map(row => {
        const brandVal = truncate(getMappedValue(row, "brand"), 200);
        const baseMetadata = sanitizeMetadata(row, extraCols);
        // Store brand in metadata for backward compat
        const metadata = brandVal
          ? { ...(baseMetadata || {}), brand_name: brandVal }
          : baseMetadata;

        return {
          restaurant_id: currentRestaurant.id,
          inventory_list_id: listId,
          item_name: truncate(getMappedValue(row, "item_name"), 200) || "",
          vendor_sku: truncate(getMappedValue(row, "vendor_sku"), 100),
          product_number: truncate(getMappedValue(row, "vendor_sku"), 100),
          brand_name: brandVal,
          category: truncate(getMappedValue(row, "category"), 100),
          unit: truncate(getMappedValue(row, "unit"), 50),
          pack_size: truncate(getMappedValue(row, "pack_size"), 100),
          default_unit_cost: validateNumericField(getMappedValue(row, "unitCost")).parsed,
          vendor_name: truncate(getMappedValue(row, "vendor_name"), 200) || (vendor.defaultVendorName ? vendor.defaultVendorName.substring(0, 200) : null),
          metadata,
        };
      }).filter(i => i.item_name);

      // Upsert logic: match by vendor_sku first, then normalized item_name
      const { data: existingItems } = await supabase
        .from("inventory_catalog_items")
        .select("id, item_name, vendor_sku")
        .eq("inventory_list_id", listId);

      const existingBySkuMap = new Map<string, string>();
      const existingByNameMap = new Map<string, string>();
      (existingItems || []).forEach(e => {
        if (e.vendor_sku) existingBySkuMap.set(e.vendor_sku.toLowerCase(), e.id);
        existingByNameMap.set(e.item_name.toLowerCase().trim(), e.id);
      });

      const toInsert: typeof catalogItems = [];
      const toUpdate: { id: string; data: any }[] = [];

      for (const item of catalogItems) {
        const matchId = (item.vendor_sku && existingBySkuMap.get(item.vendor_sku.toLowerCase())) ||
          existingByNameMap.get(item.item_name.toLowerCase().trim());
        if (matchId) {
          toUpdate.push({ id: matchId, data: item });
        } else {
          toInsert.push(item);
        }
      }

      for (let i = 0; i < toInsert.length; i += 500) {
        const chunk = toInsert.slice(i, i + 500);
        const { error } = await supabase.from("inventory_catalog_items").insert(chunk);
        if (error) { toast.error(error.message); setImporting(false); return; }
      }

      for (const u of toUpdate) {
        const { restaurant_id, inventory_list_id, ...updateData } = u.data;
        await supabase.from("inventory_catalog_items").update(updateData).eq("id", u.id);
      }

      createdCount = toInsert.length;
      updatedCount = toUpdate.length;

      // Save import run record
      const confScore = overallConfidence(fieldMappings);
      await supabase.from("import_runs").insert({
        restaurant_id: currentRestaurant.id,
        inventory_list_id: listId,
        vendor_name: vendor.id !== "generic" ? vendor.id : null,
        file_name: file?.name || "unknown",
        uploaded_by: user.id,
        mapping_used_json: mapping,
        confidence_score: confScore,
        created_count: createdCount,
        updated_count: updatedCount,
        skipped_count: skippedCount,
        warnings_json: warnings,
        template_id: matchedTemplate?.id || null,
      });

      // Legacy import files record
      await supabase.from("inventory_import_files").insert({
        restaurant_id: currentRestaurant.id,
        inventory_list_id: listId,
        file_name: file?.name || "unknown",
        file_type: file?.name.endsWith(".xlsx") || file?.name.endsWith(".xls") ? "xlsx" : "csv",
        uploaded_by: user.id,
        row_count: rows.length,
        created_count: createdCount,
        skipped_count: updatedCount + skippedCount,
        mapping_json: mapping,
      });

      // Save/update template
      if (rememberMapping) {
        const fingerprint = createHeaderFingerprint(headers);
        if (matchedTemplate) {
          await supabase.from("import_templates").update({
            mapping_json: mapping,
            header_fingerprint: fingerprint,
            last_used_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq("id", matchedTemplate.id);
        } else {
          await supabase.from("import_templates").insert({
            restaurant_id: currentRestaurant.id,
            name: `${vendor.label} — ${listName || "Import"}`,
            vendor_name: vendor.id,
            inventory_list_id: listId,
            file_type: file?.name.endsWith(".xlsx") ? "xlsx" : "csv",
            mapping_json: mapping,
            header_fingerprint: fingerprint,
            last_used_at: new Date().toISOString(),
          });
        }
      }

      setImportResult({ created: createdCount, updated: updatedCount, skipped: skippedCount });
      toast.success(`Imported ${createdCount} new, updated ${updatedCount} catalog items`);
      setStep("done");
    } catch (err: any) { toast.error(err.message || "Import failed"); }
    setImporting(false);
  };

  const previewRows = rows.slice(0, 10);
  const totalConf = overallConfidence(fieldMappings);
  const mappedCount = fieldMappings.filter(m => m.column).length;
  // Only show eligible (non-ignored) headers in the mapping dropdowns
  const eligibleHeaders = headers.filter(h => !isIgnoredColumn(h));

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/app/inventory/lists")} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <div>
          <h1 className="page-title">Import to {listName || "Inventory List"}</h1>
          <p className="page-description">Import catalog items from CSV or Excel — Sysco, US Foods, PFG, R365 supported</p>
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-xs">
        {["Upload", "Map Fields", "Preview", "Done"].map((label, i) => {
          const steps: Step[] = ["upload", "mapping", "preview", "done"];
          const isActive = steps.indexOf(step) >= i;
          return (
            <div key={label} className="flex items-center gap-2">
              {i > 0 && <div className={`h-px w-6 ${isActive ? "bg-primary" : "bg-border"}`} />}
              <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full ${isActive ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground"}`}>
                <span className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold ${isActive ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{i + 1}</span>
                {label}
              </div>
            </div>
          );
        })}
      </div>

      {step === "upload" && (
        <Card>
          <CardContent className="p-6 space-y-5">
            <div className="flex items-center gap-2 mb-1">
              <Upload className="h-5 w-5 text-primary" />
              <h2 className="font-semibold">Upload File</h2>
            </div>
            <div className="space-y-2">
              <Label className="text-sm">Select CSV or Excel file</Label>
              <Input type="file" accept=".csv,.xlsx,.xls" onChange={handleFileChange} className="h-10" />
            </div>
            <div className="flex flex-col gap-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5 text-primary" /> Auto-detects Sysco, US Foods, PFG, Restaurant365</div>
              <div className="flex items-center gap-1.5"><Shield className="h-3.5 w-3.5 text-primary" /> Imports catalog data only — stock counts, PAR levels, and order quantities are ignored</div>
              <div className="flex items-center gap-1.5"><Shield className="h-3.5 w-3.5 text-primary" /> Remembers mappings for future imports</div>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "mapping" && (
        <div className="space-y-4">
          {/* Confidence summary */}
          <Card className={totalConf >= CONFIDENCE_THRESHOLD ? "border-success/30" : "border-warning/30"}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {totalConf >= CONFIDENCE_THRESHOLD
                    ? <CheckCircle className="h-5 w-5 text-success" />
                    : <AlertTriangle className="h-5 w-5 text-warning" />
                  }
                  <div>
                    <p className="text-sm font-semibold">
                      {totalConf >= CONFIDENCE_THRESHOLD
                        ? `Auto-mapped ${mappedCount} fields with ${totalConf}% confidence`
                        : `Mapped ${mappedCount} fields — review recommended (${totalConf}% confidence)`
                      }
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Vendor: {vendor.label}
                      {matchedTemplate && <> · Using saved template: {matchedTemplate.name}</>}
                    </p>
                  </div>
                </div>
                {confidenceBadge(totalConf)}
              </div>
            </CardContent>
          </Card>

          {/* Ignored columns notice */}
          {ignoredColumns.length > 0 && (
            <Card className="border-muted">
              <CardContent className="p-3">
                <div className="flex items-start gap-2">
                  <Ban className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      {ignoredColumns.length} column(s) ignored (stock/PAR/order data not imported to catalog)
                    </p>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {ignoredColumns.map(col => (
                        <Badge key={col} variant="secondary" className="text-[10px] font-mono line-through opacity-60">{col}</Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Mapping summary chips */}
          <div className="flex flex-wrap gap-2">
            {fieldMappings.filter(m => m.column).map(m => (
              <div key={m.field} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border/60 bg-card text-xs">
                <span className="font-medium">{CANONICAL_FIELDS.find(f => f.key === m.field)?.label}</span>
                <span className="text-muted-foreground">→</span>
                <span className="font-mono text-primary">{m.column}</span>
                {confidenceBadge(m.confidence)}
                {m.method !== "none" && <span className="text-[10px] text-muted-foreground">{methodLabel(m.method)}</span>}
              </div>
            ))}
          </div>

          {/* Vendor selector */}
          <Card>
            <CardContent className="p-4">
              <div className="space-y-2">
                <Label className="text-xs font-semibold text-muted-foreground">Vendor</Label>
                <Select value={vendor.id} onValueChange={handleVendorChange}>
                  <SelectTrigger className="h-10 w-64"><SelectValue /></SelectTrigger>
                  <SelectContent>{VENDOR_PRESETS.map(v => <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>)}</SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">Importing to: <span className="font-semibold text-foreground">Inventory Catalog</span> (master item list)</p>
              </div>
            </CardContent>
          </Card>

          {/* Edit mapping (collapsible) */}
          <Card>
            <CardContent className="p-0">
              <button
                className="w-full flex items-center justify-between p-4 text-sm font-medium hover:bg-muted/30 transition-colors"
                onClick={() => setShowMappingEditor(!showMappingEditor)}
              >
                <span className="flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 text-primary" />
                  Edit Column Mapping
                </span>
                {showMappingEditor ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {showMappingEditor && (
                <div className="px-4 pb-4 space-y-3 border-t">
                  <div className="grid gap-3 sm:grid-cols-2 pt-3">
                    {CANONICAL_FIELDS.map(field => {
                      const fm = fieldMappings.find(m => m.field === field.key);
                      return (
                        <div key={field.key} className="flex items-center gap-2">
                          <Label className="w-28 text-xs shrink-0">
                            {field.label}
                            {field.required && <span className="text-destructive ml-0.5">*</span>}
                          </Label>
                          <Select value={mapping[field.key] || "__none__"} onValueChange={v => handleMappingChange(field.key, v)}>
                            <SelectTrigger className="h-8 text-xs flex-1"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">— Not mapped —</SelectItem>
                              {eligibleHeaders.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          {fm && fm.column && confidenceBadge(fm.confidence)}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Remember + actions */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Switch checked={rememberMapping} onCheckedChange={setRememberMapping} id="remember" />
              <Label htmlFor="remember" className="text-sm text-muted-foreground">Remember mapping for future imports</Label>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setStep("upload"); setFile(null); setHeaders([]); setRows([]); setIgnoredColumns([]); }}>Back</Button>
              <Button onClick={handleProceedToPreview} className="bg-gradient-amber shadow-amber gap-2">
                <ArrowRight className="h-4 w-4" /> Preview & Import
              </Button>
            </div>
          </div>
        </div>
      )}

      {step === "preview" && (
        <div className="space-y-4">
          {warnings.length > 0 && (
            <Card className="border-warning/30">
              <CardContent className="py-3 space-y-1">
                {warnings.map((w, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-warning">
                    <AlertTriangle className="h-4 w-4 shrink-0" /> {w}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          <Card>
            <div className="p-4 pb-2 flex items-center justify-between">
              <p className="text-sm font-semibold">
                Preview ({rows.length} rows) → Catalog for {listName}
              </p>
              <Badge variant="secondary" className="text-xs">{vendor.label}</Badge>
            </div>
            <CardContent className="pt-2">
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      {CANONICAL_FIELDS.filter(f => mapping[f.key]).map(f => (
                        <TableHead key={f.key} className="text-xs font-semibold">{f.label}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewRows.map((row, i) => (
                      <TableRow key={i}>
                        {CANONICAL_FIELDS.filter(f => mapping[f.key]).map(f => (
                          <TableCell key={f.key} className="text-xs py-1.5">
                            {getMappedValue(row, f.key)?.toString() || "—"}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {rows.length > 10 && <p className="text-[11px] text-muted-foreground mt-2">Showing first 10 of {rows.length} rows</p>}
            </CardContent>
          </Card>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setStep("mapping")}>Back</Button>
            <Button onClick={handleImport} className="bg-gradient-amber shadow-amber gap-2" disabled={importing}>
              {importing ? "Importing..." : `Import ${rows.length} Catalog Items`}
            </Button>
          </div>
        </div>
      )}

      {step === "done" && (
        <Card>
          <CardContent className="py-12 text-center space-y-4">
            <CheckCircle className="mx-auto h-12 w-12 text-success" />
            <p className="text-lg font-semibold">Import Complete!</p>
            {importResult && (
              <div className="flex justify-center gap-4 text-sm">
                {importResult.created > 0 && <Badge className="bg-success/10 text-success border-0">{importResult.created} created</Badge>}
                {importResult.updated > 0 && <Badge className="bg-primary/10 text-primary border-0">{importResult.updated} updated</Badge>}
                {importResult.skipped > 0 && <Badge variant="secondary">{importResult.skipped} skipped</Badge>}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Catalog items are now available across Inventory Lists, PAR Management, Smart Orders, and Purchase History.
            </p>
            {rememberMapping && (
              <p className="text-xs text-muted-foreground flex items-center justify-center gap-1.5">
                <Shield className="h-3.5 w-3.5" /> Mapping saved — next import will auto-map
              </p>
            )}
            <div className="flex gap-2 justify-center pt-2">
              <Button onClick={() => navigate("/app/inventory/lists")} variant="outline">Back to Lists</Button>
              <Button onClick={() => { setStep("upload"); setFile(null); setHeaders([]); setRows([]); setWarnings([]); setImportResult(null); setIgnoredColumns([]); }} variant="outline">
                Import Another File
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
