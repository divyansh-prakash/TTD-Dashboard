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

// ── Unified aggregation helpers ───────────────────────────────────────────────

// Builds SELECT / GROUP BY / ORDER BY clauses from a groupBy key.
// All callers get the same projection — the only variable is the key column.
function buildAggClauses(groupBy) {
  switch (groupBy) {
    case 'date':
      return {
        select:   'toString(date) AS date, SUM(total) AS req_total',
        group:    'date',
        order:    'date ASC',
      };
    case 'hour':
      return {
        select:   'toHour(timestamp) AS hour, SUM(total) AS req_total',
        group:    'hour',
        order:    'hour ASC',
      };
    case 'url':
      return {
        select:   'url, SUM(total) AS req_total',
        group:    'url',
        order:    'req_total DESC',
      };
    case 'url,matchedby':
      return {
        select:   'url, matchedby, SUM(total) AS req_total, uniq(contentid) AS content_count',
        group:    'url, matchedby',
        order:    'req_total DESC',
      };
    case 'matchedby':
      return {
        select:   'matchedby, SUM(total) AS req_total, uniq(contentid) AS content_count',
        group:    'matchedby',
        order:    'req_total DESC',
      };
    default:
      throw new Error(`[ctvStats] unknown groupBy: ${groupBy}`);
  }
}

/**
 * Unified failed-request aggregate (success = 0).
 * groupBy: 'date' | 'hour' | 'url' | 'url,matchedby' | 'matchedby'
 * Pass urls OR excludeUrls (not both) to scope by platform.
 */
async function getCtvFailedAgg({ dateFrom, dateTo, brandSafe, urls = [], excludeUrls = [], groupBy = 'date', limit }) {
  const conds = dateConditions(dateFrom, dateTo, brandSafe);
  if (urls.length)        conds.push(`url IN (${urls.map(sq).join(',')})`);
  if (excludeUrls.length) conds.push(`url NOT IN (${excludeUrls.map(sq).join(',')})`);
  const { select, group, order } = buildAggClauses(groupBy);
  const limitClause = limit ? `LIMIT ${limit}` : '';
  console.log(`[REPO:ctvStats] getCtvFailedAgg groupBy=${groupBy} dateFrom=${dateFrom} dateTo=${dateTo} urls=${urls.length} excludeUrls=${excludeUrls.length}`);
  const sql = `SELECT ${select} FROM ctv_stats WHERE ${conds.join(' AND ')} GROUP BY ${group} ORDER BY ${order} ${limitClause}`;
  return queryClickHouse(sql, DB);
}

/**
 * Unified total-request aggregate (success = 0 + 1, no success filter).
 * Identical base conditions to getCtvFailedAgg except no success = 0 predicate.
 */
async function getCtvTotalAgg({ dateFrom, dateTo, brandSafe, urls = [], excludeUrls = [], groupBy = 'date', limit }) {
  const conds = totalDateConditions(dateFrom, dateTo, brandSafe);
  if (urls.length)        conds.push(`url IN (${urls.map(sq).join(',')})`);
  if (excludeUrls.length) conds.push(`url NOT IN (${excludeUrls.map(sq).join(',')})`);
  const { select, group, order } = buildAggClauses(groupBy);
  const limitClause = limit ? `LIMIT ${limit}` : '';
  console.log(`[REPO:ctvStats] getCtvTotalAgg groupBy=${groupBy} dateFrom=${dateFrom} dateTo=${dateTo} urls=${urls.length} excludeUrls=${excludeUrls.length}`);
  const sql = `SELECT ${select} FROM ctv_stats WHERE ${conds.join(' AND ')} GROUP BY ${group} ORDER BY ${order} ${limitClause}`;
  return queryClickHouse(sql, DB);
}

