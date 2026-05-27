import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ByPlatformResponse, FilterOptions, FailureQueueFilters, TrendResponse, PlatformDetailResponse } from '../models/failure-queue.model';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private base = 'http://localhost:3000/api';

  constructor(private http: HttpClient) { }

  getByPlatform(filters: Partial<FailureQueueFilters>, offset = 0, limit = 25): Observable<ByPlatformResponse> {
    let params = new HttpParams();
    if (filters.dateFrom) params = params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo) params = params.set('dateTo', filters.dateTo);
    if (filters.platforms?.length) {
      filters.platforms.forEach(p => { params = params.append('platforms', p); });
    }
    if (filters.channel && filters.channel !== 'all') params = params.set('channel', filters.channel);
    if (filters.brandSafe && filters.brandSafe !== 'all') params = params.set('brandSafe', filters.brandSafe);
    params = params.set('offset', String(offset));
    params = params.set('limit', String(limit));
    return this.http.get<ByPlatformResponse>(`${this.base}/failure-queue/by-platform`, { params });
  }

  getPlatformDetail(
    platform: string,
    filters: Partial<FailureQueueFilters>,
    matchedBy?: string,
    offset = 0,
    limit = 25,
    enrichable = false,
  ): Observable<PlatformDetailResponse> {
    let params = new HttpParams().set('platform', platform);
    if (filters.dateFrom) params = params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo) params = params.set('dateTo', filters.dateTo);
    if (filters.brandSafe && filters.brandSafe !== 'all') params = params.set('brandSafe', filters.brandSafe);
    if (matchedBy) params = params.set('matchedBy', matchedBy);
    if (enrichable) params = params.set('enrichable', 'true');
    params = params.set('offset', String(offset));
    params = params.set('limit', String(limit));
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
    return this.http.get(`${this.base}/failure-queue/by-platform/download`, { params, responseType: 'blob' });
  }

  getTrend(filters: Partial<FailureQueueFilters>): Observable<TrendResponse> {
    let params = new HttpParams();
    if (filters.dateFrom) params = params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo) params = params.set('dateTo', filters.dateTo);
    if (filters.platforms?.length === 1) params = params.set('platform', filters.platforms[0]);
    if (filters.brandSafe && filters.brandSafe !== 'all') params = params.set('brandSafe', filters.brandSafe);
    return this.http.get<TrendResponse>(`${this.base}/failure-queue/trend`, { params });
  }
}
