import { Component, OnInit, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { FailureQueueFilters } from '../../models/failure-queue.model';
import { TrendGraphComponent } from './trend-graph/trend-graph.component';
import { PlatformQueueComponent } from './platform-queue/platform-queue.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, RouterLinkActive, TrendGraphComponent, PlatformQueueComponent],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit, OnDestroy {
  dateRange = '1';

  readonly dateRangeOptions = [
    { label: 'Today',        value: '0' },
    { label: 'Yesterday',    value: '1' },
    { label: 'Last 7 days',  value: '7' },
    { label: 'Last 30 days', value: '30' },
  ];

  // Editing state — updated freely as the user changes filter UI
  filters: FailureQueueFilters = {
    dateFrom:  this.nDaysAgo(1),
    dateTo:    this.nDaysAgo(1),
    platforms: ['Roku'],
    channel:   '',
    brandSafe: 'all',
  };

  // Applied state — new reference created on Apply/Reset; triggers child reload
  appliedFilters: FailureQueueFilters = { ...this.filters };

  filterPlatforms = signal<string[]>([]);
  platformsOpen   = signal(false);

  get platformFilterLabel(): string {
    const len = this.filters.platforms.length;
    if (len === 0) return 'All Platforms';
    if (len === 1) return this.filters.platforms[0];
    return `${len} selected`;
  }

  private destroy$ = new Subject<void>();

  constructor(private api: ApiService) {}

  ngOnInit() {
    this.api.getFilterOptions().pipe(takeUntil(this.destroy$)).subscribe({
      next: (opts) => this.filterPlatforms.set(opts.platforms),
      error: () => {},
    });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  applyFilters() {
    this.platformsOpen.set(false);
    if (this.dateRange === '0') {
      this.filters.dateFrom = this.today();
      this.filters.dateTo   = this.today();
    } else if (this.dateRange === '1') {
      this.filters.dateFrom = this.nDaysAgo(1);
      this.filters.dateTo   = this.nDaysAgo(1);
    } else {
      const days = parseInt(this.dateRange, 10);
      this.filters.dateFrom = this.nDaysAgo(days);
      this.filters.dateTo   = this.today();
    }
    this.appliedFilters = { ...this.filters };
  }

  resetFilters() {
    this.dateRange = '7';
    this.filters = { dateFrom: this.nDaysAgo(7), dateTo: this.today(), platforms: [], channel: '', brandSafe: 'all' };
    this.appliedFilters = { ...this.filters };
    this.platformsOpen.set(false);
  }

  togglePlatformsDropdown() { this.platformsOpen.update(v => !v); }
  closePlatformsDropdown()  { this.platformsOpen.set(false); }

  isPlatformSelected(p: string) { return this.filters.platforms.includes(p); }

  togglePlatformFilter(p: string) {
    const idx = this.filters.platforms.indexOf(p);
    this.filters.platforms = idx >= 0
      ? this.filters.platforms.filter(x => x !== p)
      : [...this.filters.platforms, p];
  }

  clearPlatformFilter() { this.filters.platforms = []; }

  private today()            { return new Date().toISOString().slice(0, 10); }
  private nDaysAgo(n: number){ return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10); }
}
