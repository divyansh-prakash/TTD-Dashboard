-- =============================================================================
-- TTD Enrichment — All ClickHouse & PostgreSQL Queries
-- Database : ClickHouse  → dpttd.ctv_stats
-- Database : PostgreSQL  → ttd_dmp.platform_url_mapping
--
-- Last updated : 2026-06-08
--
-- Date filter shortcuts used throughout this file
--   Yesterday  : date = '2026-06-07'
--   Last 3 days: date >= '2026-06-05' AND date <= '2026-06-08'
--
-- IMPORTANT rules:
--   1. Always use  success > 0  for served/enriched — codes 1-19 all count as served.
--      NEVER use  success = 1  only — this misses codes 2-19 which are also served.
--   2. Always use  success = 0  for failed/unmatched.
--   3. Never wrap `date` in toDate() — breaks ClickHouse partition pruning.
--   4. Always use SUM(total), never COUNT(*) — rows are pre-aggregated.
--   5. Always exclude iris* content IDs:  NOT startsWith(contentid, 'iris').
--   6. Region filter:   AND region = 'euc-1'   (values: euc-1, apse-1, use-1, usw-2)
--   7. Brand-safe filter: AND isbrandsafe = 1  (or = 0 for unsafe only)
-- =============================================================================


-- =============================================================================
-- [PG] 0. Platform URL mapping lookup
-- Endpoint : GET /api/failure-queue/filters/options
-- Purpose  : Resolve raw app/bundle IDs (url column) to human-readable platform
--            names. Cached in Node for 24 hours. Source-of-truth for all
--            platform-scoped ClickHouse queries.
-- =============================================================================

SELECT url, platform
FROM   platform_url_mapping
ORDER  BY platform, url;


-- =============================================================================
-- [CH] 1. KPI Summary — Total / Successful / Failed / Success Rate
-- Endpoint : Not a direct endpoint — used within getByPlatform + comparison
-- Purpose  : Powers the four KPI cards on the Dashboard page.
--            Total hits = all requests regardless of outcome.
--            Successful = success > 0. Failed = success = 0.
--            Success rate derived in application layer.
-- =============================================================================

-- ── Yesterday (2026-06-07) ───────────────────────────────────────────────────
SELECT
    SUM(total)                                         AS total_hits,
    SUM(CASE WHEN success > 0 THEN total ELSE 0 END)  AS successful_hits,
    SUM(CASE WHEN success = 0 THEN total ELSE 0 END)  AS failed_hits,
    ROUND(
        SUM(CASE WHEN success > 0 THEN total ELSE 0 END)
        * 100.0 / NULLIF(SUM(total), 0)
    , 2)                                               AS success_rate_pct
FROM   ctv_stats
WHERE  date = '2026-06-07'
  AND  NOT startsWith(contentid, 'iris');

-- ── Last 3 days (2026-06-05 → 2026-06-08) ────────────────────────────────────
SELECT
    SUM(total)                                         AS total_hits,
    SUM(CASE WHEN success > 0 THEN total ELSE 0 END)  AS successful_hits,
    SUM(CASE WHEN success = 0 THEN total ELSE 0 END)  AS failed_hits,
    ROUND(
        SUM(CASE WHEN success > 0 THEN total ELSE 0 END)
        * 100.0 / NULLIF(SUM(total), 0)
    , 2)                                               AS success_rate_pct
FROM   ctv_stats
WHERE  date >= '2026-06-05'
  AND  date <= '2026-06-08'
  AND  NOT startsWith(contentid, 'iris');


-- =============================================================================
-- [CH] 2. Period-over-period comparison
-- Endpoint : GET /api/failure-queue/comparison
-- Purpose  : Computes current period vs previous period of same length.
--            Used for the "vs prev period" deltas on KPI cards and platform rows.
--            Run once for current window, once for previous window.
-- =============================================================================

