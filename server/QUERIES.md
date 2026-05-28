# TTD Enrichment — Data Queries Reference

All queries run against two databases:
- **ClickHouse** (`dpttd` database, host `54.81.93.97:8123`) — `ctv_stats` table, bid-level event data
- **PostgreSQL** (`ttd_dmp` database, host `64.225.60.113:4132`) — `platform_url_mapping` table, app-ID → platform name

---

## Table: `ctv_stats` (ClickHouse)

| Column       | Type    | Description |
|-------------|---------|-------------|
| `date`       | Date    | Partition key. Use bare comparisons (`date >= '...'`), never `toDate(date)` — wrapping breaks partition pruning. |
| `timestamp`  | DateTime | Full timestamp, used for hourly grouping. |
| `contentid`  | String  | Content identifier. Rows starting with `iris` are decommissioned — excluded from all queries. |
| `url`        | String  | App/bundle ID (e.g. `151908`, `ROKU`, `com.roku.web.trc`). Maps to a platform via `platform_url_mapping`. |
| `channel`    | String  | Ad channel / placement. Can be empty. |
| `matchedby`  | String  | Segment key that matched this bid. Empty/NULL means no segment matched. Prefixes: `G_`=Genre, `C_`=Content ID, `CG_`=Channel & Genre, `R_`=Rating, `S_`=Segment. |
| `segment`    | String  | Raw segment value. |
| `isbrandsafe`| UInt8   | `1` = brand-safe, `0` = not brand-safe. |
| `success`    | UInt8   | Outcome code. `0`=failed, `1`=served/enriched. Values `2`–`19` also exist (meaning TBD — possibly retry/auction-round counts). |
| `total`      | UInt64  | Pre-aggregated count. `SUM(total)` gives request volume. Do NOT count rows. |

---

## Table: `platform_url_mapping` (PostgreSQL)

| Column     | Type   | Description |
|-----------|--------|-------------|
| `url`      | text   | App/bundle ID — same value used in `ctv_stats.url`. |
| `platform` | text   | Human-readable platform name (e.g. `Roku`, `Tubi`, `Plex`). |

~303 rows. Cached in memory for 5 minutes on the Node server.

---

## Common Filter Parameters

Every query accepts these optional filters (passed from the UI):

| Parameter   | Values                          | Behaviour when omitted |
|------------|----------------------------------|------------------------|
| `dateFrom`  | `YYYY-MM-DD`                    | Defaults to 7 days ago |
| `dateTo`    | `YYYY-MM-DD`                    | Defaults to today      |
| `brandSafe` | `'1'` (safe only) / `'0'` (unsafe only) / `'all'` | No filter applied |
| `platforms` | Array of platform names e.g. `['Roku','Tubi']` | All platforms included |
| `channel`   | Channel string / `'all'`        | No filter applied      |

---

## 1. Platform Mapping Lookup (PostgreSQL)

**Used by:** every request — resolves which `url` values belong to which platform.

```sql
-- All URL → platform mappings (cached 5 min)
SELECT url, platform
FROM platform_url_mapping;

-- Distinct platform list (used to populate the platform filter dropdown)
SELECT DISTINCT platform
FROM platform_url_mapping
WHERE platform IS NOT NULL AND platform <> ''
ORDER BY platform ASC;
```

---

## 2. Phase-1: Platform Queue Aggregation (ClickHouse)

**Used by:** `/api/failure-queue/by-platform`  
**Purpose:** Powers the main platform list — total requests, failure counts, and per-segment breakdowns.

Five queries run in parallel on every page load:

---

### 2a. Failed Requests by (URL, matchedBy) — `getCtvFailedAgg` groupBy='url,matchedby'

Counts failure volume per app-ID per segment. This is the core of the failure queue.

```sql
-- Example: all mapped platforms, last 7 days
SELECT
    url,
    matchedby,
    SUM(total)         AS req_total,      -- total failed requests
    uniq(contentid)    AS content_count   -- distinct content IDs at risk
FROM ctv_stats
WHERE
    success = 0
    AND date >= '2026-05-20'
    AND date <= '2026-05-27'
    AND NOT startsWith(contentid, 'iris')
    -- Platform scope: include only mapped URLs
    AND url IN ('151908', 'ROKU', 'com.roku.web.trc', 'b089qxrrhd', ...)  -- all 303 mapped app IDs
    -- Optional: AND isbrandsafe = 1   (brandSafe='1')
    -- Optional: AND isbrandsafe = 0   (brandSafe='0')
GROUP BY url, matchedby
ORDER BY req_total DESC;

-- matchedby values you'll see:
--   'G_Roku'      → Genre match for Roku
--   'C_Roku'      → Content ID match for Roku
--   'CG_Roku'     → Channel & Genre match for Roku
--   'G_Comedy'    → Genre sub-category (Comedy)
--   ''  (empty)   → Unmatched — no segment hit
```

