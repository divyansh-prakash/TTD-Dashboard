import { Component, Input, OnChanges, OnDestroy, SimpleChanges, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../../services/api.service';
import { FailureQueueFilters, PubmaticContentGapRow } from '../../../models/failure-queue.model';

interface PlatformGroup {
  platform:  string;
  total:     number;
  matched:   number;
  unmatched: number;
  matchRate: number;
  rows:      PubmaticContentGapRow[];
}

@Component({
  selector: 'app-pub-content-gap',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pubmatic-content-gap.component.html',
  styleUrl:    './pubmatic-content-gap.component.scss',
})
export class PubmaticContentGapComponent implements OnChanges, OnDestroy {
  @Input() filters!: FailureQueueFilters;

  rows    = signal<PubmaticContentGapRow[]>([]);
  loading = signal(false);

  // Which platform accordions are expanded
  openPlatforms = signal<Set<string>>(new Set());
  unknownOpen   = signal(false);

  // Group known rows by platform, aggregate metrics, sort by unmatched desc
  platformGroups = computed<PlatformGroup[]>(() => {
    const map = new Map<string, PlatformGroup>();
    for (const r of this.rows().filter(r => r.known)) {
      if (!map.has(r.platform)) {
        map.set(r.platform, { platform: r.platform, total: 0, matched: 0, unmatched: 0, matchRate: 0, rows: [] });
      }
      const g = map.get(r.platform)!;
      g.total     += r.total;
      g.matched   += r.matched;
      g.unmatched += r.unmatched;
      g.rows.push(r);
    }
    for (const g of map.values()) {
      g.matchRate = g.total ? +((g.matched / g.total) * 100).toFixed(1) : 0;
    }
    return Array.from(map.values()).sort((a, b) => b.unmatched - a.unmatched);
  });

  unknownRows = computed(() => this.rows().filter(r => !r.known));

  unknownSummary = computed(() => {
    const rows = this.unknownRows();
    const total     = rows.reduce((s, r) => s + r.total,     0);
    const matched   = rows.reduce((s, r) => s + r.matched,   0);
    const unmatched = rows.reduce((s, r) => s + r.unmatched, 0);
    const matchRate = total ? +((matched / total) * 100).toFixed(1) : 0;
    return { total, matched, unmatched, matchRate, count: rows.length };
  });

  private destroy$ = new Subject<void>();

  constructor(private api: ApiService) {}

  ngOnChanges(c: SimpleChanges): void {
    if (c['filters'] && this.filters?.dateFrom) this.load();
  }

  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }

  private load(): void {
    this.loading.set(true);
    this.openPlatforms.set(new Set());
    this.unknownOpen.set(false);
    this.api.getPubmaticContentGap(this.filters)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: d => { this.rows.set(d); this.loading.set(false); },
        error: () => this.loading.set(false),
      });
  }

  togglePlatform(platform: string): void {
    this.openPlatforms.update(s => {
      const next = new Set(s);
      if (next.has(platform)) next.delete(platform); else next.add(platform);
      return next;
    });
  }

  toggleUnknown(): void { this.unknownOpen.update(v => !v); }

  barPct(value: number, total: number): number {
    return total ? (value / total) * 100 : 0;
  }

  fmt(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
    return String(n);
  }
}
