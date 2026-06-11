import { Component, Input, OnChanges, OnDestroy, SimpleChanges, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../../services/api.service';
import { FailureQueueFilters, SegmentRanking, SegmentRankingsResponse, SegmentDetail } from '../../../models/failure-queue.model';

@Component({
  selector: 'app-d2-segment-rankings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './segment-rankings.component.html',
  styleUrl: './segment-rankings.component.scss',
})
export class SegmentRankingsComponent implements OnChanges, OnDestroy {
  @Input() filters!: FailureQueueFilters;

  n       = signal(10);
  loading = signal(true);
  data    = signal<SegmentRankingsResponse | null>(null);

  readonly nOptions = [
    { label: 'Top / Bottom 10', value: 10 },
    { label: 'Top / Bottom 20', value: 20 },
    { label: 'Top / Bottom 50', value: 50 },
  ];

  // modal state
  selectedSegment = signal<SegmentRanking | null>(null);
  modalTab        = signal<'overview' | 'platforms'>('overview');
  detailLoading   = signal(false);
  detail          = signal<SegmentDetail | null>(null);

  private destroy$ = new Subject<void>();

  constructor(private api: ApiService) {}

  ngOnChanges(c: SimpleChanges): void {
    if (c['filters']) this.load();
  }

  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }

  onNChange(val: number): void {
    this.n.set(Number(val));
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.api.getSegmentRankings(this.filters, this.n())
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: d => { this.data.set(d); this.loading.set(false); },
        error: ()  => this.loading.set(false),
      });
  }

  openModal(seg: SegmentRanking): void {
    this.selectedSegment.set(seg);
    this.modalTab.set('overview');
    this.detail.set(null);
    this.loadDetail(seg.segment);
  }

  setTab(tab: 'overview' | 'platforms'): void { this.modalTab.set(tab); }
  closeModal(): void { this.selectedSegment.set(null); this.detail.set(null); }

  private loadDetail(segment: string): void {
    this.detailLoading.set(true);
    this.api.getSegmentDetail(segment, this.filters)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: d => { this.detail.set(d); this.detailLoading.set(false); },
        error: ()  => this.detailLoading.set(false),
      });
  }

  fmtNum(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
    return String(n);
  }

  topMax(): number {
    const top = this.data()?.top ?? [];
    return top.length ? top[0].timesServed : 1;
  }

  botMax(): number {
    const bot = this.data()?.bottom ?? [];
    return bot.length ? Math.max(...bot.map(s => s.totalRequests)) : 1;
  }

  platformMax(): number {
    const pl = this.detail()?.platforms ?? [];
    return pl.length ? pl[0].timesServed : 1;
  }
}
