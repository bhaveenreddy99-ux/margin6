import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Upload, FileSpreadsheet, ArrowRight, CheckCircle, AlertTriangle,
  ChevronDown, ChevronUp, Sparkles, Shield, Link2, Search, Package,
} from "lucide-react";
import { usePARImport } from "./import/usePARImport";
import { PAR_CANONICAL_FIELDS, type MatchedRow, type Step, type UnmatchedAction } from "./import/types";

function confidenceBadge(score: number) {
  if (score >= 90) return <Badge className="bg-success/10 text-success border-0 text-[10px] font-mono">{score}%</Badge>;
  if (score >= 70) return <Badge className="bg-warning/10 text-warning border-0 text-[10px] font-mono">{score}%</Badge>;
  if (score > 0) return <Badge className="bg-destructive/10 text-destructive border-0 text-[10px] font-mono">{score}%</Badge>;
  return <Badge variant="secondary" className="text-[10px] font-mono">—</Badge>;
}

function matchTypeBadge(type: MatchedRow["matchType"]) {
  switch (type) {
    case "product_number": return <Badge className="bg-success/10 text-success border-0 text-[10px]">Product #</Badge>;
    case "name_pack": return <Badge className="bg-primary/10 text-primary border-0 text-[10px]">Name+Pack</Badge>;
    case "name_only": return <Badge className="bg-warning/10 text-warning border-0 text-[10px]">Name</Badge>;
    case "unmatched": return <Badge className="bg-destructive/10 text-destructive border-0 text-[10px]">Unmatched</Badge>;
  }
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
  const {
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
  } = usePARImport({ open, existingGuideId, preselectedListId });

  const stepLabels = ["Upload", "Map Fields", "Match & Review", "Done"];
  const stepKeys: Step[] = ["upload", "mapping", "review", "done"];

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
            {!existingGuideId && (
              <div className="space-y-2">
                <Label className="text-sm font-semibold">PAR Guide Name</Label>
                <Input value={guideName} onChange={e => setGuideName(e.target.value)} placeholder="e.g. Weekday PAR" className="h-10" />
              </div>
            )}
            <div className="space-y-2">
              <Label className="text-sm">Select CSV or Excel file</Label>
              <Input type="file" accept=".csv,.xlsx,.xls" onChange={handleFileChange} className="h-10" />
            </div>
            <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5 text-primary" /> Auto-detects vendor formats</div>
              <div className="flex items-center gap-1.5"><Shield className="h-3.5 w-3.5 text-primary" /> Maps Item Name, PAR Level, Pack Size, Product Number</div>
              <div className="flex items-center gap-1.5"><Link2 className="h-3.5 w-3.5 text-primary" /> Matches items by Product Number, then Name + Pack Size</div>
              <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-400 font-medium">
                <Package className="h-3.5 w-3.5" /> Imported PAR values are treated as cases.
              </div>
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
              <Button variant="outline" size="sm" onClick={() => setStep("upload")}>Back</Button>
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
                            <Select value={r.action} onValueChange={v => handleUnmatchedAction(r.rowIdx, v as UnmatchedAction)}>
                              <SelectTrigger className="h-7 text-[10px] w-32"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="import_anyway">Import anyway</SelectItem>
                                <SelectItem value="map_to_catalog">Map to catalog</SelectItem>
                                <SelectItem value="skip">Skip</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          {catalogItems.length > 0 && (
                            <TableCell className="py-1.5">
                              {r.action === "map_to_catalog" && (
                                <Select value={r.manualCatalogId || "__none__"} onValueChange={v => handleUnmatchedAction(r.rowIdx, "map_to_catalog", v === "__none__" ? undefined : v)}>
                                  <SelectTrigger className="h-7 text-[10px] w-40"><SelectValue placeholder="Select item" /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__none__">— Select item —</SelectItem>
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
                : "PAR guide created. Select a list from the PAR page to apply it."
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
