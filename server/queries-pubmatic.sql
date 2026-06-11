-- =============================================================================
-- Pubmatic CTV — ClickHouse Query Reference
-- Database : ctv  (host: $CH_PUB_HOST → 178.128.215.155:8123)
-- Table    : ctv_agg_data
--
-- Schema differences vs TTD ctv_stats:
--
--   TTD column    │ Pubmatic column
--   ──────────────┼────────────────────────────────
--   url           │ appid          (bundle / app ID)
--   contentid     │ content_id
--   total         │ total_count    (pre-aggregated)
--   success       │ ── NO COLUMN ──
--   segment       │ categories     Array(String)
--   matchedby     │ matchedby      (same name)
--   date          │ date   (String 'YYYY-MM-DD')
--   timestamp     │ hour           Int32 (0-23)
--   isbrandsafe   │ ── not available ──
--   title         │ content_title
--   series        │ content_series
--   season        │ content_season
--   episode       │ content_episode
--
-- Match/Fail logic (no success column):
--   MATCHED = matchedby != '' AND matchedby IS NOT NULL
--   FAILED  = matchedby = ''  OR  matchedby IS NULL
--
-- Rules:
--   1. date is a STRING — use string comparisons, never toDate().
--   2. Use SUM(total_count), never COUNT(*) — rows are pre-aggregated.
--   3. categories is Array(String) — use arrayJoin() to explode rows.
--   4. D2 matched/unmatched MUST be two separate WHERE-filtered queries.
--      A single uniq() without filter counts ALL pairs → always 100% / 0%.
-- =============================================================================


-- =============================================================================
-- PANEL: KPI Summary
-- Component : app-pub-kpi
-- Endpoint  : GET /api/failure-queue/pubmatic-summary
-- Shows     : Total hits, Unique pairs, Match rate, Known vs Unknown split
-- =============================================================================

-- KPI Summary — Total hits + Unique (content_id, appid) pairs
SELECT
    SUM(total_count)        AS total_hits,
    -- uniq(content_id, appid) AS unique_total
FROM   ctv_agg_data
WHERE  date = '2026-06-07';          -- Yesterday
-- date >= '2026-06-05' AND date <= '2026-06-08'  -- Last 3 days

-- KPI Summary — Total served requests (matched hits)
SELECT SUM(total_count) AS served_hits
FROM   ctv_agg_data
WHERE  date = '2026-06-07'
  AND  matchedby != '' AND matchedby IS NOT NULL;

-- KPI Summary — Matched pairs (separate query — see Rule 4 above)
SELECT uniq(content_id, appid) AS unique_matched
FROM   ctv_agg_data
WHERE  date = '2026-06-07'
  AND  matchedby != '' AND matchedby IS NOT NULL;

-- KPI Summary — Unmatched pairs (separate query — see Rule 4 above)
SELECT uniq(content_id, appid) AS unique_unmatched
FROM   ctv_agg_data
WHERE  date = '2026-06-07'
  AND  (matchedby = '' OR matchedby IS NULL);

-- KPI Summary — Known vs Unknown hit split (resolved via platform_url_mapping)
SELECT
    SUM(if(appid IN (/* known appids from platform_url_mapping */), total_count, 0)) AS known_hits,
    SUM(if(appid NOT IN (/* known appids */),                       total_count, 0)) AS unknown_hits
FROM   ctv_agg_data
WHERE  date = '2026-06-07';

-- KPI Summary — Unique distinct content IDs (ignoring appid — e.g. "movie-123" counted once)
SELECT uniq(content_id) AS unique_content_ids
FROM   ctv_agg_data
WHERE  date = '2026-06-07';

-- KPI Summary — Unique distinct content IDs that received a match
SELECT uniq(content_id) AS unique_content_matched
FROM   ctv_agg_data
WHERE  date = '2026-06-07'
  AND  matchedby != '' AND matchedby IS NOT NULL;
-- content_match_rate (%) = unique_content_matched / unique_content_ids * 100  (computed in service layer)

