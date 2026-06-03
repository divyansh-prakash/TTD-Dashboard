import { Component, Input, OnChanges, SimpleChanges, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../../services/api.service';
import { FailureQueueFilters, PlatformGroup, PlatformSegmentItem } from '../../../models/failure-queue.model';

@Component({
  selector: 'app-d2-platform-breakdown',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './platform-breakdown.component.html',
  styleUrl: './platform-breakdown.component.scss',
})
export class PlatformBreakdownComponent implements OnChanges {
  @Input() platforms: PlatformGroup[] = [];
  @Input() loading = false;
  @Input() filters!: FailureQueueFilters;

  segCounts     = signal<Record<string, number>>({});
  segCountsLoad = signal(false);

  // modal
  modalPlatform   = signal<PlatformGroup | null>(null);
  modalTab        = signal<'segments' | 'match'>('segments');
  segDetailLoad   = signal(false);
  segDetail       = signal<PlatformSegmentItem[]>([]);

  private destroy$ = new Subject<void>();

  constructor(private api: ApiService) {}

  ngOnChanges(c: SimpleChanges): void {
    if (c['filters'] && this.filters) this.loadCounts();
  }

  private loadCounts(): void {
    this.segCountsLoad.set(true);
    this.api.getPlatformSegmentCounts(this.filters)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: d => { this.segCounts.set(d); this.segCountsLoad.set(false); },
        error: ()  => this.segCountsLoad.set(false),
      });
  }

  openModal(p: PlatformGroup, event: Event): void {
    event.stopPropagation();
    this.modalPlatform.set(p);
    this.modalTab.set('segments');
    this.segDetail.set([]);
    this.loadSegDetail(p.name);
  }

  setTab(tab: 'segments' | 'match'): void { this.modalTab.set(tab); }
  closeModal(): void { this.modalPlatform.set(null); this.segDetail.set([]); }

  private loadSegDetail(platform: string): void {
    this.segDetailLoad.set(true);
    this.api.getPlatformSegmentDetail(platform, this.filters)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: d => { this.segDetail.set(d); this.segDetailLoad.set(false); },
        error: ()  => this.segDetailLoad.set(false),
      });
  }

  pillClass(pct: number): string {
    if (pct >= 75) return 'pill-green';
    if (pct >= 50) return 'pill-amber';
    return 'pill-red';
  }

  successRate(p: PlatformGroup): number {
    return p.totalRequests ? (p.totalRequests - p.totalRequestsAtRisk) / p.totalRequests * 100 : 0;
  }

  rateColor(rate: number): string {
    if (rate >= 85) return '#2d9b6f';
    if (rate >= 60) return '#f59e0b';
    return '#ef4444';
  }

  maxRequests(): number {
    return this.platforms.length ? Math.max(...this.platforms.map(p => p.totalRequests)) : 1;
  }

  barPct(p: PlatformGroup): number {
    return (p.totalRequests / this.maxRequests()) * 100;
  }

  fmtNum(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
    return String(n);
  }

  fmtPct(n: number): string { return n.toFixed(1) + '%'; }

  deltaLabel(cur: number, prev: number | undefined): string {
    if (!prev) return '';
    const d = cur - prev;
    return (d >= 0 ? '↑ +' : '↓ ') + this.fmtNum(Math.abs(d));
  }

  deltaClass(cur: number, prev: number | undefined, higherIsBetter = true): string {
    if (!prev) return '';
    return (higherIsBetter ? cur >= prev : cur <= prev) ? 'up' : 'dn';
  }
}
