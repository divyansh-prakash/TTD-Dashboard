const express = require('express');
const router = express.Router();
const { getFailedContentRows, getTopFailedUrls, getDailyTotals, getDailyTotalsByUrls, getHourlyTotals } = require('../repositories/ctvStats.repo');
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
    const { dateFrom, dateTo, platforms, channel, brandSafe } = req.query;
    const platformList = Array.isArray(platforms)
      ? platforms.map(p => p.toLowerCase())
      : (platforms ? [platforms.toLowerCase()] : []);

    const fromDate = dateFrom || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const toDate   = dateTo   || new Date().toISOString().slice(0, 10);

    const [rows, urlMap] = await Promise.all([
      getFailedContentRows({ dateFrom: fromDate, dateTo: toDate, brandSafe }),
      getAllPlatformUrlMappings(),
    ]);

    const platformMap = {};
    for (const row of rows) {
      const appName = urlMap.get(row.url);
      if (!appName) continue; // skip URLs not in platform_url_mapping

      if (platformList.length && !platformList.includes(appName.toLowerCase())) continue;
      if (channel && channel !== 'all' && (row.channel || '').toLowerCase() !== channel.toLowerCase()) continue;

      if (!platformMap[appName]) {
        platformMap[appName] = { name: appName, failedCount: 0, totalRequestsAtRisk: 0, rows: [] };
      }

      const entry = platformMap[appName];
      entry.failedCount += 1;
      entry.totalRequestsAtRisk += Number(row.req_total);
      entry.rows.push({
        contentId:      row.contentid,
        bundleId:       row.url        || '',
        channel:        row.channel    || '',
        requestsAtRisk: Number(row.req_total),
        matchedBy:      row.matchedby  || '',
        isbrandsafe:    row.isbrandsafe,
        rootCauses:     getRootCauses(row),
      });
    }

    const result = Object.values(platformMap)
      .sort((a, b) => b.totalRequestsAtRisk - a.totalRequestsAtRisk);

    res.json({ platforms: result, meta: { dateFrom: fromDate, dateTo: toDate, rowCount: rows.length } });
  } catch (err) {
    console.error('by-platform error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/filters/options', async (req, res) => {
  try {
    const platforms = await getDistinctPlatforms();
    res.json({ platforms });
  } catch (err) {
    console.error('filter options error:', err.message);
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

    // ── Single day → hourly breakdown ─────────────────────────────────────
    if (isSingleDay) {
      const rows   = await getHourlyTotals({ date: fromDate, brandSafe });
      const data   = Array.from({ length: 24 }, (_, h) => {
        const row = rows.find(r => Number(r.hour) === h);
        return row ? Number(row.req_total) : 0;
      });
      const labels = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);
      const name   = isPlatformFiltered ? platform : 'All Platforms';
      return res.json({ dates: labels, series: [{ name, data }], granularity: 'hourly' });
    }

    // ── Multi-day, no platform filter → total per day ──────────────────
    if (!isPlatformFiltered) {
      const rows  = await getDailyTotals(filters);
      const dates = rows.map(r => r.date);
      const data  = rows.map(r => Number(r.req_total));
      return res.json({ dates, series: [{ name: 'All Platforms', data }], granularity: 'daily' });
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

    const dailyRows = await getDailyTotalsByUrls({ ...filters, urls: platformUrls });
    const byDate = {};
    const dateSet = new Set();
    for (const row of dailyRows) {
      dateSet.add(row.date);
      byDate[row.date] = (byDate[row.date] || 0) + Number(row.req_total);
    }
    const dates = Array.from(dateSet).sort();
    return res.json({
      dates,
      series:      [{ name: platform, data: dates.map(d => byDate[d] || 0) }],
      granularity: 'daily',
    });

  } catch (err) {
    console.error('trend error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
