export interface FailedRow {
  id: string;
  contentId: string;
  bundleId: string;
  channel: string;
  requestsAtRisk: number;
  matchedBy: string;
  segment: string;
  title: string;
  series: string;
  season: string;
  episode: string;
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
  // tab state
  activeTab?: 'content' | 'urls' | 'hits';
  searchVal?: string;
  hitsRows?: ContentHit[];
  hitsLoading?: boolean;
  hitsLoaded?: boolean;
  hitsOffset?: number;
  hitsHasMore?: boolean;
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
  prevTotalRequests?: number;
  prevTotalRequestsAtRisk?: number;
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

export interface PlatformSummaryCategory {
  matchedBy: string;
  requests:  number;
  served:    number;
  failed:    number;
  pct:       number;
  type:      'deep' | 'shallow' | 'fail';
}

export interface PlatformSummaryUnmatchedUrl {
  bundleId:     string;
  requests:     number;
  contentCount: number;
}

export interface PlatformSummaryResponse {
  platform:        string;
  dateFrom:        string;
  dateTo:          string;
  totalRequests:   number;
  successCount:    number;
  failedCount:     number;
  enrichableCount: number;
  deepRequests:    number;
  shallowRequests: number;
  unknownRequests: number;
  categories:      PlatformSummaryCategory[];
  unmatchedUrls:   PlatformSummaryUnmatchedUrl[];
}

export interface PeriodStat {
  dateFrom:      string;
  dateTo:        string;
  totalRequests: number;
  failedCount:   number;
  successCount:  number;
  successRate:   number;
}

export interface PeriodComparison {
  currentPeriod:  PeriodStat;
  previousPeriod: PeriodStat;
  deltaRate: number;   // positive = better (higher success rate)
  deltaReqs: number;   // positive = more requests served
}

export interface ContentHit {
  contentId: string;
  hits:      number;
  title:     string;
  series:    string;
}

export interface ContentHitsResponse {
  rows:    ContentHit[];
  hasMore: boolean;
}

export interface FailureQueueFilters {
  dateFrom: string;
  dateTo: string;
  platforms: string[];   // multi-select; empty = all
  channel: string;
  brandSafe: string;
  region?: string;       // 'all' | 'EU' | 'USE' | 'USW' | 'APAC'
}
