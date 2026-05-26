const { queryClickHouse } = require('../db/clickhouse');

const DB = 'dpttd';

// Use bare date comparisons — wrapping `date` in toDate() breaks partition pruning.
// ClickHouse auto-casts string literals to Date when comparing with a Date column.
function dateConditions(dateFrom, dateTo, brandSafe) {
  const conds = [
    'success = 0',
    `date >= '${dateFrom}'`,
    `date <= '${dateTo}'`,
  ];
  if (brandSafe === '1') conds.push('isbrandsafe = 1');
  if (brandSafe === '0') conds.push('isbrandsafe = 0');
  return conds;
}

/**
 * Phase-1: aggregate by (url, matchedby) for the given set of URLs only.
 * Passing urls keeps ClickHouse from scanning unmapped bundle IDs.
 */
async function getFailedUrlChannelTotals({ dateFrom, dateTo, brandSafe, urls = [] }) {
  console.log(`[REPO:ctvStats] getFailedUrlChannelTotals dateFrom=${dateFrom} dateTo=${dateTo} brandSafe=${brandSafe} urlCount=${urls.length}`);
  const conds = dateConditions(dateFrom, dateTo, brandSafe);
  if (urls.length) {
    conds.push(`url IN (${urls.map(u => `'${u.replace(/'/g, "\\'")}'`).join(',')})`);
  }
  const sql = `
    SELECT
      url,
      matchedby,
      SUM(total)      AS req_total,
      uniq(contentid) AS content_count
    FROM ctv_stats
    WHERE ${conds.join(' AND ')}
    GROUP BY url, matchedby
    ORDER BY req_total DESC
  `;
  return queryClickHouse(sql, DB);
}

/**
 * Phase-2: content-level rows for a specific set of URLs — fetched on demand
 * when the user expands a platform accordion.
 */
async function getFailedContentRowsByUrls({ dateFrom, dateTo, brandSafe, urls }) {
  console.log(`[REPO:ctvStats] getFailedContentRowsByUrls urlCount=${urls.length} dateFrom=${dateFrom} dateTo=${dateTo}`);
  const conds = [
    ...dateConditions(dateFrom, dateTo, brandSafe),
    `url IN (${urls.map(u => `'${u.replace(/'/g, "\\'")}'`).join(',')})`,
  ];
  const sql = `
    SELECT
      contentid,
      url,
      channel,
      SUM(total)       AS req_total,
      any(matchedby)   AS matchedby,
      any(segment)     AS segment,
      any(isbrandsafe) AS isbrandsafe
    FROM ctv_stats
    WHERE ${conds.join(' AND ')}
    GROUP BY contentid, url, channel
    ORDER BY req_total DESC
  `;
  return queryClickHouse(sql, DB);
}

/**
 * Phase-2 for Others: content-level rows for URLs NOT in the platform mapping.
 */
async function getFailedContentRowsExcludingUrls({ dateFrom, dateTo, brandSafe, excludeUrls }) {
  console.log(`[REPO:ctvStats] getFailedContentRowsExcludingUrls excludeCount=${excludeUrls.length} dateFrom=${dateFrom} dateTo=${dateTo}`);
  const conds = [
    ...dateConditions(dateFrom, dateTo, brandSafe),
    `url NOT IN (${excludeUrls.map(u => `'${u.replace(/'/g, "\\'")}'`).join(',')})`,
  ];
  const sql = `
    SELECT
      contentid,
      url,
      channel,
      SUM(total)       AS req_total,
      any(matchedby)   AS matchedby,
      any(segment)     AS segment,
      any(isbrandsafe) AS isbrandsafe
    FROM ctv_stats
    WHERE ${conds.join(' AND ')}
    GROUP BY contentid, url, channel
    ORDER BY req_total DESC
  `;
  return queryClickHouse(sql, DB);
}

/**
 * Failed content rows aggregated by contentid + url + channel.
 * Sorted by total requests descending.
 */
async function getFailedContentRows({ dateFrom, dateTo, brandSafe }) {
  console.log(`[REPO:ctvStats] getFailedContentRows dateFrom=${dateFrom} dateTo=${dateTo} brandSafe=${brandSafe}`);
  const sql = `
    SELECT
      contentid,
      url,
      channel,
      SUM(total)       AS req_total,
      any(matchedby)   AS matchedby,
      any(segment)     AS segment,
      any(isbrandsafe) AS isbrandsafe
    FROM ctv_stats
    WHERE ${dateConditions(dateFrom, dateTo, brandSafe).join(' AND ')}
    GROUP BY contentid, url, channel
    ORDER BY req_total DESC
  `;
  return queryClickHouse(sql, DB);
}

/**
 * Distinct failed urls — used to populate the platform filter dropdown.
 */
async function getDistinctFailedUrls() {
  const sql = `SELECT DISTINCT url FROM ctv_stats WHERE success = 0 LIMIT 1000`;
  return queryClickHouse(sql, DB);
}

/**
 * Top N urls by total failed requests in the date range.
 * Step 1 of the platform-filtered trend flow.
 */
async function getTopFailedUrls({ dateFrom, dateTo, brandSafe, limit = 50 }) {
  console.log(`[REPO:ctvStats] getTopFailedUrls dateFrom=${dateFrom} dateTo=${dateTo} brandSafe=${brandSafe} limit=${limit}`);
  const sql = `
    SELECT url, SUM(total) AS req_total
    FROM ctv_stats
    WHERE ${dateConditions(dateFrom, dateTo, brandSafe).join(' AND ')}
    GROUP BY url
    ORDER BY req_total DESC
    LIMIT ${limit}
  `;
  return queryClickHouse(sql, DB);
}

