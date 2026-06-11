import { Component, Input, OnChanges, OnDestroy, SimpleChanges, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../../services/api.service';
import { FailureQueueFilters, PubmaticMatchbyRow } from '../../../models/failure-queue.model';

interface UnknownSubRow {
  appid:     string;
  totalRows: number;
  totalHits: number;
}

interface PlatformRow {
  appid:      string;
  platform:   string;
  known:      boolean;
  totalRows:  number;
  totalHits:  number;
  subRows?:   UnknownSubRow[];
}

interface MatchbyGroup {
  matchedby:       string;
  matchLabel:      string;
  totalRows:       number;
  totalHits:       number;
  knownTotalHits:  number;
  rows:            PlatformRow[];
}

const MATCHBY_ORDER = ['PB_C', 'PB_CAT', 'PB_TS', 'PB_S', 'PB_G'];

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

  // Keys: matchedby for outer accordions, `${matchedby}:unknown` for the nested unknown accordion
  openGroups = signal<Set<string>>(new Set());

  totalMatchedHits = computed(() => this.groups().reduce((s, g) => s + g.totalHits, 0));

  groups = computed<MatchbyGroup[]>(() => {
    const map = new Map<string, MatchbyGroup>();

    for (const r of this.rows()) {
      if (!map.has(r.matchedby)) {
        map.set(r.matchedby, {
          matchedby: r.matchedby, matchLabel: r.matchLabel,
          totalRows: 0, totalHits: 0, knownTotalHits: 0, rows: [],
        });
      }
      const g = map.get(r.matchedby)!;
      g.totalRows += r.totalRows;
      g.totalHits += r.totalHits;

      if (r.known) {
        g.knownTotalHits += r.totalHits;
        const existing = g.rows.find(row => row.known && row.platform === r.platform);
        if (existing) {
          existing.totalRows += r.totalRows;
          existing.totalHits += r.totalHits;
        } else {
          g.rows.push({ appid: r.appid, platform: r.platform, known: true, totalRows: r.totalRows, totalHits: r.totalHits });
        }
      } else {
        const unknownRow = g.rows.find(row => !row.known);
        if (unknownRow) {
          unknownRow.totalRows += r.totalRows;
          unknownRow.totalHits += r.totalHits;
          unknownRow.subRows!.push({ appid: r.appid, totalRows: r.totalRows, totalHits: r.totalHits });
        } else {
          g.rows.push({ appid: r.appid, platform: 'Unknown', known: false, totalRows: r.totalRows, totalHits: r.totalHits,
            subRows: [{ appid: r.appid, totalRows: r.totalRows, totalHits: r.totalHits }] });
        }
      }
    }

    for (const g of map.values()) {
      const known   = g.rows.filter(r => r.known).sort((a, b) => b.totalHits - a.totalHits);
      const unknown = g.rows.filter(r => !r.known);
      if (unknown[0]?.subRows) unknown[0].subRows.sort((a, b) => b.totalHits - a.totalHits);
      g.rows = [...known, ...unknown];
    }

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
