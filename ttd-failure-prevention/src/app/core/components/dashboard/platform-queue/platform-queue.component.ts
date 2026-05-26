import {
  AfterViewInit,
  Component, ElementRef, Input, OnInit, OnChanges, OnDestroy,
  SimpleChanges, ViewChild, signal, computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../../services/api.service';
import { PlatformGroup, MatchedByGroup, FailedRow, FailureQueueFilters } from '../../../models/failure-queue.model';

@Component({
  selector: 'app-platform-queue',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './platform-queue.component.html',
  styleUrl: './platform-queue.component.scss',
})
export class PlatformQueueComponent implements OnInit, OnChanges, AfterViewInit, OnDestroy {
  @Input() filters!: FailureQueueFilters;

  loading     = signal(false);
  error       = signal('');
  platforms   = signal<PlatformGroup[]>([]);
  meta        = signal<{ dateFrom: string; dateTo: string; rowCount: number } | null>(null);
  loadingMore = signal(false);

  totalAtRisk = computed(() => this.platforms().reduce((s, p) => s + p.totalRequestsAtRisk, 0));
  totalFailed = computed(() => this.platforms().reduce((s, p) => s + p.failedCount, 0));

  private currentOffset = 0;
  private total         = 0;
  private cancelTable$  = new Subject<void>();
  private destroy$      = new Subject<void>();
  private observer?: IntersectionObserver;

  @ViewChild('scrollSentinel')
  set sentinel(el: ElementRef | undefined) {
    if (el?.nativeElement && this.observer) {
      this.observer.observe(el.nativeElement);
    }
  }

  constructor(private api: ApiService) {}

  ngOnInit() {
    this.loadTable();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['filters'] && !changes['filters'].firstChange) {
      this.loadTable();
    }
  }

  ngAfterViewInit() {
    if (typeof IntersectionObserver === 'undefined') return;
    this.observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !this.loadingMore() && !this.loading()) {
        if (this.platforms().length < this.total) this.loadMore();
      }
    }, { threshold: 0 });
  }

  ngOnDestroy() {
    this.observer?.disconnect();
    this.cancelTable$.complete();
    this.destroy$.complete();
  }

  private loadTable() {
    this.cancelTable$.next();
    this.loadingMore.set(false);
    this.loading.set(true);
    this.error.set('');
    this.currentOffset = 0;
    this.total = 0;

    this.api.getByPlatform(this.filters, 0, 25)
      .pipe(takeUntil(this.cancelTable$), takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.platforms.set(res.platforms.map(p => ({
            ...p,
            rows: [],
            expanded: false,
            detailLoaded: false,
            detailLoading: false,
            matchedByGroups: (p.matchedByGroups || []).map(g => ({ ...g, rows: [], expanded: false })),
            ...(p.name === 'Others' ? { othersTab: 'content' as const } : {}),
          })));
          this.meta.set(res.meta);
          this.total = res.meta.total;
          this.currentOffset = res.platforms.length;
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set(err?.error?.error || 'Failed to load data');
          this.loading.set(false);
        },
      });
  }

  private loadMore() {
    this.loadingMore.set(true);
    this.api.getByPlatform(this.filters, this.currentOffset, 25)
      .pipe(takeUntil(this.cancelTable$), takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          const incoming = res.platforms.map(p => ({
            ...p, rows: [], expanded: false, detailLoaded: false, detailLoading: false,
            matchedByGroups: (p.matchedByGroups || []).map(g => ({ ...g, rows: [], expanded: false })),
            ...(p.name === 'Others' ? { othersTab: 'content' as const } : {}),
          }));
          this.platforms.update(list => [...list, ...incoming]);
          this.total = res.meta.total;
          this.currentOffset += incoming.length;
          this.loadingMore.set(false);
        },
        error: () => this.loadingMore.set(false),
      });
  }

  private loadPlatformDetail(platformName: string) {
    this.platforms.update(list =>
      list.map(p => p.name === platformName ? { ...p, detailLoading: true } : p)
    );

    this.api.getPlatformDetail(platformName, this.filters)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ({ rows }) => {
          const stamped = rows.map(r => ({ ...r, id: `${r.contentId}|${r.bundleId}|${r.channel}` }));
          this.platforms.update(list =>
            list.map(p => p.name !== platformName ? p : {
              ...p,
              rows: stamped,
              matchedByGroups: this.groupByMatchedBy(stamped),
              detailLoaded: true,
              detailLoading: false,
            })
          );
        },
        error: () => {
          this.platforms.update(list =>
            list.map(p => p.name === platformName ? { ...p, detailLoading: false } : p)
          );
        },
      });
  }

  private groupByMatchedBy(rows: FailedRow[]): MatchedByGroup[] {
    const map = new Map<string, MatchedByGroup>();
    for (const row of rows) {
      const key = (row.matchedBy || '').trim() || 'Unmatched';
      if (!map.has(key)) {
        map.set(key, { matchedBy: key, failedCount: 0, totalRequestsAtRisk: 0, rows: [], expanded: false });
      }
      const g = map.get(key)!;
      g.failedCount++;
      g.totalRequestsAtRisk += row.requestsAtRisk;
      g.rows.push(row);
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.matchedBy === 'Unmatched') return 1;
      if (b.matchedBy === 'Unmatched') return -1;
      return b.totalRequestsAtRisk - a.totalRequestsAtRisk;
    });
  }

  togglePlatform(platform: PlatformGroup) {
    const opening = !platform.expanded;
    this.platforms.update(list =>
      list.map(p => p.name === platform.name ? { ...p, expanded: opening } : p)
    );
    if (opening && !platform.detailLoaded && !platform.detailLoading) {
      this.loadPlatformDetail(platform.name);
    }
  }

  toggleMatchedByGroup(platformName: string, matchedBy: string) {
    this.platforms.update(list =>
      list.map(p => p.name !== platformName ? p : {
        ...p,
        matchedByGroups: p.matchedByGroups?.map(g =>
          g.matchedBy === matchedBy ? { ...g, expanded: !g.expanded } : g
        ),
      })
    );
  }

  setOthersTab(tab: 'content' | 'urls') {
    this.platforms.update(list =>
      list.map(p => p.name === 'Others' ? { ...p, othersTab: tab } : p)
    );
  }

  expandAll()   { this.platforms.update(l => l.map(p => ({ ...p, expanded: true  }))); }
  collapseAll() { this.platforms.update(l => l.map(p => ({ ...p, expanded: false }))); }

  load() { this.loadTable(); }

  formatNumber(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
    return n.toString();
  }

  formatPct(part: number, total: number): string {
    if (!total) return '0%';
    return (part / total * 100).toFixed(1) + '%';
  }
}
