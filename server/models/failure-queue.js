const DEFAULT_DAYS = 7;

const today   = () => new Date().toISOString().slice(0, 10);
const daysAgo = n  => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

function parseByPlatformQuery(query) {
  const { dateFrom, dateTo, platforms, channel, brandSafe, region } = query;
  return {
    dateFrom:     dateFrom  || daysAgo(DEFAULT_DAYS),
    dateTo:       dateTo    || today(),
    region:       region || 'all',
    platformList: Array.isArray(platforms)
      ? platforms.map(p => p.toLowerCase())
      : (platforms ? [platforms.toLowerCase()] : []),
    channel:   channel   || 'all',
    brandSafe: brandSafe || 'all',
  };
}

// Detail endpoint defaults to a single-day window (yesterday).
// When only dateFrom is provided, dateTo defaults to the same date.
function parseDetailQuery(query) {
  const { platform, dateFrom, dateTo, brandSafe, matchedBy, enrichable, search, region } = query;
  const from = dateFrom || daysAgo(1);
  return {
    platform,
    dateFrom:  from,
    dateTo:    dateTo    || from,
    brandSafe: brandSafe || 'all',
    matchedBy: matchedBy || '',
    enrichable: enrichable === 'true',
    region:    (region || 'all'),
    search:    (search || '').trim(),
  };
}

function parseSummaryQuery(query) {
  const { platform, dateFrom, dateTo, brandSafe, region } = query;
  const from = dateFrom || daysAgo(1);
  return {
    platform:  platform  || '',
    region:    region    || 'all',
    dateFrom:  from,
    dateTo:    dateTo    || from,
    brandSafe: brandSafe || 'all',
  };
}

function parseTrendQuery(query) {
  const { dateFrom, dateTo, platform, brandSafe, region } = query;
  return {
    dateFrom:  dateFrom  || daysAgo(DEFAULT_DAYS),
    dateTo:    dateTo    || today(),
    platform:  platform  || 'all',
    brandSafe: brandSafe || 'all',
    region:    region    || 'all',
  };
}

function parsePagination(query, defaultLimit = 25) {
  return {
    limit:  Math.max(1, parseInt(query.limit,  10) || defaultLimit),
    offset: Math.max(0, parseInt(query.offset, 10) || 0),
  };
}

// Transforms a raw ClickHouse ctv_stats row into the response shape the frontend expects.
function toFailedRow(row) {
  const causes = [];
  if (!(row.segment   || '').trim()) causes.push('NO SEGMENTS');
  if (!(row.matchedby || '').trim()) causes.push('UNMATCHED');
  return {
    contentId:      row.contentid,
    bundleId:       row.url       || '',
    channel:        row.channel   || '',
    requestsAtRisk: Number(row.req_total),
    matchedBy:      row.matchedby || '',
    segment:        row.segment   || '',
    title:          row.title     || '',
    series:         row.series    || '',
    season:         row.season    || '',
    episode:        row.episode   || '',
    isbrandsafe:    row.isbrandsafe,
    rootCauses:     causes,
  };
}

function parseDownloadQuery(query) {
  const { platform, dateFrom, dateTo, brandSafe, type, matchedBy, region } = query;
  const from = dateFrom || daysAgo(DEFAULT_DAYS);
  return {
    platform:  platform  || '',
    dateFrom:  from,
    dateTo:    dateTo    || today(),
    brandSafe: brandSafe || 'all',
    type:      type      || 'failed',
    matchedBy: matchedBy || '',
    region:    region    || 'all',
  };
}

module.exports = { parseByPlatformQuery, parseDetailQuery, parseSummaryQuery, parseTrendQuery, parsePagination, parseDownloadQuery, toFailedRow };
