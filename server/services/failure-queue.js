const ctvStatsRepo = require('../repositories/ctvStats.repo');
const { getCtvContentHits, getSegmentRankings, getSegmentDetail, getPlatformSegmentCounts, getPlatformSegmentDetail } = ctvStatsRepo;
const pubmaticRepo = require('../repositories/pubmaticStats.repo');
const { getAllPlatformUrlMappings, getDistinctPlatforms } = require('../repositories/platformUrlMap.repo');
const { getContentIdCache, PLATFORM_TABLES } = require('../repositories/contentIdMap.repo');
const { getPubmaticContentCoverage } = require('../repositories/pubmaticContentCache.repo');
const { resolveDb } = require('../db/databases');

/** Returns the correct ClickHouse repo for the given partner. */
function getRepo(partner) {
  return partner === 'Pubmatic' ? pubmaticRepo : ctvStatsRepo;
}
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

async function getByPlatform({ dateFrom, dateTo, platformList, channel, brandSafe, region = 'all', limit, offset, partner = 'TTD' }) {
	const db = resolveDb(partner);
	const { getCtvFailedAgg, getCtvTotalAgg, getHealthyCategoryTotals } = getRepo(partner);
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

	const [urlRows, healthyRows, totalUrlRows, prevTotalUrlRows, prevFailedUrlRows, curFailedUrlRows, segCountRows, othersMatchedRows, othersTopUrlRows, othersTotalRows, othersSegCountRows] = await Promise.all([
		getCtvFailedAgg({ dateFrom, dateTo, brandSafe, region, urls: mappedUrls, groupBy: 'url,matchedby', db }),
		getHealthyCategoryTotals({ dateFrom, dateTo, brandSafe, region, urls: healthyUrls, db }),
		getCtvTotalAgg({ dateFrom, dateTo, brandSafe, region, urls: mappedUrls, groupBy: 'url', db }),
		getCtvTotalAgg({ dateFrom: prevDateFrom, dateTo: prevDateTo, brandSafe, region, urls: mappedUrls, groupBy: 'url', db }),
		getCtvFailedAgg({ dateFrom: prevDateFrom, dateTo: prevDateTo, brandSafe, region, urls: mappedUrls, groupBy: 'url', db }),
		getCtvFailedAgg({ dateFrom, dateTo, brandSafe, region, urls: mappedUrls, groupBy: 'url', db }),
		getPlatformSegmentCounts({ dateFrom, dateTo, brandSafe, region, urls: mappedUrls, db }),
		includeOthers ? getCtvFailedAgg({ dateFrom, dateTo, brandSafe, region, excludeUrls: mappedUrls, groupBy: 'matchedby', db }) : Promise.resolve([]),
		includeOthers ? getCtvFailedAgg({ dateFrom, dateTo, brandSafe, region, excludeUrls: mappedUrls, groupBy: 'url', limit: 100, db }) : Promise.resolve([]),
		includeOthers ? getCtvTotalAgg({ dateFrom, dateTo, brandSafe, region, excludeUrls: mappedUrls, groupBy: 'url', db }) : Promise.resolve([]),
		includeOthers ? getPlatformSegmentCounts({ dateFrom, dateTo, brandSafe, region, excludeUrls: mappedUrls, db }) : Promise.resolve([]),
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

	// Unique requests: uniq(contentid) per URL = unique (contentid,url) pairs
	// Sum content_count across a platform's URLs to get platform-level unique counts
	const platformUniqueTotalMap = {};
	for (const row of totalUrlRows) {
		const appName = urlMap.get(row.url);
		if (!appName) continue;
		if (platformList.length && !platformList.includes(appName.toLowerCase())) continue;
		platformUniqueTotalMap[appName] = (platformUniqueTotalMap[appName] || 0) + Number(row.content_count);
	}
	const platformUniqueFailedMap = {};
	for (const row of curFailedUrlRows) {
		const appName = urlMap.get(row.url);
		if (!appName) continue;
		if (platformList.length && !platformList.includes(appName.toLowerCase())) continue;
		platformUniqueFailedMap[appName] = (platformUniqueFailedMap[appName] || 0) + Number(row.content_count);
	}

	// Segment count per platform (inlined — no separate API call needed)
	const platformSegmentCountMap = {};
	for (const row of segCountRows) {
		const appName = urlMap.get(row.url);
		if (!appName) continue;
		if (platformList.length && !platformList.includes(appName.toLowerCase())) continue;
		platformSegmentCountMap[appName] = (platformSegmentCountMap[appName] || 0) + Number(row.seg_count);
	}
	if (othersSegCountRows.length) platformSegmentCountMap['Others'] = Number(othersSegCountRows[0].seg_count);

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
			return { ...rest, matchedByGroups, directServedRequests, totalRequests: platformTotalMap[p.name] || 0, prevTotalRequests: prevTotal, prevTotalRequestsAtRisk: prevFailed, uniqueTotal: platformUniqueTotalMap[p.name] || 0, uniqueFailed: platformUniqueFailedMap[p.name] || 0, segmentCount: platformSegmentCountMap[p.name] || 0 };
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

async function getByPlatformDetail({ platform, dateFrom, dateTo, brandSafe, matchedBy, enrichable, search, region = 'all', limit, offset, partner = 'TTD' }) {
	const db = resolveDb(partner);
	const { getFailedContentRowsByUrls, getFailedContentRowsExcludingUrls, getServedContentRowsByUrls, getServedContentRowsExcludingUrls } = getRepo(partner);
	console.log(`[SVC:failure-queue] getByPlatformDetail platform=${platform} matchedBy=${matchedBy} enrichable=${enrichable} search=${search} limit=${limit} offset=${offset}`);

	const urlMap = await getAllPlatformUrlMappings();
	const filters = { dateFrom, dateTo, brandSafe, region };
	let rawRows;

	if (platform === 'Others') {
		const mappedUrls = Array.from(urlMap.keys());
		rawRows = enrichable
			? await getServedContentRowsExcludingUrls({ ...filters, excludeUrls: mappedUrls, matchedBy, limit, offset, db })
			: await getFailedContentRowsExcludingUrls({ ...filters, excludeUrls: mappedUrls, matchedBy, limit, offset, db });
	} else {
		const platformUrls = [...urlMap.entries()]
			.filter(([, p]) => p.toLowerCase() === platform.toLowerCase())
			.map(([url]) => url);
		if (!platformUrls.length) return { rows: [], meta: { offset, limit, hasMore: false } };
		rawRows = enrichable
			? await getServedContentRowsByUrls({ ...filters, urls: platformUrls, matchedBy, search, limit, offset, db })
			: await getFailedContentRowsByUrls({ ...filters, urls: platformUrls, matchedBy, search, limit, offset, db });
	}

	const rows = rawRows.map(toFailedRow);
	return { rows, meta: { offset, limit, hasMore: rows.length === limit } };
}

async function getPlatformSummary({ platform, dateFrom, dateTo, brandSafe, region = 'all', partner = 'TTD' }) {
	const db = resolveDb(partner);
	const { getCtvFailedAgg, getCtvTotalAgg, getHealthyCategoryTotals, getUnmatchedUrlBreakdown } = getRepo(partner);
	console.log(`[SVC:failure-queue] getPlatformSummary platform=${platform} dateFrom=${dateFrom} dateTo=${dateTo}`);

	const urlMap = await getAllPlatformUrlMappings();
	const platformUrls = [...urlMap.entries()]
		.filter(([, p]) => p.toLowerCase() === platform.toLowerCase())
		.map(([url]) => url);

	if (!platformUrls.length) return null;

	const filters = { dateFrom, dateTo, brandSafe, region };

	const [totalRows, failedByMb, servedByMb, unmatchedUrlRows, failedUniqueRows] = await Promise.all([
		getCtvTotalAgg({ ...filters, urls: platformUrls, groupBy: 'url', db }),
		getCtvFailedAgg({ ...filters, urls: platformUrls, groupBy: 'matchedby' }),
		getHealthyCategoryTotals({ ...filters, urls: platformUrls, db }),
		getUnmatchedUrlBreakdown({ ...filters, urls: platformUrls, db }),
		getCtvFailedAgg({ ...filters, urls: platformUrls, groupBy: 'url', db }),  // for unique failed count
	]);

	const totalRequests  = totalRows.reduce((s, r) => s + Number(r.req_total), 0);
	const failedCount    = failedByMb.reduce((s, r) => s + Number(r.req_total), 0);
	const successCount   = totalRequests - failedCount;
	// unique (contentid,url) combos: sum uniq(contentid) per URL
	const uniqueTotal    = totalRows.reduce((s, r) => s + Number(r.content_count), 0);
	const uniqueFailed   = failedUniqueRows.reduce((s, r) => s + Number(r.content_count), 0);

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
		uniqueTotal, uniqueFailed,
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

async function getTrend({ dateFrom, dateTo, platform, brandSafe, region = 'all', partner = 'TTD' }) {
	const db = resolveDb(partner);
	const { getCtvFailedAgg, getCtvTotalAgg } = getRepo(partner);
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
			getCtvFailedAgg({ dateFrom, dateTo: dateFrom, brandSafe, region, urls: platformUrls, groupBy: 'hour', db }),
			getCtvTotalAgg({ dateFrom, dateTo: dateFrom, brandSafe, region, urls: platformUrls, groupBy: 'hour', db }),
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
		getCtvFailedAgg({ ...filters, urls: platformUrls, groupBy: 'date', db }),
		getCtvTotalAgg({ ...filters, urls: platformUrls, groupBy: 'date', db }),
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

async function downloadCsv({ platform, dateFrom, dateTo, brandSafe, type = 'failed', matchedBy = '', region = 'all', partner = 'TTD' }) {
	const db = resolveDb(partner);
	const { getAllFailedContentRowsByUrls, getAllFailedContentRowsExcludingUrls, getAllServedContentRowsByUrls, getAllServedContentRowsExcludingUrls } = getRepo(partner);
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
			? await getAllServedContentRowsExcludingUrls({ ...filters, excludeUrls: mappedUrls, matchedBy, db })
			: await getAllServedContentRowsByUrls({ ...filters, urls: platformUrls, matchedBy, db });
		const header = 'content_id,bundle_id,channel,requests_served,matched_by\n';
		const body = rows.map(r => [esc(r.contentid), esc(r.url), esc(r.channel), r.req_total, esc(r.matchedby || '')].join(',')).join('\n');
		return header + body;
	}

	if (type === 'failed') {
		const rows = isOthers
			? await getAllFailedContentRowsExcludingUrls({ ...filters, excludeUrls: mappedUrls, onlyUnmatched: true, db })
			: await getAllFailedContentRowsByUrls({ ...filters, urls: platformUrls, onlyUnmatched: true, db });
		const header = 'content_id,bundle_id,channel,requests_failed,matched_by\n';
		const body = rows.map(r => [esc(r.contentid), esc(r.url), esc(r.channel), r.req_total, esc(r.matchedby || 'Unmatched')].join(',')).join('\n');
		return header + body;
	}

	// type === 'all': both success=0 and success=1 rows
	const [failedRows, servedRows] = await Promise.all([
		isOthers
			? getAllFailedContentRowsExcludingUrls({ ...filters, excludeUrls: mappedUrls, db })
			: getAllFailedContentRowsByUrls({ ...filters, urls: platformUrls, db }),
		isOthers
			? getAllServedContentRowsExcludingUrls({ ...filters, excludeUrls: mappedUrls, db })
			: getAllServedContentRowsByUrls({ ...filters, urls: platformUrls, db }),
	]);
	const header = 'content_id,bundle_id,channel,requests,matched_by,type\n';
	const failBody = failedRows.map(r => [esc(r.contentid), esc(r.url), esc(r.channel), r.req_total, esc(r.matchedby || 'Unmatched'), 'failed'].join(','));
	const servBody = servedRows.map(r => [esc(r.contentid), esc(r.url), esc(r.channel), r.req_total, esc(r.matchedby || ''), 'served'].join(','));
	return header + [...failBody, ...servBody].join('\n');
}

async function getPeriodComparison({ dateFrom, dateTo, brandSafe, platformList, region = 'all', partner = 'TTD' }) {
	const db = resolveDb(partner);
	const { getCtvFailedAgg, getCtvTotalAgg } = getRepo(partner);
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
		getCtvFailedAgg({ ...base, dateFrom, dateTo, db }),
		getCtvTotalAgg({ ...base, dateFrom, dateTo, db }),
		getCtvFailedAgg({ ...base, dateFrom: prevDateFrom, dateTo: prevDateTo, db }),
		getCtvTotalAgg({ ...base, dateFrom: prevDateFrom, dateTo: prevDateTo, db }),
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

async function getContentHits({ platform, dateFrom, dateTo, brandSafe, matchedBy, region = 'all', limit = 50, offset = 0, partner = 'TTD' }) {
	const db = resolveDb(partner);
	console.log(`[SVC:failure-queue] getContentHits platform=${platform} matchedBy=${matchedBy} offset=${offset}`);
	const urlMap = await getAllPlatformUrlMappings();
	const platformUrls = [...urlMap.entries()]
		.filter(([, p]) => p.toLowerCase() === platform.toLowerCase())
		.map(([url]) => url);
	if (!platformUrls.length) return { rows: [], hasMore: false };

	const { rows, hasMore } = await getCtvContentHits({ dateFrom, dateTo, brandSafe, urls: platformUrls, matchedBy, limit, offset, db });
	return {
		rows: rows.map(r => ({ contentId: r.contentid, hits: Number(r.hits), title: r.title || '', series: r.series || '' })),
		hasMore,
	};
}


async function getSegmentRankingsSvc({ dateFrom, dateTo, brandSafe, region, n = 10, partner = 'TTD' }) {
	const db = resolveDb(partner);
	console.log(`[SVC:failure-queue] getSegmentRankings dateFrom=${dateFrom} dateTo=${dateTo}`);
	const { top, bottom } = await getSegmentRankings({ dateFrom, dateTo, brandSafe, region, n, db });
	const map = row => ({
		segment: row.seg_tag,
		timesServed: Number(row.times_served),
		distinctContent: Number(row.distinct_content),
		totalRequests: Number(row.total_requests),
	});
	return { top: top.map(map), bottom: bottom.map(map) };
}

async function getSegmentDetailSvc({ segment, dateFrom, dateTo, brandSafe, region, partner = 'TTD' }) {
	const db = resolveDb(partner);
	console.log(`[SVC:failure-queue] getSegmentDetail segment=${segment}`);
	const urlMap = await getAllPlatformUrlMappings();
	const { overview, platforms } = await getSegmentDetail({ dateFrom, dateTo, brandSafe, region, segment, db });
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


async function getPlatformSegmentCountsSvc({ dateFrom, dateTo, brandSafe, region, partner = 'TTD' }) {
  const db = resolveDb(partner);
  const urlMap = await getAllPlatformUrlMappings();
  const urls = Array.from(urlMap.keys());
  // Fetch mapped-platform counts + Others in parallel
  const [rows, othersRows] = await Promise.all([
    getPlatformSegmentCounts({ dateFrom, dateTo, brandSafe, region, urls, db }),
    getPlatformSegmentCounts({ dateFrom, dateTo, brandSafe, region, excludeUrls: urls, db }),
  ]);
  const result = {};
  for (const r of rows) {
    const platform = urlMap.get(r.url);
    if (!platform) continue;
    result[platform] = (result[platform] || 0) + Number(r.seg_count);
  }
  if (othersRows.length) result['Others'] = Number(othersRows[0].seg_count);
  return result;
}

async function getPlatformSegmentDetailSvc({ platform, dateFrom, dateTo, brandSafe, region, partner = 'TTD' }) {
  const db = resolveDb(partner);
  const { getCtvFailedAgg, getCtvTotalAgg } = getRepo(partner);
  const urlMap = await getAllPlatformUrlMappings();
  const allUrls = Array.from(urlMap.keys());
  const isOthers = platform.toLowerCase() === 'others';
  const urls        = isOthers ? [] : [...urlMap.entries()].filter(([,p]) => p.toLowerCase() === platform.toLowerCase()).map(([u]) => u);
  const excludeUrls = isOthers ? allUrls : [];
  if (!urls.length && !isOthers) return [];
  const [rows, totalRows, failedRows] = await Promise.all([
    getPlatformSegmentDetail({ dateFrom, dateTo, brandSafe, region, urls, excludeUrls, db }),
    getCtvTotalAgg({ dateFrom, dateTo, brandSafe, region, urls, excludeUrls: isOthers ? allUrls : [], groupBy: 'url', db }),
    getCtvFailedAgg({ dateFrom, dateTo, brandSafe, region, urls, excludeUrls: isOthers ? allUrls : [], groupBy: 'url', db }),
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

async function getPubmaticSummarySvc({ dateFrom, dateTo, brandSafe, region, partner = 'Pubmatic' }) {
  const db = resolveDb(partner);
  const urlMap = await getAllPlatformUrlMappings();
  const knownAppIds = Array.from(urlMap.keys());
  const { kpi, matched, unmatched, split, platformRows, contentIds, contentIdsMatched, servedHits, matchedContentTotalRequests } = await pubmaticRepo.getPubmaticKpiSummary({ dateFrom, dateTo, region, knownAppIds, db });

  const totalHits                    = Number(kpi.total_hits                                           || 0);
  const uniqueTotal                  = Number(kpi.unique_total                                          || 0);
  const uniqueMatched                = Number(matched.unique_matched                                    || 0);
  const uniqueUnmatched              = Number(unmatched.unique_unmatched                                || 0);
  const matchRate                    = uniqueTotal > 0 ? (uniqueMatched / uniqueTotal) * 100 : 0;
  const knownHits                    = Number(split.known_hits                                         || 0);
  const unknownHits                  = Number(split.unknown_hits                                       || 0);
  const uniqueContentIds             = Number(contentIds.unique_content_ids                            || 0);
  const uniqueContentMatched         = Number(contentIdsMatched.unique_content_matched                  || 0);
  const contentMatchRate             = uniqueContentIds > 0 ? (uniqueContentMatched / uniqueContentIds) * 100 : 0;
  const servedRequests               = Number(servedHits.served_hits                                   || 0);
  const matchedContentTotalReqs      = Number(matchedContentTotalRequests.matched_content_total_requests || 0);

  // Resolve per-appid rows to named platforms; aggregate unknown
  const platMap = {};
  let unknownAgg = 0;
  for (const row of (platformRows || [])) {
    const name = urlMap.get(row.appid);
    const hits = Number(row.hits);
    if (name) platMap[name] = (platMap[name] || 0) + hits;
    else      unknownAgg   += hits;
  }
  const platformBreakdown = [
    ...Object.entries(platMap).map(([platform, hits]) => ({ platform, hits })).sort((a, b) => b.hits - a.hits),
    ...(unknownAgg > 0 ? [{ platform: 'Unknown', hits: unknownAgg }] : []),
  ];

  return { totalHits, uniqueTotal, uniqueMatched, uniqueUnmatched, matchRate, knownHits, unknownHits, platformBreakdown, uniqueContentIds, uniqueContentMatched, contentMatchRate, servedRequests, matchedContentTotalReqs };
}

async function getPubmaticAppidBreakdownSvc({ dateFrom, dateTo, region, partner = 'Pubmatic' }) {
  const db = resolveDb(partner);
  const urlMap = await getAllPlatformUrlMappings();
  const rows = await pubmaticRepo.getPubmaticDistinctAppids({ dateFrom, dateTo, region, db });

  const platformMap = {};
  const unknownList = [];

  for (const r of rows) {
    const name = urlMap.get(r.appid);
    if (name) {
      if (!platformMap[name]) platformMap[name] = { platform: name, appids: [] };
      platformMap[name].appids.push(r.appid);
    } else {
      unknownList.push(r.appid);
    }
  }

  const breakdown = [
    ...Object.values(platformMap).sort((a, b) => b.appids.length - a.appids.length),
    ...(unknownList.length ? [{ platform: 'Unknown', appids: unknownList }] : []),
  ].map(p => ({ ...p, count: p.appids.length }));

  const knownCount   = rows.filter(r => urlMap.has(r.appid)).length;
  const unknownCount = rows.filter(r => !urlMap.has(r.appid)).length;

  return { totalAppids: rows.length, knownCount, unknownCount, breakdown };
}

/**
 * Per-platform content ID coverage: how many Pubmatic content_ids (in the
 * selected period) are present in our dpttd platform datasets.
 *
 * Approach:
 *  1. platform_url_mapping → platform → appids (all known platforms)
 *  2. dpttd cache (lazy, built in background at startup) → per-platform Sets
 *  3. For each platform query Pubmatic for distinct content_ids → intersect
 */
async function getPubmaticContentCoverageSvc({ dateFrom, dateTo, region, partner = 'Pubmatic' }) {
  const db = resolveDb(partner);
  const urlMap = await getAllPlatformUrlMappings();

  // Build platform → appids map from platform_url_mapping
  const platformToAppids = new Map();
  for (const [appid, platform] of urlMap.entries()) {
    if (!platformToAppids.has(platform)) platformToAppids.set(platform, []);
    platformToAppids.get(platform).push(appid);
  }

  // Load dpttd content-ID cache (may await up to ~140s on first call after startup)
  const { perPlatform: dpttdPerPlatform } = await getContentIdCache();

  // Query Pubmatic for each known platform's content_ids in parallel, then intersect
  const results = await Promise.all(
    Array.from(platformToAppids.entries()).map(async ([platform, appids]) => {
      const rows = await pubmaticRepo.getPubmaticDistinctContentIdsByAppids({
        dateFrom, dateTo, region, appids, db,
      });
      const pubmaticSet = new Set(rows.map(r => r.content_id));
      const dpttdSet    = dpttdPerPlatform.get(platform);
      const dpttdCount  = dpttdSet ? dpttdSet.size : 0;

      let covered = 0;
      if (dpttdSet && dpttdSet.size > 0) {
        for (const id of pubmaticSet) {
          if (dpttdSet.has(id)) covered++;
        }
      }

      const total = pubmaticSet.size;
      const coverageRate = total > 0 ? +((covered / total) * 100).toFixed(1) : 0;

      return {
        platform,
        pubmaticIds: total,
        dpttdIds:    dpttdCount,
        covered,
        uncovered:   total - covered,
        coverageRate,
        hasDpttdData: dpttdCount > 0,
      };
    })
  );

  return results
    .filter(r => r.pubmaticIds > 0)
    .sort((a, b) => b.pubmaticIds - a.pubmaticIds);
}

async function getPubmaticContentGapSvc({ dateFrom, dateTo, region, partner = 'Pubmatic' }) {
  const db     = resolveDb(partner);
  const urlMap = await getAllPlatformUrlMappings();
  const rows   = await pubmaticRepo.getPubmaticContentGap({ dateFrom, dateTo, region, db });

  return rows.map(r => {
    const platform   = urlMap.get(r.appid) ?? null;
    const total      = Number(r.total_distinct);
    const matched    = Number(r.matched);
    const unmatched  = Number(r.unmatched);
    const matchRate  = total ? +((matched / total) * 100).toFixed(1) : 0;
    return {
      appid:    r.appid,
      platform: platform ?? `Unknown (${r.appid})`,
      known:    !!platform,
      total,
      matched,
      unmatched,
      matchRate,
    };
  });
}

const MATCHBY_LABELS = { PB_C: 'ContentId', PB_G: 'Genre', PB_S: 'Series', PB_TS: 'Title & Series' };

async function getPubmaticMatchbyBreakdownSvc({ dateFrom, dateTo, region, partner = 'Pubmatic' }) {
  const db     = resolveDb(partner);
  const urlMap = await getAllPlatformUrlMappings();
  const rows   = await pubmaticRepo.getPubmaticMatchbyBreakdown({ dateFrom, dateTo, region, db });

  return rows.map(r => {
    const platform = urlMap.get(r.appid) ?? null;
    return {
      matchedby:        r.matchedby,
      matchLabel:       MATCHBY_LABELS[r.matchedby] ?? r.matchedby,
      appid:            r.appid,
      platform:         platform ?? `Unknown (${r.appid})`,
      known:            !!platform,
      totalHits:        Number(r.total_hits),
      uniqueContentIds: Number(r.unique_content_ids),
    };
  });
}

module.exports = { getByPlatform, getPubmaticAppidBreakdownSvc, getPubmaticContentCoverageSvc, getPubmaticContentGapSvc, getPubmaticMatchbyBreakdownSvc, getPubmaticSummarySvc, getPlatformSegmentCountsSvc, getPlatformSegmentDetailSvc, getSegmentRankingsSvc, getSegmentDetailSvc, getByPlatformDetail, getPlatformSummary, getFilterOptions, getTrend, downloadCsv, getContentHits, getPeriodComparison };
