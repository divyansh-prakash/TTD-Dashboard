export interface FailedRow {
  contentId: string;
  bundleId: string;
  channel: string;
  requestsAtRisk: number;
  matchedBy: string;
  isbrandsafe: number;
  rootCauses: string[];
}

export interface PlatformGroup {
  name: string;
  failedCount: number;
  totalRequestsAtRisk: number;
  rows: FailedRow[];
  expanded?: boolean;
}

export interface ByPlatformResponse {
  platforms: PlatformGroup[];
  meta: { dateFrom: string; dateTo: string; rowCount: number };
}

export interface TrendSeries { name: string; data: number[]; }
export interface TrendResponse { dates: string[]; series: TrendSeries[]; granularity: 'daily' | 'hourly'; }

export interface FilterOptions {
  platforms: string[];
}

export interface FailureQueueFilters {
  dateFrom: string;
  dateTo: string;
  platforms: string[];   // multi-select; empty = all
  channel: string;
  brandSafe: string;
}
