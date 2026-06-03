const { queryClickHouse } = require('../db/clickhouse');

const DB = 'dpttd';

// Wraps a URL string in single quotes with inner quotes escaped.
// Used for building IN-lists; keeps escaping consistent across all queries.
const sq = u => `'${u.replace(/'/g, "\\'")}'`;

// Conditions for failed-request queries (success = 0 + date range + optional brandSafe).
// Use bare date comparisons — wrapping `date` in toDate() breaks partition pruning.
// iris_ content IDs are decommissioned and excluded from all queries.
function dateConditions(dateFrom, dateTo, brandSafe, region) {
  const conds = [
    'success = 0',
    `date >= '${dateFrom}'`,
    `date <= '${dateTo}'`,
    "NOT startsWith(contentid, 'iris')",
  ];
  if (brandSafe === '1') conds.push('isbrandsafe = 1');
  if (brandSafe === '0') conds.push('isbrandsafe = 0');
  if (region && region !== 'all') conds.push(`region = ${sq(region)}`);
  return conds;
}

// Conditions for total-request queries (no success filter).
function totalDateConditions(dateFrom, dateTo, brandSafe, region) {
  const conds = [
    `date >= '${dateFrom}'`,
    `date <= '${dateTo}'`,
    "NOT startsWith(contentid, 'iris')",
  ];
  if (brandSafe === '1') conds.push('isbrandsafe = 1');
  if (brandSafe === '0') conds.push('isbrandsafe = 0');
  if (region && region !== 'all') conds.push(`region = ${sq(region)}`);
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
        select:   'url, SUM(total) AS req_total, uniq(contentid) AS content_count',
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
async function getCtvFailedAgg({ dateFrom, dateTo, brandSafe, region = 'all', urls = [], excludeUrls = [], groupBy = 'date', limit }) {
  const conds = dateConditions(dateFrom, dateTo, brandSafe, region);
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
async function getCtvTotalAgg({ dateFrom, dateTo, brandSafe, region = 'all', urls = [], excludeUrls = [], groupBy = 'date', limit }) {
  const conds = totalDateConditions(dateFrom, dateTo, brandSafe, region);
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
async function getFailedContentRowsByUrls({ dateFrom, dateTo, brandSafe, region = 'all', urls, matchedBy, search = '', limit = 25, offset = 0 }) {
  console.log(`[REPO:ctvStats] getFailedContentRowsByUrls urlCount=${urls.length} matchedBy=${matchedBy} search=${search} limit=${limit} offset=${offset}`);
  const whereConds = [
    ...dateConditions(dateFrom, dateTo, brandSafe, region),
    `url IN (${urls.map(sq).join(',')})`,
  ];
  if (search) whereConds.push(`(positionCaseInsensitive(contentid, ${sq(search)}) > 0 OR positionCaseInsensitive(url, ${sq(search)}) > 0)`);
  const mbCond = matchedByCondition(matchedBy);
  const sql = `
    SELECT
      contentid,
      url,
      channel,
      SUM(total)       AS req_total,
      any(matchedby)   AS matchedby,
      any(segment)     AS segment,
      any(title)       AS title,
      any(series)      AS series,
      any(season)      AS season,
      any(episode)     AS episode,
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
async function getFailedContentRowsExcludingUrls({ dateFrom, dateTo, brandSafe, region = 'all', excludeUrls, matchedBy, limit = 25, offset = 0 }) {
  console.log(`[REPO:ctvStats] getFailedContentRowsExcludingUrls excludeCount=${excludeUrls.length} matchedBy=${matchedBy} limit=${limit} offset=${offset}`);
  const whereConds = [
    ...dateConditions(dateFrom, dateTo, brandSafe, region),
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
      any(title)       AS title,
      any(series)      AS series,
      any(season)      AS season,
      any(episode)     AS episode,
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
 * Phase-2 enrichable: paginated success>0 rows for a specific set of URLs.
 * Used when an enrichable (G_/R_/S_) sub-accordion is expanded — shows served content IDs.
 */
async function getServedContentRowsByUrls({ dateFrom, dateTo, brandSafe, region = 'all', urls, matchedBy, search = '', limit = 25, offset = 0 }) {
  console.log(`[REPO:ctvStats] getServedContentRowsByUrls urlCount=${urls.length} matchedBy=${matchedBy} search=${search} limit=${limit} offset=${offset}`);
  const whereConds = [
    'success > 0',
    `date >= '${dateFrom}'`,
    `date <= '${dateTo}'`,
    "NOT startsWith(contentid, 'iris')",
    `url IN (${urls.map(sq).join(',')})`,
  ];
  if (brandSafe === '1') whereConds.push('isbrandsafe = 1');
  if (brandSafe === '0') whereConds.push('isbrandsafe = 0');
  if (search) whereConds.push(`(positionCaseInsensitive(contentid, ${sq(search)}) > 0 OR positionCaseInsensitive(url, ${sq(search)}) > 0)`);
  const mbCond = matchedBy ? `matchedby = ${sq(matchedBy)}` : null;
  // segment/season/episode omitted — they are large columns (avg 662 bytes each)
  // that cause OOM on ClickHouse for multi-day / high-volume platforms.
  // For enrichable rows we only display title and series; segment is not needed.
  const sql = `
    SELECT
      contentid,
      url,
      channel,
      SUM(total)       AS req_total,
      any(matchedby)   AS matchedby,
      any(title)       AS title,
      any(series)      AS series,
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
 * Phase-2 enrichable for Others: paginated success>0 rows for unmapped URLs.
 */
async function getServedContentRowsExcludingUrls({ dateFrom, dateTo, brandSafe, region = 'all', excludeUrls, matchedBy, limit = 25, offset = 0 }) {
  console.log(`[REPO:ctvStats] getServedContentRowsExcludingUrls excludeCount=${excludeUrls.length} matchedBy=${matchedBy} limit=${limit} offset=${offset}`);
  const whereConds = [
    'success > 0',
    `date >= '${dateFrom}'`,
    `date <= '${dateTo}'`,
    "NOT startsWith(contentid, 'iris')",
    `url NOT IN (${excludeUrls.map(sq).join(',')})`,
  ];
  if (brandSafe === '1') whereConds.push('isbrandsafe = 1');
  if (brandSafe === '0') whereConds.push('isbrandsafe = 0');
  const mbCond = matchedBy ? `matchedby = ${sq(matchedBy)}` : null;
  // segment/season/episode omitted — large columns that can OOM on high-volume queries
  const sql = `
    SELECT
      contentid,
      url,
      channel,
      SUM(total)       AS req_total,
      any(matchedby)   AS matchedby,
      any(title)       AS title,
      any(series)      AS series,
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
async function getAllFailedContentRowsByUrls({ dateFrom, dateTo, brandSafe, region = 'all', urls, onlyUnmatched = false }) {
  console.log(`[REPO:ctvStats] getAllFailedContentRowsByUrls dateFrom=${dateFrom} dateTo=${dateTo} urlCount=${urls.length} onlyUnmatched=${onlyUnmatched}`);
  const conds = [
    ...dateConditions(dateFrom, dateTo, brandSafe, region),
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
async function getAllFailedContentRowsExcludingUrls({ dateFrom, dateTo, brandSafe, region = 'all', excludeUrls, onlyUnmatched = false }) {
  console.log(`[REPO:ctvStats] getAllFailedContentRowsExcludingUrls excludeCount=${excludeUrls.length} onlyUnmatched=${onlyUnmatched}`);
  const conds = [
    ...dateConditions(dateFrom, dateTo, brandSafe, region),
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
 * All served (success>0) content rows for URLs NOT in the platform mapping — no LIMIT, for Others CSV export.
 * Pass matchedBy to scope to a single segment category.
 */
async function getAllServedContentRowsExcludingUrls({ dateFrom, dateTo, brandSafe, region = 'all', excludeUrls, matchedBy }) {
  console.log(`[REPO:ctvStats] getAllServedContentRowsExcludingUrls excludeCount=${excludeUrls.length} matchedBy=${matchedBy}`);
  const conds = [
    'success > 0',
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
 * All served (success>0) content rows for a set of URLs — no LIMIT, used for enrichable CSV export.
 * Pass matchedBy to scope to a single segment category (e.g. 'G_Roku').
 */
async function getAllServedContentRowsByUrls({ dateFrom, dateTo, brandSafe, region = 'all', urls, matchedBy }) {
  console.log(`[REPO:ctvStats] getAllServedContentRowsByUrls dateFrom=${dateFrom} dateTo=${dateTo} urlCount=${urls.length} matchedBy=${matchedBy}`);
  const conds = [
    'success > 0',
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
 * Served (success>0) category totals for mapped URLs, grouped by (url, matchedby).
 * Used to surface enrichable categories in the platform queue.
 */
async function getHealthyCategoryTotals({ dateFrom, dateTo, brandSafe, region = 'all', urls = [] }) {
  console.log(`[REPO:ctvStats] getHealthyCategoryTotals dateFrom=${dateFrom} dateTo=${dateTo} urlCount=${urls.length}`);
  if (!urls.length) return [];
  const conds = [
    'success > 0',
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
 * Total hits per content ID for a given matchedBy category — no success filter,
 * counts all requests regardless of outcome. Used for the Hits tab in category accordions.
 */
async function getCtvContentHits({ dateFrom, dateTo, brandSafe, region = 'all', urls = [], matchedBy, limit = 50, offset = 0 }) {
  const conds = [
    `date >= '${dateFrom}'`,
    `date <= '${dateTo}'`,
    "NOT startsWith(contentid, 'iris')",
  ];
  if (urls.length) conds.push(`url IN (${urls.map(sq).join(',')})`);
  if (brandSafe === '1') conds.push('isbrandsafe = 1');
  if (brandSafe === '0') conds.push('isbrandsafe = 0');

  // matchedby filter goes in WHERE so SUM(total) only covers that category's rows
  if (matchedBy === 'Unmatched') conds.push(`(matchedby = '' OR matchedby IS NULL)`);
  else if (matchedBy) conds.push(`matchedby = ${sq(matchedBy)}`);

  const sql = `
    SELECT
      contentid,
      SUM(total)    AS hits,
      any(title)    AS title,
      any(series)   AS series
    FROM ctv_stats
    WHERE ${conds.join(' AND ')}
    GROUP BY contentid
    ORDER BY hits DESC
    LIMIT ${limit + 1} OFFSET ${offset}
  `;
  console.log(`[REPO:ctvStats] getCtvContentHits dateFrom=${dateFrom} dateTo=${dateTo} matchedBy=${matchedBy} urlCount=${urls.length} limit=${limit} offset=${offset}`);
  const rows = await queryClickHouse(sql, DB);
  return { rows: rows.slice(0, limit), hasMore: rows.length > limit };
}

/**
 * Failed (success=0) rows with empty matchedby, grouped by URL.
 * Used for the unmatched URL breakdown on the platform detail page.
 */
async function getUnmatchedUrlBreakdown({ dateFrom, dateTo, brandSafe, region = 'all', urls }) {
  console.log(`[REPO:ctvStats] getUnmatchedUrlBreakdown urlCount=${urls.length} dateFrom=${dateFrom} dateTo=${dateTo}`);
  if (!urls.length) return [];
  const conds = [
    ...dateConditions(dateFrom, dateTo, brandSafe, region),
    `url IN (${urls.map(sq).join(',')})`,
    "(matchedby = '' OR matchedby IS NULL)",
  ];
  const sql = `
    SELECT url, SUM(total) AS req_total, uniq(contentid) AS content_count
    FROM ctv_stats
    WHERE ${conds.join(' AND ')}
    GROUP BY url
    ORDER BY req_total DESC
  `;
  return queryClickHouse(sql, DB);
}

/**
 * Top N and bottom N segments by times served.
 * segment column holds comma-separated sp_* tags — exploded with arrayJoin.
 */
async function getSegmentRankings({ dateFrom, dateTo, brandSafe, region, urls = [], n = 10 }) {
  const base = [
    `date >= '${dateFrom}'`,
    `date <= '${dateTo}'`,
    "NOT startsWith(contentid, 'iris')",
    "segment != ''",
  ];
  if (brandSafe === '1') base.push('isbrandsafe = 1');
  if (brandSafe === '0') base.push('isbrandsafe = 0');
  if (region && region !== 'all') base.push(`region = ${sq(region)}`);
  if (urls.length) base.push(`url IN (${urls.map(sq).join(',')})`);

  const innerWhere = base.join(' AND ');

  // Inner query selects raw rows with arrayJoin explosion (no aggregation).
  // Outer query aggregates — this avoids the NOT_AN_AGGREGATE error in ClickHouse.
  const topSql = `
    SELECT seg_tag,
           SUM(if(success > 0, total, 0)) AS times_served,
           uniq(contentid)                AS distinct_content,
           SUM(total)                     AS total_requests
    FROM (
      SELECT trimBoth(arrayJoin(splitByChar(',', segment))) AS seg_tag,
             contentid, success, total
      FROM ctv_stats
      WHERE ${innerWhere}
    )
    WHERE seg_tag != ''
    GROUP BY seg_tag
    HAVING times_served > 0
    ORDER BY times_served DESC
    LIMIT ${n}
  `;

  const botSql = `
    SELECT seg_tag,
           SUM(if(success > 0, total, 0)) AS times_served,
           uniq(contentid)                AS distinct_content,
           SUM(total)                     AS total_requests
    FROM (
      SELECT trimBoth(arrayJoin(splitByChar(',', segment))) AS seg_tag,
             contentid, success, total
      FROM ctv_stats
      WHERE ${innerWhere}
    )
    WHERE seg_tag != ''
    GROUP BY seg_tag
    HAVING distinct_content >= 10
    ORDER BY times_served ASC
    LIMIT ${n}
  `;

  console.log(`[REPO:ctvStats] getSegmentRankings dateFrom=${dateFrom} dateTo=${dateTo} n=${n}`);
  const [top, bottom] = await Promise.all([
    queryClickHouse(topSql, DB),
    queryClickHouse(botSql, DB),
  ]);
  return { top, bottom };
}

/**
 * Detail for a single segment — overview + per-URL breakdown for platform join.
 */
async function getSegmentDetail({ dateFrom, dateTo, brandSafe, region, urls = [], segment }) {
  const base = [
    `date >= '${dateFrom}'`,
    `date <= '${dateTo}'`,
    "NOT startsWith(contentid, 'iris')",
    `has(splitByChar(',', segment), ${sq(segment)})`,
  ];
  if (brandSafe === '1') base.push('isbrandsafe = 1');
  if (brandSafe === '0') base.push('isbrandsafe = 0');
  if (region && region !== 'all') base.push(`region = ${sq(region)}`);
  if (urls.length) base.push(`url IN (${urls.map(sq).join(',')})`);

  const where = base.join(' AND ');

  const overviewSql = `
    SELECT
      SUM(total)                                        AS total_requests,
      SUM(if(success > 0, total, 0))                   AS times_served,
      uniq(contentid)                                   AS distinct_content
    FROM ctv_stats
    WHERE ${where}
  `;

  const platformSql = `
    SELECT
      url,
      SUM(if(success > 0, total, 0)) AS times_served,
      uniq(contentid)                AS distinct_content
    FROM ctv_stats
    WHERE ${where}
    GROUP BY url
    ORDER BY times_served DESC
  `;

  console.log(`[REPO:ctvStats] getSegmentDetail segment=${segment} dateFrom=${dateFrom}`);
  const [overviewRows, platformRows] = await Promise.all([
    queryClickHouse(overviewSql, DB),
    queryClickHouse(platformSql, DB),
  ]);
  return { overview: overviewRows[0] ?? {}, platforms: platformRows };
}

module.exports = {
  getCtvContentHits,
  getSegmentRankings,
  getSegmentDetail,
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
  // Enrichable category totals (success>0)
  getHealthyCategoryTotals,
  // Platform detail page helpers
  getUnmatchedUrlBreakdown,
};
