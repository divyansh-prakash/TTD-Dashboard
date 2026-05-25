import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ByPlatformResponse, FilterOptions, FailureQueueFilters, TrendResponse } from '../models/failure-queue.model';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private base = 'http://localhost:3000/api';

  constructor(private http: HttpClient) {}

  getByPlatform(filters: Partial<FailureQueueFilters>): Observable<ByPlatformResponse> {
    let params = new HttpParams();
    if (filters.dateFrom) params = params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo)   params = params.set('dateTo',   filters.dateTo);
    if (filters.platforms?.length) {
      filters.platforms.forEach(p => { params = params.append('platforms', p); });
    }
    if (filters.channel   && filters.channel   !== 'all') params = params.set('channel',   filters.channel);
    if (filters.brandSafe && filters.brandSafe !== 'all') params = params.set('brandSafe', filters.brandSafe);
    return this.http.get<ByPlatformResponse>(`${this.base}/failure-queue/by-platform`, { params });
  }

  getFilterOptions(): Observable<FilterOptions> {
    return this.http.get<FilterOptions>(`${this.base}/failure-queue/filters/options`);
  }

  getTrend(filters: Partial<FailureQueueFilters>): Observable<TrendResponse> {
    let params = new HttpParams();
    if (filters.dateFrom) params = params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo)   params = params.set('dateTo',   filters.dateTo);
    if (filters.platforms?.length === 1) params = params.set('platform', filters.platforms[0]);
    if (filters.brandSafe && filters.brandSafe !== 'all') params = params.set('brandSafe', filters.brandSafe);
    return this.http.get<TrendResponse>(`${this.base}/failure-queue/trend`, { params });
  }
}
