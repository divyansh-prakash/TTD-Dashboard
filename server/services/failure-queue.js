const {
	getCtvFailedAgg,
	getCtvTotalAgg,
	getFailedContentRowsByUrls,
	getAllFailedContentRowsByUrls,
	getAllFailedContentRowsExcludingUrls,
	getFailedContentRowsExcludingUrls,
	getServedContentRowsByUrls,
	getAllServedContentRowsByUrls,
	getServedContentRowsExcludingUrls,
	getAllServedContentRowsExcludingUrls,
	getHealthyCategoryTotals,
	getUnmatchedUrlBreakdown,
	getCtvContentHits,
	getSegmentRankings,
	getSegmentDetail,
	getPlatformSegmentCounts,
	getPlatformSegmentDetail,
} = require('../repositories/ctvStats.repo');
const { getAllPlatformUrlMappings, getDistinctPlatforms } = require('../repositories/platformUrlMap.repo');
const { toFailedRow } = require('../models/failure-queue');

// ── Helpers ──────────────────────────────────────────────────────────────────

function sortMatchedByGroups(map) {
	return Object.values(map).sort((a, b) => {
		const aIsC = a.matchedBy.startsWith('C_');
		const bIsC = b.matchedBy.startsWith('C_');
		if (aIsC && !bIsC) return -1;
		if (!aIsC && bIsC) return 1;
		if (a.matchedBy === 'Unmatched') return 1;
		if (b.matchedBy === 'Unmatched') return -1;
		return b.totalRequestsAtRisk - a.totalRequestsAtRisk;
	});
}

function accumMatchedBy(map, mbKey, contentCount, reqTotal) {
	if (!map[mbKey]) map[mbKey] = { matchedBy: mbKey, failedCount: 0, totalRequestsAtRisk: 0, rows: [] };
	map[mbKey].failedCount += contentCount;
	map[mbKey].totalRequestsAtRisk += reqTotal;
}

// ── Service methods ───────────────────────────────────────────────────────────

