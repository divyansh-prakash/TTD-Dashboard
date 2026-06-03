import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ByPlatformResponse, FilterOptions, FailureQueueFilters, TrendResponse, PlatformDetailResponse, PlatformSummaryResponse, ContentHit, ContentHitsResponse, PeriodComparison, SegmentRankingsResponse, SegmentDetail, PlatformSegmentItem } from '../models/failure-queue.model';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private base = 'http://localhost:3000/api';

  constructor(private http: HttpClient) { }

  private addRegion(params: HttpParams, filters: Partial<FailureQueueFilters>): HttpParams {
    if (filters.region && filters.region !== 'all') params = params.set('region', filters.region);
    return params;
  }

  getByPlatform(filters: Partial<FailureQueueFilters>, offset = 0, limit = 25): Observable<ByPlatformResponse> {
    let params = new HttpParams();
    if (filters.dateFrom) params = params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo)   params = params.set('dateTo',   filters.dateTo);
    if (filters.platforms?.length) filters.platforms.forEach(p => { params = params.append('platforms', p); });
    if (filters.channel && filters.channel !== 'all') params = params.set('channel', filters.channel);
    if (filters.brandSafe && filters.brandSafe !== 'all') params = params.set('brandSafe', filters.brandSafe);
    params = this.addRegion(params, filters);
    params = params.set('offset', String(offset)).set('limit', String(limit));
    return this.http.get<ByPlatformResponse>(`${this.base}/failure-queue/by-platform`, { params });
  }

  getPlatformSummary(platform: string, filters: Partial<FailureQueueFilters>): Observable<PlatformSummaryResponse> {
    let params = new HttpParams().set('platform', platform);
    if (filters.dateFrom) params = params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo)   params = params.set('dateTo',   filters.dateTo);
    params = this.addRegion(params, filters);
    return this.http.get<PlatformSummaryResponse>(`${this.base}/failure-queue/by-platform/summary`, { params });
  }

  getPlatformDetail(
    platform: string,
    filters: Partial<FailureQueueFilters>,
    matchedBy?: string,
    offset = 0,
    limit = 25,
    enrichable = false,
    search = '',
  ): Observable<PlatformDetailResponse> {
    let params = new HttpParams().set('platform', platform);
    if (filters.dateFrom) params = params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo)   params = params.set('dateTo',   filters.dateTo);
    if (filters.brandSafe && filters.brandSafe !== 'all') params = params.set('brandSafe', filters.brandSafe);
    if (matchedBy) params = params.set('matchedBy', matchedBy);
    if (enrichable) params = params.set('enrichable', 'true');
    if (search) params = params.set('search', search);
    params = this.addRegion(params, filters);
    params = params.set('offset', String(offset)).set('limit', String(limit));
    return this.http.get<PlatformDetailResponse>(`${this.base}/failure-queue/by-platform/detail`, { params });
  }

  getFilterOptions(): Observable<FilterOptions> {
    return this.http.get<FilterOptions>(`${this.base}/failure-queue/filters/options`);
  }

  downloadCsv(platform: string, filters: Partial<FailureQueueFilters>, type: 'all' | 'enrichable' | 'failed', matchedBy?: string): Observable<Blob> {
    let params = new HttpParams().set('platform', platform).set('type', type);
    if (filters.dateFrom)  params = params.set('dateFrom',  filters.dateFrom);
    if (filters.dateTo)    params = params.set('dateTo',    filters.dateTo);
    if (filters.brandSafe && filters.brandSafe !== 'all') params = params.set('brandSafe', filters.brandSafe);
    if (matchedBy) params = params.set('matchedBy', matchedBy);
    params = this.addRegion(params, filters);
    return this.http.get(`${this.base}/failure-queue/by-platform/download`, { params, responseType: 'blob' });
  }

  getPeriodComparison(filters: Partial<FailureQueueFilters>): Observable<PeriodComparison> {
    let params = new HttpParams();
    if (filters.dateFrom) params = params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo)   params = params.set('dateTo',   filters.dateTo);
    if (filters.brandSafe && filters.brandSafe !== 'all') params = params.set('brandSafe', filters.brandSafe);
    if (filters.platforms?.length) filters.platforms.forEach(p => { params = params.append('platforms', p); });
    params = this.addRegion(params, filters);
    return this.http.get<PeriodComparison>(`${this.base}/failure-queue/comparison`, { params });
  }

  getContentHits(platform: string, filters: Partial<FailureQueueFilters>, matchedBy: string, offset = 0, limit = 50): Observable<ContentHitsResponse> {
    let params = new HttpParams().set('platform', platform).set('matchedBy', matchedBy)
      .set('offset', String(offset)).set('limit', String(limit));
    if (filters.dateFrom) params = params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo)   params = params.set('dateTo',   filters.dateTo);
    params = this.addRegion(params, filters);
    return this.http.get<ContentHitsResponse>(`${this.base}/failure-queue/by-platform/hits`, { params });
  }

  getPlatformSegmentCounts(filters: Partial<FailureQueueFilters>): Observable<Record<string, number>> {
    let params = new HttpParams();
    if (filters.dateFrom) params = params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo)   params = params.set('dateTo',   filters.dateTo);
    params = this.addRegion(params, filters);
    return this.http.get<Record<string, number>>(`${this.base}/failure-queue/platform-segment-counts`, { params });
  }

  getPlatformSegmentDetail(platform: string, filters: Partial<FailureQueueFilters>): Observable<PlatformSegmentItem[]> {
    let params = new HttpParams().set('platform', platform);
    if (filters.dateFrom) params = params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo)   params = params.set('dateTo',   filters.dateTo);
    params = this.addRegion(params, filters);
    return this.http.get<PlatformSegmentItem[]>(`${this.base}/failure-queue/platform-segment-detail`, { params });
  }

  getSegmentRankings(filters: Partial<FailureQueueFilters>, n = 10): Observable<SegmentRankingsResponse> {
    let params = new HttpParams().set('n', String(n));
    if (filters.dateFrom) params = params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo)   params = params.set('dateTo',   filters.dateTo);
    params = this.addRegion(params, filters);
    return this.http.get<SegmentRankingsResponse>(`${this.base}/failure-queue/segment-rankings`, { params });
  }

  getSegmentDetail(segment: string, filters: Partial<FailureQueueFilters>): Observable<SegmentDetail> {
    let params = new HttpParams().set('segment', segment);
    if (filters.dateFrom) params = params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo)   params = params.set('dateTo',   filters.dateTo);
    params = this.addRegion(params, filters);
    return this.http.get<SegmentDetail>(`${this.base}/failure-queue/segment-detail`, { params });
  }

  getTrend(filters: Partial<FailureQueueFilters>): Observable<TrendResponse> {
    let params = new HttpParams();
    if (filters.dateFrom) params = params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo)   params = params.set('dateTo',   filters.dateTo);
    if (filters.platforms?.length === 1) params = params.set('platform', filters.platforms[0]);
    if (filters.brandSafe && filters.brandSafe !== 'all') params = params.set('brandSafe', filters.brandSafe);
    params = this.addRegion(params, filters);
    return this.http.get<TrendResponse>(`${this.base}/failure-queue/trend`, { params });
  }
}
