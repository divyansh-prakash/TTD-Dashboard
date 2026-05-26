const service = require('../services/failure-queue');
const {
  parseByPlatformQuery,
  parseDetailQuery,
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
    const csv      = await service.downloadPlatformCsv(params);
    const filename = `${params.platform}-failed-content-ids-${params.dateFrom}-${params.dateTo}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error('[CTRL:download]', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getByPlatform, getByPlatformDetail, getFilterOptions, getTrend, download };
