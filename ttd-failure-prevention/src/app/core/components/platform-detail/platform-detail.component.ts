import {
	Component, OnInit, OnDestroy, ViewChild, ElementRef,
	signal, computed, effect, PLATFORM_ID, Inject,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../services/api.service';
import {
	PlatformSummaryResponse,
	PlatformSummaryCategory,
	FailedRow,
	ContentHit,
} from '../../models/failure-queue.model';

interface CatState {
	expanded: boolean;
	activeTab: 'content' | 'urls' | 'hits';
	searchVal: string;
	rows: FailedRow[];
	rowsLoading: boolean;
	rowsOffset: number;
	rowsHasMore: boolean;
	hitsRows:    ContentHit[];
	hitsLoading: boolean;
	hitsLoaded:  boolean;
	hitsOffset:  number;
	hitsHasMore: boolean;
	downloading: boolean;
}

const PIE_COLORS = {
	deep: '#22C55E',  // green  – deep/direct content match
	shallow: '#F8A54A',  // light yellow-orange – shallow match
	failed: '#EF4444',  // red    – failure
	unknown: '#9AA0A6',  // gray   – unknown
};

@Component({
	selector: 'app-platform-detail',
	standalone: true,
	imports: [CommonModule, FormsModule],
	templateUrl: './platform-detail.component.html',
	styleUrl: './platform-detail.component.scss',
})
export class PlatformDetailComponent implements OnInit, OnDestroy {
	@ViewChild('pieCanvas') pieCanvas!: ElementRef<HTMLCanvasElement>;

	platformName = signal('');
	dateRange = '1';
	region    = 'all';

	readonly dateRangeOptions = [
		{ label: 'Yesterday',   value: '1' },
		{ label: 'Last 3 days', value: '3' },
	];

	readonly regionOptions = [
		{ label: 'All regions', value: 'all'    },
		{ label: 'EU',          value: 'euc-1'  },
		{ label: 'APAC',        value: 'apse-1' },
		{ label: 'US East',     value: 'use-1'  },
		{ label: 'US West',     value: 'usw-2'  },
	];

	dateFrom = signal('');
	dateTo   = signal('');

	loading = signal(false);
	error = signal('');
	summary = signal<PlatformSummaryResponse | null>(null);

	// ── Category accordion state ──────────────────────────────────────
	private catStates = signal<Record<string, CatState>>({});
	catSort = signal<'default' | 'desc' | 'asc'>('default');

	sortedCategoriesDisplay = computed(() => {
		const cats = this.sortedCategories();
		const order = this.catSort();
		if (order === 'default') return cats;
		return [...cats].sort((a, b) => order === 'desc' ? b.requests - a.requests : a.requests - b.requests);
	});

	// Categories sorted by defined order
	sortedCategories = computed(() => {
		const s = this.summary();
		if (!s) return [];
		return [...s.categories].sort(
			(a, b) => this.catOrder(a.matchedBy) - this.catOrder(b.matchedBy),
		);
	});

	// Legend items for pie chart (right-bottom)
	pieLegend = computed(() => {
		const s = this.summary();
		if (!s) return [];
		const t = s.totalRequests || 1;
		const items = [
			{ label: 'Content ID', value: s.deepRequests, color: PIE_COLORS.deep },
			{ label: 'Shallow', value: s.shallowRequests, color: PIE_COLORS.shallow },
			{ label: 'Failed', value: s.failedCount, color: PIE_COLORS.failed },
		];
		if (s.unknownRequests > 0)
			items.push({ label: 'Unknown', value: s.unknownRequests, color: PIE_COLORS.unknown });
		return items.map(i => ({ ...i, pct: (i.value / t * 100).toFixed(1) }));
	});

	private chartInstance: any = null;
	private renderVer = 0;           // incremented on every render request; stale async renders abort
	private destroy$ = new Subject<void>();

	constructor(
		private route: ActivatedRoute,
		private api: ApiService,
		@Inject(PLATFORM_ID) private platformId: object,
	) {
		// Re-render chart whenever summary changes (browser only)
		effect(() => {
			const s = this.summary();
			if (s && isPlatformBrowser(this.platformId)) {
				setTimeout(() => this.renderChart(s), 0);
			}
		});
	}

	ngOnInit(): void {
		const name = this.route.snapshot.paramMap.get('name') || '';
		this.platformName.set(decodeURIComponent(name));

		const qp = this.route.snapshot.queryParamMap;
		const df = qp.get('dateFrom') || this.nDaysAgo(1);
		const dt = qp.get('dateTo') || this.nDaysAgo(1);
		this.dateFrom.set(df);
		this.dateTo.set(dt);
		this.dateRange = this.detectRange(df, dt);

		this.loadAll();
	}

	ngOnDestroy(): void {
		this.chartInstance?.destroy();
		this.destroy$.next();
		this.destroy$.complete();
	}

	private loadAll(): void { this.loadSummary(); }

	private filters(): { dateFrom: string; dateTo: string; region: string } {
		return { dateFrom: this.dateFrom(), dateTo: this.dateTo(), region: this.region };
	}

	loadSummary(): void {
		this.loading.set(true);
		this.error.set('');
		this.api.getPlatformSummary(this.platformName(), this.filters())
			.pipe(takeUntil(this.destroy$))
			.subscribe({
				next: d => { this.summary.set(d); this.loading.set(false); },
				error: e => { this.error.set(e.message || 'Failed to load'); this.loading.set(false); },
			});
	}

	// ── Category accordion ───────────────────────────────────────────

	private defaultCatState(): CatState {
		return { expanded: false, activeTab: 'content', searchVal: '', rows: [], rowsLoading: false, rowsOffset: 0, rowsHasMore: false, hitsRows: [], hitsLoading: false, hitsLoaded: false, hitsOffset: 0, hitsHasMore: false, downloading: false };
	}

	getCatState(mb: string): CatState {
		return this.catStates()[mb] ?? this.defaultCatState();
	}

	private patchCat(mb: string, patch: Partial<CatState>): void {
		this.catStates.update(s => ({ ...s, [mb]: { ...(s[mb] ?? this.defaultCatState()), ...patch } }));
	}

	private catIsEnrichable(mb: string): boolean {
		const cat = this.sortedCategories().find(c => c.matchedBy === mb);
		return cat ? cat.type !== 'fail' : false;
	}

	toggleCat(mb: string): void {
		const opening = !this.getCatState(mb).expanded;
		this.patchCat(mb, { expanded: opening });
		if (opening) {
			const s = this.getCatState(mb);
			if (s.rows.length === 0 && !s.rowsLoading)   this.loadCatRows(mb, true);
			if (!s.hitsLoaded      && !s.hitsLoading)    this.loadCatHits(mb, true);
		}
	}

	setCatTab(mb: string, tab: 'content' | 'urls' | 'hits'): void {
		this.patchCat(mb, { activeTab: tab });
	}

	loadCatHits(mb: string, reset = true): void {
		const s      = this.getCatState(mb);
		const offset = reset ? 0 : s.hitsOffset;
		if (reset) this.patchCat(mb, { hitsRows: [], hitsOffset: 0, hitsLoaded: false });
		this.patchCat(mb, { hitsLoading: true });
		this.api.getContentHits(this.platformName(), this.filters(), mb, offset)
			.pipe(takeUntil(this.destroy$))
			.subscribe({
				next: res => {
					const cur = this.getCatState(mb);
					this.patchCat(mb, {
						hitsRows:    reset ? res.rows : [...cur.hitsRows, ...res.rows],
						hitsHasMore: res.hasMore,
						hitsOffset:  offset + res.rows.length,
						hitsLoading: false,
						hitsLoaded:  true,
					});
				},
				error: () => this.patchCat(mb, { hitsLoading: false }),
			});
	}

	loadCatHitsMore(mb: string): void {
		const s = this.getCatState(mb);
		if (s.hitsHasMore && !s.hitsLoading) this.loadCatHits(mb, false);
	}

	hitsMaxCount(mb: string): number {
		const rows = this.getCatState(mb).hitsRows;
		return rows.length ? rows[0].hits : 1;
	}

	onCatSearch(mb: string, val: string): void {
		this.patchCat(mb, { searchVal: val });
		this.loadCatRows(mb, true);
	}

	loadCatRows(mb: string, reset: boolean): void {
		const s = this.getCatState(mb);
		const offset = reset ? 0 : s.rowsOffset;
		if (reset) this.patchCat(mb, { rows: [], rowsOffset: 0 });
		this.patchCat(mb, { rowsLoading: true });

		this.api.getPlatformDetail(
			this.platformName(),
			this.filters(),
			mb, offset, 50, this.catIsEnrichable(mb), this.getCatState(mb).searchVal,
		).pipe(takeUntil(this.destroy$))
			.subscribe({
				next: d => {
					const cur = this.getCatState(mb);
					this.patchCat(mb, {
						rows: reset ? d.rows : [...cur.rows, ...d.rows],
						rowsHasMore: d.meta.hasMore,
						rowsOffset: offset + d.rows.length,
						rowsLoading: false,
					});
				},
				error: () => this.patchCat(mb, { rowsLoading: false }),
			});
	}

	toggleCatSort(): void {
		this.catSort.update(s => s === 'default' ? 'desc' : s === 'desc' ? 'asc' : 'default');
	}

	catSortIcon(): string {
		const s = this.catSort();
		if (s === 'desc') return '↓';
		if (s === 'asc') return '↑';
		return '↕';
	}

	catExtraLabel(mb: string): string {
		if (mb.startsWith('TS_')) return 'Title';
		if (mb.startsWith('S_')) return 'Series';
		if (mb.startsWith('G_')) return 'Genre';
		if (mb.startsWith('R_')) return 'Rating';
		if (mb.startsWith('CG_')) return 'Channel & Genre';
		return '';
	}

	catExtraValue(mb: string, row: FailedRow): string {
		if (mb.startsWith('TS_')) return row.title || '—';
		if (mb.startsWith('S_')) return row.series || '—';
		if (mb.startsWith('G_')) return row.segment || '—';
		if (mb.startsWith('R_')) return row.segment || '—';
		if (mb.startsWith('CG_')) return row.segment || '—';
		return '—';
	}

	catDownloadLabel(mb: string): string {
		const s = this.getCatState(mb);
		if (s.expanded && s.activeTab === 'urls') return 'URLs CSV';
		if (s.expanded && s.activeTab === 'hits') return 'Hits CSV';
		return this.catIsEnrichable(mb) ? 'Served CSV' : 'Failed CSV';
	}

	loadCatMore(mb: string): void {
		const s = this.getCatState(mb);
		if (s.rowsHasMore && !s.rowsLoading) this.loadCatRows(mb, false);
	}

	catUrlRows(mb: string): { bundleId: string; requests: number; contentCount: number }[] {
		// For Unmatched use pre-aggregated summary data (complete, not paginated)
		if (mb === 'Unmatched') {
			const q = this.getCatState(mb).searchVal.toLowerCase();
			const urls = this.summary()?.unmatchedUrls ?? [];
			return q ? urls.filter(u => u.bundleId.toLowerCase().includes(q)) : urls;
		}
		// For enrichable categories, derive from loaded content rows
		const map: Record<string, { requests: number; ids: Set<string> }> = {};
		for (const r of this.getCatState(mb).rows) {
			const key = r.bundleId || '—';
			if (!map[key]) map[key] = { requests: 0, ids: new Set() };
			map[key].requests += r.requestsAtRisk;
			map[key].ids.add(r.contentId);
		}
		return Object.entries(map)
			.map(([bundleId, v]) => ({ bundleId, requests: v.requests, contentCount: v.ids.size }))
			.sort((a, b) => b.requests - a.requests);
	}

	catUrlMaxRequests(mb: string): number {
		const urls = this.catUrlRows(mb);
		return urls.length ? Math.max(...urls.map(u => u.requests)) : 1;
	}

	catUrlBarWidth(mb: string, requests: number): number {
		const max = this.catUrlMaxRequests(mb);
		return max ? Math.max(0.3, (requests / max) * 100) : 0;
	}

	downloadCat(mb: string): void {
		const s = this.getCatState(mb);
		// Hits tab — client-side CSV from loaded hits
		if (s.expanded && s.activeTab === 'hits') {
			const rows = s.hitsRows;
			const header = 'Content ID,Hits,Title,Series\n';
			const body = rows.map(r => `"${r.contentId}",${r.hits},"${r.title}","${r.series}"`).join('\n');
			this.triggerDownload(new Blob([header + body], { type: 'text/csv' }), `${this.platformName()}-${mb}-hits-${this.dateFrom()}.csv`);
			return;
		}
		// URLs tab — client-side CSV from loaded rows
		if (s.expanded && s.activeTab === 'urls') {
			const urls = this.catUrlRows(mb);
			const header = 'Bundle ID,Requests,Content IDs\n';
			const body = urls.map(u => `"${u.bundleId}",${u.requests},${u.contentCount}`).join('\n');
			this.triggerDownload(new Blob([header + body], { type: 'text/csv' }), `${this.platformName()}-${mb}-urls-${this.dateFrom()}.csv`);
			return;
		}
		if (s.downloading) return;
		this.patchCat(mb, { downloading: true });
		const enrichable = this.catIsEnrichable(mb);
		this.api.downloadCsv(
			this.platformName(),
			this.filters(),
			enrichable ? 'enrichable' : 'failed',
			enrichable ? mb : undefined,
		).pipe(takeUntil(this.destroy$))
			.subscribe({
				next: blob => {
					this.triggerDownload(blob, `${this.platformName()}-${mb}-${enrichable ? 'served' : 'failed'}-${this.dateFrom()}.csv`);
					this.patchCat(mb, { downloading: false });
				},
				error: () => this.patchCat(mb, { downloading: false }),
			});
	}

	onDateRangeChange(): void {
		const n = parseInt(this.dateRange, 10);
		if (n === 1) { const y = this.nDaysAgo(1); this.dateFrom.set(y); this.dateTo.set(y); }
		else { this.dateFrom.set(this.nDaysAgo(n)); this.dateTo.set(this.today()); }
		this.catStates.set({});
		this.catSort.set('default');
		this.loadAll();
	}

	onRegionChange(): void {
		this.catStates.set({});
		this.catSort.set('default');
		this.loadAll();
	}

	goBack(): void { window.close(); }

	copyToClipboard(text: string): void {
		navigator.clipboard?.writeText(text).catch(() => {
			const el = document.createElement('textarea');
			el.value = text;
			document.body.appendChild(el);
			el.select();
			document.execCommand('copy');
			document.body.removeChild(el);
		});
	}

	private triggerDownload(blob: Blob, filename: string): void {
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url; a.download = filename; a.click();
		URL.revokeObjectURL(url);
	}

	// ── Format helpers ──────────────────────────────────────────────

	formatNumber(n: number): string {
		if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
		if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
		return String(n);
	}

	formatPct(part: number, total: number): string {
		if (!total) return '0%';
		return (part / total * 100).toFixed(1) + '%';
	}

	/** Returns just the type name — no identifier, no platform name */
	formatMatchedBy(mb: string): string {
		if (!mb || mb === 'Unmatched') return 'Unmatched';
		if (mb.startsWith('C_')) return 'Content ID';
		if (mb.startsWith('TS_')) return 'Title & Series';
		if (mb.startsWith('S_')) return 'Series';
		if (mb.startsWith('G_')) return 'Genre';
		if (mb.startsWith('R_')) return 'Rating';
		if (mb.startsWith('CG_')) return 'Channel & Genre';
		return mb;
	}

	barWidth(cat: PlatformSummaryCategory): number {
		const s = this.summary();
		if (!s || s.totalRequests === 0) return 0;
		return Math.max(0.3, (cat.requests / s.totalRequests) * 100);
	}

	dateLabel(): string {
		const df = this.dateFrom(), dt = this.dateTo();
		return df === dt ? df : `${df} → ${dt}`;
	}

	// ── Private helpers ─────────────────────────────────────────────

	private today(): string { return new Date().toISOString().slice(0, 10); }
	private nDaysAgo(n: number) { return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10); }

	private detectRange(df: string, dt: string): string {
		const yest = this.nDaysAgo(1);
		if (df === yest && dt === yest) return '1';
		if (df === this.nDaysAgo(3) && dt === this.today()) return '3';
		return '1';
	}

	private catOrder(mb: string): number {
		if (!mb || mb === 'Unmatched') return 99;
		if (mb.startsWith('C_')) return 0;
		if (mb.startsWith('TS_')) return 1;
		if (mb.startsWith('S_')) return 2;
		if (mb.startsWith('G_')) return 3;
		if (mb.startsWith('R_')) return 4;
		if (mb.startsWith('CG_')) return 5;
		return 6;
	}

	private async renderChart(s: PlatformSummaryResponse): Promise<void> {
		const ver = ++this.renderVer;           // claim this render slot
		const canvas = this.pieCanvas?.nativeElement;
		if (!canvas) return;

		const { Chart, PieController, ArcElement, Tooltip } = await import('chart.js');
		Chart.register(PieController, ArcElement, Tooltip);

		if (ver !== this.renderVer) return;     // a newer render was requested while we were importing

		this.chartInstance?.destroy();
		this.chartInstance = null;

		const t = s.totalRequests || 1;
		const data = [
			{ label: 'Content ID', value: s.deepRequests, color: PIE_COLORS.deep },
			{ label: 'Shallow', value: s.shallowRequests, color: PIE_COLORS.shallow },
			{ label: 'Failed', value: s.failedCount, color: PIE_COLORS.failed },
			{ label: 'Unknown', value: s.unknownRequests, color: PIE_COLORS.unknown },
		].filter(d => d.value > 0);

		this.chartInstance = new Chart(canvas, {
			type: 'pie',
			data: {
				labels: data.map(d => d.label),
				datasets: [{
					data: data.map(d => d.value),
					backgroundColor: data.map(d => d.color),
					borderWidth: 2,
					borderColor: '#ffffff',
					hoverOffset: 8,
				}],
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,  // fill the flex container — parent owns the height
				animation: { duration: 500 },
				layout: { padding: { top: 6 } },
				plugins: {
					legend: { display: false },
					tooltip: {
						padding: 10,
						bodyFont: { size: 13, weight: 'bold' as const },
						callbacks: {
							label: ctx => {
								const pct = ((ctx.raw as number) / t * 100).toFixed(1);
								return `  ${pct}%  (${this.formatNumber(ctx.raw as number)} reqs)`;
							},
						},
					},
				},
			},
		});
	}
}