// ── Builds a matchedby condition for Phase-2 queries ─────────────────────────
// 'Unmatched' matches rows where matchedby is empty or NULL.
function matchedByCondition(matchedBy) {
  if (!matchedBy) return null;
  if (matchedBy === 'Unmatched') return `(matchedby = '' OR matchedby IS NULL)`;
  return `matchedby = ${sq(matchedBy)}`;
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
 * Phase-2 enrichable: paginated success=1 rows for a specific set of URLs.
 * Used when an enrichable (G_/R_/S_) sub-accordion is expanded — shows served content IDs.
 */
async function getServedContentRowsByUrls({ dateFrom, dateTo, brandSafe, urls, matchedBy, limit = 25, offset = 0 }) {
  console.log(`[REPO:ctvStats] getServedContentRowsByUrls urlCount=${urls.length} matchedBy=${matchedBy} limit=${limit} offset=${offset}`);
  const whereConds = [
    'success = 1',
    `date >= '${dateFrom}'`,
    `date <= '${dateTo}'`,
    "NOT startsWith(contentid, 'iris')",
    `url IN (${urls.map(sq).join(',')})`,
  ];
  if (brandSafe === '1') whereConds.push('isbrandsafe = 1');
  if (brandSafe === '0') whereConds.push('isbrandsafe = 0');
  const mbCond = matchedBy ? `matchedby = ${sq(matchedBy)}` : null;
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
 * Phase-2 enrichable for Others: paginated success=1 rows for unmapped URLs.
 */
async function getServedContentRowsExcludingUrls({ dateFrom, dateTo, brandSafe, excludeUrls, matchedBy, limit = 25, offset = 0 }) {
  console.log(`[REPO:ctvStats] getServedContentRowsExcludingUrls excludeCount=${excludeUrls.length} matchedBy=${matchedBy} limit=${limit} offset=${offset}`);
  const whereConds = [
    'success = 1',
    `date >= '${dateFrom}'`,
    `date <= '${dateTo}'`,
    "NOT startsWith(contentid, 'iris')",
    `url NOT IN (${excludeUrls.map(sq).join(',')})`,
  ];
  if (brandSafe === '1') whereConds.push('isbrandsafe = 1');
  if (brandSafe === '0') whereConds.push('isbrandsafe = 0');
  const mbCond = matchedBy ? `matchedby = ${sq(matchedBy)}` : null;
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
 * All failed content rows for a set of URLs — no LIMIT, used for CSV export.
 * Pass onlyUnmatched=true to restrict to rows where matchedby is empty (failing zone download).
 */
async function getAllFailedContentRowsByUrls({ dateFrom, dateTo, brandSafe, urls, onlyUnmatched = false }) {
  console.log(`[REPO:ctvStats] getAllFailedContentRowsByUrls dateFrom=${dateFrom} dateTo=${dateTo} urlCount=${urls.length} onlyUnmatched=${onlyUnmatched}`);
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
    ${onlyUnmatched ? "HAVING (matchedby = '' OR matchedby IS NULL)" : ''}
    ORDER BY req_total DESC
  `;
  return queryClickHouse(sql, DB);
}

/**
 * All failed content rows for URLs NOT in the platform mapping — no LIMIT, used for Others CSV export.
 */
async function getAllFailedContentRowsExcludingUrls({ dateFrom, dateTo, brandSafe, excludeUrls, onlyUnmatched = false }) {
  console.log(`[REPO:ctvStats] getAllFailedContentRowsExcludingUrls excludeCount=${excludeUrls.length} onlyUnmatched=${onlyUnmatched}`);
  const conds = [
    ...dateConditions(dateFrom, dateTo, brandSafe),
    `url NOT IN (${excludeUrls.map(sq).join(',')})`,
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
    ${onlyUnmatched ? "HAVING (matchedby = '' OR matchedby IS NULL)" : ''}
    ORDER BY req_total DESC
  `;
  return queryClickHouse(sql, DB);
}

/**
 * All served (success=1) content rows for URLs NOT in the platform mapping — no LIMIT, for Others CSV export.
 * Pass matchedBy to scope to a single segment category.
 */
async function getAllServedContentRowsExcludingUrls({ dateFrom, dateTo, brandSafe, excludeUrls, matchedBy }) {
  console.log(`[REPO:ctvStats] getAllServedContentRowsExcludingUrls excludeCount=${excludeUrls.length} matchedBy=${matchedBy}`);
  const conds = [
    'success = 1',
    `date >= '${dateFrom}'`,
    `date <= '${dateTo}'`,
    "NOT startsWith(contentid, 'iris')",
    `url NOT IN (${excludeUrls.map(sq).join(',')})`,
  ];
  if (brandSafe === '1') conds.push('isbrandsafe = 1');
  if (brandSafe === '0') conds.push('isbrandsafe = 0');
  const mbCond = matchedBy ? `matchedby = ${sq(matchedBy)}` : null;
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
    ${mbCond ? `HAVING ${mbCond}` : ''}
    ORDER BY req_total DESC
  `;
  return queryClickHouse(sql, DB);
}

/**
 * All served (success=1) content rows for a set of URLs — no LIMIT, used for enrichable CSV export.
 * Pass matchedBy to scope to a single segment category (e.g. 'G_Roku').
 */
async function getAllServedContentRowsByUrls({ dateFrom, dateTo, brandSafe, urls, matchedBy }) {
  console.log(`[REPO:ctvStats] getAllServedContentRowsByUrls dateFrom=${dateFrom} dateTo=${dateTo} urlCount=${urls.length} matchedBy=${matchedBy}`);
  const conds = [
    'success = 1',
    `date >= '${dateFrom}'`,
    `date <= '${dateTo}'`,
    "NOT startsWith(contentid, 'iris')",
    `url IN (${urls.map(sq).join(',')})`,
  ];
  if (brandSafe === '1') conds.push('isbrandsafe = 1');
  if (brandSafe === '0') conds.push('isbrandsafe = 0');
  const mbCond = matchedBy ? `matchedby = ${sq(matchedBy)}` : null;
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
    ${mbCond ? `HAVING ${mbCond}` : ''}
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

module.exports = {
  // Unified aggregation (preferred for all new callers)
  getCtvFailedAgg,
  getCtvTotalAgg,
  // Phase-2 content-row drills (paginated, different SELECT shape)
  getFailedContentRowsByUrls,
  getAllFailedContentRowsByUrls,
  getAllFailedContentRowsExcludingUrls,
  getFailedContentRowsExcludingUrls,
  getServedContentRowsByUrls,
  getAllServedContentRowsByUrls,
  getServedContentRowsExcludingUrls,
  getAllServedContentRowsExcludingUrls,
  // Enrichable category totals (success=1 special case)
  getHealthyCategoryTotals,
};
