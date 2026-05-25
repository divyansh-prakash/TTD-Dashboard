# Failure Prevention Dashboard — Design Spec
**Date:** 2026-05-22  
**Stack:** Plain HTML + CSS + JS (single self-contained file, shareable)  
**Charts:** Chart.js via CDN

---

## Overview

A single `index.html` dashboard for monitoring CTV content matching failures and diagnosing root causes. Serves both ops/business users (monitoring) and engineers (investigation). No build step, no server — open in any browser.

---

## Data Sources

### `ctv_stats`
Primary table. Each row = one content ID processed on a given date.

| Column | Description |
|---|---|
| `contentid` | Content identifier (multiple formats) |
| `url` | Platform bundle/app ID — joins to `platform_url_map` |
| `title` | Content title (often empty) |
| `series` / `season` / `episode` | Series metadata (often "0") |
| `channel` | Channel name (often empty) |
| `region` | Region code (e.g. `use-1`) |
| `segment` | Comma-separated contextual targeting segments |
| `total` | Total requests for this content |
| `success` | Successfully matched requests |
| `matchedby` | Matcher type (G, CG, R, C_IRIS, C_ROKU, C_PLUTO, C_FUBO, C_PLEX, TS); empty = failed |
| `isbrandsafe` | 0 or 1 |
| `date` | Date (YYYY-MM-DD) |
| `timestamp` | Full processing timestamp |

**Key metric definitions:**
- A content ID is **successful** if `success > 0`
- A content ID is **failed** if `success = 0` (strictly)
- **Success Rate** = count(rows where success > 0) / count(all rows)
- **Deep match** — `matchedby` starts with `C_` (C_IRIS, C_ROKU, C_PLUTO, C_FUBO, C_PLEX): matched by direct content_id lookup in the database
- **Shallow match** — all other non-empty `matchedby` values (G, CG, R, TS): matched via title, genre, rating, or other generic attributes
- **Unmatched** — `matchedby` is empty

### `platform_url_map`
Maps raw `url` values to human-readable platform names (Fawesome, Fubo, Crave, JoyN, etc.).  
URLs not present in this map are displayed as their raw value.

---

## Layout

### Global Filters (always visible, above both tabs)
Affect all data in both tabs simultaneously.

| Filter | Source | Options |
|---|---|---|
| Date | `date` column | Today / Last 7 Days / Last 30 Days |
| Location | `region` column | Distinct values (e.g. use-1) + All |

### Tabs
Two tabs below the global filters: **Overview** and **Diagnose**.

---

## Tab 1: Overview

### Row 1 — KPI Cards (5 cards)
1. **Total Content IDs** — distinct count of `contentid`
2. **Total Requests** — `sum(total)`
3. **Overall Success Rate** — `count(success > 0) / count(rows)`
4. **Failed Content IDs** — `count(rows where success = 0)`
5. **Brand Safe %** — `count(isbrandsafe = 1) / count(rows)`

### Row 2 — Charts
- **Failures by Platform** (horizontal bar) — top 10 platforms by count of failed rows; `url` resolved via `platform_url_map`
- **Matched By Breakdown** (donut) — distribution across Deep, Shallow, and Unmatched; hovering shows individual matcher values (C_IRIS, G, R, etc.)

### Row 3 — Charts
- **Top Failing Channels** (bar) — channels with most rows where `success = 0`
- **Segment Coverage** (pie) — rows with at least one segment vs. rows with empty segment field

### Row 4 — Deep vs Shallow Match
- **Match Depth Overview** (KPI strip, 3 cards): Deep Match %, Shallow Match %, Unmatched %
- **Match Depth by Platform** (stacked horizontal bar) — each platform bar shows proportion of Deep / Shallow / Unmatched; sorted by total row count descending; top 10 platforms

---

## Tab 2: Diagnose

### Filters Bar (tab-local, below global filters)
- **Platform** — dropdown, resolved names from `platform_url_map`
- **Channel** — dropdown, distinct values from `channel`
- **Match Status** — All / Failed (`success = 0`) / Successful (`success > 0`)
- **Brand Safe** — All / Yes / No

### Root Cause Badges
Auto-tagged on each row:
- `NO SEGMENTS` — `segment` field is empty
- `UNMATCHED` — `matchedby` is empty

### Table Columns
| Column | Notes |
|---|---|
| Content ID | Truncated with tooltip for full value |
| Platform | Resolved from `platform_url_map`; raw URL if not found |
| Channel | Raw value |
| Total | `total` |
| Success | `success` |
| Failure Rate | `(total - success) / total`; color coded: red = 100%, yellow = partial, green = 0% |
| Matched By | Raw value; empty shown as "—" |
| Brand Safe | Yes / No |
| Root Cause | Badge(s): NO SEGMENTS, UNMATCHED |

Table is sortable by any column. Default sort: Failure Rate descending.

### Failure Impact & RCA Section (above the table)

Answers: *what's causing the most failures, and what should we fix first?*

**Top Failure Drivers** — ranked table of failure groups:

| Column | Notes |
|---|---|
| Rank | Priority order (1 = highest impact) |
| Root Cause | NO SEGMENTS / UNMATCHED / BOTH |
| Failed Content IDs | Count of rows in this group |
| Requests at Risk | `sum(total)` for rows in this group — requests that would be recovered if fixed |
| % of All Failures | Share of total failed requests this group represents |
| Recommended Action | Human-readable fix suggestion (e.g. "Enrich segment data for these content IDs", "Add content IDs to matcher DB") |

Sorted by **Requests at Risk** descending — the group that recovers the most requests if fixed ranks #1.

**Priority logic:**
- `UNMATCHED` with high `total` = highest priority (content is seen frequently but never matched)
- `NO SEGMENTS` with high `total` = second priority (content recognized but has no targeting data)
- `BOTH` = also high priority as it indicates completely unprocessed content

---

## File Structure

Single `index.html` — all CSS, JS, and mock data inlined. Chart.js loaded from CDN.  
Designed so the mock data block can be replaced with an `async fetch()` call when a backend is ready.

---

## Future Considerations
- Replace inline mock data with API calls (data block is isolated for easy swap)
- Add date range picker when real timestamps are available
- Extend `platform_url_map` as new platforms are onboarded
