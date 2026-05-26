const express = require('express');
const router = express.Router();
const { getFailedContentRows, getFailedUrlChannelTotals, getFailedContentRowsByUrls, getFailedContentRowsExcludingUrls, getTopFailedUrls, getDailyTotals, getDailyTotalsByUrls, getHourlyTotals, getDailyTotalAllRequests, getHourlyTotalAllRequests, getDailyTotalsByUrlsAll } = require('../repositories/ctvStats.repo');
const { getAllPlatformUrlMappings, getDistinctPlatforms } = require('../repositories/platformUrlMap.repo');

function getRootCauses(row) {
  const causes = [];
  if (!(row.segment   || '').trim()) causes.push('NO SEGMENTS');
  if (!(row.matchedby || '').trim()) causes.push('UNMATCHED');
  return causes;
}

// ── Routes ─────────────────────────────────────────────────────────────────

router.get('/by-platform', async (req, res) => {
  try {
    const { dateFrom, dateTo, platforms, channel, brandSafe, limit, offset } = req.query;
    const platformList = Array.isArray(platforms)
      ? platforms.map(p => p.toLowerCase())
      : (platforms ? [platforms.toLowerCase()] : []);

    const paginationLimit = Math.max(1, parseInt(limit, 10) || 25);
    const paginationOffset = Math.max(0, parseInt(offset, 10) || 0);

    const fromDate = dateFrom || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const toDate   = dateTo   || new Date().toISOString().slice(0, 10);

    console.log(`[ROUTE:/by-platform] dateFrom=${fromDate} dateTo=${toDate} platforms=[${platformList}] channel=${channel} brandSafe=${brandSafe} limit=${paginationLimit} offset=${paginationOffset}`);

    // Load the platform map first so we can pass its URL list into the SQL,
    // avoiding a full-table scan of unmapped bundle IDs.
    const urlMap = await getAllPlatformUrlMappings();
    const mappedUrls = Array.from(urlMap.keys());

    const urlRows = await getFailedUrlChannelTotals({
      dateFrom: fromDate, dateTo: toDate, brandSafe, urls: mappedUrls,
    });

    console.log(`[ROUTE:/by-platform] phase1 urlRows=${urlRows.length} urlMapSize=${urlMap.size}`);

    const platformMap = {};
    const othersUrlTotals = {};

    for (const row of urlRows) {
      const appName = urlMap.get(row.url) || 'Others';

      if (platformList.length && !platformList.includes(appName.toLowerCase())) continue;
      if (channel && channel !== 'all' && (row.channel || '').toLowerCase() !== channel.toLowerCase()) continue;

      if (!platformMap[appName]) {
        platformMap[appName] = { name: appName, failedCount: 0, totalRequestsAtRisk: 0, rows: [], matchedByMap: {} };
      }

      const reqTotal     = Number(row.req_total);
      const contentCount = Number(row.content_count);
      const entry        = platformMap[appName];
      entry.failedCount          += contentCount;
      entry.totalRequestsAtRisk  += reqTotal;

      // Build matchedBy sub-accordion headers from Phase 1 data
      const mbKey = (row.matchedby || '').trim() || 'Unmatched';
      if (!entry.matchedByMap[mbKey]) {
        entry.matchedByMap[mbKey] = { matchedBy: mbKey, failedCount: 0, totalRequestsAtRisk: 0, rows: [] };
      }
      entry.matchedByMap[mbKey].failedCount         += contentCount;
      entry.matchedByMap[mbKey].totalRequestsAtRisk += reqTotal;

      if (appName === 'Others') {
        const url = row.url || '';
        if (!othersUrlTotals[url]) othersUrlTotals[url] = { bundleId: url, totalRequestsAtRisk: 0, hitCount: 0 };
        othersUrlTotals[url].totalRequestsAtRisk += reqTotal;
        othersUrlTotals[url].hitCount            += contentCount;
      }
    }

    const result = Object.values(platformMap)
      .map(platform => {
        // Sort matchedByGroups: Unmatched last, rest by requests desc
        platform.matchedByGroups = Object.values(platform.matchedByMap).sort((a, b) => {
          if (a.matchedBy === 'Unmatched') return 1;
          if (b.matchedBy === 'Unmatched') return -1;
          return b.totalRequestsAtRisk - a.totalRequestsAtRisk;
        });
        delete platform.matchedByMap;

        if (platform.name === 'Others') {
          platform.urlSummary = Object.values(othersUrlTotals)
            .sort((a, b) => b.totalRequestsAtRisk - a.totalRequestsAtRisk);
        }
        return platform;
      })
      .sort((a, b) => {
        if (a.name === 'Others') return 1;
        if (b.name === 'Others') return -1;
        return b.totalRequestsAtRisk - a.totalRequestsAtRisk;
      });

    const totalPlatforms = result.length;
    const paginatedResult = result.slice(paginationOffset, paginationOffset + paginationLimit);

    console.log(`[ROUTE:/by-platform] result platforms=${result.length} total=${totalPlatforms} paginated=${paginatedResult.length}`);
    res.json({
      platforms: paginatedResult,
      meta: {
        dateFrom: fromDate,
        dateTo: toDate,
        rowCount: urlRows.length,
        total: totalPlatforms,
        offset: paginationOffset,
        limit: paginationLimit,
      },
    });
  } catch (err) {
    console.error('[ROUTE:/by-platform] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Phase-2: content-level rows fetched on demand when a platform accordion opens.
router.get('/by-platform/detail', async (req, res) => {
  try {
    const { platform, dateFrom, dateTo, brandSafe } = req.query;

    const fromDate = dateFrom || new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const toDate   = dateTo   || fromDate;
    const filters  = { dateFrom: fromDate, dateTo: toDate, brandSafe };

    console.log(`[ROUTE:/by-platform/detail] platform=${platform} dateFrom=${fromDate} dateTo=${toDate}`);

    const urlMap = await getAllPlatformUrlMappings();

    let rawRows;
    if (platform === 'Others') {
      const mappedUrls = Array.from(urlMap.keys());
      rawRows = await getFailedContentRowsExcludingUrls({ ...filters, excludeUrls: mappedUrls });
    } else {
      const platformUrls = [...urlMap.entries()]
        .filter(([, p]) => p.toLowerCase() === platform.toLowerCase())
        .map(([url]) => url);

      if (!platformUrls.length) return res.json({ rows: [] });
      rawRows = await getFailedContentRowsByUrls({ ...filters, urls: platformUrls });
    }

    const rows = rawRows.map(row => ({
      contentId:      row.contentid,
      bundleId:       row.url       || '',
      channel:        row.channel   || '',
      requestsAtRisk: Number(row.req_total),
      matchedBy:      row.matchedby || '',
      isbrandsafe:    row.isbrandsafe,
      rootCauses:     getRootCauses(row),
    }));

    console.log(`[ROUTE:/by-platform/detail] platform=${platform} rows=${rows.length}`);
    res.json({ rows });
  } catch (err) {
    console.error('[ROUTE:/by-platform/detail] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/filters/options', async (req, res) => {
  try {
    console.log('[ROUTE:/filters/options] fetching distinct platforms');
    const platforms = await getDistinctPlatforms();
    console.log(`[ROUTE:/filters/options] platforms=${platforms.length}`);
    res.json({ platforms });
  } catch (err) {
    console.error('[ROUTE:/filters/options] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/trend', async (req, res) => {
  try {
    const { dateFrom, dateTo, platform, brandSafe } = req.query;

    const fromDate = dateFrom || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const toDate   = dateTo   || new Date().toISOString().slice(0, 10);
    const filters  = { dateFrom: fromDate, dateTo: toDate, brandSafe };

    const isSingleDay        = fromDate === toDate;
    const isPlatformFiltered = platform && platform !== 'all';

    console.log(`[ROUTE:/trend] dateFrom=${fromDate} dateTo=${toDate} platform=${platform} brandSafe=${brandSafe} | branch=${isSingleDay ? 'hourly' : isPlatformFiltered ? 'daily-by-platform' : 'daily-all'}`);

    // ── Single day → hourly breakdown ─────────────────────────────────────
    if (isSingleDay) {
      const [failedRows, totalRows] = await Promise.all([
        getHourlyTotals({ date: fromDate, brandSafe }),
        getHourlyTotalAllRequests({ date: fromDate, brandSafe }),
      ]);
      const labels   = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);
      const failData = Array.from({ length: 24 }, (_, h) => {
        const r = failedRows.find(r => Number(r.hour) === h);
        return r ? Number(r.req_total) : 0;
      });
      const totalData = Array.from({ length: 24 }, (_, h) => {
        const r = totalRows.find(r => Number(r.hour) === h);
        return r ? Number(r.req_total) : 0;
      });
      const name = isPlatformFiltered ? platform : 'All Platforms';
      return res.json({
        dates: labels,
        series: [
          { name: `${name} — Failed`, data: failData },
          { name: `${name} — Total`,  data: totalData },
        ],
        granularity: 'hourly',
      });
    }

    // ── Multi-day, no platform filter → total per day ──────────────────
    if (!isPlatformFiltered) {
      const [failedRows, totalRows] = await Promise.all([
        getDailyTotals(filters),
        getDailyTotalAllRequests(filters),
      ]);
      const dateSet = new Set([...failedRows.map(r => r.date), ...totalRows.map(r => r.date)]);
      const dates   = Array.from(dateSet).sort();
      const failMap = Object.fromEntries(failedRows.map(r => [r.date, Number(r.req_total)]));
      const totMap  = Object.fromEntries(totalRows.map(r => [r.date, Number(r.req_total)]));
      return res.json({
        dates,
        series: [
          { name: 'Failed Requests', data: dates.map(d => failMap[d] || 0) },
          { name: 'Total Requests',  data: dates.map(d => totMap[d]  || 0) },
        ],
        granularity: 'daily',
      });
    }

    // ── Multi-day, platform filtered → resolve URLs then daily breakdown ──
    const [urlMap, topUrls] = await Promise.all([
      getAllPlatformUrlMappings(),
      getTopFailedUrls({ ...filters, limit: 50 }),
    ]);

    const platformUrls = topUrls
      .map(r => r.url)
      .filter(url => (urlMap.get(url) || '').toLowerCase() === platform.toLowerCase());

    if (!platformUrls.length) return res.json({ dates: [], series: [], granularity: 'daily' });

    const [failedRows, totalRows] = await Promise.all([
      getDailyTotalsByUrls({ ...filters, urls: platformUrls }),
      getDailyTotalsByUrlsAll({ ...filters, urls: platformUrls }),
    ]);

    const dateSet = new Set([...failedRows.map(r => r.date), ...totalRows.map(r => r.date)]);
    const dates   = Array.from(dateSet).sort();
    const failMap = {};
    for (const row of failedRows) failMap[row.date] = (failMap[row.date] || 0) + Number(row.req_total);
    const totMap  = {};
    for (const row of totalRows)  totMap[row.date]  = (totMap[row.date]  || 0) + Number(row.req_total);

    return res.json({
      dates,
      series: [
        { name: `${platform} — Failed`, data: dates.map(d => failMap[d] || 0) },
        { name: `${platform} — Total`,  data: dates.map(d => totMap[d]  || 0) },
      ],
      granularity: 'daily',
    });

  } catch (err) {
    console.error('trend error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
