import { Component, Input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlatformGroup } from '../../../models/failure-queue.model';

@Component({
  selector: 'app-d2-kpi-cards',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './kpi-cards.component.html',
  styleUrl: './kpi-cards.component.scss',
})
export class KpiCardsComponent {
  readonly Math = Math;

  @Input() set platforms(v: PlatformGroup[]) { this._platforms.set(v); }
  @Input() loading = false;

  private _platforms = signal<PlatformGroup[]>([]);

  // Totals — same computation as the main page summary bar
  readonly totalRequests = computed(() => this._platforms().reduce((s, p) => s + p.totalRequests, 0));
  readonly failedCount   = computed(() => this._platforms().reduce((s, p) => s + p.totalRequestsAtRisk, 0));
  readonly successCount  = computed(() => this.totalRequests() - this.failedCount());
  readonly successRate   = computed(() => {
    const t = this.totalRequests();
    return t ? this.successCount() / t * 100 : 0;
  });

  // Period-over-period deltas (prevTotalRequests already on each platform from getByPlatform)
  readonly prevTotalRequests = computed(() => this._platforms().reduce((s, p) => s + (p.prevTotalRequests ?? 0), 0));
  readonly prevFailedCount   = computed(() => this._platforms().reduce((s, p) => s + (p.prevTotalRequestsAtRisk ?? 0), 0));
  readonly prevSuccessCount  = computed(() => this.prevTotalRequests() - this.prevFailedCount());
  readonly prevSuccessRate   = computed(() => {
    const t = this.prevTotalRequests();
    return t ? this.prevSuccessCount() / t * 100 : 0;
  });

  readonly hasPrev = computed(() => this.prevTotalRequests() > 0);

  readonly deltaReqs = computed(() => this.totalRequests() - this.prevTotalRequests());
  readonly deltaRate = computed(() => this.successRate() - this.prevSuccessRate());

  fmtNum(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
    return String(n);
  }

  fmtPct(n: number): string { return n.toFixed(1) + '%'; }

  fmtDelta(d: number): string { return (d >= 0 ? '↑ +' : '↓ ') + this.fmtNum(Math.abs(d)); }

  rateBadge(rate: number): { label: string; cls: string } {
    if (rate >= 85) return { label: 'Healthy',         cls: 'hl' };
    if (rate >= 60) return { label: 'Needs attention', cls: 'wn' };
    return             { label: 'Critical',            cls: 'cr' };
  }
}
