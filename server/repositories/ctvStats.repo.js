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
 * Failed content rows aggregated by contentid + url + channel.
 * Sorted by total requests descending.
 */
async function getFailedContentRows({ dateFrom, dateTo, brandSafe }) {
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
    LIMIT 5000
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

module.exports = {
  getFailedContentRows,
  getDistinctFailedUrls,
  getTopFailedUrls,
  getDailyTotals,
  getDailyTotalsByUrls,
  getHourlyTotals,
};
