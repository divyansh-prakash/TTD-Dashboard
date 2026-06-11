import { Component, Input, OnChanges, OnDestroy, SimpleChanges, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../../services/api.service';
import { FailureQueueFilters, PubmaticMatchbyRow } from '../../../models/failure-queue.model';

interface AppidRow {
  appid:            string;
  platform:         string;
  known:            boolean;
  totalHits:        number;
  uniqueContentIds: number;
}

interface MatchbyGroup {
  matchedby:        string;
  matchLabel:       string;
  totalHits:        number;
  uniqueContentIds: number;
  appidCount:       number;
  rows:             AppidRow[];
}

const MATCHBY_ORDER = ['PB_C', 'PB_G', 'PB_S', 'PB_TS'];

@Component({
  selector: 'app-pub-matchby',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pubmatic-matchby.component.html',
  styleUrl:    './pubmatic-matchby.component.scss',
})
export class PubmaticMatchbyComponent implements OnChanges, OnDestroy {
  @Input() filters!: FailureQueueFilters;

  rows    = signal<PubmaticMatchbyRow[]>([]);
  loading = signal(false);

  openGroups = signal<Set<string>>(new Set());

  groups = computed<MatchbyGroup[]>(() => {
    const map = new Map<string, MatchbyGroup>();
    for (const r of this.rows()) {
      if (!map.has(r.matchedby)) {
        map.set(r.matchedby, {
          matchedby: r.matchedby, matchLabel: r.matchLabel,
          totalHits: 0, uniqueContentIds: 0, appidCount: 0, rows: [],
        });
      }
      const g = map.get(r.matchedby)!;
      g.totalHits        += r.totalHits;
      g.uniqueContentIds += r.uniqueContentIds;
      g.appidCount++;
      g.rows.push({ appid: r.appid, platform: r.platform, known: r.known, totalHits: r.totalHits, uniqueContentIds: r.uniqueContentIds });
    }
    // Sort rows inside each group by totalHits desc
    for (const g of map.values()) g.rows.sort((a, b) => b.totalHits - a.totalHits);
    // Return in canonical order
    return MATCHBY_ORDER.map(k => map.get(k)).filter(Boolean) as MatchbyGroup[];
  });

  private destroy$ = new Subject<void>();
  constructor(private api: ApiService) {}

  ngOnChanges(c: SimpleChanges): void {
    if (c['filters'] && this.filters?.dateFrom) this.load();
  }
  ngOnDestroy(): void { this.destroy$.next(); this.destroy$.complete(); }

  private load(): void {
    this.loading.set(true);
    this.openGroups.set(new Set());
    this.api.getPubmaticMatchbyBreakdown(this.filters)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: d => { this.rows.set(d); this.loading.set(false); },
        error: () => this.loading.set(false),
      });
  }

  toggle(key: string): void {
    this.openGroups.update(s => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  fmt(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
    return String(n);
  }

  pct(value: number, total: number): number {
    return total ? (value / total) * 100 : 0;
  }
}
