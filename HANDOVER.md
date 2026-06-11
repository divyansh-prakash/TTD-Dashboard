# TTD Failure Prevention Dashboard — Project Handover Sheet

**Date**: 2026-06-08  
**Author**: Paras Nath (paras.nath@silverpush.co)

---

## 1. Project Overview

**Purpose**: Monitor and analyse CTV ad-serving failures and enrichment coverage across streaming platforms (Roku, Tubi, Plex, Fubo, etc.) and Pubmatic.

**Architecture**:
- **Frontend**: Angular 21.1.3 — `ttd-failure-prevention/` — serves on `http://localhost:4200`
- **Backend**: Node.js / Express — `server/` — serves on `http://localhost:3000`
- **Databases**: 2 × ClickHouse (TTD + Pubmatic) + 1 × PostgreSQL (platform URL mapping)

---

## 2. Repository Structure

```
ttd/
├── server/                          # Node.js Express backend
│   ├── index.js                     # App entry point, CORS, startup cache
│   ├── controllers/failure-queue.js # HTTP request handlers (thin layer)
│   ├── services/failure-queue.js    # Business logic & data aggregation (739 lines)
│   ├── repositories/
│   │   ├── ctvStats.repo.js         # ClickHouse queries for TTD data
│   │   ├── pubmaticStats.repo.js    # ClickHouse queries for Pubmatic data
│   │   ├── platformUrlMap.repo.js   # PostgreSQL — url→platform mapping (cached 24h)
│   │   ├── contentIdMap.repo.js     # DISABLED — cross-server approach abandoned
│   │   └── pubmaticContentCache.repo.js  # DISABLED
│   ├── models/failure-queue.js      # Query-string parsers & row transforms
│   ├── db/
│   │   ├── databases.js             # Partner config + column name aliases
│   │   ├── clickhouse.js            # ClickHouse HTTP client + query logging
│   │   └── postgres.js              # PostgreSQL connection pool
│   ├── routes/failure-queue.js      # Express route definitions
│   ├── queries.sql                  # TTD reference queries (all endpoints)
│   ├── queries-pubmatic.sql         # Pubmatic reference queries (all endpoints)
│   └── queries.log                  # Auto-generated query audit log (JSON lines)
│
└── ttd-failure-prevention/          # Angular frontend
    └── src/app/
        ├── core/services/api.service.ts      # All HTTP calls to backend
        ├── core/models/failure-queue.model.ts # TypeScript interfaces
        └── core/components/
            ├── layout/               # Root layout wrapper
            ├── dashboard/            # v1 — deprecated
            ├── dashboard-2/          # v2 — active (TTD + Pubmatic)
            └── dashboard-new/        # v3 — newer variant
```

---

## 3. Running the Project

### Backend
```bash
cd server
npm install
npm run dev      # nodemon watch mode
# or: npm start
```

### Frontend
```bash
cd ttd-failure-prevention
npm install
ng serve         # http://localhost:4200
```

---

## 4. Database Configuration

Credentials live in `server/.env` (not committed).

| Database | Type | Host | DB/Table |
|----------|------|------|----------|
| TTD | ClickHouse | `54.81.93.97:8123` | `dpttd.ctv_stats` |
| Pubmatic | ClickHouse | `178.128.215.155:8123` | `ctv.ctv_agg_data` |
| Platform mapping | PostgreSQL | `64.225.60.113:4132` | `ttd_dmp.platform_url_mapping` |

### TTD ClickHouse — `ctv_stats` Schema

| Column | Type | Notes |
|--------|------|-------|
| `date` | Date | Partition key — never wrap in `toDate()` |
| `timestamp` | DateTime | Used for hourly grouping |
| `url` | String | App/bundle ID → resolves to platform via PostgreSQL |
| `contentid` | String | Content ID — exclude rows starting with `iris` |
| `channel` | String | Ad placement channel |
| `matchedby` | String | Segment key (see prefix table below) |
| `segment` | String | Raw segment value |
| `isbrandsafe` | UInt8 | 1 = safe, 0 = unsafe |
| `success` | UInt8 | 0 = failed, **>0 = served** (1–19 are all served/enriched) |
| `total` | UInt64 | Pre-aggregated request count — use `SUM(total)`, NOT `COUNT(*)` |
| `region` | String | Geographic region |

**IMPORTANT**: `success > 0` means served — do NOT use `success = 1` only. Codes 2–19 are also served/enriched.

### Pubmatic ClickHouse — `ctv_agg_data` Schema

| Column | Type | Notes |
|--------|------|-------|
| `process_date` | String | Date as `YYYY-MM-DD` — use string comparisons, no `toDate()` |
| `hour` | Int32 | Hour 0–23 (replaces ClickHouse `toHour(timestamp)`) |
| `appid` | String | Bundle/app ID (equivalent to `url` in TTD) |
| `content_id` | String | Content ID |
| `matchedby` | String | Same meaning as TTD — empty = unmatched/failed |
| `categories` | Array(String) | Segment array — use `arrayJoin()` to explode |
| `total_count` | UInt64 | Pre-aggregated count (equivalent to `total` in TTD) |
| `content_title` | String | |
| `content_series` | String | |
| `content_season` | String | |
| `content_episode` | String | |