async function getByPlatform({ dateFrom, dateTo, platformList, channel, brandSafe, region = 'all', limit, offset }) {
	console.log(`[SVC:failure-queue] getByPlatform dateFrom=${dateFrom} dateTo=${dateTo} platforms=[${platformList}] limit=${limit} offset=${offset}`);

	const urlMap = await getAllPlatformUrlMappings();
	const mappedUrls = Array.from(urlMap.keys());
	const includeOthers = !platformList.length;

	// Previous period window (same length, ending the day before dateFrom)
	const msPerDay = 86400000;
	const fromMs = new Date(dateFrom).getTime();
	const toMs = new Date(dateTo).getTime();
	const windowDays = Math.round((toMs - fromMs) / msPerDay) + 1;
	const prevDateTo = new Date(fromMs - msPerDay).toISOString().slice(0, 10);
	const prevDateFrom = new Date(fromMs - windowDays * msPerDay).toISOString().slice(0, 10);

	// Scope the healthy query to only the selected platform's URLs when a filter
	// is active — avoids scanning all 270+ mapped URLs for success=1 rows.
	const healthyUrls = platformList.length
		? [...urlMap.entries()].filter(([, p]) => platformList.includes(p.toLowerCase())).map(([url]) => url)
		: mappedUrls;

	const [urlRows, othersMatchedRows, othersTopUrlRows, healthyRows, totalUrlRows, othersTotalRows, prevTotalUrlRows, prevFailedUrlRows] = await Promise.all([
		getCtvFailedAgg({ dateFrom, dateTo, brandSafe, region, urls: mappedUrls, groupBy: 'url,matchedby' }),
		includeOthers ? getCtvFailedAgg({ dateFrom, dateTo, brandSafe, region, excludeUrls: mappedUrls, groupBy: 'matchedby' }) : Promise.resolve([]),
		includeOthers ? getCtvFailedAgg({ dateFrom, dateTo, brandSafe, region, excludeUrls: mappedUrls, groupBy: 'url', limit: 100 }) : Promise.resolve([]),
		getHealthyCategoryTotals({ dateFrom, dateTo, brandSafe, region, urls: healthyUrls }),
		getCtvTotalAgg({ dateFrom, dateTo, brandSafe, region, urls: mappedUrls, groupBy: 'url' }),
		includeOthers ? getCtvTotalAgg({ dateFrom, dateTo, brandSafe, region, excludeUrls: mappedUrls, groupBy: 'url' }) : Promise.resolve([]),
		getCtvTotalAgg({ dateFrom: prevDateFrom, dateTo: prevDateTo, brandSafe, region, urls: mappedUrls, groupBy: 'url' }),
		getCtvFailedAgg({ dateFrom: prevDateFrom, dateTo: prevDateTo, brandSafe, region, urls: mappedUrls, groupBy: 'url' }),
	]);

	console.log(`[SVC:failure-queue] phase1 urlRows=${urlRows.length} othersMatchedRows=${othersMatchedRows.length} othersTopUrls=${othersTopUrlRows.length} healthyRows=${healthyRows.length} totalUrlRows=${totalUrlRows.length}`);

	// Build per-platform total requests map (success=0+1)
	const platformTotalMap = {};
	for (const row of totalUrlRows) {
		const appName = urlMap.get(row.url);
		if (!appName) continue;
		if (platformList.length && !platformList.includes(appName.toLowerCase())) continue;
		platformTotalMap[appName] = (platformTotalMap[appName] || 0) + Number(row.req_total);
	}
	if (othersTotalRows.length) {
		platformTotalMap['Others'] = othersTotalRows.reduce((s, r) => s + Number(r.req_total), 0);
	}

	// Previous period per-platform maps
	const prevPlatformTotalMap = {};
	for (const row of prevTotalUrlRows) {
		const appName = urlMap.get(row.url);
		if (!appName) continue;
		if (platformList.length && !platformList.includes(appName.toLowerCase())) continue;
		prevPlatformTotalMap[appName] = (prevPlatformTotalMap[appName] || 0) + Number(row.req_total);
	}
	const prevPlatformFailedMap = {};
	for (const row of prevFailedUrlRows) {
		const appName = urlMap.get(row.url);
		if (!appName) continue;
		if (platformList.length && !platformList.includes(appName.toLowerCase())) continue;
		prevPlatformFailedMap[appName] = (prevPlatformFailedMap[appName] || 0) + Number(row.req_total);
	}

	const platformMap = {};

	for (const row of urlRows) {
		const appName = urlMap.get(row.url) || 'Others';
		const reqTotal = Number(row.req_total);
		const contentCount = Number(row.content_count);

		if (platformList.length && !platformList.includes(appName.toLowerCase())) continue;
		if (channel !== 'all' && (row.channel || '').toLowerCase() !== channel.toLowerCase()) continue;

		if (!platformMap[appName]) {
			platformMap[appName] = { name: appName, failedCount: 0, totalRequestsAtRisk: 0, totalRequests: 0, rows: [], matchedByMap: {} };
		}
		platformMap[appName].failedCount += contentCount;
		platformMap[appName].totalRequestsAtRisk += reqTotal;

		const mbKey = (row.matchedby || '').trim() || 'Unmatched';
		accumMatchedBy(platformMap[appName].matchedByMap, mbKey, contentCount, reqTotal);
	}

	// Build a per-platform map of healthy (success=1) request totals by matchedby.
	const healthyPlatformMap = {};
	for (const row of healthyRows) {
		const appName = urlMap.get(row.url);
		if (!appName || appName === 'Others') continue;
		if (platformList.length && !platformList.includes(appName.toLowerCase())) continue;
		if (!healthyPlatformMap[appName]) healthyPlatformMap[appName] = {};
		const mb = row.matchedby;
		healthyPlatformMap[appName][mb] = (healthyPlatformMap[appName][mb] || 0) + Number(row.req_served);
	}

	if (includeOthers && othersMatchedRows.length) {
		let totalRequests = 0, totalContent = 0;
		const othersMatchedByMap = {};
		for (const row of othersMatchedRows) {
			const reqTotal = Number(row.req_total);
			const contentCount = Number(row.content_count);
			totalRequests += reqTotal;
			totalContent += contentCount;
			const mbKey = (row.matchedby || '').trim() || 'Unmatched';
			accumMatchedBy(othersMatchedByMap, mbKey, contentCount, reqTotal);
		}
		platformMap['Others'] = {
			name: 'Others',
			failedCount: totalContent,
			totalRequestsAtRisk: totalRequests,
			rows: [],
			matchedByMap: othersMatchedByMap,
			urlSummary: othersTopUrlRows.map(r => ({
				bundleId: r.url || '',
				totalRequestsAtRisk: Number(r.req_total),
				hitCount: Number(r.content_count),
			})),
		};
	}

	const platforms = Object.values(platformMap)
		.map(p => {
			const { matchedByMap, ...rest } = p;
			const healthyMap = healthyPlatformMap[p.name] || {};

			// Merge healthy-only groups (success=1, never failed for this matchedBy)
			// into matchedByMap so all segments appear in one unified list.
			for (const [mb] of Object.entries(healthyMap)) {
				if (!matchedByMap[mb]) {
					matchedByMap[mb] = { matchedBy: mb, failedCount: 0, totalRequestsAtRisk: 0, rows: [] };
				}
			}

			const matchedByGroups = Object.values(matchedByMap)
				.map(group => {
					const served = (group.matchedBy && group.matchedBy !== 'Unmatched')
						? (healthyMap[group.matchedBy] || 0)
						: 0;
					return {
						...group,
						totalRequestsServed: served,
						totalRequests: group.totalRequestsAtRisk + served,
					};
				})
				.sort((a, b) => {
					if (a.matchedBy === 'Unmatched') return 1;
					if (b.matchedBy === 'Unmatched') return -1;
					return b.totalRequests - a.totalRequests;
				});

			// Requests served with no segment tag (success=1, matchedBy='').
			// These don't appear in healthyMap (which filters matchedby != '') or
			// in matchedByMap (which filters success=0). Shown as a non-expandable row.
			const totalServedWithSegment = Object.values(healthyMap).reduce((s, v) => s + v, 0);
			const directServedRequests = Math.max(0,
				(platformTotalMap[p.name] || 0) - p.totalRequestsAtRisk - totalServedWithSegment
			);

			const prevTotal = prevPlatformTotalMap[p.name] || 0;
			const prevFailed = prevPlatformFailedMap[p.name] || 0;
			return { ...rest, matchedByGroups, directServedRequests, totalRequests: platformTotalMap[p.name] || 0, prevTotalRequests: prevTotal, prevTotalRequestsAtRisk: prevFailed };
		})
		.sort((a, b) => {
			if (a.name === 'Others') return 1;
			if (b.name === 'Others') return -1;
			return b.totalRequestsAtRisk - a.totalRequestsAtRisk;
		});

	const total = platforms.length;
	return {
		platforms: platforms.slice(offset, offset + limit),
		meta: { dateFrom, dateTo, rowCount: urlRows.length, total, offset, limit },
	};
}

