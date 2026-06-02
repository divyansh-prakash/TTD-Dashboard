import {
  Component, Input, OnChanges, OnDestroy, SimpleChanges,
  ViewChild, ElementRef, signal, PLATFORM_ID, Inject,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../../services/api.service';
import { FailureQueueFilters, TrendResponse } from '../../../models/failure-queue.model';

@Component({
  selector: 'app-d2-request-trend',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './request-trend.component.html',
  styleUrl: './request-trend.component.scss',
})
export class RequestTrendComponent implements OnChanges, OnDestroy {
  @Input() filters!: FailureQueueFilters;
  @ViewChild('trendCanvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  loading = signal(true);
  trend   = signal<TrendResponse | null>(null);

  private chartInstance: any = null;
  private destroy$ = new Subject<void>();

  constructor(private api: ApiService, @Inject(PLATFORM_ID) private platformId: object) {}

  ngOnChanges(c: SimpleChanges): void { if (c['filters']) this.load(); }

  ngOnDestroy(): void {
    this.chartInstance?.destroy();
    this.destroy$.next(); this.destroy$.complete();
  }

  private load(): void {
    this.loading.set(true);
    this.api.getTrend(this.filters).pipe(takeUntil(this.destroy$)).subscribe({
      next: d => {
        this.trend.set(d); this.loading.set(false);
        if (isPlatformBrowser(this.platformId)) setTimeout(() => this.renderChart(d), 0);
      },
      error: () => this.loading.set(false),
    });
  }

  private async renderChart(d: TrendResponse): Promise<void> {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;
    const { Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip } = await import('chart.js');
    Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip);
    this.chartInstance?.destroy();
    const totalSeries  = d.series.find(s => s.name.includes('Total'))?.data ?? [];
    const failedSeries = d.series.find(s => s.name.includes('Failed'))?.data ?? [];
    const successSeries = totalSeries.map((t, i) => Math.max(0, t - (failedSeries[i] ?? 0)));
    this.chartInstance = new Chart(canvas, {
      type: 'line',
      data: {
        labels: d.dates,
        datasets: [
          { label: 'Total',      data: totalSeries,   borderColor: '#3b82f6', fill: false, tension: 0.3, borderWidth: 2, pointRadius: 3 },
          { label: 'Successful', data: successSeries, borderColor: '#2d9b6f', fill: false, tension: 0.3, borderWidth: 2, pointRadius: 3 },
          { label: 'Failed',     data: failedSeries,  borderColor: '#ef4444', fill: false, tension: 0.3, borderWidth: 2, pointRadius: 3 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
        plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#9ca3af' } },
          y: { grid: { color: '#f3f4f6' }, ticks: { font: { size: 11 }, color: '#9ca3af' } },
        },
      },
    });
  }
}