> **Note for Others platform:** replace `url IN (...)` with `url NOT IN (...)` to get traffic
> from app IDs that are NOT mapped to any known platform.

---

### 2b. Failed Requests by matchedBy only — `getCtvFailedAgg` groupBy='matchedby'

Used only for the **Others** platform — aggregates all unmapped traffic by segment.

```sql
SELECT
    matchedby,
    SUM(total)         AS req_total,
    uniq(contentid)    AS content_count
FROM ctv_stats
WHERE
    success = 0
    AND date >= '2026-05-20'
    AND date <= '2026-05-27'
    AND NOT startsWith(contentid, 'iris')
    AND url NOT IN ('151908', 'ROKU', ...)   -- exclude all 303 known app IDs
GROUP BY matchedby
ORDER BY req_total DESC;
```

---

### 2c. Top Failed URLs for Others — `getCtvFailedAgg` groupBy='url' LIMIT 100

Used only for the **Others** platform URL tab — shows which unknown app IDs are sending the most failed traffic.

```sql
SELECT
    url,
    SUM(total) AS req_total
FROM ctv_stats
WHERE
    success = 0
    AND date >= '2026-05-20'
    AND date <= '2026-05-27'
    AND NOT startsWith(contentid, 'iris')
    AND url NOT IN ('151908', 'ROKU', ...)
GROUP BY url
ORDER BY req_total DESC
LIMIT 100;
```

---

### 2d. Healthy (success=1) Category Totals — `getHealthyCategoryTotals`

Finds which segments are actively serving content successfully. Combined with 2a, this gives
the full picture per segment: how many failed AND how many served.

```sql
SELECT
    url,
    matchedby,
    SUM(total) AS req_served    -- successfully served requests for this segment
FROM ctv_stats
WHERE
    success = 1
    AND date >= '2026-05-20'
    AND date <= '2026-05-27'
    AND NOT startsWith(contentid, 'iris')
    AND url IN ('151908', 'ROKU', ...)   -- scoped to mapped URLs only
    AND matchedby != ''
    AND matchedby IS NOT NULL
    -- Optional: AND isbrandsafe = 1
GROUP BY url, matchedby
ORDER BY req_served DESC;

-- When a platform filter is active (e.g. platforms=['Roku']):
--   urls is narrowed to only Roku's app IDs to avoid scanning all 303 URLs.
```

> **Note:** `success=1` is the only "cleanly served" state we query directly.
> Rows with `success >= 2` exist in the database (2–19) and account for a large share
> of total traffic (~60% for Roku). Their exact meaning is unknown from this codebase —
> they are included in `getCtvTotalAgg` (no success filter) but excluded from all
> success=1 and success=0 specific queries.

---

### 2e. Total Requests (all success codes) — `getCtvTotalAgg` groupBy='url'

Used to compute the platform-level denominator for success/failure percentages.

```sql
-- For known platforms
SELECT
    url,
    SUM(total) AS req_total    -- all requests regardless of success code (0, 1, 2...19)
FROM ctv_stats
WHERE
    date >= '2026-05-20'
    AND date <= '2026-05-27'
    AND NOT startsWith(contentid, 'iris')
    AND url IN ('151908', 'ROKU', ...)    -- all 303 mapped app IDs
    -- Optional: AND isbrandsafe = 1
GROUP BY url
ORDER BY req_total DESC;

-- For Others platform (same query, inverted URL filter)
SELECT
    url,
    SUM(total) AS req_total
FROM ctv_stats
WHERE
    date >= '2026-05-20'
    AND date <= '2026-05-27'
    AND NOT startsWith(contentid, 'iris')
    AND url NOT IN ('151908', 'ROKU', ...)
GROUP BY url
ORDER BY req_total DESC;
```

> **How platform totals are built from this:**
> The result is iterated in JS. Each row's `url` is looked up in the platform mapping.
> Rows belonging to the same platform are summed:
> `platformTotalMap['Roku'] += row.req_total` for each Roku URL.

---

## 3. Trend Graph (ClickHouse)

**Used by:** `/api/failure-queue/trend`  
**Purpose:** Time-series chart — daily or hourly breakdown of failed vs total requests.

