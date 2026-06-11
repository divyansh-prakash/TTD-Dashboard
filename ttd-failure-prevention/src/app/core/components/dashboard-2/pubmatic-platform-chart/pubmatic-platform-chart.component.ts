import {
  Component, Input, OnChanges, OnDestroy, SimpleChanges,
  ViewChild, ElementRef, signal, computed, PLATFORM_ID, Inject,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../../services/api.service';
import {
  FailureQueueFilters,
  PubmaticAppidBreakdown,
  PubmaticAppidPlatform,
  PubmaticContentCoverageRow,
} from '../../../models/failure-queue.model';

@Component({
  selector: 'app-pub-platform-chart',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pubmatic-platform-chart.component.html',
  styleUrl: './pubmatic-platform-chart.component.scss',
})
export class PubmaticPlatformChartComponent implements OnChanges, OnDestroy {
  @Input() filters!: FailureQueueFilters;

  @ViewChild('pieCanvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  appidData    = signal<PubmaticAppidBreakdown | null>(null);
  appidLoading = signal(false);
  modal        = signal<{ title: string; appids: string[] } | null>(null);

  coverageData    = signal<PubmaticContentCoverageRow[]>([]);
  coverageLoading = signal(false);

  coverageTotals = computed(() => {
    const rows = this.coverageData();
    const pubmaticIds = rows.reduce((s, r) => s + r.pubmaticIds, 0);
    const covered     = rows.reduce((s, r) => s + r.covered,     0);
    const rate        = pubmaticIds > 0 ? +((covered / pubmaticIds) * 100).toFixed(1) : 0;
    return { pubmaticIds, covered, rate };
  });

  private chartInstance: any = null;
  private renderVer = 0;
  private destroy$ = new Subject<void>();

  constructor(
    private api: ApiService,
    @Inject(PLATFORM_ID) private platformId: object,
  ) {}

  ngOnChanges(c: SimpleChanges): void {
    if (c['filters'] && this.filters?.dateFrom) this.load();
  }

  ngOnDestroy(): void {
    this.chartInstance?.destroy();
    this.destroy$.next();
    this.destroy$.complete();
  }

  private load(): void {
    this.appidLoading.set(true);
    this.api.getPubmaticAppidBreakdown(this.filters)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: d => {
          this.appidData.set(d);
          this.appidLoading.set(false);
          if (isPlatformBrowser(this.platformId)) setTimeout(() => this.renderChart(), 0);
        },
        error: () => this.appidLoading.set(false),
      });

    this.coverageLoading.set(true);
    this.coverageData.set([]);
    this.api.getPubmaticContentCoverage(this.filters)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: d => { this.coverageData.set(d); this.coverageLoading.set(false); },
        error: () => this.coverageLoading.set(false),
      });
  }

  private async renderChart(): Promise<void> {
    const ver = ++this.renderVer;
    const canvas = this.canvasRef?.nativeElement;
    const d = this.appidData();
    if (!canvas || !d) return;

    const { Chart, PieController, ArcElement, Tooltip, Legend } = await import('chart.js');
    Chart.register(PieController, ArcElement, Tooltip, Legend);
    if (ver !== this.renderVer) return;

    this.chartInstance?.destroy();
    const total = d.knownCount + d.unknownCount || 1;

    this.chartInstance = new Chart(canvas, {
      type: 'pie',
      data: {
        labels: ['Known app IDs', 'Unknown app IDs'],
        datasets: [{
          data: [d.knownCount, d.unknownCount],
          backgroundColor: ['#2d9b6f', '#e5e7eb'],
          borderColor: '#fff',
          borderWidth: 2,
          hoverOffset: 8,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: 4 },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => {
                const pct = ((ctx.raw as number) / total * 100).toFixed(1);
                return `  ${ctx.raw} app IDs  (${pct}%)`;
              },
            },
          },
        },
        onClick: (_evt, elements) => {
          if (!elements.length || !d) return;
          const idx = elements[0].index;
          if (idx === 0) {
            const allKnown = d.breakdown.filter(p => p.platform !== 'Unknown').flatMap(p => p.appids);
            this.modal.set({ title: 'Known App IDs', appids: allKnown });
          } else {
            const unknown = d.breakdown.find(p => p.platform === 'Unknown');
            this.modal.set({ title: 'Unknown App IDs', appids: unknown?.appids ?? [] });
          }
        },
      },
    });
  }

  openModal(p: PubmaticAppidPlatform): void {
    this.modal.set({ title: `${p.platform} App IDs`, appids: p.appids });
  }

  closeModal(): void { this.modal.set(null); }

  barWidth(count: number, list: { count: number }[]): number {
    const max = list.length ? Math.max(...list.map(b => b.count)) : 1;
    return max ? (count / max) * 100 : 0;
  }

  pct(n: number, total: number): string {
    return total ? (n / total * 100).toFixed(1) + '%' : '0%';
  }

  fmt(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
    return String(n);
  }

  covBarPct(part: number, total: number): number {
    return total ? (part / total) * 100 : 0;
  }
}
