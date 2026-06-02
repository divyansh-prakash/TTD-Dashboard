import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlatformGroup } from '../../../models/failure-queue.model';

@Component({
  selector: 'app-d2-platform-breakdown',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './platform-breakdown.component.html',
  styleUrl: './platform-breakdown.component.scss',
})
export class PlatformBreakdownComponent {
  @Input() platforms: PlatformGroup[] = [];
  @Input() loading = false;

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
    const max = this.maxRequests();
    return max ? (p.totalRequests / max) * 100 : 0;
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
