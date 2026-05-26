const {
  getFailedUrlChannelTotals,
  getFailedContentRowsByUrls,
  getAllFailedContentRowsByUrls,
  getFailedContentRowsExcludingUrls,
  getOthersChannelTotals,
  getOthersTopUrls,
  getTopFailedUrls,
  getHealthyCategoryTotals,
  getDailyTotals,
  getDailyTotalsByUrls,
  getHourlyTotals,
  getDailyTotalAllRequests,
  getHourlyTotalAllRequests,
  getDailyTotalsByUrlsAll,
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

  const [urlRows, othersMatchedRows, othersTopUrlRows, healthyRows] = await Promise.all([
    getFailedUrlChannelTotals({ dateFrom, dateTo, brandSafe, urls: mappedUrls }),
    includeOthers ? getOthersChannelTotals({ dateFrom, dateTo, brandSafe, excludeUrls: mappedUrls }) : Promise.resolve([]),
    includeOthers ? getOthersTopUrls({ dateFrom, dateTo, brandSafe, excludeUrls: mappedUrls, limit: 100 }) : Promise.resolve([]),
    getHealthyCategoryTotals({ dateFrom, dateTo, brandSafe, urls: mappedUrls }),
  ]);

  console.log(`[SVC:failure-queue] phase1 urlRows=${urlRows.length} othersMatchedRows=${othersMatchedRows.length} othersTopUrls=${othersTopUrlRows.length} healthyRows=${healthyRows.length}`);

  const platformMap = {};

  for (const row of urlRows) {
    const appName      = urlMap.get(row.url) || 'Others';
    const reqTotal     = Number(row.req_total);
    const contentCount = Number(row.content_count);

    if (platformList.length && !platformList.includes(appName.toLowerCase())) continue;
    if (channel !== 'all' && (row.channel || '').toLowerCase() !== channel.toLowerCase()) continue;

    if (!platformMap[appName]) {
      platformMap[appName] = { name: appName, failedCount: 0, totalRequestsAtRisk: 0, rows: [], matchedByMap: {} };
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
      return { ...rest, matchedByGroups: sortMatchedByGroups(matchedByMap), healthyGroups };
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

async function getByPlatformDetail({ platform, dateFrom, dateTo, brandSafe, matchedBy, limit, offset }) {
  console.log(`[SVC:failure-queue] getByPlatformDetail platform=${platform} matchedBy=${matchedBy} limit=${limit} offset=${offset}`);

  const urlMap = await getAllPlatformUrlMappings();
  const filters = { dateFrom, dateTo, brandSafe };
  let rawRows;

  if (platform === 'Others') {
    const mappedUrls = Array.from(urlMap.keys());
    rawRows = await getFailedContentRowsExcludingUrls({ ...filters, excludeUrls: mappedUrls, matchedBy, limit, offset });
  } else {
    const platformUrls = [...urlMap.entries()]
      .filter(([, p]) => p.toLowerCase() === platform.toLowerCase())
      .map(([url]) => url);
    if (!platformUrls.length) return { rows: [], meta: { offset, limit, hasMore: false } };
    rawRows = await getFailedContentRowsByUrls({ ...filters, urls: platformUrls, matchedBy, limit, offset });
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

  if (isSingleDay) {
    const [failedRows, totalRows] = await Promise.all([
      getHourlyTotals({ date: dateFrom, brandSafe }),
      getHourlyTotalAllRequests({ date: dateFrom, brandSafe }),
    ]);
    const labels    = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);
    const failData  = labels.map((_, h) => Number(failedRows.find(r => Number(r.hour) === h)?.req_total  || 0));
    const totalData = labels.map((_, h) => Number(totalRows.find( r => Number(r.hour) === h)?.req_total  || 0));
    const name = isPlatformFiltered ? platform : 'All Platforms';
    return {
      dates: labels,
      series: [{ name: `${name} — Failed`, data: failData }, { name: `${name} — Total`, data: totalData }],
      granularity: 'hourly',
    };
  }

  if (!isPlatformFiltered) {
    const [failedRows, totalRows] = await Promise.all([getDailyTotals(filters), getDailyTotalAllRequests(filters)]);
    const dates   = Array.from(new Set([...failedRows.map(r => r.date), ...totalRows.map(r => r.date)])).sort();
    const failMap = Object.fromEntries(failedRows.map(r => [r.date, Number(r.req_total)]));
    const totMap  = Object.fromEntries(totalRows.map( r => [r.date, Number(r.req_total)]));
    return {
      dates,
      series: [
        { name: 'Failed Requests', data: dates.map(d => failMap[d] || 0) },
        { name: 'Total Requests',  data: dates.map(d => totMap[d]  || 0) },
      ],
      granularity: 'daily',
    };
  }

  const [urlMap, topUrls] = await Promise.all([
    getAllPlatformUrlMappings(),
    getTopFailedUrls({ ...filters, limit: 50 }),
  ]);
  const platformUrls = topUrls
    .map(r => r.url)
    .filter(url => (urlMap.get(url) || '').toLowerCase() === platform.toLowerCase());

  if (!platformUrls.length) return { dates: [], series: [], granularity: 'daily' };

  const [failedRows, totalRows] = await Promise.all([
    getDailyTotalsByUrls({ ...filters, urls: platformUrls }),
    getDailyTotalsByUrlsAll({ ...filters, urls: platformUrls }),
  ]);
  const dates   = Array.from(new Set([...failedRows.map(r => r.date), ...totalRows.map(r => r.date)])).sort();
  const failMap = {};
  for (const row of failedRows) failMap[row.date] = (failMap[row.date] || 0) + Number(row.req_total);
  const totMap  = {};
  for (const row of totalRows)  totMap[row.date]  = (totMap[row.date]  || 0) + Number(row.req_total);

  return {
    dates,
    series: [
      { name: `${platform} — Failed`, data: dates.map(d => failMap[d] || 0) },
      { name: `${platform} — Total`,  data: dates.map(d => totMap[d]  || 0) },
    ],
    granularity: 'daily',
  };
}

async function downloadPlatformCsv({ platform, dateFrom, dateTo, brandSafe }) {
  console.log(`[SVC:failure-queue] downloadPlatformCsv platform=${platform} dateFrom=${dateFrom} dateTo=${dateTo}`);
  const urlMap = await getAllPlatformUrlMappings();
  const platformUrls = [...urlMap.entries()]
    .filter(([, p]) => p.toLowerCase() === platform.toLowerCase())
    .map(([url]) => url);
  if (!platformUrls.length) return '';

  const rows = await getAllFailedContentRowsByUrls({ dateFrom, dateTo, brandSafe, urls: platformUrls });

  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = 'content_id,bundle_id,channel,requests_at_risk,matched_by\n';
  const body   = rows.map(r => [
    esc(r.contentid),
    esc(r.url),
    esc(r.channel),
    r.req_total,
    esc(r.matchedby || 'Unmatched'),
  ].join(',')).join('\n');

  return header + body;
}

module.exports = { getByPlatform, getByPlatformDetail, getFilterOptions, getTrend, downloadPlatformCsv };