**Success logic (no `success` column)**:
- Served/matched: `matchedby != '' AND matchedby IS NOT NULL`
- Failed/unmatched: `matchedby = '' OR matchedby IS NULL`

### PostgreSQL — `platform_url_mapping`

```sql
SELECT url, platform FROM platform_url_mapping ORDER BY platform, url;
```

~303 rows. Cached in Node.js memory for 24 hours on startup. Maps raw bundle IDs to human-readable platform names (Roku, Tubi, Plex, etc.).

### `matchedby` Prefix Reference

| Prefix | Category | Example | Meaning |
|--------|----------|---------|---------|
| `C_` | Content ID | `C_Roku` | Matched by exact content ID |
| `G_` | Genre | `G_Roku` | Matched by genre targeting |
| `CG_` | Channel & Genre | `CG_Roku` | Matched by channel AND genre combined |
| `R_` | Rating | `R_Roku` | Matched by content rating |
| `S_` | Segment | `S_Roku` | Matched by custom segment |
| `(empty)` | Unmatched | — | No segment matched = failure |

---

## 5. API Endpoints

All routes are mounted at `/api/failure-queue/`. Backend URL: `http://localhost:3000`.

### TTD Endpoints

| Method | Path | Frontend method | Purpose |
|--------|------|-----------------|---------|
| GET | `/by-platform` | `getByPlatform()` | Main platform list with segment breakdown and deltas |
| GET | `/by-platform/detail` | `getPlatformDetail()` | Paginated content rows per segment (failed or enrichable) |
| GET | `/by-platform/summary` | `getPlatformSummary()` | Single-platform deep-dive (pie chart data) |
| GET | `/by-platform/download` | `downloadCsv()` | CSV export — `type`: `failed` / `enrichable` / `all` |
| GET | `/by-platform/hits` | `getContentHits()` | Content-level hit counts per matchedBy category |
| GET | `/trend` | `getTrend()` | Daily or hourly time-series (branches on date range) |
| GET | `/comparison` | `getPeriodComparison()` | Current period vs equal-length previous period |
| GET | `/segment-rankings` | `getSegmentRankings()` | Top/bottom N performing segments |
| GET | `/segment-detail` | `getSegmentDetail()` | Single segment performance by platform |
| GET | `/platform-segment-counts` | `getPlatformSegmentCounts()` | Distinct segment count per platform |
| GET | `/platform-segment-detail` | `getPlatformSegmentDetail()` | Segment success rate by platform |
| GET | `/filters/options` | `getFilterOptions()` | Platform dropdown list (from PostgreSQL cache) |

### Pubmatic Endpoints

| Method | Path | Frontend method | Purpose |
|--------|------|-----------------|---------|
| GET | `/pubmatic-summary` | `getPubmaticSummary()` | KPI cards: total hits, unique matched/unmatched, match rate |
| GET | `/pubmatic-appid-breakdown` | `getPubmaticAppidBreakdown()` | App ID distribution (known vs unknown platforms) |
| GET | `/pubmatic-content-gap` | `getPubmaticContentGap()` | Unmatched content IDs per app ID |
| ~~GET~~ | ~~`/pubmatic-contentid-breakdown`~~ | ~~disabled~~ | Disabled — cross-server approach abandoned |

### Health Check

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Server liveness check |

---

## 6. Query Parameters (Common Filters)

| Parameter | Type | Default | Accepted values |
|-----------|------|---------|-----------------|
| `dateFrom` | YYYY-MM-DD | 7 days ago | Any date string |
| `dateTo` | YYYY-MM-DD | Today | Any date string |
| `platforms` | string[] | All | Platform names (Roku, Tubi, Plex…) |
| `channel` | string | `all` | Channel name or `all` |
| `brandSafe` | string | `all` | `1` (safe only), `0` (unsafe only), `all` |
| `region` | string | `all` | `euc-1`, `apse-1`, `use-1`, `usw-2`, or `all` |
| `partner` | string | `TTD` | `TTD` or `Pubmatic` |
| `offset` | number | 0 | Pagination offset |
| `limit` | number | 25 | Page size |

---

## 7. Data Flow — Main Dashboard Load