async function getByPlatformDetail({ platform, dateFrom, dateTo, brandSafe, matchedBy, enrichable, search, region = 'all', limit, offset }) {
	console.log(`[SVC:failure-queue] getByPlatformDetail platform=${platform} matchedBy=${matchedBy} enrichable=${enrichable} search=${search} limit=${limit} offset=${offset}`);

	const urlMap = await getAllPlatformUrlMappings();
	const filters = { dateFrom, dateTo, brandSafe, region };
	let rawRows;

	if (platform === 'Others') {
		const mappedUrls = Array.from(urlMap.keys());
		rawRows = enrichable
			? await getServedContentRowsExcludingUrls({ ...filters, excludeUrls: mappedUrls, matchedBy, limit, offset })
			: await getFailedContentRowsExcludingUrls({ ...filters, excludeUrls: mappedUrls, matchedBy, limit, offset });
	} else {
		const platformUrls = [...urlMap.entries()]
			.filter(([, p]) => p.toLowerCase() === platform.toLowerCase())
			.map(([url]) => url);
		if (!platformUrls.length) return { rows: [], meta: { offset, limit, hasMore: false } };
		rawRows = enrichable
			? await getServedContentRowsByUrls({ ...filters, urls: platformUrls, matchedBy, search, limit, offset })
			: await getFailedContentRowsByUrls({ ...filters, urls: platformUrls, matchedBy, search, limit, offset });
	}

	const rows = rawRows.map(toFailedRow);
	return { rows, meta: { offset, limit, hasMore: rows.length === limit } };
}

