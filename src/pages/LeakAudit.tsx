import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  ChefHat,
  CheckCircle2,
  ClipboardList,
  Download,
  FileText,
  Info,
  Loader2,
  TrendingDown,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";

type Screen = "upload" | "processing" | "results";

type FileType = "PDF" | "IMAGE";

interface TopItem {
  item_name: string;
  line_total: number;
  vendor_name: string;
}

interface AuditResult {
  total_spend: number;
  estimated_weekly_leak: number;
  loss_rate: number;
  top_items: TopItem[];
  vendor_names: string[];
  item_count: number;
  invoices_parsed: number;
}

interface QueuedFile {
  file: File;
  file_type: FileType;
  filename: string;
}

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || "";
const SUPABASE_ANON =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim() || "";
const MAX_FILES = 2;
const MAX_BYTES = 5 * 1024 * 1024;

const PROCESSING_MESSAGES = [
  "Reading your invoice...",
  "Identifying line items...",
  "Calculating your food cost...",
  "Building your report...",
];

function fmtUsd(n: number, fractionDigits = 0): string {
  return `$${n.toLocaleString("en-US", {
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  })}`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Could not read file"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

function detectFileType(file: File): FileType | null {
  const type = (file.type || "").toLowerCase();
  if (type === "application/pdf") return "PDF";
  if (type.startsWith("image/")) return "IMAGE";
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return "PDF";
  if (/\.(png|jpe?g|webp|gif)$/i.test(name)) return "IMAGE";
  return null;
}

function todayLabel(): string {
  return new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default function LeakAuditPage() {
  const [screen, setScreen] = useState<Screen>("upload");
  const [queued, setQueued] = useState<QueuedFile[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<AuditResult | null>(null);
  const [processingIndex, setProcessingIndex] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Rotate processing messages every 2s.
  useEffect(() => {
    if (screen !== "processing") return;
    const id = window.setInterval(() => {
      setProcessingIndex((i) => (i + 1) % PROCESSING_MESSAGES.length);
    }, 2000);
    return () => window.clearInterval(id);
  }, [screen]);

  const handleAddFiles = useCallback((incoming: FileList | File[]) => {
    setErrorMessage(null);
    const list = Array.from(incoming);
    const next: QueuedFile[] = [];
    for (const file of list) {
      const ft = detectFileType(file);
      if (!ft) {
        setErrorMessage(`"${file.name}" — only PDF and image files are supported.`);
        continue;
      }
      if (file.size > MAX_BYTES) {
        setErrorMessage(`"${file.name}" is over 5MB.`);
        continue;
      }
      next.push({ file, file_type: ft, filename: file.name });
    }
    setQueued((prev) => {
      const combined = [...prev, ...next];
      if (combined.length > MAX_FILES) {
        setErrorMessage(`Only ${MAX_FILES} invoices per audit.`);
        return combined.slice(0, MAX_FILES);
      }
      return combined;
    });
  }, []);

  const removeFile = (index: number) => {
    setQueued((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAnalyze = async () => {
    if (queued.length === 0) return;
    if (!SUPABASE_URL || !SUPABASE_ANON) {
      setErrorMessage("Audit service is not configured. Try again later.");
      return;
    }
    setErrorMessage(null);
    setScreen("processing");
    setProcessingIndex(0);
    try {
      const payloadFiles = await Promise.all(
        queued.map(async (q) => ({
          content: await fileToBase64(q.file),
          file_type: q.file_type,
          filename: q.filename,
        })),
      );

      const res = await fetch(`${SUPABASE_URL}/functions/v1/audit-invoice-anon`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON,
          Authorization: `Bearer ${SUPABASE_ANON}`,
        },
        body: JSON.stringify({ files: payloadFiles }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<AuditResult> & {
        error?: string;
      };

      if (!res.ok || typeof data.estimated_weekly_leak !== "number") {
        throw new Error(data.error || "Could not read invoice");
      }

      setResult({
        total_spend: data.total_spend ?? 0,
        estimated_weekly_leak: data.estimated_weekly_leak ?? 0,
        loss_rate: data.loss_rate ?? 0.08,
        top_items: data.top_items ?? [],
        vendor_names: data.vendor_names ?? [],
        item_count: data.item_count ?? 0,
        invoices_parsed: data.invoices_parsed ?? 0,
      });
      setScreen("results");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      setScreen("upload");
    }
  };

  const handleDownloadPdf = () => {
    if (!result) return;
    void generateLeakAuditPdf(result);
  };

  const reset = () => {
    setQueued([]);
    setResult(null);
    setErrorMessage(null);
    setScreen("upload");
  };

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-border/30">
        <div className="container flex h-16 items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-orange">
              <ChefHat className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight text-foreground">
              Margin<span className="text-gradient-orange">6</span>
            </span>
          </Link>
          <Link to="/signup" className="text-sm font-medium text-muted-foreground hover:text-foreground">
            Sign up free
          </Link>
        </div>
      </header>

      <main className="container py-12 sm:py-16">
        <div className="mx-auto max-w-2xl">
          {screen === "upload" && (
            <UploadScreen
              queued={queued}
              dragOver={dragOver}
              errorMessage={errorMessage}
              setDragOver={setDragOver}
              onPickFiles={() => fileInputRef.current?.click()}
              onAddFiles={handleAddFiles}
              onRemoveFile={removeFile}
              onAnalyze={handleAnalyze}
              fileInputRef={fileInputRef}
            />
          )}

          {screen === "processing" && (
            <ProcessingScreen message={PROCESSING_MESSAGES[processingIndex]} />
          )}

          {screen === "results" && result && (
            <ResultsScreen
              result={result}
              onDownloadPdf={handleDownloadPdf}
              onReset={reset}
            />
          )}
        </div>
      </main>
    </div>
  );
}

// ── Upload screen ─────────────────────────────────────────────────────────
function UploadScreen({
  queued,
  dragOver,
  errorMessage,
  setDragOver,
  onPickFiles,
  onAddFiles,
  onRemoveFile,
  onAnalyze,
  fileInputRef,
}: {
  queued: QueuedFile[];
  dragOver: boolean;
  errorMessage: string | null;
  setDragOver: (v: boolean) => void;
  onPickFiles: () => void;
  onAddFiles: (files: FileList | File[]) => void;
  onRemoveFile: (i: number) => void;
  onAnalyze: () => void;
  fileInputRef: React.RefObject<HTMLInputElement>;
}) {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="text-center">
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
          Find out what your restaurant lost this week
        </h1>
        <p className="mt-3 text-base text-muted-foreground max-w-xl mx-auto">
          Upload 1-2 vendor invoices. We'll show you exactly where your money is going.
          Free. No signup required.
        </p>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files) onAddFiles(e.dataTransfer.files);
        }}
        onClick={onPickFiles}
        className={`rounded-2xl border-2 border-dashed p-10 sm:p-12 text-center cursor-pointer transition-colors ${
          dragOver
            ? "border-[hsl(25,95%,53%)] bg-orange-50/60"
            : "border-border/60 hover:border-border bg-muted/20"
        }`}
      >
        <Upload className="mx-auto h-10 w-10 text-muted-foreground/60 mb-3" />
        <p className="text-base font-semibold text-foreground">
          Drop invoice PDFs here or click to browse
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          PDF or image · max 2 files · 5MB each
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) onAddFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      <p className="text-xs text-muted-foreground text-center">
        We accept Sysco, US Foods, Performance Food, and most other vendor invoices.
      </p>

      {queued.length > 0 && (
        <ul className="space-y-2">
          {queued.map((q, i) => (
            <li
              key={`${q.filename}-${i}`}
              className="flex items-center gap-3 rounded-lg border border-border/50 px-3 py-2"
            >
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{q.filename}</p>
                <p className="text-[11px] text-muted-foreground">
                  {q.file_type} · {(q.file.size / 1024).toFixed(0)} KB
                </p>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveFile(i);
                }}
                className="text-muted-foreground/60 hover:text-destructive"
                aria-label="Remove file"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {errorMessage && (
        <p className="text-sm text-destructive text-center">{errorMessage}</p>
      )}

      <div className="flex flex-col gap-2">
        <Button
          size="lg"
          disabled={queued.length === 0}
          onClick={onAnalyze}
          className="bg-gradient-orange shadow-orange text-white gap-2 hover:opacity-90"
        >
          Analyze My Invoices <ArrowRight className="h-4 w-4" />
        </Button>
        <p className="text-[11px] text-muted-foreground text-center">
          Your invoices are analyzed and immediately discarded. We never store them.
        </p>
      </div>
    </div>
  );
}

// ── Processing screen ─────────────────────────────────────────────────────
function ProcessingScreen({ message }: { message: string }) {
  return (
    <div className="py-20 flex flex-col items-center justify-center text-center animate-fade-in">
      <Loader2 className="h-10 w-10 animate-spin text-[hsl(25,95%,53%)]" />
      <p className="mt-6 text-base font-semibold text-foreground">{message}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        This usually takes 5–15 seconds.
      </p>
    </div>
  );
}

function itemEstimatedWeeklyLoss(lineTotal: number, lossRate: number): number {
  return lineTotal * lossRate;
}

function realNumberSteps() {
  return [
    {
      icon: FileText,
      label: "Step 1",
      title: "All your invoices",
      desc: "Forward every vendor invoice to your unique Margin6 email address. We parse them automatically.",
    },
    {
      icon: ClipboardList,
      label: "Step 2",
      title: "One inventory count",
      desc: "Count your stock once. Takes 15 minutes. Shows exactly what you have vs what you should have.",
    },
    {
      icon: BarChart3,
      label: "Step 3",
      title: "This week's sales",
      desc: "Enter your gross sales for the week. Takes 2 minutes. Unlocks your real food cost percentage.",
    },
  ] as const;
}

// ── Results screen ────────────────────────────────────────────────────────
function ResultsScreen({
  result,
  onDownloadPdf,
  onReset,
}: {
  result: AuditResult;
  onDownloadPdf: () => void;
  onReset: () => void;
}) {
  const lossRatePct = Math.round(result.loss_rate * 1000) / 10;
  const steps = realNumberSteps();

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {todayLabel()}
        </p>
        <h1 className="mt-1 text-2xl sm:text-3xl font-extrabold tracking-tight">
          Your Leak Report
        </h1>
      </div>

      <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
        <Info className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
        <p className="text-sm text-amber-800">
          This is an estimate based on industry averages — not your real loss number. Upload all
          your invoices, do one inventory count, and enter your weekly sales to see your exact
          number.
        </p>
      </div>

      <div className="rounded-2xl border border-destructive/20 bg-gradient-to-br from-destructive/5 to-transparent p-7 text-center">
        <div className="flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-wider text-destructive/80">
          <TrendingDown className="h-3.5 w-3.5" />
          Estimated weekly leak
        </div>
        <p className="mt-3 text-5xl sm:text-6xl font-extrabold tracking-tight tabular-nums text-destructive">
          {fmtUsd(result.estimated_weekly_leak)}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          based on the invoice{result.invoices_parsed === 1 ? "" : "s"} you uploaded
        </p>
      </div>

      <div className="rounded-xl border border-border/50 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Total invoice spend analyzed</span>
          <span className="text-sm font-bold font-mono tabular-nums">
            {fmtUsd(result.total_spend)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Estimated weekly loss rate</span>
          <span className="text-sm font-bold font-mono tabular-nums">
            {lossRatePct.toFixed(0)}% (industry average)
          </span>
        </div>
        <div className="flex items-center justify-between border-t pt-3">
          <span className="text-sm font-semibold">Your estimated weekly leak</span>
          <span className="text-base font-bold font-mono tabular-nums text-destructive">
            {fmtUsd(result.estimated_weekly_leak)}
          </span>
        </div>
      </div>

      <div className="rounded-xl border border-border/50 p-5">
        <h2 className="text-sm font-bold tracking-tight">
          Estimated loss by item
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Each item&apos;s share of your {lossRatePct.toFixed(0)}% estimated weekly leak
        </p>
        {result.top_items.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            We couldn&apos;t extract individual line items from that invoice.
          </p>
        ) : (
          <ol className="mt-4 space-y-4">
            {result.top_items.map((it, i) => {
              const estLoss = itemEstimatedWeeklyLoss(it.line_total, result.loss_rate);
              const barWidth =
                result.total_spend > 0
                  ? Math.min(100, (it.line_total / result.total_spend) * 100)
                  : 0;

              return (
                <li key={`${it.item_name}-${i}`} className="space-y-2">
                  <div className="flex items-start gap-3">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[11px] font-bold text-muted-foreground tabular-nums shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{it.item_name}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {it.vendor_name}
                      </p>
                    </div>
                    <div className="text-right shrink-0 space-y-0.5">
                      <p className="text-[11px] text-muted-foreground tabular-nums">
                        Spend: {fmtUsd(it.line_total, 0)}
                      </p>
                      <p className="text-xs font-semibold tabular-nums text-[hsl(25,95%,53%)]">
                        Loss est: ~{fmtUsd(estLoss, 0)}
                      </p>
                    </div>
                  </div>
                  <div className="ml-9 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[hsl(25,95%,53%)]"
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-bold tracking-tight text-center">
          Want your real number?
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {steps.map((step) => (
            <div
              key={step.label}
              className="rounded-xl border border-border/50 p-4 space-y-2"
            >
              <step.icon className="h-5 w-5 text-[hsl(25,95%,53%)]" />
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {step.label}
              </p>
              <p className="text-sm font-bold">{step.title}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{step.desc}</p>
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
          <p className="text-sm font-semibold text-emerald-900 mb-2">
            After these 3 steps Margin6 shows you:
          </p>
          <ul className="space-y-1.5 text-sm text-emerald-800">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-600" />
              Exact dollar amount lost — not an estimate
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-600" />
              Which vendor raised prices on you
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-600" />
              Which items are bleeding money
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-600" />
              Your real food cost percentage
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-600" />
              What to fix first this week
            </li>
          </ul>
        </div>
      </div>

      <div className="rounded-xl border border-amber-200/70 bg-amber-50/80 p-4 dark:border-amber-800/50 dark:bg-amber-950/30">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="h-5 w-5 text-amber-700 dark:text-amber-300 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-900 dark:text-amber-100">
            Restaurants that track food cost weekly reduce losses by{" "}
            <strong>23% on average</strong> within 90 days.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <Link to="/signup">
          <Button
            size="lg"
            className="w-full bg-gradient-orange shadow-orange text-white gap-2 hover:opacity-90"
          >
            Get My Real Number Free <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
        <p className="text-[11px] text-muted-foreground text-center">
          14-day free trial · No credit card
        </p>
        <Button
          size="lg"
          variant="outline"
          onClick={onDownloadPdf}
          className="w-full gap-2"
        >
          <Download className="h-4 w-4" />
          Download This Estimate (PDF)
        </Button>
      </div>

      <button
        type="button"
        onClick={onReset}
        className="block mx-auto text-xs text-muted-foreground hover:text-foreground underline"
      >
        Audit another invoice
      </button>
    </div>
  );
}

// ── PDF generator (jspdf) ─────────────────────────────────────────────────
async function generateLeakAuditPdf(result: AuditResult) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 48;
  const accent: [number, number, number] = [249, 115, 22]; // Tailwind orange-500
  const destructive: [number, number, number] = [220, 38, 38];
  const muted: [number, number, number] = [107, 114, 128];
  const dark: [number, number, number] = [17, 24, 39];

  let y = margin;

  // Header bar
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 56, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Margin6", margin, 35);
  doc.setTextColor(...accent);
  doc.text(" · ", margin + doc.getTextWidth("Margin6"), 35);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.text(
    "Free Leak Audit Report",
    margin + doc.getTextWidth("Margin6  ·  "),
    35,
  );

  y = 90;

  // Date
  doc.setTextColor(...muted);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(todayLabel(), margin, y);

  y += 30;

  // Hero
  doc.setTextColor(...muted);
  doc.setFontSize(9);
  doc.text("ESTIMATED WEEKLY FOOD COST LEAK", margin, y);
  y += 18;
  doc.setTextColor(...destructive);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(34);
  doc.text(fmtUsd(result.estimated_weekly_leak), margin, y);

  y += 22;

  // Estimate disclaimer
  doc.setFillColor(254, 243, 199);
  doc.setDrawColor(253, 230, 138);
  const disclaimerLines = doc.splitTextToSize(
    "⚠ ESTIMATE ONLY: This figure is based on the industry-average 8% food cost loss rate applied to your invoice spend. Your actual losses may be significantly higher or lower. To find your real number, sign up free at margin6.com",
    pageWidth - margin * 2 - 20,
  );
  const disclaimerHeight = disclaimerLines.length * 12 + 16;
  doc.roundedRect(margin, y, pageWidth - margin * 2, disclaimerHeight, 6, 6, "FD");
  doc.setTextColor(146, 64, 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(disclaimerLines, margin + 10, y + 14);
  y += disclaimerHeight + 16;

  // Breakdown table
  doc.setTextColor(...dark);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Breakdown", margin, y);
  y += 14;

  const breakdownRows: Array<[string, string]> = [
    ["Spend analyzed", fmtUsd(result.total_spend, 2)],
    [
      "Loss rate",
      `${Math.round(result.loss_rate * 1000) / 10}% (industry average)`,
    ],
    ["Weekly leak", fmtUsd(result.estimated_weekly_leak, 2)],
  ];

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  for (const [label, value] of breakdownRows) {
    doc.setDrawColor(229, 231, 235);
    doc.line(margin, y + 6, pageWidth - margin, y + 6);
    doc.setTextColor(...muted);
    doc.text(label, margin, y);
    doc.setTextColor(...dark);
    doc.text(value, pageWidth - margin, y, { align: "right" });
    y += 20;
  }

  y += 14;

  // Top 5 items
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...dark);
  doc.text("Top 5 items — estimated weekly loss", margin, y);
  y += 14;

  if (result.top_items.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(10);
    doc.setTextColor(...muted);
    doc.text("No line items were extracted.", margin, y);
    y += 20;
  } else {
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...muted);
    doc.text("ITEM", margin, y);
    doc.text("SPEND", pageWidth - margin - 120, y, { align: "right" });
    doc.text("EST. LOSS", pageWidth - margin, y, { align: "right" });
    y += 12;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...dark);
    for (const it of result.top_items) {
      doc.setDrawColor(229, 231, 235);
      doc.line(margin, y + 6, pageWidth - margin, y + 6);
      const name = it.item_name.length > 32 ? `${it.item_name.slice(0, 29)}…` : it.item_name;
      const vendor = it.vendor_name.length > 28 ? `${it.vendor_name.slice(0, 25)}…` : it.vendor_name;
      const estLoss = itemEstimatedWeeklyLoss(it.line_total, result.loss_rate);
      doc.text(name, margin, y);
      doc.setTextColor(...muted);
      doc.setFontSize(8);
      doc.text(vendor, margin, y + 10);
      doc.setFontSize(10);
      doc.setTextColor(...dark);
      doc.text(fmtUsd(it.line_total, 2), pageWidth - margin - 120, y, { align: "right" });
      doc.setTextColor(...accent);
      doc.text(`~${fmtUsd(estLoss, 2)}`, pageWidth - margin, y, { align: "right" });
      doc.setTextColor(...dark);
      y += 24;
    }
  }

  y += 10;

  doc.setTextColor(...muted);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const exactLossLines = doc.splitTextToSize(
    "To find your exact loss: upload all invoices + complete one inventory count + enter weekly sales at margin6.com — takes under 10 minutes.",
    pageWidth - margin * 2,
  );
  doc.text(exactLossLines, margin, y);
  y += exactLossLines.length * 12 + 8;

  // Insight callout
  doc.setFillColor(254, 243, 199);
  doc.roundedRect(margin, y, pageWidth - margin * 2, 56, 8, 8, "F");
  doc.setTextColor(120, 53, 15);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Track weekly. Lose less.", margin + 14, y + 22);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(
    "Restaurants that track food cost weekly reduce losses by 23%",
    margin + 14,
    y + 38,
  );
  doc.text("on average within 90 days.", margin + 14, y + 50);

  y += 80;

  // Footer CTA
  doc.setTextColor(...dark);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Want to track this automatically every week?", margin, y);
  y += 18;
  doc.setTextColor(...accent);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Sign up free at margin6.com/signup", margin, y);

  y += 32;
  doc.setTextColor(...muted);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.text(
    "Estimate based on industry-average 8% food cost loss rate. Actual losses may vary.",
    margin,
    y,
  );

  const filename = `margin6-leak-audit-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}
