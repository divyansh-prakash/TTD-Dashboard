const { queryClickHouse } = require('../db/clickhouse');

const DB = 'dpttd';

// Wraps a URL string in single quotes with inner quotes escaped.
// Used for building IN-lists; keeps escaping consistent across all queries.
const sq = u => `'${u.replace(/'/g, "\\'")}'`;

// Conditions for failed-request queries (success = 0 + date range + optional brandSafe).
// Use bare date comparisons — wrapping `date` in toDate() breaks partition pruning.
// iris_ content IDs are decommissioned and excluded from all queries.
function dateConditions(dateFrom, dateTo, brandSafe) {
  const conds = [
    'success = 0',
    `date >= '${dateFrom}'`,
    `date <= '${dateTo}'`,
    "NOT startsWith(contentid, 'iris')",
  ];
  if (brandSafe === '1') conds.push('isbrandsafe = 1');
  if (brandSafe === '0') conds.push('isbrandsafe = 0');
  return conds;
}

// Conditions for total-request queries (no success filter).
function totalDateConditions(dateFrom, dateTo, brandSafe) {
  const conds = [
    `date >= '${dateFrom}'`,
    `date <= '${dateTo}'`,
    "NOT startsWith(contentid, 'iris')",
  ];
  if (brandSafe === '1') conds.push('isbrandsafe = 1');
  if (brandSafe === '0') conds.push('isbrandsafe = 0');
  return conds;
}

// Builds a matchedby condition for Phase-2 queries.
// 'Unmatched' matches rows where matchedby is empty or NULL.
function matchedByCondition(matchedBy) {
  if (!matchedBy) return null;
  if (matchedBy === 'Unmatched') return `(matchedby = '' OR matchedby IS NULL)`;
  return `matchedby = ${sq(matchedBy)}`;
}

/**
 * Phase-1: aggregate by (url, matchedby) for the given set of URLs only.
 * Scoping to mappedUrls avoids scanning unmapped bundle IDs.
 */