async function getPlatformSummary({ platform, dateFrom, dateTo, brandSafe, region = 'all' }) {
	console.log(`[SVC:failure-queue] getPlatformSummary platform=${platform} dateFrom=${dateFrom} dateTo=${dateTo}`);

	const urlMap = await getAllPlatformUrlMappings();
	const platformUrls = [...urlMap.entries()]
		.filter(([, p]) => p.toLowerCase() === platform.toLowerCase())
		.map(([url]) => url);

	if (!platformUrls.length) return null;

	const filters = { dateFrom, dateTo, brandSafe, region };

	const [totalRows, failedByMb, servedByMb, unmatchedUrlRows] = await Promise.all([
		getCtvTotalAgg({ ...filters, urls: platformUrls, groupBy: 'url' }),
		getCtvFailedAgg({ ...filters, urls: platformUrls, groupBy: 'matchedby' }),
		getHealthyCategoryTotals({ ...filters, urls: platformUrls }),
		getUnmatchedUrlBreakdown({ ...filters, urls: platformUrls }),
	]);

	const totalRequests = totalRows.reduce((s, r) => s + Number(r.req_total), 0);
	const failedCount = failedByMb.reduce((s, r) => s + Number(r.req_total), 0);
	const successCount = totalRequests - failedCount;

	// Aggregate served by matchedby across all URLs
	const servedMap = {};
	for (const row of servedByMb) {
		servedMap[row.matchedby] = (servedMap[row.matchedby] || 0) + Number(row.req_served);
	}

	// Build unified category map (served + failed per matchedby)
	const catMap = {};
	for (const row of failedByMb) {
		const mb = (row.matchedby || '').trim() || 'Unmatched';
		if (!catMap[mb]) catMap[mb] = { matchedBy: mb, served: 0, failed: 0 };
		catMap[mb].failed += Number(row.req_total);
	}
	for (const [mb, served] of Object.entries(servedMap)) {
		const key = mb || 'Direct';
		if (!catMap[key]) catMap[key] = { matchedBy: key, served: 0, failed: 0 };
		catMap[key].served += served;
	}

	// Bucket totals for the pie chart
	let deepRequests = 0, shallowRequests = 0, unknownRequests = 0;
	for (const [mb, cat] of Object.entries(catMap)) {
		const total = cat.served + cat.failed;
		if (mb === 'Unmatched' || mb === '') continue; // failedCount already accounts for this
		if (mb === 'Direct') { unknownRequests += total; }
		else if (mb.startsWith('C_')) { deepRequests += total; }
		else { shallowRequests += total; }
	}

	const enrichableCount = Object.keys(servedMap).filter(mb => mb).length;

	const categories = Object.values(catMap)
		.filter(c => c.matchedBy !== 'Direct')
		.map(c => {
			const total = c.served + c.failed;
			const type = c.matchedBy === 'Unmatched' ? 'fail'
				: c.matchedBy.startsWith('C_') ? 'deep' : 'shallow';
			return {
				matchedBy: c.matchedBy, requests: total, served: c.served, failed: c.failed,
				pct: totalRequests > 0 ? (total / totalRequests) * 100 : 0, type
			};
		})
		.sort((a, b) => {
			if (a.type === 'fail') return 1;
			if (b.type === 'fail') return -1;
			if (a.matchedBy.startsWith('C_') && !b.matchedBy.startsWith('C_')) return -1;
			if (!a.matchedBy.startsWith('C_') && b.matchedBy.startsWith('C_')) return 1;
			return b.requests - a.requests;
		});

	return {
		platform, dateFrom, dateTo,
		totalRequests, successCount, failedCount, enrichableCount,
		deepRequests, shallowRequests, unknownRequests,
		categories,
		unmatchedUrls: unmatchedUrlRows.map(r => ({
			bundleId: r.url, requests: Number(r.req_total), contentCount: Number(r.content_count),
		})),
	};
}

async function getFilterOptions() {
	const platforms = await getDistinctPlatforms();
	return { platforms };
}