### 3a. Daily trend

```sql
-- Failed requests per day
SELECT
    toString(date) AS date,
    SUM(total) AS req_total
FROM ctv_stats
WHERE
    success = 0
    AND date >= '2026-05-20'
    AND date <= '2026-05-27'
    AND NOT startsWith(contentid, 'iris')
    -- Optional platform scope: AND url IN ('151908', 'ROKU', ...)
    -- Optional: AND isbrandsafe = 1
GROUP BY date
ORDER BY date ASC;

-- Total requests per day (no success filter)
SELECT
    toString(date) AS date,
    SUM(total) AS req_total
FROM ctv_stats
WHERE
    date >= '2026-05-20'
    AND date <= '2026-05-27'
    AND NOT startsWith(contentid, 'iris')
GROUP BY date
ORDER BY date ASC;

-- The frontend computes: Success = Total - Failed for each date point.
```

### 3b. Hourly trend (when dateFrom = dateTo, single-day view)

```sql
-- Failed requests per hour (0-23)
SELECT
    toHour(timestamp) AS hour,
    SUM(total) AS req_total
FROM ctv_stats
WHERE
    success = 0
    AND date = '2026-05-27'
    AND NOT startsWith(contentid, 'iris')
    -- Optional platform scope: AND url IN (...)
GROUP BY hour
ORDER BY hour ASC;

-- Total requests per hour
SELECT
    toHour(timestamp) AS hour,
    SUM(total) AS req_total
FROM ctv_stats
WHERE
    date = '2026-05-27'
    AND NOT startsWith(contentid, 'iris')
GROUP BY hour
ORDER BY hour ASC;
```

---

## 4. Phase-2: Content Row Drill-down (ClickHouse, Paginated)

**Used by:** `/api/failure-queue/by-platform/detail`  
**Purpose:** When a user expands a matchedBy row, load the individual content IDs.  
**Pagination:** `LIMIT 10 OFFSET 0`, `LIMIT 10 OFFSET 10`, etc.

### 4a. Failed content rows — known platform (e.g. Roku)

```sql
SELECT
    contentid,
    url,
    channel,
    SUM(total)       AS req_total,
    any(matchedby)   AS matchedby,
    any(segment)     AS segment,
    any(isbrandsafe) AS isbrandsafe
FROM ctv_stats
WHERE
    success = 0
    AND date >= '2026-05-26'
    AND date <= '2026-05-26'
    AND NOT startsWith(contentid, 'iris')
    AND url IN ('151908', 'ROKU', ...)   -- Roku's app IDs only
    -- Optional: AND isbrandsafe = 1
GROUP BY contentid, url, channel
-- matchedBy filter applied as HAVING (post-aggregation):
HAVING (matchedby = '' OR matchedby IS NULL)    -- for Unmatched rows
-- OR:
HAVING matchedby = 'G_Roku'                     -- for a specific segment row
ORDER BY req_total DESC
LIMIT 10 OFFSET 0;
```

### 4b. Failed content rows — Others platform

Same as 4a but with `url NOT IN (...)` instead of `url IN (...)`.

### 4c. Served (enrichable) content rows — known platform

```sql
SELECT
    contentid,
    url,
    channel,
    SUM(total)       AS req_total,
    any(matchedby)   AS matchedby,
    any(segment)     AS segment,
    any(isbrandsafe) AS isbrandsafe
FROM ctv_stats
WHERE
    success = 1
    AND date >= '2026-05-26'
    AND date <= '2026-05-26'
    AND NOT startsWith(contentid, 'iris')
    AND url IN ('151908', 'ROKU', ...)
    -- Optional: AND isbrandsafe = 1
GROUP BY contentid, url, channel
HAVING matchedby = 'G_Roku'   -- expand only that segment's served content
ORDER BY req_total DESC
LIMIT 10 OFFSET 0;
```

### 4d. Served content rows — Others platform

Same as 4c but with `url NOT IN (...)`.

---

## 5. CSV Export (ClickHouse, No LIMIT)

**Used by:** `/api/failure-queue/by-platform/download`  
**Purpose:** Full data download for a platform + type combination.

### 5a. type='enrichable' — all served rows for a segment