-- KPI Summary — Total requests (matched + unmatched) for content IDs that were matched at least once
-- Note: different from served_hits (card 2) which counts only matched rows.
--       This counts ALL appearances of content IDs that had at least one match.
SELECT SUM(total_count) AS matched_content_total_requests
FROM   ctv_agg_data
WHERE  date = '2026-06-07'
  AND  content_id IN (  
    SELECT content_id FROM ctv_agg_data
    WHERE  date = '2026-06-07'
      AND  matchedby != '' AND matchedby IS NOT NULL
    GROUP  BY content_id
  );


-- =============================================================================
-- PANEL: App ID Coverage
-- Component : app-pub-platform-chart  (Panel 1 — pie chart + horizontal bars)
-- Endpoint  : GET /api/failure-queue/pubmatic-appid-breakdown
-- Shows     : How many distinct app IDs are known vs unknown in our mapping.
--             Breakdown by platform. Click a bar/slice to see the raw appids.
-- Note      : Service resolves appid → platform via PostgreSQL platform_url_mapping.
-- =============================================================================

-- App ID Coverage — All distinct app IDs with total hit count (no limit)
SELECT
    appid,
    SUM(total_count) AS hits
FROM   ctv_agg_data
WHERE  date = '2026-06-07'           -- Yesterday
-- date >= '2026-06-05' AND date <= '2026-06-08'  -- Last 3 days
GROUP  BY appid
ORDER  BY hits DESC;

-- Service-layer post-processing (JavaScript — not SQL):
-- 1. Fetch all rows from PostgreSQL platform_url_mapping → Map { appid → platformName }
-- 2. For each row above:
--    known   = urlMap.has(appid) → group into platformMap[platformName].appids[]
--    unknown = not in urlMap     → push to unknownList[]
-- 3. Response: { totalAppids, knownCount, unknownCount,
--               breakdown: [{ platform, count, appids[] }, …, { platform:'Unknown', … }] }


-- =============================================================================
-- PANEL: Content ID Dataset Coverage
-- Component : app-pub-platform-chart  (Panel 2)
-- Endpoint  : GET /api/failure-queue/pubmatic-content-coverage
-- Shows     : Of the content IDs Pubmatic sees per platform, how many are
--             already in our dpttd dataset? Tells us where scraping would help.
-- Note      : Requires dpttd content-ID cache (built in background at startup,
--             ~140s). First request may be slow; subsequent requests are fast.
-- =============================================================================

-- Content ID Dataset Coverage — Step 1: dpttd cache (built once at startup)
-- Single UNION ALL across all 11 platform tables in dpttd ClickHouse.
SELECT contentid, 'Roku'     AS platform FROM dpttd.roku_data_v2     UNION ALL
SELECT contentid, 'Tubi'     AS platform FROM dpttd.tubi_full_data_v2 UNION ALL
SELECT contentid, 'Pluto'    AS platform FROM dpttd.pluto_data_v2     UNION ALL
SELECT contentid, 'Crave'    AS platform FROM dpttd.crave_data        UNION ALL
SELECT contentid, 'Philo'    AS platform FROM dpttd.philo_data_v2     UNION ALL
SELECT contentid, 'Fawesome' AS platform FROM dpttd.fawesome_data_v2  UNION ALL
SELECT contentid, 'Fubo'     AS platform FROM dpttd.fubo_data_v2      UNION ALL
SELECT contentid, 'Joyn'     AS platform FROM dpttd.joyn_data_v2      UNION ALL
SELECT contentid, 'TVmaze'   AS platform FROM dpttd.tvmaze_data_v2    UNION ALL
SELECT contentid, 'Plex'     AS platform FROM dpttd.plex_data_v2      UNION ALL
SELECT contentid, 'SBS'      AS platform FROM dpttd.sbs_data_v2;
-- Result cached in Node.js: Map<platformName, Set<contentId>>

