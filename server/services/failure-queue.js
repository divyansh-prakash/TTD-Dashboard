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
} = require('../repositories/ctvStats.repo');
const { getAllPlatformUrlMappings, getDistinctPlatforms } = require('../repositories/platformUrlMap.repo');
const { toFailedRow } = require('../models/failure-queue');

// ── Helpers ──────────────────────────────────────────────────────────────────

function sortMatchedByGroups(map) {
  return Object.values(map).sort((a, b) => {
    if (a.matchedBy === 'Unmatched') return 1;
    if (b.matchedBy === 'Unmatched') return -1;
    return b.totalRequestsAtRisk - a.totalRequestsAtRisk;
  });
}

function accumMatchedBy(map, mbKey, contentCount, reqTotal) {
  if (!map[mbKey]) map[mbKey] = { matchedBy: mbKey, failedCount: 0, totalRequestsAtRisk: 0, rows: [] };
  map[mbKey].failedCount         += contentCount;
  map[mbKey].totalRequestsAtRisk += reqTotal;
}

// ── Service methods ───────────────────────────────────────────────────────────

async function getByPlatform({ dateFrom, dateTo, platformList, channel, brandSafe, limit, offset }) {
  console.log(`[SVC:failure-queue] getByPlatform dateFrom=${dateFrom} dateTo=${dateTo} platforms=[${platformList}] limit=${limit} offset=${offset}`);

  const urlMap     = await getAllPlatformUrlMappings();
  const mappedUrls = Array.from(urlMap.keys());
  const includeOthers = !platformList.length;

  // Scope the healthy query to only the selected platform's URLs when a filter
  // is active — avoids scanning all 270+ mapped URLs for success=1 rows.
  const healthyUrls = platformList.length
    ? [...urlMap.entries()].filter(([, p]) => platformList.includes(p.toLowerCase())).map(([url]) => url)
    : mappedUrls;

  const [urlRows, othersMatchedRows, othersTopUrlRows, healthyRows, totalUrlRows] = await Promise.all([
    getCtvFailedAgg({ dateFrom, dateTo, brandSafe, urls: mappedUrls, groupBy: 'url,matchedby' }),
    includeOthers ? getCtvFailedAgg({ dateFrom, dateTo, brandSafe, excludeUrls: mappedUrls, groupBy: 'matchedby' }) : Promise.resolve([]),
    includeOthers ? getCtvFailedAgg({ dateFrom, dateTo, brandSafe, excludeUrls: mappedUrls, groupBy: 'url', limit: 100 }) : Promise.resolve([]),
    getHealthyCategoryTotals({ dateFrom, dateTo, brandSafe, urls: healthyUrls }),
    getCtvTotalAgg({ dateFrom, dateTo, brandSafe, urls: mappedUrls, groupBy: 'url' }),
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

  const platformMap = {};

  for (const row of urlRows) {
    const appName      = urlMap.get(row.url) || 'Others';
    const reqTotal     = Number(row.req_total);
    const contentCount = Number(row.content_count);

    if (platformList.length && !platformList.includes(appName.toLowerCase())) continue;
    if (channel !== 'all' && (row.channel || '').toLowerCase() !== channel.toLowerCase()) continue;

    if (!platformMap[appName]) {
      platformMap[appName] = { name: appName, failedCount: 0, totalRequestsAtRisk: 0, totalRequests: 0, rows: [], matchedByMap: {} };
    }
    platformMap[appName].failedCount         += contentCount;
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
      const reqTotal     = Number(row.req_total);
      const contentCount = Number(row.content_count);
      totalRequests += reqTotal;
      totalContent  += contentCount;
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
        bundleId:           r.url || '',
        totalRequestsAtRisk: Number(r.req_total),
        hitCount:           Number(r.content_count),
      })),
    };
  }

  const platforms = Object.values(platformMap)
    .map(p => {
      const { matchedByMap, ...rest } = p;
      const failingKeys  = new Set(Object.keys(matchedByMap));
      const healthyMap   = healthyPlatformMap[p.name] || {};
      const healthyGroups = Object.entries(healthyMap)
        .filter(([mb]) => !failingKeys.has(mb))
        .map(([matchedBy, totalRequestsServed]) => ({ matchedBy, totalRequestsServed }))
        .sort((a, b) => b.totalRequestsServed - a.totalRequestsServed);
      const matchedByGroups = sortMatchedByGroups(matchedByMap).map(group => {
        if (group.matchedBy && group.matchedBy !== 'Unmatched') {
          const served = healthyMap[group.matchedBy] || 0;
          return { ...group, totalRequestsServed: served };
        }
        return group;
      });
      return { ...rest, matchedByGroups, healthyGroups, totalRequests: platformTotalMap[p.name] || 0 };
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

async function getByPlatformDetail({ platform, dateFrom, dateTo, brandSafe, matchedBy, enrichable, limit, offset }) {
  console.log(`[SVC:failure-queue] getByPlatformDetail platform=${platform} matchedBy=${matchedBy} enrichable=${enrichable} limit=${limit} offset=${offset}`);

  const urlMap = await getAllPlatformUrlMappings();
  const filters = { dateFrom, dateTo, brandSafe };
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
      ? await getServedContentRowsByUrls({ ...filters, urls: platformUrls, matchedBy, limit, offset })
      : await getFailedContentRowsByUrls({ ...filters, urls: platformUrls, matchedBy, limit, offset });
  }

  const rows = rawRows.map(toFailedRow);
  return { rows, meta: { offset, limit, hasMore: rows.length === limit } };
}

async function getFilterOptions() {
  const platforms = await getDistinctPlatforms();
  return { platforms };
}

async function getTrend({ dateFrom, dateTo, platform, brandSafe }) {
  const isSingleDay        = dateFrom === dateTo;
  const isPlatformFiltered = platform && platform !== 'all';
  const filters            = { dateFrom, dateTo, brandSafe };

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
      getCtvFailedAgg({ dateFrom, dateTo: dateFrom, brandSafe, urls: platformUrls, groupBy: 'hour' }),
      getCtvTotalAgg({ dateFrom, dateTo: dateFrom, brandSafe, urls: platformUrls, groupBy: 'hour' }),
    ]);
    const labels    = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);
    const failData  = labels.map((_, h) => Number(failedRows.find(r => Number(r.hour) === h)?.req_total || 0));
    const totalData = labels.map((_, h) => Number(totalRows.find( r => Number(r.hour) === h)?.req_total || 0));
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
  const dates   = Array.from(new Set([...failedRows.map(r => r.date), ...totalRows.map(r => r.date)])).sort();
  const failMap = {};
  for (const row of failedRows) failMap[row.date] = (failMap[row.date] || 0) + Number(row.req_total);
  const totMap  = {};
  for (const row of totalRows)  totMap[row.date]  = (totMap[row.date]  || 0) + Number(row.req_total);

  const name = isPlatformFiltered ? platform : 'All Platforms';
  return {
    dates,
    series: [
      { name: `${name} — Failed`, data: dates.map(d => failMap[d] || 0) },
      { name: `${name} — Total`,  data: dates.map(d => totMap[d]  || 0) },
    ],
    granularity: 'daily',
  };
}