async function getTrend({ dateFrom, dateTo, platform, brandSafe, region = 'all' }) {
	const isSingleDay = dateFrom === dateTo;
	const isPlatformFiltered = platform && platform !== 'all';
	const filters = { dateFrom, dateTo, brandSafe, region };

	console.log(`[SVC:failure-queue] getTrend dateFrom=${dateFrom} dateTo=${dateTo} platform=${platform} branch=${isSingleDay ? 'hourly' : isPlatformFiltered ? 'daily-by-platform' : 'daily-all'}`);

	// Resolve platform URLs once — used for both hourly and daily platform-scoped queries.
	let platformUrls = [];
	if (isPlatformFiltered) {
		const urlMap = await getAllPlatformUrlMappings();
		platformUrls = [...urlMap.entries()]
			.filter(([, p]) => p.toLowerCase() === platform.toLowerCase())
			.map(([url]) => url);
		if (!platformUrls.length) return { dates: [], series: [], granularity: isSingleDay ? 'hourly' : 'daily' };
	}

	if (isSingleDay) {
		const [failedRows, totalRows] = await Promise.all([
			getCtvFailedAgg({ dateFrom, dateTo: dateFrom, brandSafe, region, urls: platformUrls, groupBy: 'hour' }),
			getCtvTotalAgg({ dateFrom, dateTo: dateFrom, brandSafe, region, urls: platformUrls, groupBy: 'hour' }),
		]);
		const labels = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);
		const failData = labels.map((_, h) => Number(failedRows.find(r => Number(r.hour) === h)?.req_total || 0));
		const totalData = labels.map((_, h) => Number(totalRows.find(r => Number(r.hour) === h)?.req_total || 0));
		const name = isPlatformFiltered ? platform : 'All Platforms';
		return {
			dates: labels,
			series: [{ name: `${name} — Failed`, data: failData }, { name: `${name} — Total`, data: totalData }],
			granularity: 'hourly',
		};
	}

	const [failedRows, totalRows] = await Promise.all([
		getCtvFailedAgg({ ...filters, urls: platformUrls, groupBy: 'date' }),
		getCtvTotalAgg({ ...filters, urls: platformUrls, groupBy: 'date' }),
	]);
	const dates = Array.from(new Set([...failedRows.map(r => r.date), ...totalRows.map(r => r.date)])).sort();
	const failMap = {};
	for (const row of failedRows) failMap[row.date] = (failMap[row.date] || 0) + Number(row.req_total);
	const totMap = {};
	for (const row of totalRows) totMap[row.date] = (totMap[row.date] || 0) + Number(row.req_total);

	const name = isPlatformFiltered ? platform : 'All Platforms';
	return {
		dates,
		series: [
			{ name: `${name} — Failed`, data: dates.map(d => failMap[d] || 0) },
			{ name: `${name} — Total`, data: dates.map(d => totMap[d] || 0) },
		],
		granularity: 'daily',
	};
}

async function downloadCsv({ platform, dateFrom, dateTo, brandSafe, type = 'failed', matchedBy = '', region = 'all' }) {
	console.log(`[SVC:failure-queue] downloadCsv platform=${platform} dateFrom=${dateFrom} dateTo=${dateTo} type=${type} matchedBy=${matchedBy}`);
	const urlMap = await getAllPlatformUrlMappings();
	const isOthers = platform.toLowerCase() === 'others';
	const mappedUrls = Array.from(urlMap.keys());
	const platformUrls = isOthers ? [] : [...urlMap.entries()]
		.filter(([, p]) => p.toLowerCase() === platform.toLowerCase())
		.map(([url]) => url);

	if (!isOthers && !platformUrls.length) return '';

	const filters = { dateFrom, dateTo, brandSafe, region };
	const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;

	if (type === 'enrichable') {
		const rows = isOthers
			? await getAllServedContentRowsExcludingUrls({ ...filters, excludeUrls: mappedUrls, matchedBy })
			: await getAllServedContentRowsByUrls({ ...filters, urls: platformUrls, matchedBy });
		const header = 'content_id,bundle_id,channel,requests_served,matched_by\n';
		const body = rows.map(r => [esc(r.contentid), esc(r.url), esc(r.channel), r.req_total, esc(r.matchedby || '')].join(',')).join('\n');
		return header + body;
	}

	if (type === 'failed') {
		const rows = isOthers
			? await getAllFailedContentRowsExcludingUrls({ ...filters, excludeUrls: mappedUrls, onlyUnmatched: true })
			: await getAllFailedContentRowsByUrls({ ...filters, urls: platformUrls, onlyUnmatched: true });
		const header = 'content_id,bundle_id,channel,requests_failed,matched_by\n';
		const body = rows.map(r => [esc(r.contentid), esc(r.url), esc(r.channel), r.req_total, esc(r.matchedby || 'Unmatched')].join(',')).join('\n');
		return header + body;
	}

	// type === 'all': both success=0 and success=1 rows
	const [failedRows, servedRows] = await Promise.all([
		isOthers
			? getAllFailedContentRowsExcludingUrls({ ...filters, excludeUrls: mappedUrls })
			: getAllFailedContentRowsByUrls({ ...filters, urls: platformUrls }),
		isOthers
			? getAllServedContentRowsExcludingUrls({ ...filters, excludeUrls: mappedUrls })
			: getAllServedContentRowsByUrls({ ...filters, urls: platformUrls }),
	]);
	const header = 'content_id,bundle_id,channel,requests,matched_by,type\n';
	const failBody = failedRows.map(r => [esc(r.contentid), esc(r.url), esc(r.channel), r.req_total, esc(r.matchedby || 'Unmatched'), 'failed'].join(','));
	const servBody = servedRows.map(r => [esc(r.contentid), esc(r.url), esc(r.channel), r.req_total, esc(r.matchedby || ''), 'served'].join(','));
	return header + [...failBody, ...servBody].join('\n');
}