-- ── Yesterday (current = 2026-06-07, previous = 2026-06-06) ──────────────────
-- Current period
SELECT SUM(total) AS total, SUM(CASE WHEN success = 0 THEN total ELSE 0 END) AS failed
FROM   ctv_stats
WHERE  date = '2026-06-07'
  AND  NOT startsWith(contentid, 'iris');

-- Previous period
SELECT SUM(total) AS total, SUM(CASE WHEN success = 0 THEN total ELSE 0 END) AS failed
FROM   ctv_stats
WHERE  date = '2026-06-06'
  AND  NOT startsWith(contentid, 'iris');

-- ── Last 3 days (current = 2026-06-05→08, previous = 2026-06-02→04) ──────────
-- Current period
SELECT SUM(total) AS total, SUM(CASE WHEN success = 0 THEN total ELSE 0 END) AS failed
FROM   ctv_stats
WHERE  date >= '2026-06-05' AND date <= '2026-06-08'
  AND  NOT startsWith(contentid, 'iris');

-- Previous period
SELECT SUM(total) AS total, SUM(CASE WHEN success = 0 THEN total ELSE 0 END) AS failed
FROM   ctv_stats
WHERE  date >= '2026-06-02' AND date <= '2026-06-04'
  AND  NOT startsWith(contentid, 'iris');


-- =============================================================================
-- [CH] 3. Request volume over time (trend chart)
-- Endpoint : GET /api/failure-queue/trend
-- Purpose  : Powers the line chart on the Dashboard page.
--            Returns daily or hourly breakdown of total / failed requests.
--            Application derives successful = total - failed.
--            Branch: single day → hourly (toHour), multi-day → daily (date).
-- =============================================================================

-- ── Yesterday — hourly granularity ───────────────────────────────────────────
SELECT
    toHour(timestamp)                                  AS hour,
    SUM(total)                                         AS total_hits,
    SUM(CASE WHEN success = 0 THEN total ELSE 0 END)  AS failed_hits
FROM   ctv_stats
WHERE  date = '2026-06-07'
  AND  NOT startsWith(contentid, 'iris')
GROUP  BY hour
ORDER  BY hour ASC;

-- ── Last 3 days — daily granularity ──────────────────────────────────────────
SELECT
    toString(date)                                     AS day,
    SUM(total)                                         AS total_hits,
    SUM(CASE WHEN success = 0 THEN total ELSE 0 END)  AS failed_hits
FROM   ctv_stats
WHERE  date >= '2026-06-05' AND date <= '2026-06-08'
  AND  NOT startsWith(contentid, 'iris')
GROUP  BY date
ORDER  BY date ASC;


-- =============================================================================
-- [CH+PG] 4. Platform performance table
-- Endpoint : GET /api/failure-queue/by-platform
-- Purpose  : Shows each platform's total, served, failed requests and success
--            rate. The url column is resolved to platform names in the
--            application layer via platform_url_mapping (PostgreSQL cache).
--            Includes period-over-period deltas using same logic as query 2.
-- =============================================================================

-- ── Yesterday — failed requests per URL ──────────────────────────────────────
SELECT
    url,
    SUM(total)                                         AS total_hits,
    SUM(CASE WHEN success = 0 THEN total ELSE 0 END)  AS failed_hits,
    uniq(contentid)                                    AS distinct_content_ids
FROM   ctv_stats
WHERE  date = '2026-06-07'
  AND  NOT startsWith(contentid, 'iris')
  AND  url IN (/* comma-separated list of all mapped URLs from platform_url_mapping */)
GROUP  BY url
ORDER  BY total_hits DESC;

-- ── Last 3 days — failed requests per URL ────────────────────────────────────
SELECT
    url,
    SUM(total)                                         AS total_hits,
    SUM(CASE WHEN success = 0 THEN total ELSE 0 END)  AS failed_hits,
    uniq(contentid)                                    AS distinct_content_ids
FROM   ctv_stats
WHERE  date >= '2026-06-05' AND date <= '2026-06-08'
  AND  NOT startsWith(contentid, 'iris')
  AND  url IN (/* comma-separated list of all mapped URLs from platform_url_mapping */)
