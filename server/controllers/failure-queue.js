const service = require('../services/failure-queue');
const {
  parseByPlatformQuery,
  parseDetailQuery,
  parseSummaryQuery,
  parseTrendQuery,
  parsePagination,
  parseDownloadQuery,
} = require('../models/failure-queue');

async function getByPlatform(req, res) {
  try {
    const filters           = parseByPlatformQuery(req.query);
    const { limit, offset } = parsePagination(req.query);
    const result            = await service.getByPlatform({ ...filters, limit, offset });
    res.json(result);
  } catch (err) {
    console.error('[CTRL:getByPlatform]', err.message);
    res.status(500).json({ error: err.message });
  }
}

async function getByPlatformDetail(req, res) {
  try {
    const params            = parseDetailQuery(req.query);
    const { limit, offset } = parsePagination(req.query);
    const result            = await service.getByPlatformDetail({ ...params, limit, offset });
    res.json(result);
  } catch (err) {
    console.error('[CTRL:getByPlatformDetail]', err.message);
    res.status(500).json({ error: err.message });
  }
}

async function getFilterOptions(req, res) {
  try {
    const result = await service.getFilterOptions();
    res.json(result);
  } catch (err) {
    console.error('[CTRL:getFilterOptions]', err.message);
    res.status(500).json({ error: err.message });
  }
}

async function getTrend(req, res) {
  try {
    const params = parseTrendQuery(req.query);
    const result = await service.getTrend(params);
    res.json(result);
  } catch (err) {
    console.error('[CTRL:getTrend]', err.message);
    res.status(500).json({ error: err.message });
  }
}

async function download(req, res) {
  try {
    const params = parseDownloadQuery(req.query);
    if (!params.platform) return res.status(400).json({ error: 'platform is required' });
    const csv      = await service.downloadCsv(params);
    const filename = `${params.platform}-${params.type}-${params.dateFrom}-${params.dateTo}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error('[CTRL:download]', err.message);
    res.status(500).json({ error: err.message });
  }
}

async function getPlatformSummary(req, res) {
  try {
    const params = parseSummaryQuery(req.query);
    if (!params.platform) return res.status(400).json({ error: 'platform is required' });
    const result = await service.getPlatformSummary(params);
    if (!result) return res.status(404).json({ error: 'Platform not found' });
    res.json(result);
  } catch (err) {
    console.error('[CTRL:getPlatformSummary]', err.message);
    res.status(500).json({ error: err.message });
  }
}

async function getPeriodComparison(req, res) {
  try {
    const { dateFrom, dateTo, brandSafe } = req.query;
    const platforms = req.query.platforms;
    const platformList = Array.isArray(platforms) ? platforms.map(p => p.toLowerCase())
      : platforms ? [platforms.toLowerCase()] : [];
    const result = await service.getPeriodComparison({
      dateFrom:  dateFrom  || '',
      dateTo:    dateTo    || '',
      brandSafe: brandSafe || 'all',
      platformList,
    });
    res.json(result);
  } catch (err) {
    console.error('[CTRL:getPeriodComparison]', err.message);
    res.status(500).json({ error: err.message });
  }
}

async function getContentHits(req, res) {
  try {
    const { platform, dateFrom, dateTo, brandSafe, matchedBy, limit, offset } = req.query;
    if (!platform) return res.status(400).json({ error: 'platform is required' });
    const result = await service.getContentHits({
      platform,
      dateFrom:  dateFrom  || '',
      dateTo:    dateTo    || '',
      brandSafe: brandSafe || 'all',
      matchedBy: matchedBy || '',
      limit:  Math.max(1, parseInt(limit,  10) || 50),
      offset: Math.max(0, parseInt(offset, 10) || 0),
    });
    res.json(result);
  } catch (err) {
    console.error('[CTRL:getContentHits]', err.message);
    res.status(500).json({ error: err.message });
  }
}

async function getSegmentRankings(req, res) {
  try {
    const { dateFrom, dateTo, brandSafe, region, n } = req.query;
    const result = await service.getSegmentRankingsSvc({
      dateFrom:  dateFrom  || '',
      dateTo:    dateTo    || '',
      brandSafe: brandSafe || 'all',
      region:    region    || 'all',
      n: Math.max(1, parseInt(n, 10) || 10),
    });
    res.json(result);
  } catch (err) {
    console.error('[CTRL:getSegmentRankings]', err.message);
    res.status(500).json({ error: err.message });
  }
}

async function getSegmentDetail(req, res) {
  try {
    const { segment, dateFrom, dateTo, brandSafe, region } = req.query;
    if (!segment) return res.status(400).json({ error: 'segment is required' });
    const result = await service.getSegmentDetailSvc({
      segment,
      dateFrom:  dateFrom  || '',
      dateTo:    dateTo    || '',
      brandSafe: brandSafe || 'all',
      region:    region    || 'all',
    });
    res.json(result);
  } catch (err) {
    console.error('[CTRL:getSegmentDetail]', err.message);
    res.status(500).json({ error: err.message });
  }
}

async function getPlatformSegmentCounts(req, res) {
  try {
    const { dateFrom, dateTo, brandSafe, region } = req.query;
    const result = await service.getPlatformSegmentCountsSvc({ dateFrom: dateFrom || '', dateTo: dateTo || '', brandSafe: brandSafe || 'all', region: region || 'all' });
    res.json(result);
  } catch (err) { console.error('[CTRL:getPlatformSegmentCounts]', err.message); res.status(500).json({ error: err.message }); }
}

async function getPlatformSegmentDetail(req, res) {
  try {
    const { platform, dateFrom, dateTo, brandSafe, region } = req.query;
    if (!platform) return res.status(400).json({ error: 'platform required' });
    const result = await service.getPlatformSegmentDetailSvc({ platform, dateFrom: dateFrom || '', dateTo: dateTo || '', brandSafe: brandSafe || 'all', region: region || 'all' });
    res.json(result);
  } catch (err) { console.error('[CTRL:getPlatformSegmentDetail]', err.message); res.status(500).json({ error: err.message }); }
}

module.exports = { getByPlatform, getByPlatformDetail, getPlatformSummary, getFilterOptions, getTrend, download, getContentHits, getPeriodComparison, getSegmentRankings, getSegmentDetail, getPlatformSegmentCounts, getPlatformSegmentDetail };