async function getPeriodComparison({ dateFrom, dateTo, brandSafe, platformList, region = 'all' }) {
	console.log(`[SVC:failure-queue] getPeriodComparison dateFrom=${dateFrom} dateTo=${dateTo}`);

	const msPerDay = 86400000;
	const fromMs = new Date(dateFrom).getTime();
	const toMs = new Date(dateTo).getTime();
	const windowDays = Math.round((toMs - fromMs) / msPerDay) + 1;

	const prevDateTo = new Date(fromMs - msPerDay).toISOString().slice(0, 10);
	const prevDateFrom = new Date(fromMs - windowDays * msPerDay).toISOString().slice(0, 10);

	let urls = [];
	if (platformList && platformList.length) {
		const urlMap = await getAllPlatformUrlMappings();
		urls = [...urlMap.entries()]
			.filter(([, p]) => platformList.includes(p.toLowerCase()))
			.map(([url]) => url);
		if (!urls.length) return null;
	}

	const base = { brandSafe, region, urls, groupBy: 'date' };
	const [curFailed, curTotal, prevFailed, prevTotal] = await Promise.all([
		getCtvFailedAgg({ ...base, dateFrom, dateTo }),
		getCtvTotalAgg({ ...base, dateFrom, dateTo }),
		getCtvFailedAgg({ ...base, dateFrom: prevDateFrom, dateTo: prevDateTo }),
		getCtvTotalAgg({ ...base, dateFrom: prevDateFrom, dateTo: prevDateTo }),
	]);

	const sum = rows => rows.reduce((s, r) => s + Number(r.req_total), 0);
	const curFailedCount = sum(curFailed);
	const curTotalCount = sum(curTotal);
	const prevFailedCount = sum(prevFailed);
	const prevTotalCount = sum(prevTotal);

	const curSuccessCount = curTotalCount - curFailedCount;
	const prevSuccessCount = prevTotalCount - prevFailedCount;
	const curRate = curTotalCount ? curSuccessCount / curTotalCount * 100 : 0;
	const prevRate = prevTotalCount ? prevSuccessCount / prevTotalCount * 100 : 0;

	return {
		currentPeriod: { dateFrom, dateTo, totalRequests: curTotalCount, failedCount: curFailedCount, successCount: curSuccessCount, successRate: curRate },
		previousPeriod: { dateFrom: prevDateFrom, dateTo: prevDateTo, totalRequests: prevTotalCount, failedCount: prevFailedCount, successCount: prevSuccessCount, successRate: prevRate },
		deltaRate: curRate - prevRate,
		deltaReqs: curSuccessCount - prevSuccessCount,
	};
}

async function getContentHits({ platform, dateFrom, dateTo, brandSafe, matchedBy, region = 'all', limit = 50, offset = 0 }) {
	console.log(`[SVC:failure-queue] getContentHits platform=${platform} matchedBy=${matchedBy} offset=${offset}`);
	const urlMap = await getAllPlatformUrlMappings();
	const platformUrls = [...urlMap.entries()]
		.filter(([, p]) => p.toLowerCase() === platform.toLowerCase())
		.map(([url]) => url);
	if (!platformUrls.length) return { rows: [], hasMore: false };

	const { rows, hasMore } = await getCtvContentHits({ dateFrom, dateTo, brandSafe, urls: platformUrls, matchedBy, limit, offset });
	return {
		rows: rows.map(r => ({ contentId: r.contentid, hits: Number(r.hits), title: r.title || '', series: r.series || '' })),
		hasMore,
	};
}