GROUP  BY url
ORDER  BY total_hits DESC;


-- =============================================================================
-- [CH] 5. Category breakdown (matchedBy aggregation)
-- Endpoint : part of GET /api/failure-queue/by-platform
-- Purpose  : Shows how failed requests are distributed across matching categories
--            (Content ID, Genre, Series, Rating, Channel+Genre, Unmatched)
--            for a specific platform. Used in accordion expansion.
-- =============================================================================

-- ── Yesterday ────────────────────────────────────────────────────────────────
SELECT
    matchedby,
    SUM(total)      AS req_total,
    uniq(contentid) AS content_count
FROM   ctv_stats
WHERE  date = '2026-06-07'
  AND  NOT startsWith(contentid, 'iris')
  AND  success = 0
  AND  url IN (/* platform URLs e.g. Roku's URLs */)
GROUP  BY matchedby
ORDER  BY req_total DESC;

-- ── Last 3 days ───────────────────────────────────────────────────────────────
SELECT
    matchedby,
    SUM(total)      AS req_total,
    uniq(contentid) AS content_count
FROM   ctv_stats
WHERE  date >= '2026-06-05' AND date <= '2026-06-08'
  AND  NOT startsWith(contentid, 'iris')
  AND  success = 0
  AND  url IN (/* platform URLs */)
GROUP  BY matchedby
ORDER  BY req_total DESC;


-- =============================================================================
-- [CH] 6. Served category totals (enrichable segments)
-- Endpoint : part of GET /api/failure-queue/by-platform
-- Purpose  : Finds which matchedBy segments are actively serving content
--            (success > 0). Combined with query 5, gives full served+failed
--            picture per segment for the category breakdown panel.
-- =============================================================================

-- ── Yesterday ────────────────────────────────────────────────────────────────
SELECT
    url,
    matchedby,
    SUM(total) AS req_served
FROM   ctv_stats
WHERE  date = '2026-06-07'
  AND  NOT startsWith(contentid, 'iris')
  AND  success > 0
  AND  matchedby != ''
  AND  matchedby IS NOT NULL
  AND  url IN (/* platform URLs */)
GROUP  BY url, matchedby
ORDER  BY req_served DESC;

-- ── Last 3 days ───────────────────────────────────────────────────────────────
SELECT
    url,
    matchedby,
    SUM(total) AS req_served
FROM   ctv_stats
WHERE  date >= '2026-06-05' AND date <= '2026-06-08'
  AND  NOT startsWith(contentid, 'iris')
  AND  success > 0
  AND  matchedby != ''
  AND  matchedby IS NOT NULL
  AND  url IN (/* platform URLs */)
GROUP  BY url, matchedby
ORDER  BY req_served DESC;


-- =============================================================================
-- [CH] 7. Content drill-down — failed rows (Unmatched category)
-- Endpoint : GET /api/failure-queue/by-platform/detail  (enrichable=false)
-- Purpose  : Paginated list of content IDs that failed with no segment match.
--            Shown in the Content tab of the Unmatched accordion row.
--            Supports search by contentid or url.
-- =============================================================================

-- ── Yesterday ────────────────────────────────────────────────────────────────
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
FROM   ctv_stats
WHERE  date = '2026-06-07'
  AND  NOT startsWith(contentid, 'iris')
  AND  success = 0
  AND  url IN (/* platform URLs */)
GROUP  BY contentid, url, channel
HAVING (matchedby = '' OR matchedby IS NULL)   -- only Unmatched
ORDER  BY req_total DESC
LIMIT  50 OFFSET 0;

-- ── Last 3 days ───────────────────────────────────────────────────────────────
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
FROM   ctv_stats
WHERE  date >= '2026-06-05' AND date <= '2026-06-08'
  AND  NOT startsWith(contentid, 'iris')
  AND  success = 0
  AND  url IN (/* platform URLs */)
GROUP  BY contentid, url, channel
HAVING (matchedby = '' OR matchedby IS NULL)
ORDER  BY req_total DESC
LIMIT  50 OFFSET 0;


