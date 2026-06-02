import {
  AfterViewInit,
  Component, ElementRef, Input, OnInit, OnChanges, OnDestroy,
  SimpleChanges, ViewChild, signal, computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../../services/api.service';
import { PlatformGroup, MatchedByGroup, FailedRow, FailureQueueFilters, PeriodComparison, ContentHit } from '../../../models/failure-queue.model';

@Component({
  selector: 'app-platform-queue',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './platform-queue.component.html',
  styleUrl: './platform-queue.component.scss',
})
export class PlatformQueueComponent implements OnInit, OnChanges, AfterViewInit, OnDestroy {
  @Input() filters!: FailureQueueFilters;

  loading              = signal(false);
  error                = signal('');
  platforms            = signal<PlatformGroup[]>([]);
  meta                 = signal<{ dateFrom: string; dateTo: string; rowCount: number } | null>(null);
  loadingMore          = signal(false);
  downloadingPlatforms = signal<Set<string>>(new Set());
  downloadingZones     = signal<Set<string>>(new Set());
  downloadingGroups    = signal<Set<string>>(new Set());

  platformSort    = signal<'default' | 'desc' | 'asc'>('default');
  comparison      = signal<PeriodComparison | null>(null);
  catSortMap      = signal<Record<string, 'default' | 'desc' | 'asc'>>({});

  sortedPlatforms = computed(() => {
    const list  = this.platforms();
    const order = this.platformSort();
    if (order === 'default') return list;
    return [...list].sort((a, b) =>
      order === 'desc' ? b.totalRequests - a.totalRequests : a.totalRequests - b.totalRequests
    );
  });

  totalAtRisk       = computed(() => this.platforms().reduce((s, p) => s + p.totalRequestsAtRisk, 0));
  totalFailed       = computed(() => this.platforms().reduce((s, p) => s + p.failedCount, 0));
  totalRequests     = computed(() => this.platforms().reduce((s, p) => s + p.totalRequests, 0));
  totalServed       = computed(() => this.totalRequests() - this.totalAtRisk());
  successRate       = computed(() => this.totalRequests() ? this.totalServed() / this.totalRequests() * 100 : 0);
  failureRate       = computed(() => this.totalRequests() ? this.totalAtRisk() / this.totalRequests() * 100 : 0);
  platformsAtRisk   = computed(() => this.platforms().filter(p => p.totalRequestsAtRisk > 0).length);
  enrichableCount   = computed(() => this.platforms().reduce((s, p) => s + this.enrichableGroups(p).length, 0));

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

  isEnrichable(mb: string): boolean {
    return !!mb && mb !== 'Unmatched';
  }

  platformServed(platform: PlatformGroup): number {
    return platform.totalRequests - platform.totalRequestsAtRisk;
  }

  getCatSort(name: string): 'default' | 'desc' | 'asc' { return this.catSortMap()[name] ?? 'default'; }

  toggleCatSort(name: string, event: Event): void {
    event.stopPropagation();
    const cur = this.getCatSort(name);
    const next: 'default' | 'desc' | 'asc' = cur === 'default' ? 'desc' : cur === 'desc' ? 'asc' : 'default';
    this.catSortMap.update(m => ({ ...m, [name]: next }));
  }

  catSortIcon(name: string): string {
    const s = this.getCatSort(name);
    if (s === 'desc') return '↓';
    if (s === 'asc')  return '↑';
    return '↕';
  }

  private sortGroups(groups: MatchedByGroup[], sort: 'default' | 'desc' | 'asc'): MatchedByGroup[] {
    if (sort === 'desc') return [...groups].sort((a, b) => (b.totalRequests ?? 0) - (a.totalRequests ?? 0));
    if (sort === 'asc')  return [...groups].sort((a, b) => (a.totalRequests ?? 0) - (b.totalRequests ?? 0));
    return groups;
  }

  failingGroups(platform: PlatformGroup): MatchedByGroup[] {
    const base = (platform.matchedByGroups || [])
      .filter(g => !this.isEnrichable(g.matchedBy))
      .sort((a, b) => this.catOrder(a.matchedBy) - this.catOrder(b.matchedBy));
    return this.sortGroups(base, this.getCatSort(platform.name));
  }

  enrichableGroups(platform: PlatformGroup): MatchedByGroup[] {
    const base = (platform.matchedByGroups || [])
      .filter(g => this.isEnrichable(g.matchedBy))
      .sort((a, b) => this.catOrder(a.matchedBy) - this.catOrder(b.matchedBy));
    return this.sortGroups(base, this.getCatSort(platform.name));
  }

  private catOrder(mb: string): number {
    if (mb.startsWith('C_'))  return 0;
    if (mb.startsWith('TS_')) return 1;
    if (mb.startsWith('S_'))  return 2;
    if (mb.startsWith('G_'))  return 3;
    if (mb.startsWith('R_'))  return 4;
    if (mb.startsWith('CG_')) return 5;
    return 6;
  }

  private initGroups(groups: MatchedByGroup[]): MatchedByGroup[] {
    return (groups || [])
      .sort((a, b) => this.catOrder(a.matchedBy) - this.catOrder(b.matchedBy))
      .map(g => ({
        ...g,
        enrichable: this.isEnrichable(g.matchedBy),
        sortDesc: true,
        rows: [],
        expanded: false,
        detailLoaded: false,
        detailLoading: false,
        detailLoadingMore: false,
        detailOffset: 0,
        detailHasMore: true,
        activeTab: 'content' as const,
        searchVal: '',
        hitsRows: [],
        hitsLoading: false,
        hitsLoaded: false,
        hitsOffset: 0,
        hitsHasMore: false,
      }));
  }

  sortedRows(group: MatchedByGroup): FailedRow[] {
    const rows = [...(group.rows || [])];
    return group.sortDesc !== false
      ? rows.sort((a, b) => b.requestsAtRisk - a.requestsAtRisk)
      : rows.sort((a, b) => a.requestsAtRisk - b.requestsAtRisk);
  }

  toggleGroupSort(platformName: string, matchedBy: string, event: Event) {
    event.stopPropagation();
    this.platforms.update(list =>
      list.map(p => p.name !== platformName ? p : {
        ...p,
        matchedByGroups: p.matchedByGroups?.map(g =>
          g.matchedBy !== matchedBy ? g : { ...g, sortDesc: !(g.sortDesc ?? true) }
        ),
      })
    );
  }

  private initPlatform(p: PlatformGroup): PlatformGroup {
    return {
      ...p,
      rows: [],
      expanded: false,
      detailLoaded: false,
      detailLoading: false,
      matchedByGroups: this.initGroups(p.matchedByGroups || []),
      ...(p.name === 'Others' ? { othersTab: 'content' as const } : {}),
    };
  }

  private loadTable() {
    this.cancelTable$.next();
    this.loadingMore.set(false);
    this.loading.set(true);
    this.error.set('');
    this.currentOffset = 0;
    this.total = 0;
    this.comparison.set(null);

    // Load comparison in parallel — doesn't block the main list
    this.api.getPeriodComparison(this.filters)
      .pipe(takeUntil(this.cancelTable$), takeUntil(this.destroy$))
      .subscribe({ next: c => this.comparison.set(c), error: () => {} });

    this.api.getByPlatform(this.filters, 0, 25)
      .pipe(takeUntil(this.cancelTable$), takeUntil(this.destroy$))
      .subscribe({
        next: (res) => {
          this.platforms.set(res.platforms.map(p => this.initPlatform(p)));
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
          const incoming = res.platforms.map(p => this.initPlatform(p));
          this.platforms.update(list => [...list, ...incoming]);
          this.total = res.meta.total;
          this.currentOffset += incoming.length;
          this.loadingMore.set(false);
        },
        error: () => this.loadingMore.set(false),
      });
  }

  // Loads a page of content rows for a specific matchedBy group.
  // offset=0 is the initial load; higher offsets append to existing rows.
  private loadGroupDetail(platformName: string, matchedBy: string, offset: number, enrichable = false, resetRows = false) {
    // Read search value from current state before mutating
    const search = this.platforms().find(p => p.name === platformName)
      ?.matchedByGroups?.find(g => g.matchedBy === matchedBy)?.searchVal ?? '';
    if (resetRows) {
      this.platforms.update(list =>
        list.map(p => p.name !== platformName ? p : {
          ...p,
          matchedByGroups: p.matchedByGroups?.map(g =>
            g.matchedBy !== matchedBy ? g : { ...g, rows: [], detailOffset: 0, detailLoaded: false }
          ),
        })
      );
    }
    this.platforms.update(list =>
      list.map(p => p.name !== platformName ? p : {
        ...p,
        matchedByGroups: p.matchedByGroups?.map(g =>
          g.matchedBy !== matchedBy ? g : {
            ...g,
            ...(offset === 0 ? { detailLoading: true } : { detailLoadingMore: true }),
          }
        ),
      })
    );

    this.api.getPlatformDetail(platformName, this.filters, matchedBy, offset, 10, enrichable, search)
      .pipe(takeUntil(this.cancelTable$), takeUntil(this.destroy$))
      .subscribe({
        next: ({ rows, meta }) => {
          const stamped = rows.map(r => ({ ...r, id: `${r.contentId}|${r.bundleId}|${r.channel}` }));
          this.platforms.update(list =>
            list.map(p => p.name !== platformName ? p : {
              ...p,
              matchedByGroups: p.matchedByGroups?.map(g => {
                if (g.matchedBy !== matchedBy) return g;
                return {
                  ...g,
                  rows: offset === 0 ? stamped : [...(g.rows || []), ...stamped],
                  detailLoaded: true,
                  detailLoading: false,
                  detailLoadingMore: false,
                  detailOffset: offset + stamped.length,
                  detailHasMore: meta.hasMore,
                };
              }),
            })
          );
        },
        error: () => {
          this.platforms.update(list =>
            list.map(p => p.name !== platformName ? p : {
              ...p,
              matchedByGroups: p.matchedByGroups?.map(g =>
                g.matchedBy !== matchedBy ? g : { ...g, detailLoading: false, detailLoadingMore: false }
              ),
            })
          );
        },
      });
  }

  togglePlatform(platform: PlatformGroup) {
    this.platforms.update(list =>
      list.map(p => p.name === platform.name ? { ...p, expanded: !p.expanded } : p)
    );
  }

  toggleMatchedByGroup(platformName: string, matchedBy: string) {
    const platform = this.platforms().find(p => p.name === platformName);
    const group    = platform?.matchedByGroups?.find(g => g.matchedBy === matchedBy);
    const opening  = !group?.expanded;

    this.platforms.update(list =>
      list.map(p => p.name !== platformName ? p : {
        ...p,
        matchedByGroups: p.matchedByGroups?.map(g =>
          g.matchedBy === matchedBy ? { ...g, expanded: !g.expanded } : g
        ),
      })
    );

    if (opening && group && !group.detailLoaded && !group.detailLoading) {
      this.loadGroupDetail(platformName, matchedBy, 0, group.enrichable ?? false);
    }
    if (opening && group && !group.hitsLoaded && !group.hitsLoading) {
      this.loadGroupHits(platformName, matchedBy, true);
    }
  }

  onGroupScroll(event: Event, platformName: string, matchedBy: string) {
    const el = event.target as HTMLElement;
    if (el.scrollTop + el.clientHeight < el.scrollHeight - 40) return;
    const platform = this.platforms().find(p => p.name === platformName);
    const group    = platform?.matchedByGroups?.find(g => g.matchedBy === matchedBy);
    if (group?.detailHasMore && !group.detailLoadingMore && !group.detailLoading) {
      this.loadGroupDetail(platformName, matchedBy, group.detailOffset ?? 0, group.enrichable ?? false);
    }
  }

  setOthersTab(tab: 'content' | 'urls') {
    this.platforms.update(list =>
      list.map(p => p.name === 'Others' ? { ...p, othersTab: tab } : p)
    );
  }

  private triggerCsvDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  downloadAll(platform: PlatformGroup, event: Event) {
    event.stopPropagation();
    if (this.downloadingPlatforms().has(platform.name)) return;
    this.downloadingPlatforms.update(s => new Set([...s, platform.name]));
    this.api.downloadCsv(platform.name, this.filters, 'all')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: blob => {
          this.triggerCsvDownload(blob, `${platform.name}-all-${this.filters.dateFrom}-${this.filters.dateTo}.csv`);
          this.downloadingPlatforms.update(s => { const n = new Set(s); n.delete(platform.name); return n; });
        },
        error: () => this.downloadingPlatforms.update(s => { const n = new Set(s); n.delete(platform.name); return n; }),
      });
  }

  downloadEnrichable(platform: PlatformGroup, event: Event) {
    event.stopPropagation();
    const key = `${platform.name}:enrichable`;
    if (this.downloadingZones().has(key)) return;
    this.downloadingZones.update(s => new Set([...s, key]));
    this.api.downloadCsv(platform.name, this.filters, 'enrichable')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: blob => {
          this.triggerCsvDownload(blob, `${platform.name}-enrichable-${this.filters.dateFrom}-${this.filters.dateTo}.csv`);
          this.downloadingZones.update(s => { const n = new Set(s); n.delete(key); return n; });
        },
        error: () => this.downloadingZones.update(s => { const n = new Set(s); n.delete(key); return n; }),
      });
  }

  downloadFailed(platform: PlatformGroup, event: Event) {
    event.stopPropagation();
    const key = `${platform.name}:failed`;
    if (this.downloadingZones().has(key)) return;
    this.downloadingZones.update(s => new Set([...s, key]));
    this.api.downloadCsv(platform.name, this.filters, 'failed')
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: blob => {
          this.triggerCsvDownload(blob, `${platform.name}-failed-${this.filters.dateFrom}-${this.filters.dateTo}.csv`);
          this.downloadingZones.update(s => { const n = new Set(s); n.delete(key); return n; });
        },
        error: () => this.downloadingZones.update(s => { const n = new Set(s); n.delete(key); return n; }),
      });
  }

  downloadGroup(platform: PlatformGroup, group: MatchedByGroup, event: Event) {
    event.stopPropagation();
    const key = `${platform.name}:${group.matchedBy}`;
    if (this.downloadingGroups().has(key)) return;
    this.downloadingGroups.update(s => new Set([...s, key]));
    const shortName = this.formatMatchedByShort(group.matchedBy).toLowerCase().replace(/\s+/g, '-');
    this.api.downloadCsv(platform.name, this.filters, 'enrichable', group.matchedBy)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: blob => {
          this.triggerCsvDownload(blob, `${platform.name}-${shortName}-${this.filters.dateFrom}-${this.filters.dateTo}.csv`);
          this.downloadingGroups.update(s => { const n = new Set(s); n.delete(key); return n; });
        },
        error: () => this.downloadingGroups.update(s => { const n = new Set(s); n.delete(key); return n; }),
      });
  }

  // ── Group tab / search / hits ─────────────────────────────────────

  setGroupTab(platformName: string, matchedBy: string, tab: 'content' | 'urls' | 'hits'): void {
    this.platforms.update(l => l.map(p => p.name !== platformName ? p : {
      ...p,
      matchedByGroups: p.matchedByGroups?.map(g => g.matchedBy !== matchedBy ? g : { ...g, activeTab: tab }),
    }));
  }

  onGroupSearch(platformName: string, matchedBy: string, val: string): void {
    this.platforms.update(l => l.map(p => p.name !== platformName ? p : {
      ...p,
      matchedByGroups: p.matchedByGroups?.map(g =>
        g.matchedBy !== matchedBy ? g : { ...g, searchVal: val }
      ),
    }));
    const group = this.platforms().find(p => p.name === platformName)
      ?.matchedByGroups?.find(g => g.matchedBy === matchedBy);
    this.loadGroupDetail(platformName, matchedBy, 0, group?.enrichable ?? false, true);
  }

  groupUrlRows(group: MatchedByGroup): { bundleId: string; requests: number; contentCount: number }[] {
    const map: Record<string, { requests: number; ids: Set<string> }> = {};
    for (const r of group.rows ?? []) {
      const key = r.bundleId || '—';
      if (!map[key]) map[key] = { requests: 0, ids: new Set() };
      map[key].requests += r.requestsAtRisk;
      map[key].ids.add(r.contentId);
    }
    return Object.entries(map)
      .map(([bundleId, v]) => ({ bundleId, requests: v.requests, contentCount: v.ids.size }))
      .sort((a, b) => b.requests - a.requests);
  }

  groupUrlMaxRequests(group: MatchedByGroup): number {
    const urls = this.groupUrlRows(group);
    return urls.length ? Math.max(...urls.map(u => u.requests)) : 1;
  }

  groupHitsMaxCount(group: MatchedByGroup): number {
    const rows = group.hitsRows ?? [];
    return rows.length ? rows[0].hits : 1;
  }

  loadGroupHits(platformName: string, matchedBy: string, reset: boolean): void {
    const g      = this.platforms().find(p => p.name === platformName)?.matchedByGroups?.find(g => g.matchedBy === matchedBy);
    const offset = reset ? 0 : (g?.hitsOffset ?? 0);
    this.platforms.update(l => l.map(p => p.name !== platformName ? p : {
      ...p,
      matchedByGroups: p.matchedByGroups?.map(g => g.matchedBy !== matchedBy ? g : {
        ...g, ...(reset ? { hitsRows: [], hitsOffset: 0, hitsLoaded: false } : {}), hitsLoading: true,
      }),
    }));
    this.api.getContentHits(platformName, this.filters, matchedBy, offset)
      .pipe(takeUntil(this.cancelTable$), takeUntil(this.destroy$))
      .subscribe({
        next: res => {
          this.platforms.update(l => l.map(p => p.name !== platformName ? p : {
            ...p,
            matchedByGroups: p.matchedByGroups?.map(g => {
              if (g.matchedBy !== matchedBy) return g;
              const existing = reset ? [] : (g.hitsRows ?? []);
              return { ...g, hitsRows: [...existing, ...res.rows], hitsHasMore: res.hasMore, hitsOffset: offset + res.rows.length, hitsLoading: false, hitsLoaded: true };
            }),
          }));
        },
        error: () => this.platforms.update(l => l.map(p => p.name !== platformName ? p : {
          ...p,
          matchedByGroups: p.matchedByGroups?.map(g => g.matchedBy !== matchedBy ? g : { ...g, hitsLoading: false }),
        })),
      });
  }

  loadGroupHitsMore(platformName: string, matchedBy: string): void {
    const g = this.platforms().find(p => p.name === platformName)?.matchedByGroups?.find(g => g.matchedBy === matchedBy);
    if (g?.hitsHasMore && !g.hitsLoading) this.loadGroupHits(platformName, matchedBy, false);
  }

  copyToClipboard(text: string): void {
    navigator.clipboard?.writeText(text).catch(() => {
      const el = document.createElement('textarea');
      el.value = text; document.body.appendChild(el); el.select();
      document.execCommand('copy'); document.body.removeChild(el);
    });
  }

  expandAll()   { this.platforms.update(l => l.map(p => ({ ...p, expanded: true  }))); }
  collapseAll() { this.platforms.update(l => l.map(p => ({ ...p, expanded: false }))); }

  fmtDeltaRate(d: number): string { return (d >= 0 ? '+' : '') + d.toFixed(2) + '%'; }
  fmtDeltaReqs(d: number): string { return (d >= 0 ? '+' : '') + this.formatNumber(Math.abs(d)) + (d < 0 ? ' lost' : ' gained'); }

  platformDeltaReqs(p: PlatformGroup): number {
    return p.totalRequests - (p.prevTotalRequests ?? 0);
  }

  platformDeltaRate(p: PlatformGroup): number {
    const prev = p.prevTotalRequests ?? 0;
    if (!prev) return 0;
    const curRate  = p.totalRequests ? (p.totalRequests - p.totalRequestsAtRisk) / p.totalRequests * 100 : 0;
    const prevFail = p.prevTotalRequestsAtRisk ?? 0;
    const prevRate = (prev - prevFail) / prev * 100;
    return curRate - prevRate;
  }

  togglePlatformSort() {
    this.platformSort.update(s => s === 'default' ? 'desc' : s === 'desc' ? 'asc' : 'default');
  }

  platformSortIcon(): string {
    const s = this.platformSort();
    if (s === 'desc') return '↓';
    if (s === 'asc')  return '↑';
    return '↕';
  }

  openPlatformDetail(platform: PlatformGroup, event: MouseEvent): void {
    event.stopPropagation();
    const { dateFrom, dateTo } = this.filters;
    const url = `/platform/${encodeURIComponent(platform.name)}?dateFrom=${dateFrom}&dateTo=${dateTo}`;
    window.open(url, '_blank');
  }

  load() { this.loadTable(); }

  formatNumber(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
    return n.toString();
  }

  formatPct(part: number, total: number): string {
    if (!total) return '0%';
    const pct = part / total * 100;
    if (pct === 0) return '0%';
    const formatted = pct.toFixed(1);
    return formatted === '0.0' ? '~0%' : formatted + '%';
  }

  formatRate(pct: number): string {
    if (pct === 0) return '0%';
    const formatted = pct.toFixed(1);
    return formatted === '0.0' ? '~0%' : formatted + '%';
  }

  formatExact(n: number): string {
    return n.toLocaleString('en-US');
  }

  totalHealthyServed(platform: PlatformGroup): number {
    return (platform.healthyGroups || []).reduce((s, g) => s + g.totalRequestsServed, 0);
  }

  formatMatchedBy(matchedBy: string): string {
    if (!matchedBy) return 'Unmatched';
    if (matchedBy.startsWith('CG_')) return 'Channel & Genre · ' + matchedBy.slice(3);
    if (matchedBy.startsWith('C_'))  return 'Content ID · '      + matchedBy.slice(2);
    if (matchedBy.startsWith('G_'))  return 'Genre · '           + matchedBy.slice(2);
    if (matchedBy.startsWith('R_'))  return 'Rating · '          + matchedBy.slice(2);
    if (matchedBy.startsWith('S_'))  return 'Series · '          + matchedBy.slice(2);
    if (matchedBy.startsWith('TS_')) return 'Title & Series · '  + matchedBy.slice(3);
    return matchedBy;
  }

  formatMatchedByShort(matchedBy: string): string {
    if (!matchedBy) return 'Unmatched';
    if (matchedBy.startsWith('CG_')) return 'Channel & Genre';
    if (matchedBy.startsWith('C_'))  return 'Content ID';
    if (matchedBy.startsWith('G_'))  return 'Genre';
    if (matchedBy.startsWith('R_'))  return 'Rating';
    if (matchedBy.startsWith('S_'))  return 'Series';
    if (matchedBy.startsWith('TS_')) return 'Title & Series';
    return matchedBy;
  }

  // Like formatMatchedBy but drops the suffix only when it equals the platform name
  // (redundant context). Keeps the suffix when it carries real information (e.g. genre names).
  formatEnrichableCategory(matchedBy: string, platformName: string): string {
    const prefixes: [string, string][] = [
      ['CG_', 'Channel & Genre'],
      ['C_',  'Content ID'],
      ['G_',  'Genre'],
      ['R_',  'Rating'],
      ['S_',  'Series'],
      ['TS_', 'Title & Series'],
    ];
    for (const [prefix, label] of prefixes) {
      if (matchedBy.startsWith(prefix)) {
        const value = matchedBy.slice(prefix.length);
        return value.toLowerCase() === platformName.toLowerCase() ? label : `${label} · ${value}`;
      }
    }
    return matchedBy || 'Unmatched';
  }
}