/**
 * Daily total failures — one number per day, no per-url breakdown.
 * Used for the "All Platforms" trend line.
 */
async function getDailyTotals({ dateFrom, dateTo, brandSafe }) {
  console.log(`[REPO:ctvStats] getDailyTotals dateFrom=${dateFrom} dateTo=${dateTo} brandSafe=${brandSafe}`);
  const sql = `
    SELECT toString(date) AS date, SUM(total) AS req_total
    FROM ctv_stats
    WHERE ${dateConditions(dateFrom, dateTo, brandSafe).join(' AND ')}
    GROUP BY date
    ORDER BY date ASC
  `;
  return queryClickHouse(sql, DB);
}

/**
 * Daily totals for specific urls only — used for platform-filtered trend.
 */
async function getDailyTotalsByUrls({ dateFrom, dateTo, brandSafe, urls }) {
  console.log(`[REPO:ctvStats] getDailyTotalsByUrls dateFrom=${dateFrom} dateTo=${dateTo} brandSafe=${brandSafe} urlCount=${urls.length}`);
  const conds = [
    ...dateConditions(dateFrom, dateTo, brandSafe),
    `url IN (${urls.map(u => `'${u}'`).join(',')})`,
  ];
  const sql = `
    SELECT toString(date) AS date, url, SUM(total) AS req_total
    FROM ctv_stats
    WHERE ${conds.join(' AND ')}
    GROUP BY date, url
    ORDER BY date ASC
  `;
  return queryClickHouse(sql, DB);
}

/**
 * Hourly totals for a single day — used when dateFrom === dateTo.
 */
async function getHourlyTotals({ date, brandSafe }) {
  console.log(`[REPO:ctvStats] getHourlyTotals date=${date} brandSafe=${brandSafe}`);
  const conds = [
    `date = '${date}'`,
    'success = 0',
  ];
  if (brandSafe === '1') conds.push('isbrandsafe = 1');
  if (brandSafe === '0') conds.push('isbrandsafe = 0');

  const sql = `
    SELECT
      toHour(timestamp) AS hour,
      SUM(total)        AS req_total
    FROM ctv_stats
    WHERE ${conds.join(' AND ')}
    GROUP BY hour
    ORDER BY hour ASC
  `;
  return queryClickHouse(sql, DB);
}

function totalDateConditions(dateFrom, dateTo, brandSafe) {
  const conds = [`date >= '${dateFrom}'`, `date <= '${dateTo}'`];
  if (brandSafe === '1') conds.push('isbrandsafe = 1');
  if (brandSafe === '0') conds.push('isbrandsafe = 0');
  return conds;
}

async function getDailyTotalAllRequests({ dateFrom, dateTo, brandSafe }) {
  console.log(`[REPO:ctvStats] getDailyTotalAllRequests dateFrom=${dateFrom} dateTo=${dateTo} brandSafe=${brandSafe}`);
  const sql = `
    SELECT toString(date) AS date, SUM(total) AS req_total
    FROM ctv_stats
    WHERE ${totalDateConditions(dateFrom, dateTo, brandSafe).join(' AND ')}
    GROUP BY date
    ORDER BY date ASC
  `;
  return queryClickHouse(sql, DB);
}

async function getHourlyTotalAllRequests({ date, brandSafe }) {
  console.log(`[REPO:ctvStats] getHourlyTotalAllRequests date=${date} brandSafe=${brandSafe}`);
  const conds = [`date = '${date}'`];
  if (brandSafe === '1') conds.push('isbrandsafe = 1');
  if (brandSafe === '0') conds.push('isbrandsafe = 0');
  const sql = `
    SELECT toHour(timestamp) AS hour, SUM(total) AS req_total
    FROM ctv_stats
    WHERE ${conds.join(' AND ')}
    GROUP BY hour
    ORDER BY hour ASC
  `;
  return queryClickHouse(sql, DB);
}

async function getDailyTotalsByUrlsAll({ dateFrom, dateTo, brandSafe, urls }) {
  console.log(`[REPO:ctvStats] getDailyTotalsByUrlsAll dateFrom=${dateFrom} dateTo=${dateTo} urlCount=${urls.length}`);
  const conds = [
    ...totalDateConditions(dateFrom, dateTo, brandSafe),
    `url IN (${urls.map(u => `'${u}'`).join(',')})`,
  ];
  const sql = `
    SELECT toString(date) AS date, url, SUM(total) AS req_total
    FROM ctv_stats
    WHERE ${conds.join(' AND ')}
    GROUP BY date, url
    ORDER BY date ASC
  `;
  return queryClickHouse(sql, DB);
}

module.exports = {
  getFailedContentRows,
  getFailedUrlChannelTotals,
  getFailedContentRowsByUrls,
  getFailedContentRowsExcludingUrls,
  getDistinctFailedUrls,
  getTopFailedUrls,
  getDailyTotals,
  getDailyTotalsByUrls,
  getHourlyTotals,
  getDailyTotalAllRequests,
  getHourlyTotalAllRequests,
  getDailyTotalsByUrlsAll,
};
