/**
 * Pubmatic ClickHouse query layer.
 * Schema: ctv.ctv_agg_data
 *
 * Key differences from TTD ctv_stats:
 *  - Table      : ctv_agg_data (not ctv_stats)
 *  - URL column : appid         (not url)
 *  - Content ID : content_id    (not contentid)
 *  - Total      : total_count   (not total)
 *  - Date       : date  (String, not Date)
 *  - Hour       : hour          (Int32 column — direct, no toHour())
 *  - No success column — served = matchedby IS NOT NULL && != ''
 *                       failed  = matchedby IS NULL || = ''
 *
 * All functions mirror ctvStats.repo.js signatures so the service
 * can swap repos transparently.
 */
const { queryClickHouse } = require('../db/clickhouse');
const { getPartnerConfig } = require('../db/databases');

const PUB = getPartnerConfig('Pubmatic');
const sq  = u => `'${u.replace(/'/g, "\\'")}'`;

// ── Conditions ────────────────────────────────────────────────────────────────

function baseConds(dateFrom, dateTo, region) {
  const c = [
    `date >= '${dateFrom}'`,
    `date <= '${dateTo}'`,
  ];
  if (region && region !== 'all') c.push(`region = ${sq(region)}`);
  return c;
}

const SERVED = "matchedby != '' AND matchedby IS NOT NULL";
const FAILED = "(matchedby = '' OR matchedby IS NULL)";

// ── Aggregation helpers ────────────────────────────────────────────────────────

function buildAggSelect(groupBy) {
  switch (groupBy) {
    case 'date':         return { select: `toString(date) AS date, SUM(total_count) AS req_total`, group: 'date', order: 'date ASC' };
    case 'hour':         return { select: `hour, SUM(total_count) AS req_total`,                           group: 'hour',         order: 'hour ASC' };
    case 'url':          return { select: `appid AS url, SUM(total_count) AS req_total, uniq(content_id) AS content_count`, group: 'appid',  order: 'req_total DESC' };
    case 'url,matchedby':return { select: `appid AS url, matchedby, SUM(total_count) AS req_total, uniq(content_id) AS content_count`, group: 'appid, matchedby', order: 'req_total DESC' };
    case 'matchedby':    return { select: `matchedby, SUM(total_count) AS req_total, uniq(content_id) AS content_count`, group: 'matchedby', order: 'req_total DESC' };
    default: throw new Error(`[pubmaticStats] unknown groupBy: ${groupBy}`);
  }
}

async function query(sql, db) {
  return queryClickHouse(sql, db, { host: PUB.host, user: PUB.user, password: PUB.password });
}

// ── Public API (mirrors ctvStats.repo.js) ─────────────────────────────────────

async function getCtvFailedAgg({ dateFrom, dateTo, region, urls = [], excludeUrls = [], groupBy = 'date', limit, db }) {
  const conds = [...baseConds(dateFrom, dateTo, region), FAILED];
  if (urls.length)        conds.push(`appid IN (${urls.map(sq).join(',')})`);
  if (excludeUrls.length) conds.push(`appid NOT IN (${excludeUrls.map(sq).join(',')})`);
  const { select, group, order } = buildAggSelect(groupBy);
  const lim = limit ? `LIMIT ${limit}` : '';
  const sql = `SELECT ${select} FROM ctv_agg_data WHERE ${conds.join(' AND ')} GROUP BY ${group} ORDER BY ${order} ${lim}`;
  return query(sql, db);
}

async function getCtvTotalAgg({ dateFrom, dateTo, region, urls = [], excludeUrls = [], groupBy = 'date', limit, db }) {
  const conds = baseConds(dateFrom, dateTo, region);
  if (urls.length)        conds.push(`appid IN (${urls.map(sq).join(',')})`);
  if (excludeUrls.length) conds.push(`appid NOT IN (${excludeUrls.map(sq).join(',')})`);
  const { select, group, order } = buildAggSelect(groupBy);
  const lim = limit ? `LIMIT ${limit}` : '';
  const sql = `SELECT ${select} FROM ctv_agg_data WHERE ${conds.join(' AND ')} GROUP BY ${group} ORDER BY ${order} ${lim}`;
  return query(sql, db);
}