-- =============================================================================
-- [CH] 8. Content drill-down — served rows (enrichable category)
-- Endpoint : GET /api/failure-queue/by-platform/detail  (enrichable=true)
-- Purpose  : Paginated list of content IDs that were successfully served for
--            a specific matchedBy category (e.g. G_Roku, C_Fubo).
--            Shown in the Content tab of enrichable accordion rows.
-- =============================================================================

-- ── Yesterday — example: Genre category (G_Roku) ─────────────────────────────
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
FROM   ctv_stats
WHERE  date = '2026-06-07'
  AND  NOT startsWith(contentid, 'iris')
  AND  success > 0
  AND  url IN (/* platform URLs */)
GROUP  BY contentid, url, channel
HAVING any(matchedby) = 'G_Roku'
ORDER  BY req_total DESC
LIMIT  50 OFFSET 0;

-- ── Last 3 days ───────────────────────────────────────────────────────────────
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
FROM   ctv_stats
WHERE  date >= '2026-06-05' AND date <= '2026-06-08'
  AND  NOT startsWith(contentid, 'iris')
  AND  success > 0
  AND  url IN (/* platform URLs */)
GROUP  BY contentid, url, channel
HAVING any(matchedby) = 'G_Roku'
ORDER  BY req_total DESC
LIMIT  50 OFFSET 0;


-- =============================================================================
-- [CH] 9. Unmatched URL breakdown
-- Endpoint : part of GET /api/failure-queue/by-platform
-- Purpose  : Shows which bundle IDs (urls) account for the most unmatched
--            failures on a given platform. Shown in the URLs tab of the
--            Unmatched accordion and the platform detail page URLs tab.
-- =============================================================================

-- ── Yesterday ────────────────────────────────────────────────────────────────
SELECT
    url,
    SUM(total)      AS req_total,
    uniq(contentid) AS content_count
FROM   ctv_stats
WHERE  date = '2026-06-07'
  AND  NOT startsWith(contentid, 'iris')
  AND  success = 0
  AND  url IN (/* platform URLs */)
  AND  (matchedby = '' OR matchedby IS NULL)
GROUP  BY url
ORDER  BY req_total DESC;

-- ── Last 3 days ───────────────────────────────────────────────────────────────
SELECT
    url,
    SUM(total)      AS req_total,
    uniq(contentid) AS content_count
FROM   ctv_stats
WHERE  date >= '2026-06-05' AND date <= '2026-06-08'
  AND  NOT startsWith(contentid, 'iris')
  AND  success = 0
  AND  url IN (/* platform URLs */)
  AND  (matchedby = '' OR matchedby IS NULL)
GROUP  BY url
ORDER  BY req_total DESC;


-- =============================================================================
-- [CH] 10. Content hits — ranked by total request count
-- Endpoint : GET /api/failure-queue/by-platform/hits
-- Purpose  : Shows which content IDs are hit most often within a given
--            matchedBy category (all success codes, not just failed/served).
--            Shown in the Hits tab of each category accordion. Paginated.
--            Fetch 51 rows — if result count > 50, frontend shows "load more".
-- =============================================================================

-- ── Yesterday — example: Genre category ──────────────────────────────────────
SELECT
    contentid,
    SUM(total)   AS hits,
    any(title)   AS title,
    any(series)  AS series
FROM   ctv_stats
WHERE  date = '2026-06-07'
  AND  NOT startsWith(contentid, 'iris')
  AND  url IN (/* platform URLs */)
  AND  matchedby = 'G_Roku'      -- filter by category; omit for all categories
GROUP  BY contentid
ORDER  BY hits DESC
LIMIT  51 OFFSET 0;              -- fetch 51, app checks if hasMore (> 50)

-- ── Last 3 days ───────────────────────────────────────────────────────────────
SELECT
    contentid,
    SUM(total)   AS hits,
    any(title)   AS title,
    any(series)  AS series
