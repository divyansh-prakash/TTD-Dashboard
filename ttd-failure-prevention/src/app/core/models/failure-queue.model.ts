export interface FailedRow {
  id: string;
  contentId: string;
  bundleId: string;
  channel: string;
  requestsAtRisk: number;
  matchedBy: string;
  isbrandsafe: number;
  rootCauses: string[];
}

export interface UrlSummary {
  bundleId: string;
  totalRequestsAtRisk: number;
  hitCount: number;
}

export interface MatchedByGroup {
  matchedBy: string;
  failedCount: number;
  totalRequestsAtRisk: number;
  totalRequestsServed?: number;
  totalRequests?: number;
  enrichable?: boolean;
  sortDesc?: boolean;
  rows: FailedRow[];
  expanded?: boolean;
  detailLoaded?: boolean;
  detailLoading?: boolean;
  detailLoadingMore?: boolean;
  detailOffset?: number;
  detailHasMore?: boolean;
}

export interface HealthyGroup {
  matchedBy: string;
  totalRequestsServed: number;
}

export interface PlatformDetailResponse {
  rows: FailedRow[];
  meta: { offset: number; limit: number; hasMore: boolean };
}

export interface PlatformGroup {
  name: string;
  failedCount: number;
  totalRequestsAtRisk: number;
  totalRequests: number;
  directServedRequests?: number;
  rows: FailedRow[];
  urlSummary?: UrlSummary[];
  matchedByGroups?: MatchedByGroup[];
  healthyGroups?: HealthyGroup[];
  expanded?: boolean;
  othersTab?: 'content' | 'urls';
  detailLoaded?: boolean;
  detailLoading?: boolean;
}

export interface ByPlatformResponse {
  platforms: PlatformGroup[];
  meta: { dateFrom: string; dateTo: string; rowCount: number; total: number; offset: number; limit: number };
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