-- Content ID Dataset Coverage — Step 2: Per-platform Pubmatic content IDs
-- Run once per platform (filtered by that platform's appids from platform_url_mapping).
SELECT appid, content_id
FROM   ctv_agg_data
WHERE  date >= '2026-06-05' AND date <= '2026-06-08'
  AND  appid IN (/* that platform's appids from platform_url_mapping */)
GROUP  BY appid, content_id;

-- Service-layer intersection (JavaScript — not SQL):
-- pubmaticSet = new Set(rows.map(r => r.content_id))   -- deduped per platform
-- dpttdSet    = cache.perPlatform.get(platformName)
-- covered     = count of pubmaticSet items that exist in dpttdSet
-- Response: [{ platform, pubmaticIds, dpttdIds, covered, uncovered, coverageRate }]


-- =============================================================================
-- PANEL: Content ID Gap Analysis
-- Component : app-pub-content-gap  (Panel 3)
-- Endpoint  : GET /api/failure-queue/pubmatic-content-gap
-- Shows     : Per platform (appid), how many distinct content IDs arrived
--             matched vs unmatched in Pubmatic's own system.
--             Sorted by unmatched desc — top rows = highest scraping priority.
-- Note      : matchedby comes from Pubmatic's own matching — no cross-server
--             join needed. Does NOT tell you whether our dpttd data could fix
--             the gap (that's Panel 2). Shows the size of the problem only.
-- =============================================================================

-- Content ID Gap Analysis — Per appid matched vs unmatched distinct content IDs
SELECT
    appid,
    uniq(content_id)                                              AS total_content,
    uniqIf(content_id, matchedby != '' AND matchedby IS NOT NULL) AS matched_content,
    uniqIf(content_id, matchedby = '' OR matchedby IS NULL)       AS unmatched_content,
    ROUND(
        uniqIf(content_id, matchedby != '' AND matchedby IS NOT NULL)
        * 100.0 / NULLIF(uniq(content_id), 0)
    , 2)                                                          AS match_rate_pct
FROM   ctv_agg_data
WHERE  date = '2026-06-07'           -- Yesterday
-- date >= '2026-06-05' AND date <= '2026-06-08'  -- Last 3 days
GROUP  BY appid
ORDER  BY unmatched_content DESC;

-- Note on uniqueness: uniq() is ClickHouse HyperLogLog (~0.8% error).
-- Counts are per-appid. A content_id on two Fawesome appids = counted twice.
-- To get true per-platform distinct counts, group by platform inside CH
-- (requires the platform_url_mapping join to happen in CH, not Node.js).


-- =============================================================================
-- PANEL: Matchby Breakdown
-- Component : app-pub-matchby
-- Endpoint  : GET /api/failure-queue/pubmatic-matchby-breakdown
-- Shows     : Per app ID request volume and unique content IDs, grouped by
--             match category. Accordion per category.
-- Match categories:
--   PB_C  = ContentId      PB_G  = Genre
--   PB_S  = Series         PB_TS = Title & Series
-- =============================================================================

-- Matchby Breakdown — per matchedby, per appid totals
SELECT
    matchedby,
    appid,
    SUM(total_count) AS total_hits,
    uniq(content_id) AS unique_content_ids
FROM   ctv_agg_data
WHERE  date = '2026-06-09'
  AND  matchedby IN ('PB_C', 'PB_G', 'PB_S', 'PB_TS')
GROUP  BY matchedby, appid
ORDER  BY total_hits DESC;

-- Service resolves appid → platform via platform_url_mapping.
-- Frontend groups rows by matchedby into accordions in order: PB_C → PB_G → PB_S → PB_TS.


-- =============================================================================
-- SUPPORTING: Platform Performance table (by-platform view)
-- Component : main platform queue / platform detail
-- Endpoint  : GET /api/failure-queue/by-platform  (partner=Pubmatic)
-- Shows     : Per-platform total hits, matched, unmatched, distinct content IDs.
-- =============================================================================

-- Platform Performance — per appid totals (known platforms only)
SELECT
    appid,
    SUM(total_count)                                                   AS total_hits,
    SUM(CASE WHEN matchedby != '' AND matchedby IS NOT NULL
             THEN total_count ELSE 0 END)                              AS matched_hits,
    SUM(CASE WHEN matchedby = '' OR matchedby IS NULL
             THEN total_count ELSE 0 END)                              AS unmatched_hits,
    uniq(content_id)                                                   AS distinct_content
FROM   ctv_agg_data
WHERE  date = '2026-06-07'
  AND  appid IN (/* known appids from platform_url_mapping */)
GROUP  BY appid
ORDER  BY total_hits DESC;

-- Platform Performance — Category breakdown (matchedby per platform)
SELECT
    matchedby,
    SUM(total_count)  AS req_total,
    uniq(content_id)  AS content_count
FROM   ctv_agg_data
WHERE  date = '2026-06-07'
  AND  (matchedby = '' OR matchedby IS NULL)
  AND  appid IN (/* platform appids */)
GROUP  BY matchedby
ORDER  BY req_total DESC;

-- Platform Performance — Served requests by matchedby per appid (healthy categories)
SELECT
    appid    AS url,
    matchedby,
    SUM(total_count) AS req_served
FROM   ctv_agg_data
WHERE  date = '2026-06-07'
  AND  matchedby != '' AND matchedby IS NOT NULL
  AND  appid IN (/* platform appids */)
GROUP  BY appid, matchedby
ORDER  BY req_served DESC;

-- Platform Performance — Unmatched content detail (paginated drill-down)
SELECT
    content_id,
    appid,
    SUM(total_count)       AS req_total,
    any(matchedby)         AS matchedby,
    any(content_title)     AS title,
    any(content_series)    AS series
FROM   ctv_agg_data
WHERE  date = '2026-06-07'
  AND  (matchedby = '' OR matchedby IS NULL)
  AND  appid IN (/* platform appids */)
GROUP  BY content_id, appid
ORDER  BY req_total DESC
LIMIT  50 OFFSET 0;

-- Platform Performance — Request trend (hourly)
SELECT
    hour,
    SUM(total_count)                                              AS total_hits,
    SUM(CASE WHEN matchedby = '' OR matchedby IS NULL
             THEN total_count ELSE 0 END)                        AS unmatched_hits
FROM   ctv_agg_data
WHERE  date = '2026-06-07'
GROUP  BY hour
ORDER  BY hour ASC;

-- Platform Performance — Request trend (daily)
SELECT
    date                                                  AS day,
    SUM(total_count)                                              AS total_hits,
    SUM(CASE WHEN matchedby = '' OR matchedby IS NULL
             THEN total_count ELSE 0 END)                        AS unmatched_hits
FROM   ctv_agg_data
WHERE  date >= '2026-06-05' AND date <= '2026-06-08'
GROUP  BY date
ORDER  BY date ASC;

-- Platform Performance — Segment rankings (categories array exploded)
SELECT
    seg_tag,
    SUM(if(matchedby != '' AND matchedby IS NOT NULL, total_count, 0)) AS matched_hits,
    uniq(content_id)                                                    AS distinct_content,
    SUM(total_count)                                                    AS total_requests
FROM (
    SELECT
        trimBoth(arrayJoin(categories)) AS seg_tag,
        matchedby, total_count, content_id
    FROM ctv_agg_data
    WHERE date = '2026-06-07'
      AND length(categories) > 0
)
WHERE seg_tag != ''
GROUP  BY seg_tag
HAVING matched_hits > 0
ORDER  BY matched_hits DESC
LIMIT  10;


-- =============================================================================
-- NOTES
-- =============================================================================
-- 1. No `success` column — match status derived from `matchedby`.
-- 2. `categories` is Array(String) — use arrayJoin() to explode per row.
-- 3. `date` is a String column — never wrap in toDate().
-- 4. `hour` (Int32 0-23) replaces ClickHouse's toHour(timestamp).
-- 5. KPI matched/unmatched MUST use two separate WHERE-filtered queries.
--    A single uniq() without filter gives wrong 100% / 0% split.
-- 8. KPI has two distinct-count dimensions:
--    a. uniq(content_id, appid) — unique PAIRS (same content on two appids = 2)
--    b. uniq(content_id)        — unique CONTENT IDs (same content on two appids = 1)
--    Both are reported. content_match_rate uses dimension (b).
-- 6. Content ID Gap Analysis uses Pubmatic's own matchedby signal — no
--    cross-server join needed. Counts are approximate (HyperLogLog).
-- 7. Content ID Dataset Coverage requires the dpttd cache (~2.3M IDs across
--    11 platform tables). Built in background after server starts (~140s).
-- =============================================================================