FROM   ctv_stats
WHERE  date >= '2026-06-05' AND date <= '2026-06-08'
  AND  NOT startsWith(contentid, 'iris')
  AND  url IN (/* platform URLs */)
  AND  matchedby = 'G_Roku'
GROUP  BY contentid
ORDER  BY hits DESC
LIMIT  51 OFFSET 0;


-- =============================================================================
-- [CH] 11. Others platform — unmapped URLs
-- Endpoint : part of GET /api/failure-queue/by-platform
-- Purpose  : Traffic from app/bundle IDs that are NOT in platform_url_mapping.
--            These appear as the "Others" platform in the main dashboard.
--            Uses url NOT IN (...) instead of url IN (...).
-- =============================================================================

-- ── Yesterday ────────────────────────────────────────────────────────────────
SELECT
    matchedby,
    SUM(total)      AS req_total,
    uniq(contentid) AS content_count
FROM   ctv_stats
WHERE  date = '2026-06-07'
  AND  NOT startsWith(contentid, 'iris')
  AND  success = 0
  AND  url NOT IN (/* all 303 mapped URLs from platform_url_mapping */)
GROUP  BY matchedby
ORDER  BY req_total DESC;

-- ── Last 3 days ───────────────────────────────────────────────────────────────
SELECT
    matchedby,
    SUM(total)      AS req_total,
    uniq(contentid) AS content_count
FROM   ctv_stats
WHERE  date >= '2026-06-05' AND date <= '2026-06-08'
  AND  NOT startsWith(contentid, 'iris')
  AND  success = 0
  AND  url NOT IN (/* all 303 mapped URLs from platform_url_mapping */)
GROUP  BY matchedby
ORDER  BY req_total DESC;


-- =============================================================================
-- [CH] 12. Platform detail summary — pie chart data
-- Endpoint : GET /api/failure-queue/by-platform/summary
-- Purpose  : Aggregates all request types for a single platform to power
--            the Traffic Distribution pie chart and stat cards on the
--            platform detail page. deep = C_ prefix, shallow = all others.
-- =============================================================================

-- ── Yesterday ────────────────────────────────────────────────────────────────
SELECT
    matchedby,
    SUM(CASE WHEN success = 0 THEN total ELSE 0 END) AS failed,
    SUM(CASE WHEN success > 0 THEN total ELSE 0 END) AS served,
    SUM(total)                                        AS total
FROM   ctv_stats
WHERE  date = '2026-06-07'
  AND  NOT startsWith(contentid, 'iris')
  AND  url IN (/* Roku URLs */)
GROUP  BY matchedby
ORDER  BY total DESC;

-- ── Last 3 days ───────────────────────────────────────────────────────────────
SELECT
    matchedby,
    SUM(CASE WHEN success = 0 THEN total ELSE 0 END) AS failed,
    SUM(CASE WHEN success > 0 THEN total ELSE 0 END) AS served,
    SUM(total)                                        AS total
FROM   ctv_stats
WHERE  date >= '2026-06-05' AND date <= '2026-06-08'
  AND  NOT startsWith(contentid, 'iris')
  AND  url IN (/* Roku URLs */)
GROUP  BY matchedby
ORDER  BY total DESC;


-- =============================================================================
-- [CH] 13. CSV export — failed rows
-- Endpoint : GET /api/failure-queue/by-platform/download  (type=failed)
-- Purpose  : Full export of unmatched/failed content rows for a platform.
--            No pagination (all rows). Used to build enrichment pipelines.
-- =============================================================================

SELECT
    contentid                                          AS content_id,
    url                                                AS bundle_id,
    channel,
    SUM(total)                                         AS requests_failed,
    any(matchedby)                                     AS matched_by
FROM   ctv_stats
WHERE  date >= '2026-06-05' AND date <= '2026-06-08'
  AND  NOT startsWith(contentid, 'iris')
  AND  success = 0
  AND  url IN (/* platform URLs */)
GROUP  BY contentid, url, channel
ORDER  BY requests_failed DESC;