async function downloadCsv({ platform, dateFrom, dateTo, brandSafe, type = 'failed', matchedBy = '' }) {
  console.log(`[SVC:failure-queue] downloadCsv platform=${platform} dateFrom=${dateFrom} dateTo=${dateTo} type=${type} matchedBy=${matchedBy}`);
  const urlMap     = await getAllPlatformUrlMappings();
  const isOthers   = platform.toLowerCase() === 'others';
  const mappedUrls = Array.from(urlMap.keys());
  const platformUrls = isOthers ? [] : [...urlMap.entries()]
    .filter(([, p]) => p.toLowerCase() === platform.toLowerCase())
    .map(([url]) => url);

  if (!isOthers && !platformUrls.length) return '';

  const filters = { dateFrom, dateTo, brandSafe };
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;

  if (type === 'enrichable') {
    const rows = isOthers
      ? await getAllServedContentRowsExcludingUrls({ ...filters, excludeUrls: mappedUrls, matchedBy })
      : await getAllServedContentRowsByUrls({ ...filters, urls: platformUrls, matchedBy });
    const header = 'content_id,bundle_id,channel,requests_served,matched_by\n';
    const body   = rows.map(r => [esc(r.contentid), esc(r.url), esc(r.channel), r.req_total, esc(r.matchedby || '')].join(',')).join('\n');
    return header + body;
  }

  if (type === 'failed') {
    const rows = isOthers
      ? await getAllFailedContentRowsExcludingUrls({ ...filters, excludeUrls: mappedUrls, onlyUnmatched: true })
      : await getAllFailedContentRowsByUrls({ ...filters, urls: platformUrls, onlyUnmatched: true });
    const header = 'content_id,bundle_id,channel,requests_failed,matched_by\n';
    const body   = rows.map(r => [esc(r.contentid), esc(r.url), esc(r.channel), r.req_total, esc(r.matchedby || 'Unmatched')].join(',')).join('\n');
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
  const header   = 'content_id,bundle_id,channel,requests,matched_by,type\n';
  const failBody = failedRows.map(r => [esc(r.contentid), esc(r.url), esc(r.channel), r.req_total, esc(r.matchedby || 'Unmatched'), 'failed'].join(','));
  const servBody = servedRows.map(r => [esc(r.contentid), esc(r.url), esc(r.channel), r.req_total, esc(r.matchedby || ''), 'served'].join(','));
  return header + [...failBody, ...servBody].join('\n');
}

module.exports = { getByPlatform, getByPlatformDetail, getFilterOptions, getTrend, downloadCsv };
