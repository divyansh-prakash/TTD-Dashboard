import { Component, OnInit, OnDestroy, Output, EventEmitter, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { ApiService } from '../../../services/api.service';
import { FailureQueueFilters } from '../../../models/failure-queue.model';

@Component({
	selector: 'app-filter-header',
	standalone: true,
	imports: [CommonModule, FormsModule],
	templateUrl: './filter-header.component.html',
	styleUrl: './filter-header.component.scss',
})
export class FilterHeaderComponent implements OnInit, OnDestroy {
	@Output() filtersChanged = new EventEmitter<FailureQueueFilters>();

	dateRange = '1';

	readonly dateRangeOptions = [
		{ label: 'Yesterday', value: '1' },
		{ label: 'Last 3 days', value: '3' },
	];

	readonly regionOptions = [
		{ label: 'All regions', value: 'all'    },
		{ label: 'EU',          value: 'euc-1'  },
		{ label: 'APAC',        value: 'apse-1' },
		{ label: 'US East',     value: 'use-1'  },
		{ label: 'US West',     value: 'usw-2'  },
	];

	filters: FailureQueueFilters = {
		dateFrom: this.nDaysAgo(1),
		dateTo: this.nDaysAgo(1),
		platforms: [],
		channel: '',
		brandSafe: 'all',
		region: 'all',
	};

	get regionLabel(): string {
		return this.regionOptions.find(o => o.value === this.filters.region)?.label ?? 'All regions';
	}

	filterPlatforms = signal<string[]>([]);
	platformsOpen = signal(false);

	get platformFilterLabel(): string {
		const len = this.filters.platforms.length;
		if (len === 0) return 'All Platforms';
		if (len === 1) return this.filters.platforms[0];
		return `${len} selected`;
	}

	private destroy$ = new Subject<void>();

	constructor(private api: ApiService) { }

	ngOnInit() {
		this.api.getFilterOptions().pipe(takeUntil(this.destroy$)).subscribe({
			next: (opts) => this.filterPlatforms.set(opts.platforms),
			error: () => { },
		});
		// Emit initial filters so parent has a starting value
		this.filtersChanged.emit({ ...this.filters });
	}

	ngOnDestroy() {
		this.destroy$.next();
		this.destroy$.complete();
	}

	applyFilters() {
		this.platformsOpen.set(false);
		if (this.dateRange === '1') {
			this.filters.dateFrom = this.nDaysAgo(1);
			this.filters.dateTo = this.nDaysAgo(1);
		} else {
			const days = parseInt(this.dateRange, 10);
			this.filters.dateFrom = this.nDaysAgo(days);
			this.filters.dateTo = this.today();
		}
		this.filtersChanged.emit({ ...this.filters });
	}

	setRegion(v: string): void { this.filters = { ...this.filters, region: v }; }

	resetFilters() {
		this.dateRange = '1';
		this.filters = { dateFrom: this.nDaysAgo(1), dateTo: this.nDaysAgo(1), platforms: [], channel: '', brandSafe: 'all', region: 'all' };
		this.platformsOpen.set(false);
		this.filtersChanged.emit({ ...this.filters });
	}

	togglePlatformsDropdown() { this.platformsOpen.update(v => !v); }
	closePlatformsDropdown() { this.platformsOpen.set(false); }

	isPlatformSelected(p: string) { return this.filters.platforms.includes(p); }

	togglePlatformFilter(p: string) {
		const idx = this.filters.platforms.indexOf(p);
		this.filters.platforms = idx >= 0
			? this.filters.platforms.filter(x => x !== p)
			: [...this.filters.platforms, p];
	}

	clearPlatformFilter() { this.filters.platforms = []; }

	private today() { return new Date().toISOString().slice(0, 10); }
	private nDaysAgo(n: number) { return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10); }
}