-- =============================================================================
-- [CH] 14. CSV export — enrichable rows (served)
-- Endpoint : GET /api/failure-queue/by-platform/download  (type=enrichable)
-- Purpose  : Full export of served content rows (success > 0) for a platform.
--            Identifies content that is being enriched successfully.
-- =============================================================================

SELECT
    contentid                                          AS content_id,
    url                                                AS bundle_id,
    channel,
    SUM(total)                                         AS requests_served,
    any(matchedby)                                     AS matched_by
FROM   ctv_stats
WHERE  date >= '2026-06-05' AND date <= '2026-06-08'
  AND  NOT startsWith(contentid, 'iris')
  AND  success > 0
  AND  url IN (/* platform URLs */)
GROUP  BY contentid, url, channel
ORDER  BY requests_served DESC;


-- =============================================================================
-- [CH] 15. Segment rankings — top and bottom N segments
-- Endpoint : GET /api/failure-queue/segment-rankings
-- Purpose  : Finds the N segments with the most/least requests.
--            Returns top N and bottom N separately.
--            Used in the Segment Rankings section of dashboard-2.
-- =============================================================================

-- ── Yesterday — top 10 segments by total requests ────────────────────────────
SELECT
    matchedby,
    SUM(total)                                         AS total_requests,
    SUM(CASE WHEN success > 0 THEN total ELSE 0 END)  AS served_requests,
    SUM(CASE WHEN success = 0 THEN total ELSE 0 END)  AS failed_requests,
    uniq(contentid)                                    AS distinct_content
FROM   ctv_stats
WHERE  date = '2026-06-07'
  AND  NOT startsWith(contentid, 'iris')
  AND  matchedby != ''
  AND  matchedby IS NOT NULL
GROUP  BY matchedby
ORDER  BY total_requests DESC
LIMIT  10;

-- ── Last 3 days ───────────────────────────────────────────────────────────────
SELECT
    matchedby,
    SUM(total)                                         AS total_requests,
    SUM(CASE WHEN success > 0 THEN total ELSE 0 END)  AS served_requests,
    SUM(CASE WHEN success = 0 THEN total ELSE 0 END)  AS failed_requests,
    uniq(contentid)                                    AS distinct_content
FROM   ctv_stats
WHERE  date >= '2026-06-05' AND date <= '2026-06-08'
  AND  NOT startsWith(contentid, 'iris')
  AND  matchedby != ''
  AND  matchedby IS NOT NULL
GROUP  BY matchedby
ORDER  BY total_requests DESC
LIMIT  10;


-- =============================================================================
-- [CH] 16. Segment detail — single segment breakdown by platform
-- Endpoint : GET /api/failure-queue/segment-detail
-- Purpose  : Shows performance stats for one specific segment across all
--            platforms. Used when drilling into a ranked segment.
-- =============================================================================

-- ── Yesterday — example: segment = 'G_Roku' ──────────────────────────────────
SELECT
    url,
    SUM(total)                                         AS total_requests,
    SUM(CASE WHEN success > 0 THEN total ELSE 0 END)  AS served_requests,
    SUM(CASE WHEN success = 0 THEN total ELSE 0 END)  AS failed_requests,
    uniq(contentid)                                    AS distinct_content
FROM   ctv_stats
WHERE  date = '2026-06-07'
  AND  NOT startsWith(contentid, 'iris')
  AND  matchedby = 'G_Roku'
GROUP  BY url
ORDER  BY total_requests DESC;

-- ── Last 3 days ───────────────────────────────────────────────────────────────
SELECT
    url,
    SUM(total)                                         AS total_requests,
    SUM(CASE WHEN success > 0 THEN total ELSE 0 END)  AS served_requests,
    SUM(CASE WHEN success = 0 THEN total ELSE 0 END)  AS failed_requests,
    uniq(contentid)                                    AS distinct_content
FROM   ctv_stats
WHERE  date >= '2026-06-05' AND date <= '2026-06-08'
  AND  NOT startsWith(contentid, 'iris')
  AND  matchedby = 'G_Roku'
GROUP  BY url
ORDER  BY total_requests DESC;


