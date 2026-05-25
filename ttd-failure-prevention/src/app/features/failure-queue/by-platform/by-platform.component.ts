import { Component, OnInit, OnDestroy, signal, computed, PLATFORM_ID, inject, ElementRef, ViewChild } from '@angular/core';
import { isPlatformBrowser, CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { PlatformGroup, FailureQueueFilters } from '../../../core/models/failure-queue.model';
import { Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip, Legend } from 'chart.js';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip, Legend);

const LINE_COLORS = [
  '#2d9b6f', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#10b981', '#f97316', '#6366f1',
];

@Component({
  selector: 'app-by-platform',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './by-platform.component.html',
  styleUrl: './by-platform.component.scss',
})
export class ByPlatformComponent implements OnInit, OnDestroy {
  @ViewChild('trendCanvas') trendCanvasRef!: ElementRef<HTMLCanvasElement>;

  loading      = signal(false);
  trendLoading = signal(false);
  error        = signal('');
  platforms    = signal<PlatformGroup[]>([]);
  filterPlatforms = signal<string[]>([]);
  meta = signal<{ dateFrom: string; dateTo: string; rowCount: number } | null>(null);

  dateRange = '7';

  readonly dateRangeOptions = [
    { label: 'Today',        value: '0' },
    { label: 'Yesterday',    value: '1' },
    { label: 'Last 7 days',  value: '7' },
    { label: 'Last 30 days', value: '30' },
  ];

  filters: FailureQueueFilters = {
    dateFrom:  this.nDaysAgo(7),
    dateTo:    this.today(),
    platforms: [],
    channel:   '',
    brandSafe: 'all',
  };

  platformsOpen = signal(false);

  get platformFilterLabel(): string {
    const len = this.filters.platforms.length;
    if (len === 0) return 'All Platforms';
    if (len === 1) return this.filters.platforms[0];
    return `${len} selected`;
  }

  totalAtRisk = computed(() => this.platforms().reduce((s, p) => s + p.totalRequestsAtRisk, 0));
  totalFailed = computed(() => this.platforms().reduce((s, p) => s + p.failedCount, 0));

  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private chart: Chart | null = null;

  // Emitting on these cancels any in-flight request for that stream
  private cancelTable$ = new Subject<void>();
  private cancelTrend$ = new Subject<void>();
  private destroy$     = new Subject<void>();

  constructor(private api: ApiService) {}

  ngOnInit() {
    if (!this.isBrowser) return;
    this.loadOptions();
    this.load();
  }

  ngOnDestroy() {
    this.cancelTable$.complete();
    this.cancelTrend$.complete();
    this.destroy$.next();
    this.destroy$.complete();
    this.chart?.destroy();
  }

  loadOptions() {
    this.api.getFilterOptions().pipe(takeUntil(this.destroy$)).subscribe({
      next: (opts) => this.filterPlatforms.set(opts.platforms),
      error: () => {},
    });
  }

  load() {
    this.loadTable();
    this.loadTrend();
  }

  private loadTable() {
    // Cancel any previous in-flight table request
    this.cancelTable$.next();

    this.loading.set(true);
    this.error.set('');
    this.api.getByPlatform(this.filters)
      .pipe(takeUntil(this.cancelTable$), takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.platforms.set(res.platforms.map(p => ({ ...p, expanded: false })));
          this.meta.set(res.meta);
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set(err?.error?.error || 'Failed to load data');
          this.loading.set(false);
        },
      });
  }

  private loadTrend() {
    // Cancel any previous in-flight trend request
    this.cancelTrend$.next();

    this.trendLoading.set(true);
    this.api.getTrend(this.filters)
      .pipe(takeUntil(this.cancelTrend$), takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.trendLoading.set(false);
          setTimeout(() => this.renderChart(res.dates, res.series, res.granularity), 0);
        },
        error: () => this.trendLoading.set(false),
      });
  }

  private renderChart(
    dates: string[],
    series: { name: string; data: number[] }[],
    granularity: 'daily' | 'hourly'
  ) {
    if (!this.trendCanvasRef?.nativeElement) return;
    const ctx = this.trendCanvasRef.nativeElement.getContext('2d');
    if (!ctx) return;

    this.chart?.destroy();

    const isSingle = series.length === 1;

    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: dates,
        datasets: series.map((s, i) => ({
          label:           s.name,
          data:            s.data,
          borderColor:     LINE_COLORS[i % LINE_COLORS.length],
          backgroundColor: LINE_COLORS[i % LINE_COLORS.length] + '18',
          borderWidth:     2,
          pointRadius:     granularity === 'hourly' ? 2 : 3,
          pointHoverRadius:5,
          tension:         0.3,
          fill:            isSingle,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: !isSingle,
            position: 'top',
            labels: { boxWidth: 12, font: { size: 12 } },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const v = ctx.parsed.y ?? 0;
                const fmt = v >= 1_000_000 ? (v / 1_000_000).toFixed(1) + 'M'
                          : v >= 1_000     ? (v / 1_000).toFixed(1) + 'K'
                          : String(v);
                return ` ${ctx.dataset.label}: ${fmt}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(0,0,0,.04)' },
            ticks: { font: { size: 11 }, maxTicksLimit: granularity === 'hourly' ? 12 : undefined },
          },
          y: {
            grid: { color: 'rgba(0,0,0,.04)' },
            ticks: {
              font: { size: 11 },
              callback: (v) => {
                const n = Number(v ?? 0);
                return n >= 1_000_000 ? (n / 1_000_000).toFixed(1) + 'M'
                     : n >= 1_000     ? (n / 1_000).toFixed(0) + 'K'
                     : String(n);
              },
            },
          },
        },
      },
    });
  }

  togglePlatform(platform: PlatformGroup) {
    this.platforms.update(list =>
      list.map(p => p.name === platform.name ? { ...p, expanded: !p.expanded } : p)
    );
  }

  expandAll()   { this.platforms.update(l => l.map(p => ({ ...p, expanded: true  }))); }
  collapseAll() { this.platforms.update(l => l.map(p => ({ ...p, expanded: false }))); }

  applyFilters() {
    this.platformsOpen.set(false);
    if (this.dateRange === '1') {
      this.filters.dateFrom = this.nDaysAgo(1);
      this.filters.dateTo   = this.nDaysAgo(1);
    } else {
      const days = parseInt(this.dateRange, 10);
      this.filters.dateFrom = this.nDaysAgo(days);
      this.filters.dateTo   = this.today();
    }
    this.load();
  }

  togglePlatformsDropdown() { this.platformsOpen.update(v => !v); }
  closePlatformsDropdown() { this.platformsOpen.set(false); }

  isPlatformSelected(p: string): boolean { return this.filters.platforms.includes(p); }

  togglePlatformFilter(p: string) {
    const idx = this.filters.platforms.indexOf(p);
    this.filters.platforms = idx >= 0
      ? this.filters.platforms.filter(x => x !== p)
      : [...this.filters.platforms, p];
  }

  clearPlatformFilter() { this.filters.platforms = []; }

  resetFilters() {
    this.dateRange = '7';
    this.filters = { dateFrom: this.nDaysAgo(7), dateTo: this.today(), platforms: [], channel: '', brandSafe: 'all' };
    this.platformsOpen.set(false);
    this.load();
  }

  formatNumber(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
    return n.toString();
  }

  private today()           { return new Date().toISOString().slice(0, 10); }
  private nDaysAgo(n: number) { return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10); }
}