async function getSegmentRankingsSvc({ dateFrom, dateTo, brandSafe, region, n = 10 }) {
	console.log(`[SVC:failure-queue] getSegmentRankings dateFrom=${dateFrom} dateTo=${dateTo}`);
	const { top, bottom } = await getSegmentRankings({ dateFrom, dateTo, brandSafe, region, n });
	const map = row => ({
		segment: row.seg_tag,
		timesServed: Number(row.times_served),
		distinctContent: Number(row.distinct_content),
		totalRequests: Number(row.total_requests),
	});
	return { top: top.map(map), bottom: bottom.map(map) };
}

async function getSegmentDetailSvc({ segment, dateFrom, dateTo, brandSafe, region }) {
	console.log(`[SVC:failure-queue] getSegmentDetail segment=${segment}`);
	const urlMap = await getAllPlatformUrlMappings();
	const { overview, platforms } = await getSegmentDetail({ dateFrom, dateTo, brandSafe, region, segment });
	const total   = Number(overview.total_requests ?? 0);
	const served  = Number(overview.times_served   ?? 0);
	const content = Number(overview.distinct_content ?? 0);
	const platformList = platforms.map(r => ({
		platform:        urlMap.get(r.url) || 'Others',
		timesServed:     Number(r.times_served),
		distinctContent: Number(r.distinct_content),
	}));
	// merge Others
	const pMap = {};
	for (const p of platformList) {
		pMap[p.platform] = pMap[p.platform]
			? { ...pMap[p.platform], timesServed: pMap[p.platform].timesServed + p.timesServed, distinctContent: pMap[p.platform].distinctContent + p.distinctContent }
			: { ...p };
	}
	return {
		segment, timesServed: served, distinctContent: content,
		totalRequests: total,
		successRate: total ? (served / total * 100) : 0,
		platforms: Object.values(pMap).sort((a, b) => b.timesServed - a.timesServed),
	};
}


async function getPlatformSegmentCountsSvc({ dateFrom, dateTo, brandSafe, region }) {
  const urlMap = await getAllPlatformUrlMappings();
  const urls = Array.from(urlMap.keys());
  const rows = await getPlatformSegmentCounts({ dateFrom, dateTo, brandSafe, region, urls });
  const result = {};
  for (const r of rows) {
    const platform = urlMap.get(r.url);
    if (!platform) continue;
    result[platform] = (result[platform] || 0) + Number(r.seg_count);
  }
  return result;
}

async function getPlatformSegmentDetailSvc({ platform, dateFrom, dateTo, brandSafe, region }) {
  const urlMap = await getAllPlatformUrlMappings();
  const urls = [...urlMap.entries()].filter(([,p]) => p.toLowerCase() === platform.toLowerCase()).map(([u]) => u);
  if (!urls.length) return [];
  const [rows, totalRows, failedRows] = await Promise.all([
    getPlatformSegmentDetail({ dateFrom, dateTo, brandSafe, region, urls }),
    getCtvTotalAgg({ dateFrom, dateTo, brandSafe, region, urls, groupBy: 'url' }),
    getCtvFailedAgg({ dateFrom, dateTo, brandSafe, region, urls, groupBy: 'url' }),
  ]);
  const totalServed = Math.max(1,
    totalRows.reduce((s, r) => s + Number(r.req_total), 0) -
    failedRows.reduce((s, r) => s + Number(r.req_total), 0)
  );
  return rows.map(r => ({
    segment:   r.segment,
    served:    Number(r.served),
    total:     totalServed,
    servedPct: Number(r.served) / totalServed * 100,
  }));
}
module.exports = { getByPlatform, getPlatformSegmentCountsSvc, getPlatformSegmentDetailSvc, getSegmentRankingsSvc, getSegmentDetailSvc, getByPlatformDetail, getPlatformSummary, getFilterOptions, getTrend, downloadCsv, getContentHits, getPeriodComparison };