```sql
-- Example: Roku, Genre segment
SELECT
    contentid,
    url,
    channel,
    SUM(total)       AS req_total,
    any(matchedby)   AS matchedby,
    any(segment)     AS segment
FROM ctv_stats
WHERE
    success = 1
    AND date >= '2026-05-20'
    AND date <= '2026-05-27'
    AND NOT startsWith(contentid, 'iris')
    AND url IN ('151908', 'ROKU', ...)
    -- Optional: AND isbrandsafe = 1
GROUP BY contentid, url, channel
HAVING matchedby = 'G_Roku'    -- omit HAVING to get all enrichable segments
ORDER BY req_total DESC;
-- CSV columns: content_id, bundle_id, channel, requests_served, matched_by
```

### 5b. type='failed' — unmatched failed rows only

```sql
SELECT
    contentid,
    url,
    channel,
    SUM(total)       AS req_total,
    any(matchedby)   AS matchedby,
    any(segment)     AS segment
FROM ctv_stats
WHERE
    success = 0
    AND date >= '2026-05-20'
    AND date <= '2026-05-27'
    AND NOT startsWith(contentid, 'iris')
    AND url IN ('151908', 'ROKU', ...)
GROUP BY contentid, url, channel
HAVING (matchedby = '' OR matchedby IS NULL)    -- only truly unmatched rows
ORDER BY req_total DESC;
-- CSV columns: content_id, bundle_id, channel, requests_failed, matched_by
```

### 5c. type='all' — everything (failed + served), both queries run in parallel

Runs 5a (without matchedBy filter) and 5b (without onlyUnmatched filter) simultaneously,
then merges the results into one CSV with an extra `type` column (`served` or `failed`).

```sql
-- Query A: all failed rows (success=0, any matchedby)
-- Query B: all served rows (success=1, matchedby != '')
-- Merged CSV columns: content_id, bundle_id, channel, requests, matched_by, type
```

---

## Query Execution Flow per API Endpoint

```
GET /api/failure-queue/by-platform
  ├── PostgreSQL: getAllPlatformUrlMappings()          [cached 5 min]
  ├── ClickHouse: getCtvFailedAgg(groupBy='url,matchedby', urls=all303)   [phase-1 failures]
  ├── ClickHouse: getCtvFailedAgg(groupBy='matchedby', excludeUrls=all303) [Others failures, if no platform filter]
  ├── ClickHouse: getCtvFailedAgg(groupBy='url', excludeUrls=all303, LIMIT 100) [Others top URLs, if no platform filter]
  ├── ClickHouse: getHealthyCategoryTotals(urls=platformUrls)             [success=1 by segment]
  ├── ClickHouse: getCtvTotalAgg(groupBy='url', urls=all303)              [all-success totals for known platforms]
  └── ClickHouse: getCtvTotalAgg(groupBy='url', excludeUrls=all303)      [all-success totals for Others, if needed]

GET /api/failure-queue/by-platform/detail?platform=Roku&matchedBy=G_Roku&enrichable=true
  ├── PostgreSQL: getAllPlatformUrlMappings()          [cached]
  └── ClickHouse: getServedContentRowsByUrls(urls=RokuUrls, matchedBy='G_Roku', limit=10, offset=0)

GET /api/failure-queue/trend?dateFrom=...&dateTo=...
  ├── PostgreSQL: getAllPlatformUrlMappings()          [cached, only if platform filter active]
  ├── ClickHouse: getCtvFailedAgg(groupBy='date' or 'hour')
  └── ClickHouse: getCtvTotalAgg(groupBy='date' or 'hour')

GET /api/failure-queue/by-platform/download?platform=Roku&type=enrichable&matchedBy=G_Roku
  ├── PostgreSQL: getAllPlatformUrlMappings()          [cached]
  └── ClickHouse: getAllServedContentRowsByUrls(urls=RokuUrls, matchedBy='G_Roku')  [no LIMIT]

GET /api/failure-queue/filters/options
  └── PostgreSQL: getDistinctPlatforms()
```

---

## matchedBy Prefix Reference

| Prefix | Label (UI)       | Example value | Meaning |
|--------|-----------------|---------------|---------|
| `G_`   | Genre            | `G_Roku`      | Matched by genre targeting for this platform |
| `C_`   | Content ID       | `C_Roku`      | Matched by content ID |
| `CG_`  | Channel & Genre  | `CG_Roku`     | Matched by both channel and genre |
| `R_`   | Rating           | `R_Roku`      | Matched by content rating |
| `S_`   | Segment          | `S_Roku`      | Matched by a custom segment |
| `(empty)` | Unmatched     | —             | No segment matched this request |

When a suffix after the prefix matches the platform name (e.g. `G_Roku` under Roku),
the UI strips it and shows just "Genre". When it differs (e.g. `G_Comedy`), it shows "Genre · Comedy".
