import { Component, Input, OnChanges, OnDestroy, SimpleChanges, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../../services/api.service';
import { FailureQueueFilters, PubmaticSummary } from '../../../models/failure-queue.model';

@Component({
  selector: 'app-pub-kpi',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pubmatic-kpi.component.html',
  styleUrl: './pubmatic-kpi.component.scss',
})
export class PubmaticKpiComponent implements OnChanges, OnDestroy {
  @Input() filters!: FailureQueueFilters;

  loading = signal(true);
  data    = signal<PubmaticSummary | null>(null);

  private destroy$ = new Subject<void>();
  constructor(private api: ApiService) {}

  ngOnChanges(c: SimpleChanges): void { if (c['filters']) this.load(); }
  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }

  private load(): void {
    this.loading.set(true);
    this.api.getPubmaticSummary(this.filters)
      .pipe(takeUntil(this.destroy$))
      .subscribe({ next: d => { this.data.set(d); this.loading.set(false); }, error: () => this.loading.set(false) });
  }

  fmt(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
    return String(n);
  }

  pct(n: number): string { return n.toFixed(1) + '%'; }
}