async function getHealthyCategoryTotals({ dateFrom, dateTo, region, urls = [], db }) {
  if (!urls.length) return [];
  const conds = [
    ...baseConds(dateFrom, dateTo, region),
    SERVED,
    "matchedby IS NOT NULL",
    `appid IN (${urls.map(sq).join(',')})`,
  ];
  const sql = `
    SELECT appid AS url, matchedby, SUM(total_count) AS req_served
    FROM ctv_agg_data
    WHERE ${conds.join(' AND ')}
    GROUP BY appid, matchedby
    ORDER BY req_served DESC
  `;
  return query(sql, db);
}

async function getUnmatchedUrlBreakdown({ dateFrom, dateTo, region, urls, db }) {
  if (!urls.length) return [];
  const conds = [
    ...baseConds(dateFrom, dateTo, region),
    FAILED,
    `appid IN (${urls.map(sq).join(',')})`,
  ];
  const sql = `
    SELECT appid AS url, SUM(total_count) AS req_total, uniq(content_id) AS content_count
    FROM ctv_agg_data
    WHERE ${conds.join(' AND ')}
    GROUP BY appid
    ORDER BY req_total DESC
  `;
  return query(sql, db);
}

async function getFailedContentRowsByUrls({ dateFrom, dateTo, region, urls, matchedBy, search = '', limit = 25, offset = 0, db }) {
  const conds = [...baseConds(dateFrom, dateTo, region), FAILED, `appid IN (${urls.map(sq).join(',')})`];
  if (search) conds.push(`(positionCaseInsensitive(content_id, ${sq(search)}) > 0 OR positionCaseInsensitive(appid, ${sq(search)}) > 0)`);
  const mbCond = matchedBy === 'Unmatched' ? null : (matchedBy ? `matchedby = ${sq(matchedBy)}` : null);
  const sql = `
    SELECT content_id AS contentid, appid AS url, '' AS channel,
           SUM(total_count) AS req_total,
           any(matchedby) AS matchedby, '' AS segment,
           any(content_title) AS title, any(content_series) AS series,
           '' AS season, '' AS episode, 1 AS isbrandsafe
    FROM ctv_agg_data
    WHERE ${conds.join(' AND ')}
    GROUP BY content_id, appid
    ${mbCond ? `HAVING ${mbCond}` : ''}
    ORDER BY req_total DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return query(sql, db);
}

async function getServedContentRowsByUrls({ dateFrom, dateTo, region, urls, matchedBy, search = '', limit = 25, offset = 0, db }) {
  const conds = [...baseConds(dateFrom, dateTo, region), SERVED, `appid IN (${urls.map(sq).join(',')})`];
  if (search) conds.push(`(positionCaseInsensitive(content_id, ${sq(search)}) > 0 OR positionCaseInsensitive(appid, ${sq(search)}) > 0)`);
  const mbCond = matchedBy ? `matchedby = ${sq(matchedBy)}` : null;
  const sql = `
    SELECT content_id AS contentid, appid AS url, '' AS channel,
           SUM(total_count) AS req_total,
           any(matchedby) AS matchedby, '' AS segment,
           any(content_title) AS title, any(content_series) AS series,
           '' AS season, '' AS episode, 1 AS isbrandsafe
    FROM ctv_agg_data
    WHERE ${conds.join(' AND ')}
    GROUP BY content_id, appid
    ${mbCond ? `HAVING ${mbCond}` : ''}
    ORDER BY req_total DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return query(sql, db);
}

// Stub wrappers for CSV export (return same shape as TTD versions)
async function getAllFailedContentRowsByUrls(params)         { return getFailedContentRowsByUrls({ ...params, limit: 10000, offset: 0 }); }
async function getAllFailedContentRowsExcludingUrls(params)  { return []; }
async function getAllServedContentRowsByUrls(params)         { return getServedContentRowsByUrls({ ...params, limit: 10000, offset: 0 }); }
async function getAllServedContentRowsExcludingUrls(params)  { return []; }
async function getFailedContentRowsExcludingUrls(params)    { return []; }
async function getServedContentRowsExcludingUrls(params)    { return []; }