async function getFailedUrlChannelTotals({ dateFrom, dateTo, brandSafe, urls = [] }) {
  console.log(`[REPO:ctvStats] getFailedUrlChannelTotals dateFrom=${dateFrom} dateTo=${dateTo} urlCount=${urls.length}`);
  const conds = dateConditions(dateFrom, dateTo, brandSafe);
  if (urls.length) conds.push(`url IN (${urls.map(sq).join(',')})`);
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
 * Phase-2: paginated content rows for a specific set of URLs.
 * matchedBy = 'Unmatched' matches rows with empty/null matchedby.
 */
async function getFailedContentRowsByUrls({ dateFrom, dateTo, brandSafe, urls, matchedBy, limit = 25, offset = 0 }) {
  console.log(`[REPO:ctvStats] getFailedContentRowsByUrls urlCount=${urls.length} matchedBy=${matchedBy} limit=${limit} offset=${offset}`);
  const whereConds = [
    ...dateConditions(dateFrom, dateTo, brandSafe),
    `url IN (${urls.map(sq).join(',')})`,
  ];
  const mbCond = matchedByCondition(matchedBy);
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
    WHERE ${whereConds.join(' AND ')}
    GROUP BY contentid, url, channel
    ${mbCond ? `HAVING ${mbCond}` : ''}
    ORDER BY req_total DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return queryClickHouse(sql, DB);
}

/**
 * Phase-2 for Others: paginated content rows for URLs NOT in the platform mapping.
 */
async function getFailedContentRowsExcludingUrls({ dateFrom, dateTo, brandSafe, excludeUrls, matchedBy, limit = 25, offset = 0 }) {
  console.log(`[REPO:ctvStats] getFailedContentRowsExcludingUrls excludeCount=${excludeUrls.length} matchedBy=${matchedBy} limit=${limit} offset=${offset}`);
  const whereConds = [
    ...dateConditions(dateFrom, dateTo, brandSafe),
    `url NOT IN (${excludeUrls.map(sq).join(',')})`,
  ];
  const mbCond = matchedByCondition(matchedBy);
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
    WHERE ${whereConds.join(' AND ')}
    GROUP BY contentid, url, channel
    ${mbCond ? `HAVING ${mbCond}` : ''}
    ORDER BY req_total DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return queryClickHouse(sql, DB);
}

/**
 * Phase-1 for Others: aggregate unmapped URLs by matchedby.
 * Builds the Others accordion header counts without fetching content rows.
 */
async function getOthersChannelTotals({ dateFrom, dateTo, brandSafe, excludeUrls }) {
  console.log(`[REPO:ctvStats] getOthersChannelTotals excludeCount=${excludeUrls.length} dateFrom=${dateFrom} dateTo=${dateTo}`);
  const conds = [
    ...dateConditions(dateFrom, dateTo, brandSafe),
    `url NOT IN (${excludeUrls.map(sq).join(',')})`,
  ];
  const sql = `
    SELECT
      matchedby,
      SUM(total)      AS req_total,
      uniq(contentid) AS content_count
    FROM ctv_stats
    WHERE ${conds.join(' AND ')}
    GROUP BY matchedby
    ORDER BY req_total DESC
  `;
  return queryClickHouse(sql, DB);
}

/**
 * Top N unmapped URLs by failed requests — populates the Others "By URL" tab.
 */
async function getOthersTopUrls({ dateFrom, dateTo, brandSafe, excludeUrls, limit = 100 }) {
  console.log(`[REPO:ctvStats] getOthersTopUrls excludeCount=${excludeUrls.length} limit=${limit} dateFrom=${dateFrom} dateTo=${dateTo}`);
  const conds = [
    ...dateConditions(dateFrom, dateTo, brandSafe),
    `url NOT IN (${excludeUrls.map(sq).join(',')})`,
  ];
  const sql = `
    SELECT
      url,
      SUM(total)      AS req_total,
      uniq(contentid) AS content_count
    FROM ctv_stats
    WHERE ${conds.join(' AND ')}
    GROUP BY url
    ORDER BY req_total DESC
    LIMIT ${limit}
  `;
  return queryClickHouse(sql, DB);
}

/**
 * Top N urls by total failed requests — used in the platform-filtered trend flow.
 */
async function getTopFailedUrls({ dateFrom, dateTo, brandSafe, limit = 50 }) {
  console.log(`[REPO:ctvStats] getTopFailedUrls dateFrom=${dateFrom} dateTo=${dateTo} limit=${limit}`);
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
 * Daily total failures — one row per day, used for the "All Platforms" trend line.
 */
async function getDailyTotals({ dateFrom, dateTo, brandSafe }) {
  console.log(`[REPO:ctvStats] getDailyTotals dateFrom=${dateFrom} dateTo=${dateTo}`);
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
 * Daily failures for specific URLs — used for the platform-filtered trend line.
 */
async function getDailyTotalsByUrls({ dateFrom, dateTo, brandSafe, urls }) {
  console.log(`[REPO:ctvStats] getDailyTotalsByUrls dateFrom=${dateFrom} dateTo=${dateTo} urlCount=${urls.length}`);
  const conds = [
    ...dateConditions(dateFrom, dateTo, brandSafe),
    `url IN (${urls.map(sq).join(',')})`,
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
 * Hourly failures for a single day — used when dateFrom === dateTo.
 */
async function getHourlyTotals({ date, brandSafe }) {
  console.log(`[REPO:ctvStats] getHourlyTotals date=${date}`);
  const sql = `
    SELECT toHour(timestamp) AS hour, SUM(total) AS req_total
    FROM ctv_stats
    WHERE ${dateConditions(date, date, brandSafe).join(' AND ')}
    GROUP BY hour
    ORDER BY hour ASC
  `;
  return queryClickHouse(sql, DB);
}

/**
 * All failed content rows for a set of URLs — no LIMIT, used for CSV export.
 */
async function getAllFailedContentRowsByUrls({ dateFrom, dateTo, brandSafe, urls }) {
  console.log(`[REPO:ctvStats] getAllFailedContentRowsByUrls dateFrom=${dateFrom} dateTo=${dateTo} urlCount=${urls.length}`);
  const conds = [
    ...dateConditions(dateFrom, dateTo, brandSafe),
    `url IN (${urls.map(sq).join(',')})`,
  ];
  const sql = `
    SELECT
      contentid,
      url,
      channel,
      SUM(total)       AS req_total,
      any(matchedby)   AS matchedby,
      any(segment)     AS segment
    FROM ctv_stats
    WHERE ${conds.join(' AND ')}
    GROUP BY contentid, url, channel
    ORDER BY req_total DESC
  `;
  return queryClickHouse(sql, DB);
}

/**
 * Healthy (success=1) category totals for mapped URLs, grouped by (url, matchedby).
 * Used to surface zero-failure categories in the platform queue healthy section.
 */
async function getHealthyCategoryTotals({ dateFrom, dateTo, brandSafe, urls = [] }) {
  console.log(`[REPO:ctvStats] getHealthyCategoryTotals dateFrom=${dateFrom} dateTo=${dateTo} urlCount=${urls.length}`);
  if (!urls.length) return [];
  const conds = [
    'success = 1',
    `date >= '${dateFrom}'`,
    `date <= '${dateTo}'`,
    "NOT startsWith(contentid, 'iris')",
    `url IN (${urls.map(sq).join(',')})`,
    "matchedby != ''",
    "matchedby IS NOT NULL",
  ];
  if (brandSafe === '1') conds.push('isbrandsafe = 1');
  if (brandSafe === '0') conds.push('isbrandsafe = 0');
  const sql = `
    SELECT
      url,
      matchedby,
      SUM(total) AS req_served
    FROM ctv_stats
    WHERE ${conds.join(' AND ')}
    GROUP BY url, matchedby
    ORDER BY req_served DESC
  `;
  return queryClickHouse(sql, DB);
}

/**
 * Daily total all requests (success + failed) — used for the trend "Total" line.
 */
async function getDailyTotalAllRequests({ dateFrom, dateTo, brandSafe }) {
  console.log(`[REPO:ctvStats] getDailyTotalAllRequests dateFrom=${dateFrom} dateTo=${dateTo}`);
  const sql = `
    SELECT toString(date) AS date, SUM(total) AS req_total
    FROM ctv_stats
    WHERE ${totalDateConditions(dateFrom, dateTo, brandSafe).join(' AND ')}
    GROUP BY date
    ORDER BY date ASC
  `;
  return queryClickHouse(sql, DB);
}

/**
 * Hourly total all requests for a single day — used for the trend "Total" line.
 */
async function getHourlyTotalAllRequests({ date, brandSafe }) {
  console.log(`[REPO:ctvStats] getHourlyTotalAllRequests date=${date}`);
  const sql = `
    SELECT toHour(timestamp) AS hour, SUM(total) AS req_total
    FROM ctv_stats
    WHERE ${totalDateConditions(date, date, brandSafe).join(' AND ')}
    GROUP BY hour
    ORDER BY hour ASC
  `;
  return queryClickHouse(sql, DB);
}

/**
 * Daily total all requests for specific URLs — used for the platform-filtered trend "Total" line.
 */
async function getDailyTotalsByUrlsAll({ dateFrom, dateTo, brandSafe, urls }) {
  console.log(`[REPO:ctvStats] getDailyTotalsByUrlsAll dateFrom=${dateFrom} dateTo=${dateTo} urlCount=${urls.length}`);
  const conds = [
    ...totalDateConditions(dateFrom, dateTo, brandSafe),
    `url IN (${urls.map(sq).join(',')})`,
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
};
