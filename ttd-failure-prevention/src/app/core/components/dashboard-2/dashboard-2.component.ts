import { Component, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { FailureQueueFilters, PlatformGroup } from '../../models/failure-queue.model';
import { KpiCardsComponent } from './kpi-cards/kpi-cards.component';
import { RequestTrendComponent } from './request-trend/request-trend.component';
import { PlatformBreakdownComponent } from './platform-breakdown/platform-breakdown.component';

@Component({
  selector: 'app-dashboard-2',
  standalone: true,
  imports: [CommonModule, KpiCardsComponent, RequestTrendComponent, PlatformBreakdownComponent],
  templateUrl: './dashboard-2.component.html',
  styleUrl: './dashboard-2.component.scss',
})
export class Dashboard2Component implements OnDestroy {
  activePartner = 'TTD';
  dateRange     = '1';   // default: Yesterday
  region        = 'all';

  readonly partners = ['TTD', 'Pubmatic'];

  // Matching the main dashboard date options
  readonly dateOptions = [
    { label: 'Yesterday',   value: '1' },
    { label: 'Last 3 days', value: '3' },
  ];
  readonly regionOptions = [
    { label: 'All regions', value: 'all'    },
    { label: 'EU',          value: 'euc-1'  },
    { label: 'APAC',        value: 'apse-1' },
    { label: 'US East',     value: 'use-1'  },
    { label: 'US West',     value: 'usw-2'  },
  ];

  dateOpen   = signal(false);
  regionOpen = signal(false);

  // Platform data shared between KPI cards and platform table
  platformsLoading = signal(true);
  platforms        = signal<PlatformGroup[]>([]);

  appliedFilters: FailureQueueFilters = this.buildFilters();

  private destroy$ = new Subject<void>();

  constructor(private api: ApiService) {
    this.loadPlatforms();
  }

  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }

  get dateLabel():   string { return this.dateOptions.find(o => o.value === this.dateRange)?.label ?? 'Yesterday'; }
  get regionLabel(): string { return this.regionOptions.find(o => o.value === this.region)?.label ?? 'All regions'; }

  selectPartner(p: string): void { this.activePartner = p; this.apply(); }
  selectDate(v: string):    void { this.dateRange = v; this.dateOpen.set(false);   this.apply(); }
  selectRegion(v: string):  void { this.region = v;    this.regionOpen.set(false); this.apply(); }

  reset(): void {
    this.dateRange = '1'; this.region = 'all';
    this.dateOpen.set(false); this.regionOpen.set(false);
    this.apply();
  }

  private apply(): void {
    this.appliedFilters = this.buildFilters();
    this.loadPlatforms();
  }

  private loadPlatforms(): void {
    this.platformsLoading.set(true);
    // Load first 50 platforms — same endpoint as the main page
    this.api.getByPlatform(this.appliedFilters, 0, 50)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next:  res => { this.platforms.set(res.platforms); this.platformsLoading.set(false); },
        error: ()  => this.platformsLoading.set(false),
      });
  }

  private buildFilters(): FailureQueueFilters {
    const n    = parseInt(this.dateRange, 10);
    const ago  = (d: number) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    // Yesterday → from=yesterday, to=yesterday  |  Last 3 days → from=3dAgo, to=today
    const dateFrom = n === 1 ? ago(1) : ago(n);
    const dateTo   = n === 1 ? ago(1) : today;
    return { dateFrom, dateTo, platforms: [], channel: '', brandSafe: 'all', region: this.region };
  }
}