/**
 * KPI summary + known-vs-unknown platform split for the Pubmatic dashboard.
 * knownAppIds = list from platform_url_mapping (resolved in service layer).
 */
async function getPubmaticKpiSummary({ dateFrom, dateTo, region, knownAppIds = [], db }) {
  const baseConds = [`date >= '${dateFrom}'`, `date <= '${dateTo}'`];
  if (region && region !== 'all') baseConds.push(`region = ${sq(region)}`);
  const where = baseConds.join(' AND ');

  const knownIn = knownAppIds.length ? knownAppIds.map(sq).join(',') : "'__NONE__'";

  const [kpi, matchedRows, unmatchedRows, split, platformRows, contentIds, contentIdsMatched, servedHitsRows, matchedContentTotalRequests] = await Promise.all([
    // Total hits + total unique (content_id, appid) pairs + raw row count
    query(`
      SELECT SUM(total_count)        AS total_hits,
             uniq(content_id, appid) AS unique_total,
             COUNT(*)                AS total_rows
      FROM ctv_agg_data WHERE ${where}
    `, db),

    // Unique pairs that HAD a match (matchedby is set)
    query(`
      SELECT uniq(content_id, appid) AS unique_matched
      FROM ctv_agg_data
      WHERE ${where} AND matchedby != '' AND matchedby IS NOT NULL
    `, db),

    // Unique pairs that had NO match (matchedby is empty)
    query(`
      SELECT uniq(content_id, appid) AS unique_unmatched
      FROM ctv_agg_data
      WHERE ${where} AND (matchedby = '' OR matchedby IS NULL)
    `, db),

    // Known vs unknown platform split (by total_count)
    query(`
      SELECT
        SUM(if(appid IN (${knownIn}), total_count, 0))     AS known_hits,
        SUM(if(appid NOT IN (${knownIn}), total_count, 0)) AS unknown_hits
      FROM ctv_agg_data WHERE ${where}
    `, db),

    // Per-appid breakdown — resolved to platform names in service layer
    query(`
      SELECT appid, SUM(total_count) AS hits
      FROM ctv_agg_data WHERE ${where}
      GROUP BY appid ORDER BY hits DESC LIMIT 200
    `, db),

    // Unique distinct content IDs (regardless of appid)
    query(`
      SELECT uniq(content_id) AS unique_content_ids
      FROM ctv_agg_data WHERE ${where}
    `, db),

    // Unique distinct content IDs that were matched
    query(`
      SELECT uniq(content_id) AS unique_content_matched
      FROM ctv_agg_data
      WHERE ${where} AND matchedby != '' AND matchedby IS NOT NULL
    `, db),

    // Total served requests (matched hits) + raw served row count
    query(`
      SELECT SUM(total_count) AS served_hits,
             COUNT(*)         AS served_rows
      FROM ctv_agg_data
      WHERE ${where} AND matchedby != '' AND matchedby IS NOT NULL
    `, db),

    // Total requests (matched + unmatched) for content IDs that were matched at least once
    query(`
      SELECT SUM(total_count) AS matched_content_total_requests
      FROM ctv_agg_data
      WHERE ${where}
        AND content_id IN (
          SELECT content_id FROM ctv_agg_data
          WHERE ${where} AND matchedby != '' AND matchedby IS NOT NULL
          GROUP BY content_id
        )
    `, db),
  ]);

  return {
    kpi:                        kpi[0]                      || {},
    matched:                    matchedRows[0]               || {},
    unmatched:                  unmatchedRows[0]             || {},
    split:                      split[0]                    || {},
    platformRows,
    contentIds:                 contentIds[0]                || {},
    contentIdsMatched:          contentIdsMatched[0]         || {},
    servedHits:                 servedHitsRows[0]            || {},
    matchedContentTotalRequests: matchedContentTotalRequests[0] || {},
  };
}


/**
 * Returns all distinct appids seen in the date range,
 * with their total hit count. Service resolves known/unknown via urlMap.
 */