-- =============================================================================
-- [CH] 17. Platform segment counts — distinct segments per platform
-- Endpoint : GET /api/failure-queue/platform-segment-counts
-- Purpose  : Returns how many distinct segment keys each platform has.
--            Used to annotate the platform breakdown table.
-- =============================================================================

-- ── Yesterday ────────────────────────────────────────────────────────────────
SELECT
    url,
    uniq(matchedby) AS segment_count
FROM   ctv_stats
WHERE  date = '2026-06-07'
  AND  NOT startsWith(contentid, 'iris')
  AND  matchedby != ''
  AND  matchedby IS NOT NULL
GROUP  BY url
ORDER  BY segment_count DESC;

-- ── Last 3 days ───────────────────────────────────────────────────────────────
SELECT
    url,
    uniq(matchedby) AS segment_count
FROM   ctv_stats
WHERE  date >= '2026-06-05' AND date <= '2026-06-08'
  AND  NOT startsWith(contentid, 'iris')
  AND  matchedby != ''
  AND  matchedby IS NOT NULL
GROUP  BY url
ORDER  BY segment_count DESC;


-- =============================================================================
-- [CH] 18. Platform segment detail — success rate per segment per platform
-- Endpoint : GET /api/failure-queue/platform-segment-detail
-- Purpose  : For a single platform, shows the success rate for each segment key.
--            Used in the expanded platform row segment tab.
-- =============================================================================

-- ── Yesterday — example: Roku ────────────────────────────────────────────────
SELECT
    matchedby,
    SUM(total)                                         AS total_requests,
    SUM(CASE WHEN success > 0 THEN total ELSE 0 END)  AS served_requests,
    ROUND(
        SUM(CASE WHEN success > 0 THEN total ELSE 0 END)
        * 100.0 / NULLIF(SUM(total), 0)
    , 2)                                               AS success_rate_pct
FROM   ctv_stats
WHERE  date = '2026-06-07'
  AND  NOT startsWith(contentid, 'iris')
  AND  matchedby != ''
  AND  matchedby IS NOT NULL
  AND  url IN (/* Roku URLs */)
GROUP  BY matchedby
ORDER  BY total_requests DESC;

-- ── Last 3 days ───────────────────────────────────────────────────────────────
SELECT
    matchedby,
    SUM(total)                                         AS total_requests,
    SUM(CASE WHEN success > 0 THEN total ELSE 0 END)  AS served_requests,
    ROUND(
        SUM(CASE WHEN success > 0 THEN total ELSE 0 END)
        * 100.0 / NULLIF(SUM(total), 0)
    , 2)                                               AS success_rate_pct
FROM   ctv_stats
WHERE  date >= '2026-06-05' AND date <= '2026-06-08'
  AND  NOT startsWith(contentid, 'iris')
  AND  matchedby != ''
  AND  matchedby IS NOT NULL
  AND  url IN (/* Roku URLs */)
GROUP  BY matchedby
ORDER  BY total_requests DESC;


-- =============================================================================
-- NOTES
-- =============================================================================
-- 1. All queries exclude iris* content IDs (decommissioned inventory).
-- 2. Never wrap `date` in toDate() — breaks ClickHouse partition pruning.
-- 3. `success = 0` = failed/unmatched.
--    `success > 0` = served (includes codes 1-19, NOT just 1).
-- 4. `SUM(total)` gives request count — do NOT use COUNT(*) on this table.
-- 5. The IN-list of platform URLs comes from platform_url_mapping (PostgreSQL).
-- 6. Region filter adds:     AND region = 'euc-1'
--    (values: euc-1, apse-1, use-1, usw-2)
-- 7. Brand-safety filter adds: AND isbrandsafe = 1  (or = 0 for unsafe only)
-- 8. matchedby prefix meanings:
--      C_  = Content ID match
--      G_  = Genre match
--      CG_ = Channel & Genre match
--      R_  = Rating match
--      S_  = Segment match
--      (empty) = Unmatched / failed
-- =============================================================================
