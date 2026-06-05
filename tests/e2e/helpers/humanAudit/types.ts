export type AuditCheck = {
  page: string;
  label: string;
  uiValue: string;
  uiNumeric: number | null;
  sourceData: string;
  sourceTables?: string;
  formula: string;
  expectedValue: string;
  expectedNumeric: number | null;
  pass: boolean;
  skipped?: boolean;
  skipReason?: string;
  tolerance?: number;
  confidence?: "high" | "medium" | "low" | "unknown";
  lastUpdated?: string;
};

export type AuditReport = {
  generatedAt: string;
  baseUrl: string;
  restaurantId: string | null;
  locationId: string | null;
  timeFilter: string;
  dataSourceAvailable: boolean;
  checks: AuditCheck[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
};