async function getPubmaticDistinctAppids({ dateFrom, dateTo, region, db }) {
  const conds = [`date >= '${dateFrom}'`, `date <= '${dateTo}'`];
  if (region && region !== 'all') conds.push(`region = ${sq(region)}`);
  const sql = `
    SELECT appid, SUM(total_count) AS hits
    FROM ctv_agg_data
    WHERE ${conds.join(' AND ')}
    GROUP BY appid
    ORDER BY hits DESC
  `;
  return query(sql, db);
}

/**
 * Returns all distinct content_ids seen via the given appids in the date range.
 * Used to compute per-platform content ID coverage against dpttd datasets.
 */
async function getPubmaticDistinctContentIdsByAppids({ dateFrom, dateTo, region, appids, db }) {
  if (!appids.length) return [];
  const conds = [
    `date >= '${dateFrom}'`,
    `date <= '${dateTo}'`,
    `appid IN (${appids.map(sq).join(',')})`,
  ];
  if (region && region !== 'all') conds.push(`region = ${sq(region)}`);
  const sql = `
    SELECT appid, content_id
    FROM ctv_agg_data
    WHERE ${conds.join(' AND ')}
    GROUP BY appid, content_id
  `;
  return query(sql, db);
}

// getPubmaticDistinctContentIds disabled — cross-server content_id approach abandoned.
// Replaced by getPubmaticContentGap which uses matchedby within Pubmatic's own data.

/**
 * Per-appid breakdown of matched vs unmatched distinct content_ids.
 * Sorted by unmatched descending — tells you which platforms to scrape next.
 */
async function getPubmaticContentGap({ dateFrom, dateTo, region, db }) {
  const conds = [
    `date >= '${dateFrom}'`,
    `date <= '${dateTo}'`,
  ];
  if (region && region !== 'all') conds.push(`region = ${sq(region)}`);
  const sql = `
    SELECT
      appid,
      uniq(content_id)                                                             AS total_distinct,
      uniqIf(content_id, matchedby != '' AND matchedby IS NOT NULL)                AS matched,
      uniqIf(content_id, matchedby = ''  OR  matchedby IS NULL)                   AS unmatched
    FROM ctv_agg_data
    WHERE ${conds.join(' AND ')}
    GROUP BY appid
    ORDER BY unmatched DESC
  `;
  return query(sql, db);
}

const MATCHBY_TYPES = ['PB_C', 'PB_G', 'PB_S', 'PB_TS'];

/**
 * Per-appid, per-matchedby hit counts for the 4 known Pubmatic match categories.
 */
async function getPubmaticMatchbyBreakdown({ dateFrom, dateTo, region, db }) {
  const conds = [
    `date >= '${dateFrom}'`,
    `date <= '${dateTo}'`,
    `matchedby IN (${MATCHBY_TYPES.map(sq).join(',')})`,
  ];
  if (region && region !== 'all') conds.push(`region = ${sq(region)}`);
  const sql = `
    SELECT
      matchedby,
      appid,
      SUM(total_count)  AS total_hits,
      uniq(content_id)  AS unique_content_ids
    FROM ctv_agg_data
    WHERE ${conds.join(' AND ')}
    GROUP BY matchedby, appid
    ORDER BY total_hits DESC
  `;
  return query(sql, db);
}

module.exports = {
  getPubmaticDistinctAppids,
  getPubmaticDistinctContentIdsByAppids,
  getPubmaticContentGap,
  getPubmaticMatchbyBreakdown,
  getPubmaticKpiSummary,
  getCtvFailedAgg,
  getCtvTotalAgg,
  getHealthyCategoryTotals,
  getUnmatchedUrlBreakdown,
  getFailedContentRowsByUrls,
  getServedContentRowsByUrls,
  getAllFailedContentRowsByUrls,
  getAllFailedContentRowsExcludingUrls,
  getAllServedContentRowsByUrls,
  getAllServedContentRowsExcludingUrls,
  getFailedContentRowsExcludingUrls,
  getServedContentRowsExcludingUrls,
};
