import {
  Component, Input, OnInit, OnChanges, OnDestroy,
  SimpleChanges, ViewChild, ElementRef, PLATFORM_ID, inject, signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../../services/api.service';
import { FailureQueueFilters } from '../../../models/failure-queue.model';
import {
  Chart, LineController, LineElement, PointElement,
  LinearScale, CategoryScale, Filler, Tooltip, Legend,
} from 'chart.js';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip, Legend);

const LINE_COLORS = [
  '#ef4444', '#3b82f6', '#f59e0b', '#2d9b6f', '#8b5cf6',
  '#ec4899', '#06b6d4', '#10b981', '#f97316', '#6366f1',
];
const SERIES_COLOR_MAP: Record<string, string> = { failed: '#ef4444', total: '#3b82f6' };

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
    const isSingle = series.length === 1;

    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: dates,
        datasets: series.map((s, i) => {
          const key = Object.keys(SERIES_COLOR_MAP).find(k => s.name.toLowerCase().includes(k));
          const color = key ? SERIES_COLOR_MAP[key] : LINE_COLORS[i % LINE_COLORS.length];
          return {
            label: s.name,
            data: s.data,
            borderColor: color,
            backgroundColor: color + '18',
            borderWidth: 2,
            pointRadius: granularity === 'hourly' ? 2 : 3,
            pointHoverRadius: 5,
            tension: 0.3,
            fill: true,
          };
        }),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: !isSingle, position: 'top', labels: { boxWidth: 12, font: { size: 12 } } },
          tooltip: {
            callbacks: {
              label: (c) => {
                const v = c.parsed.y ?? 0;
                const fmt = v >= 1_000_000 ? (v / 1_000_000).toFixed(1) + 'M'
                          : v >= 1_000     ? (v / 1_000).toFixed(1) + 'K'
                          : String(v);
                return ` ${c.dataset.label}: ${fmt}`;
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
}