```
Angular component
  → ApiService.getByPlatform(filters, offset, limit)
  → GET /api/failure-queue/by-platform
  → Controller: parseByPlatformQuery + parsePagination
  → Service: getByPlatform()
      ├── PostgreSQL: getAllPlatformUrlMappings()  [cached 24h]
      ├── ClickHouse TTD (parallel):
      │     getCtvFailedAgg()       → failed by (url, matchedby)
      │     getCtvTotalAgg()        → total by (url)
      │     getHealthyCategoryTotals() → served by (url, matchedby)
      │     [previous period totals for delta]
      └── Application layer:
            - Group rows by platform (url → platform name via PG map)
            - Build matchedByGroups sorted by type
            - Compute success rates + period deltas
            - Paginate (offset/limit)
  ← Response: { platforms[], meta: { offset, limit, total } }
```

### Trend Branching Logic
- Single day selected → **hourly** data (24 points, uses `toHour(timestamp)`)
- Multiple days selected → **daily** data (one point per date)

### CSV Export Types
- `failed` → `success = 0` rows (unmatched failures)
- `enrichable` → `success > 0` rows (served content, enrichment candidates)
- `all` → both, with a `type` column

---

## 8. Frontend Components

### Active Dashboard: `dashboard-2/`

| Component | Purpose |
|-----------|---------|
| `dashboard-2.component` | Main orchestrator — loads all data on filter change |
| `kpi-cards/` | 4 KPI metric cards (total / success / failed / rate) |
| `platform-breakdown/` | Platform table with expandable matchedBy rows and detail drill-down |
| `request-trend/` | Daily/hourly line chart |
| `segment-rankings/` | Top/bottom segment performance table |
| `pubmatic-kpi/` | Pubmatic KPI cards |
| `pubmatic-platform-chart/` | Pubmatic platform hit distribution bar chart |
| `pubmatic-content-gap/` | Unmatched content IDs per app ID table |

### Other Components

| Component | Purpose |
|-----------|---------|
| `layout/` | Root layout wrapper — header and navigation |
| `platform-detail/` | Deep-dive page/modal for single platform |
| `dashboard/` | v1 — deprecated, do not use |
| `dashboard-new/` | v3 variant — filter header, trend, platform breakdown |

### TypeScript Models (`failure-queue.model.ts`)

Key interfaces: `FailedRow`, `MatchedByGroup`, `PlatformGroup`, `ByPlatformResponse`, `PlatformDetailResponse`, `TrendResponse`, `PlatformSummaryResponse`, `FailureQueueFilters`, `PubmaticSummary`, `PubmaticContentGapRow`, `SegmentRankingsResponse`, `SegmentDetail`, `PlatformSegmentItem`.

---

## 9. Query Logging

Every ClickHouse query is appended to `server/queries.log` in JSON-lines format:

```json
{"ts":"2026-06-08T10:00:00.000Z","db":"dpttd","sql":"SELECT ...","rows":1234,"ms":45}
```

This file grows over time and is not auto-rotated — archive or truncate periodically.

---

## 10. Known Limitations & Disabled Features

| Feature | Status | Reason |
|---------|--------|--------|
| `contentIdMap.repo.js` | Disabled | Cross-server content ID lookup approach abandoned |
| `pubmaticContentCache.repo.js` | Disabled | Replaced by per-app `/pubmatic-content-gap` endpoint |
| `/pubmatic-contentid-breakdown` | Route commented out | Superseded by content-gap query |
| `success` code semantics | Ambiguous | Codes 2–19 exist but meaning is unclear; treat as served (`success > 0`) |

---

## 11. Handover Checklist

- [ ] Copy `.env` to new machine — credentials for PG + 2 × ClickHouse
- [ ] Verify PostgreSQL connectivity: `SELECT COUNT(*) FROM platform_url_mapping`
- [ ] Verify TTD ClickHouse: `SELECT COUNT(*) FROM dpttd.ctv_stats WHERE date = today()-1`
- [ ] Verify Pubmatic ClickHouse: `SELECT COUNT(*) FROM ctv.ctv_agg_data WHERE process_date = yesterday()`
- [ ] Backend health check: `curl http://localhost:3000/health`
- [ ] Frontend loads: open `http://localhost:4200`
- [ ] Test date range filter (day / week / month)
- [ ] Test platform multi-select filter
- [ ] Test brand-safe toggle
- [ ] Test detail drill-down pagination
- [ ] Test CSV export (failed / enrichable / all)
- [ ] Test trend chart — verify daily vs hourly branching
- [ ] Toggle partner to Pubmatic — verify Pubmatic KPI cards load
- [ ] Check `queries.log` for slow or errored queries

---

## 12. Reference Files

| File | Purpose |
|------|---------|
| `server/queries.sql` | All TTD ClickHouse & PostgreSQL reference queries |
| `server/queries-pubmatic.sql` | All Pubmatic ClickHouse reference queries |
| `server/db/databases.js` | Partner config, column name aliases |
| `server/repositories/ctvStats.repo.js` | Actual query implementations for TTD |
| `server/repositories/pubmaticStats.repo.js` | Actual query implementations for Pubmatic |
| `server/services/failure-queue.js` | Aggregation and business logic |
