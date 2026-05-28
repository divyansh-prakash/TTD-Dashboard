import {
  Component, Input, OnInit, OnChanges, OnDestroy,
  SimpleChanges, ViewChild, ElementRef, PLATFORM_ID, inject, signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../../services/api.service';
import { FailureQueueFilters } from '../../../models/failure-queue.model';
import {
  Chart, BarController, BarElement,
  LinearScale, CategoryScale, Tooltip, Legend,
} from 'chart.js';

Chart.register(BarController, BarElement, LinearScale, CategoryScale, Tooltip, Legend);

const BAR_COLORS: Record<string, string> = {
  total:   '#3b82f6',
  success: '#2d9b6f',
  failed:  '#ef4444',
};

@Component({
  selector: 'app-trend-graph',
  standalone: true,
  imports: [],
  templateUrl: './trend-graph.component.html',
  styleUrl: './trend-graph.component.scss',
})
export class TrendGraphComponent implements OnInit, OnChanges, OnDestroy {
  @Input() filters!: FailureQueueFilters;
  @ViewChild('trendCanvas') trendCanvasRef!: ElementRef<HTMLCanvasElement>;

  loading = signal(false);

  private chart: Chart | null = null;
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private cancel$ = new Subject<void>();
  private destroy$ = new Subject<void>();

  constructor(private api: ApiService) {}

  ngOnInit() {
    if (this.isBrowser) this.load();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['filters'] && !changes['filters'].firstChange && this.isBrowser) {
      this.load();
    }
  }

  ngOnDestroy() {
    this.cancel$.complete();
    this.destroy$.complete();
    this.chart?.destroy();
  }

  get platformLabel(): string {
    return this.filters?.platforms?.length === 1 ? this.filters.platforms[0] : '';
  }

  load() {
    this.cancel$.next();
    this.loading.set(true);
    this.api.getTrend(this.filters)
      .pipe(takeUntil(this.cancel$), takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.loading.set(false);
          setTimeout(() => this.renderChart(res.dates, res.series, res.granularity), 0);
        },
        error: () => this.loading.set(false),
      });
  }

  private renderChart(
    dates: string[],
    series: { name: string; data: number[] }[],
    granularity: 'daily' | 'hourly',
  ) {
    if (!this.trendCanvasRef?.nativeElement) return;
    const ctx = this.trendCanvasRef.nativeElement.getContext('2d');
    if (!ctx) return;

    this.chart?.destroy();

    // Extract Total and Failed, compute Success = Total - Failed
    const totalS  = series.find(s => s.name.toLowerCase().includes('total'));
    const failedS = series.find(s => s.name.toLowerCase().includes('failed'));
    const label   = this.platformLabel || 'All Platforms';

    const totalData   = totalS?.data  ?? [];
    const failedData  = failedS?.data ?? [];
    const successData = totalData.map((t, i) => Math.max(0, t - (failedData[i] ?? 0)));

    const fmtVal = (v: number) =>
      v >= 1_000_000 ? (v / 1_000_000).toFixed(1) + 'M'
    : v >= 1_000     ? (v / 1_000).toFixed(1) + 'K'
    : String(v);

    this.chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: dates,
        datasets: [
          {
            label: `${label} — Total`,
            data: totalData,
            backgroundColor: BAR_COLORS['total'] + 'cc',
            borderColor: BAR_COLORS['total'],
            borderWidth: 1,
            borderRadius: 2,
            categoryPercentage: 0.9,
            barPercentage: 1.0,
          },
          {
            label: `${label} — Success`,
            data: successData,
            backgroundColor: BAR_COLORS['success'] + 'cc',
            borderColor: BAR_COLORS['success'],
            borderWidth: 1,
            borderRadius: 2,
            categoryPercentage: 0.9,
            barPercentage: 1.0,
          },
          {
            label: `${label} — Failed`,
            data: failedData,
            backgroundColor: BAR_COLORS['failed'] + 'cc',
            borderColor: BAR_COLORS['failed'],
            borderWidth: 1,
            borderRadius: 2,
            categoryPercentage: 0.9,
            barPercentage: 1.0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, position: 'top', labels: { boxWidth: 12, font: { size: 12 } } },
          tooltip: {
            callbacks: {
              label: (c) => ` ${c.dataset.label}: ${fmtVal(c.parsed.y ?? 0)}`,
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
              callback: (v) => fmtVal(Number(v ?? 0)),
            },
          },
        },
      },
    });
  }
}
