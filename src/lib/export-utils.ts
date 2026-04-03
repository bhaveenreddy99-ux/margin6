import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

interface ExportItem {
  item_name: string;
  vendor_sku?: string;
  product_number?: string;
  brand_name?: string;
  category?: string;
  unit?: string;
  pack_size?: string;
  current_stock?: number;
  par_level?: number;
  lead_time_days?: number;
  unit_cost?: number;
  risk?: string;
  ratio?: number;
  suggestedOrder?: number;
}

const INVENTORY_COLUMNS = [
  "Item Name", "Brand", "Product Number", "Category", "Unit", "Pack Size",
  "Current Stock", "PAR Level", "Lead Time (Days)", "Unit Cost",
];

const SMART_ORDER_COLUMNS = [
  "Risk", "Item Name", "Brand", "Pack Size", "Current Stock", "PAR Level", "Suggested Order",
];

function itemToRow(item: ExportItem) {
  return [
    item.item_name || "",
    item.brand_name || "",
    item.product_number || item.vendor_sku || "",
    item.category || "",
    item.unit || "",
    item.pack_size || "",
    item.current_stock ?? "",
    item.par_level ?? "",
    item.lead_time_days ?? "",
    item.unit_cost != null ? `$${item.unit_cost}` : "",
  ];
}

function smartOrderRow(item: ExportItem) {
  return [
    item.risk || "",
    item.item_name || "",
    item.brand_name || "",
    item.pack_size || "",
    item.current_stock ?? "",
    item.par_level ?? "",
    item.suggestedOrder ?? "",
  ];
}

export function exportToCSV(items: ExportItem[], filename: string, type: "inventory" | "smartorder" = "inventory") {
  const cols = type === "smartorder" ? SMART_ORDER_COLUMNS : INVENTORY_COLUMNS;
  const toRow = type === "smartorder" ? smartOrderRow : itemToRow;
  const rows = [cols, ...items.map(toRow)];
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  downloadBlob(blob, `${filename}.csv`);
}

export function exportToExcel(
  items: ExportItem[],
  filename: string,
  type: "inventory" | "smartorder" = "inventory",
  meta?: { listName?: string; sessionName?: string; date?: string }
) {
  const cols = type === "smartorder" ? SMART_ORDER_COLUMNS : INVENTORY_COLUMNS;
  const toRow = type === "smartorder" ? smartOrderRow : itemToRow;
  const wb = XLSX.utils.book_new();
  const headerRows: string[][] = [];
  if (meta?.listName) headerRows.push(["List", meta.listName]);
  if (meta?.sessionName) headerRows.push(["Session", meta.sessionName]);
  if (meta?.date) headerRows.push(["Date", meta.date]);
  if (headerRows.length) headerRows.push([]);
  const data = [...headerRows, cols, ...items.map(toRow)];
  const ws = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, "Export");
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

export function exportToPDF(
  items: ExportItem[],
  filename: string,
  type: "inventory" | "smartorder" = "inventory",
  meta?: { listName?: string; sessionName?: string; date?: string }
) {
  const doc = new jsPDF();
  let y = 15;
  doc.setFontSize(16);
  doc.text("RestaurantIQ Export", 14, y);
  y += 8;
  doc.setFontSize(10);
  if (meta?.listName) { doc.text(`List: ${meta.listName}`, 14, y); y += 5; }
  if (meta?.sessionName) { doc.text(`Session: ${meta.sessionName}`, 14, y); y += 5; }
  if (meta?.date) { doc.text(`Date: ${meta.date}`, 14, y); y += 5; }
  y += 3;

  const cols = type === "smartorder" ? SMART_ORDER_COLUMNS : INVENTORY_COLUMNS;
  const toRow = type === "smartorder" ? smartOrderRow : itemToRow;

  autoTable(doc, {
    startY: y,
    head: [cols],
    body: items.map(toRow),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [245, 158, 11] },
  });

  doc.save(`${filename}.pdf`);
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function parseFile(file: File): Promise<{ headers: string[]; rows: Record<string, any>[] }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "" });
        if (json.length === 0) {
          resolve({ headers: [], rows: [] });
          return;
        }
        const headers = Object.keys(json[0]);
        resolve({ headers, rows: json });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}
