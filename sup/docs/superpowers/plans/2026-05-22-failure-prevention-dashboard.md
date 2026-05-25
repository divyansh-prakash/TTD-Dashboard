# CTV Failure Prevention Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single self-contained `index.html` CTV failure prevention dashboard matching the Silverpush design system.

**Architecture:** Everything inlined in one HTML file — HTML, CSS, Chart.js (CDN), mock data as JS arrays, all rendering logic. A central `render()` function is called on any filter change. Chart instances are stored in a `charts` object and destroyed before recreation. The data block is isolated for easy future API swap.

**Tech Stack:** HTML5, vanilla JS (ES6+), CSS3, Chart.js 4.4.0 (CDN)

---

## Design Tokens (from Silverpush screenshot)

```
--bg-page:        #F0F2F5
--bg-card:        #FFFFFF
--table-header:   #1C2B3A
--primary:        #22C55E
--primary-dark:   #16A34A
--blue-cta:       #2563EB
--danger:         #EF4444
--warning:        #F59E0B
--text-primary:   #1E293B
--text-secondary: #64748B
--border:         #E2E8F0
--badge-success-bg:   #D1FAE5
--badge-success-text: #059669
--badge-danger-bg:    #FEE2E2
--badge-danger-text:  #DC2626
--badge-warn-bg:      #FEF3C7
--badge-warn-text:    #D97706
```

---

## File

- **Create:** `index.html` in project root (`/Users/parasnath/silverpush/frontend/ttd/sup/`)

---

## Task 1: HTML shell + CSS

**Files:** Create `index.html`

- [ ] **Step 1: Create the file**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CTV Failure Prevention Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg-page: #F0F2F5;
      --bg-card: #FFFFFF;
      --table-header: #1C2B3A;
      --primary: #22C55E;
      --primary-dark: #16A34A;
      --blue-cta: #2563EB;
      --danger: #EF4444;
      --warning: #F59E0B;
      --text-primary: #1E293B;
      --text-secondary: #64748B;
      --border: #E2E8F0;
      --shadow: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06);
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif;
      background: var(--bg-page);
      color: var(--text-primary);
      font-size: 14px;
      min-height: 100vh;
    }

    /* ── Header ── */
    .header {
      background: var(--bg-card);
      border-bottom: 1px solid var(--border);
      padding: 0 24px;
      height: 56px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .header-brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 700;
      font-size: 16px;
      color: var(--text-primary);
    }
    .header-brand svg { flex-shrink: 0; }
    .global-filters {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .global-filters label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      color: var(--text-secondary);
      font-weight: 500;
    }
    .global-filters select, .diag-filters select {
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 5px 28px 5px 10px;
      font-size: 13px;
      color: var(--text-primary);
      background: #fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2364748B' d='M6 8L1 3h10z'/%3E%3C/svg%3E") no-repeat right 8px center;
      -webkit-appearance: none;
      appearance: none;
      cursor: pointer;
    }
    .global-filters select:focus, .diag-filters select:focus {
      outline: none;
      border-color: var(--primary);
    }

    /* ── Page title ── */
    .page-header {
      padding: 20px 24px 0;
    }
    .page-header h1 {
      font-size: 22px;
      font-weight: 700;
      color: var(--text-primary);
    }
    .page-header p {
      color: var(--text-secondary);
      font-size: 13px;
      margin-top: 2px;
    }

    /* ── Tabs ── */
    .tabs {
      display: flex;
      gap: 0;
      padding: 16px 24px 0;
      border-bottom: 1px solid var(--border);
      margin: 0 0 20px;
    }
    .tab-btn {
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      padding: 8px 16px;
      font-size: 14px;
      font-weight: 500;
      color: var(--text-secondary);
      cursor: pointer;
      margin-bottom: -1px;
      transition: all 0.15s;
    }
    .tab-btn.active {
      color: var(--primary-dark);
      border-bottom-color: var(--primary-dark);
    }
    .tab-btn:hover:not(.active) { color: var(--text-primary); }

    /* ── Tab panes ── */
    .tab-pane { display: none; padding: 0 24px 24px; }
    .tab-pane.active { display: block; }

    /* ── KPI cards ── */
    .kpi-row {
      display: grid;
      gap: 16px;
      margin-bottom: 20px;
    }
    .kpi-row--5 { grid-template-columns: repeat(5, 1fr); }
    .kpi-row--3 { grid-template-columns: repeat(3, 1fr); }
    .kpi-card {
      background: var(--bg-card);
      border-radius: 10px;
      padding: 18px 20px;
      box-shadow: var(--shadow);
      border: 1px solid var(--border);
    }
    .kpi-card__label {
      font-size: 12px;
      font-weight: 500;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 8px;
    }
    .kpi-card__value {
      font-size: 26px;
      font-weight: 700;
      color: var(--text-primary);
      line-height: 1;
    }
    .kpi-card__value.green { color: var(--primary-dark); }
    .kpi-card__value.red   { color: var(--danger); }

    /* ── Chart cards ── */
    .chart-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-bottom: 20px;
    }
    .chart-card {
      background: var(--bg-card);
      border-radius: 10px;
      padding: 20px;
      box-shadow: var(--shadow);
      border: 1px solid var(--border);
    }
    .chart-card--full {
      grid-column: 1 / -1;
    }
    .chart-card h3 {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 16px;
    }
    .chart-card canvas { max-height: 280px; }

    /* ── Section titles ── */
    .section-title {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-primary);
      margin-bottom: 14px;
      margin-top: 8px;
    }

    /* ── Diagnose filters ── */
    .diag-filters {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 20px;
      background: var(--bg-card);
      border-radius: 10px;
      padding: 14px 16px;
      border: 1px solid var(--border);
      box-shadow: var(--shadow);
    }
    .diag-filters label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      color: var(--text-secondary);
      font-weight: 500;
    }

    /* ── RCA table ── */
    .rca-card {
      background: var(--bg-card);
      border-radius: 10px;
      padding: 20px;
      box-shadow: var(--shadow);
      border: 1px solid var(--border);
      margin-bottom: 20px;
    }

    /* ── Tables ── */
    .table-wrap {
      background: var(--bg-card);
      border-radius: 10px;
      box-shadow: var(--shadow);
      border: 1px solid var(--border);
      overflow: hidden;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    thead tr {
      background: var(--table-header);
    }
    thead th {
      color: #FFFFFF;
      padding: 11px 14px;
      text-align: left;
      font-weight: 600;
      font-size: 12px;
      white-space: nowrap;
      user-select: none;
    }
    thead th.sortable { cursor: pointer; }
    thead th.sortable:hover { background: #253447; }
    thead th .sort-icon { margin-left: 4px; opacity: 0.6; font-size: 10px; }
    thead th.sort-asc .sort-icon::after  { content: ' ▲'; }
    thead th.sort-desc .sort-icon::after { content: ' ▼'; }
    tbody tr { border-bottom: 1px solid var(--border); }
    tbody tr:last-child { border-bottom: none; }
    tbody tr:hover { background: #F8FAFC; }
    tbody td {
      padding: 10px 14px;
      color: var(--text-primary);
      vertical-align: middle;
    }
    td.success-val { color: var(--primary-dark); font-weight: 600; }
    td.danger-val  { color: var(--danger); font-weight: 600; }

    /* ── Badges ── */
    .badge {
      display: inline-block;
      border-radius: 20px;
      padding: 2px 9px;
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
    }
    .badge--success { background: #D1FAE5; color: #059669; }
    .badge--danger  { background: #FEE2E2; color: #DC2626; }
    .badge--warn    { background: #FEF3C7; color: #D97706; }
    .badge--blue    { background: #DBEAFE; color: #2563EB; }
    .badge--gray    { background: #F1F5F9; color: #64748B; }

    /* ── Failure rate cell ── */
    .rate-bar-wrap { display: flex; align-items: center; gap: 8px; min-width: 100px; }
    .rate-bar {
      flex: 1;
      height: 5px;
      background: #E2E8F0;
      border-radius: 99px;
      overflow: hidden;
    }
    .rate-bar__fill { height: 100%; border-radius: 99px; }

    /* ── Content ID truncation ── */
    .content-id {
      max-width: 180px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 11px;
      color: var(--text-secondary);
    }

    /* ── Empty state ── */
    .empty-state {
      text-align: center;
      padding: 40px;
      color: var(--text-secondary);
    }

    @media (max-width: 1100px) {
      .kpi-row--5 { grid-template-columns: repeat(3, 1fr); }
      .chart-row  { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>

  <!-- Header -->
  <header class="header">
    <div class="header-brand">
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <circle cx="8"  cy="8"  r="4" fill="#22C55E"/>
        <circle cx="20" cy="8"  r="4" fill="#22C55E" opacity=".7"/>
        <circle cx="8"  cy="20" r="4" fill="#22C55E" opacity=".7"/>
        <circle cx="20" cy="20" r="4" fill="#22C55E" opacity=".4"/>
      </svg>
      Silverpush · CTV
    </div>
    <div class="global-filters">
      <label>Date
        <select id="filter-date">
          <option value="all">All Time</option>
          <option value="today">Today</option>
          <option value="7d">Last 7 Days</option>
          <option value="30d">Last 30 Days</option>
        </select>
      </label>
      <label>Location
        <select id="filter-location"><option value="all">All</option></select>
      </label>
    </div>
  </header>

  <!-- Page title -->
  <div class="page-header">
    <h1>Failure Prevention Dashboard</h1>
    <p>Monitor CTV content matching failures and diagnose root causes</p>
  </div>

  <!-- Tabs -->
  <div class="tabs">
    <button class="tab-btn active" data-tab="overview">Overview</button>
    <button class="tab-btn" data-tab="diagnose">Diagnose</button>
  </div>

  <!-- ── Overview Tab ── -->
  <div id="tab-overview" class="tab-pane active">
    <div id="kpi-row" class="kpi-row kpi-row--5"></div>

    <div class="chart-row">
      <div class="chart-card">
        <h3>Failures by Platform</h3>
        <canvas id="chart-failures-platform"></canvas>
      </div>
      <div class="chart-card">
        <h3>Matched By Breakdown</h3>
        <canvas id="chart-matchedby"></canvas>
      </div>
    </div>

    <div class="chart-row">
      <div class="chart-card">
        <h3>Top Failing Channels</h3>
        <canvas id="chart-failing-channels"></canvas>
      </div>
      <div class="chart-card">
        <h3>Segment Coverage</h3>
        <canvas id="chart-segment-coverage"></canvas>
      </div>
    </div>

    <h2 class="section-title">Match Depth Analysis</h2>
    <div id="match-depth-kpis" class="kpi-row kpi-row--3"></div>
    <div class="chart-row">
      <div class="chart-card chart-card--full">
        <h3>Match Depth by Platform (Top 10)</h3>
        <canvas id="chart-match-depth-platform" style="max-height:340px"></canvas>
      </div>
    </div>
  </div>

  <!-- ── Diagnose Tab ── -->
  <div id="tab-diagnose" class="tab-pane">
    <div class="diag-filters">
      <label>Platform
        <select id="diag-platform"><option value="all">All</option></select>
      </label>
      <label>Channel
        <select id="diag-channel"><option value="all">All</option></select>
      </label>
      <label>Match Status
        <select id="diag-status">
          <option value="all">All</option>
          <option value="failed">Failed</option>
          <option value="success">Successful</option>
        </select>
      </label>
      <label>Brand Safe
        <select id="diag-brand">
          <option value="all">All</option>
          <option value="1">Yes</option>
          <option value="0">No</option>
        </select>
      </label>
    </div>

    <h2 class="section-title">Failure Impact &amp; Root Cause Analysis</h2>
    <div class="rca-card">
      <div id="rca-table"></div>
    </div>

    <h2 class="section-title">Content Details</h2>
    <div id="diagnose-table-wrap"></div>
  </div>

  <script>
  /* ================================================================
     SECTION 1 — MOCK DATA  (swap fetch() here when backend is ready)
  ================================================================ */
  const CTV_STATS = [
    {contentid:"iris_ff89a4d4c0d6c082",url:"roku.ifoodtv",title:"",channel:"ifood.tv",region:"use-1",segment:"",total:1,success:0,matchedby:"",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"03273750-7e4c-4b78-b3b0-77849be9fd80",url:"com.canela.ott.tv",title:"Confianza",channel:"canelatv_androidtv",region:"use-1",segment:"sp_movies_and_television,sp_thriller,sp_drama",total:1,success:1,matchedby:"G",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"6dfecbf819f89821a3fe2fbc49ab2477",url:"151908",title:"",channel:"",region:"use-1",segment:"sp_movies_and_television,sp_reality_tv_t2,sp_highenergyoccasions,sp_lifestyle,sp_movie_fans_silverpush_vl",total:4,success:4,matchedby:"G",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"AMCNVR0000039148",url:"G22223020133",title:"",channel:"allrealitywetv",region:"use-1",segment:"sp_movies_and_television,sp_reality_tv_t2,sp_movie_fans_silverpush_vl,sp_movies_television_int,sp_millennials_silverpush_vl",total:1,success:1,matchedby:"CG",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"EP013845521066",url:"directv.stb",title:"",channel:"fox_news",region:"use-1",segment:"sp_movies_and_television,sp_news_and_talk_shows,sp_movie_fans_silverpush_vl,sp_news_viewers_silverpush_vl",total:53,success:53,matchedby:"CG",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"iris_cd560337173a7eab",url:"com.plexapp.android",title:"",channel:"AMCN",region:"use-1",segment:"sp_movies_and_television,sp_horror,sp_slasher_horror,sp_comedy,sp_dark_comedy,sp_movie_fans_silverpush_vl",total:2,success:2,matchedby:"C_IRIS",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"626311b0c287f2001304338e_63bf4fca808b7400074fae07",url:"vizio.plutotv",title:"",channel:"",region:"use-1",segment:"sp_brand_safe,sp_pg_brandsafety,sp_brandsafe_med_low_no_vl,sp_brand_safe_silverpush,sp_brandsafe_int",total:1,success:1,matchedby:"R",isbrandsafe:1,date:"2025-11-02"},
    {contentid:"ce301b7d4c44b4e13a738ece7bd07d39",url:"151908",title:"",channel:"ce301b7d4c44b4e13a738ece7bd07d39",region:"use-1",segment:"sp_movies_and_television,sp_workplace_comedy,sp_comedy,sp_brand_safe,sp_pg_brandsafety,sp_movie_fans_silverpush_vl",total:5,success:5,matchedby:"C_ROKU",isbrandsafe:1,date:"2025-11-02"},
    {contentid:"iris_eac1ccab7e0f0ea6",url:"firetv.filmrise",title:"",channel:"",region:"use-1",segment:"sp_brand_safe,sp_pg_brandsafety,sp_brandsafe_med_low_no_vl,sp_brand_safe_silverpush,sp_brandsafe_int",total:2,success:2,matchedby:"R",isbrandsafe:1,date:"2025-11-02"},
    {contentid:"5d7769a396b655001fdd4df2",url:"256567",title:"",channel:"",region:"use-1",segment:"sp_movies_and_television,sp_movies,sp_movie_fans_silverpush_vl,sp_movies_television_int",total:18,success:18,matchedby:"C_PLEX",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"iris_c7b91b3fad3c45bc",url:"596759",title:"",channel:"FilmRise",region:"use-1",segment:"sp_movies_and_television,sp_tv_series,sp_brand_safe,sp_pg_brandsafety,sp_movie_fans_silverpush_vl",total:5,success:5,matchedby:"CG",isbrandsafe:1,date:"2025-11-02"},
    {contentid:"iris_77ed4d19ca6fa4bc",url:"B00KDSGIPK",title:"",channel:"",region:"use-1",segment:"sp_brand_safe,sp_pg_brandsafety,sp_brandsafe_med_low_no_vl,sp_brand_safe_silverpush,sp_brandsafe_int",total:5,success:5,matchedby:"R",isbrandsafe:1,date:"2025-11-02"},
    {contentid:"iris_78d7786e71021f9a",url:"Fawesome.Comcast",title:"",channel:"",region:"use-1",segment:"",total:1,success:0,matchedby:"",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"iris_798c60347128ac72",url:"com.plexapp.x1",title:"",channel:"",region:"use-1",segment:"sp_movies_and_television,sp_drama,sp_movie_fans_silverpush_vl,sp_movies_television_int",total:9,success:9,matchedby:"G",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"EP009089410833",url:"G17347010659",title:"",channel:"food_network",region:"use-1",segment:"sp_movies_and_television,sp_cooking_and_food,sp_reality_tv_t2,sp_tv_series,sp_brand_safe",total:4,success:4,matchedby:"C_FUBO",isbrandsafe:1,date:"2025-11-02"},
    {contentid:"64c950a5aab4dc0013e2be5a_64c950a7aab4dc0013e2be71",url:"74519",title:"",channel:"",region:"use-1",segment:"sp_movies_and_television,sp_reality_tv_t2,sp_brand_safe,sp_pg_brandsafety,sp_movie_fans_silverpush_vl",total:1,success:1,matchedby:"C_PLUTO",isbrandsafe:1,date:"2025-11-02"},
    {contentid:"iris_f1adad1292d2d4a6",url:"48630",title:"",channel:"",region:"use-1",segment:"",total:1,success:0,matchedby:"",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"iris_6e88cea0e1c88de2",url:"tv.pluto.comcastx1",title:"",channel:"",region:"use-1",segment:"sp_movies_and_television,sp_drama,sp_movie_fans_silverpush_vl,sp_movies_television_int",total:2,success:2,matchedby:"G",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"iris_d36a73c42c8aadee",url:"600853",title:"",channel:"Fawesome - Free Movies and TV Shows",region:"use-1",segment:"sp_movies_and_television,sp_romance,sp_drama,sp_indie_and_arthouse,sp_brand_safe",total:9,success:9,matchedby:"C_IRIS",isbrandsafe:1,date:"2025-11-02"},
    {contentid:"cd58fc3f-a8e2-424e-b0be-7b21804474eb",url:"584171",title:"Bruma",channel:"canelatv_roku",region:"use-1",segment:"sp_movies_and_television,sp_drama,sp_movie_fans_silverpush_vl,sp_movies_television_int",total:1,success:1,matchedby:"G",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"64cb387ee3fea2609d1daaed6c6e5969",url:"151908",title:"vod",channel:"",region:"use-1",segment:"sp_movies_and_television,sp_documentary,sp_historical,sp_brand_safe,sp_curious_minds_silver_vl",total:1,success:1,matchedby:"C_ROKU",isbrandsafe:1,date:"2025-11-02"},
    {contentid:"66624_395932",url:"196460",title:"",channel:"",region:"use-1",segment:"sp_movies_and_television,sp_reality_tv_t2,sp_highenergyoccasions,sp_movie_fans_silverpush_vl,sp_millennials_silverpush_vl",total:5,success:5,matchedby:"G",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"iris_eaa91e36b08a744f",url:"tv.pluto.chromecast",title:"",channel:"",region:"use-1",segment:"",total:2,success:0,matchedby:"",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"iris_71fb0e0edbd27d94",url:"458741",title:"",channel:"Fawesome - Free Movies and TV Shows",region:"use-1",segment:"sp_movies_and_television,sp_comedy,sp_movie_fans_silverpush_vl",total:1,success:1,matchedby:"CG",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"iris_148dfcb7b5620c08",url:"tv.pluto.android",title:"",channel:"",region:"use-1",segment:"",total:2,success:0,matchedby:"",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"iris_d87fba18e26f6303",url:"com.xumo.x1",title:"",channel:"Xumo Free Movies",region:"use-1",segment:"sp_movies_and_television,sp_crime_and_mystery,sp_documentary,sp_true_crime,sp_brand_safe",total:1,success:1,matchedby:"C_IRIS",isbrandsafe:1,date:"2025-11-02"},
    {contentid:"iris_fafc81d338e5970c",url:"48630",title:"",channel:"",region:"use-1",segment:"sp_movies_and_television,sp_romance,sp_thriller,sp_reality_tv_t2,sp_brand_safe",total:5,success:5,matchedby:"C_IRIS",isbrandsafe:1,date:"2025-11-02"},
    {contentid:"91ebc0279e02ae5a9023e40178509f85f08ec140",url:"196460",title:"",channel:"food",region:"use-1",segment:"sp_brand_safe,sp_pg_brandsafety,sp_brandsafe_med_low_no_vl,sp_brand_safe_silverpush",total:9,success:9,matchedby:"R",isbrandsafe:1,date:"2025-11-02"},
    {contentid:"61ba6293b3ddda001368cddc_61ba6295b3ddda001368cde0",url:"tv.pluto.comcastxclass",title:"",channel:"",region:"use-1",segment:"sp_brand_safe,sp_pg_brandsafety,sp_brandsafe_med_low_no_vl,sp_brand_safe_silverpush",total:1,success:1,matchedby:"R",isbrandsafe:1,date:"2025-11-02"},
    {contentid:"2_b5d80798431ff8df2dcf84a82b3a819f",url:"552828",title:"",channel:"",region:"use-1",segment:"sp_movies_and_television,sp_movies,sp_drama,sp_romance,sp_movie_fans_silverpush_vl",total:28,success:28,matchedby:"G",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"iris_0d9388e249273a5a",url:"firetv.filmrise",title:"",channel:"",region:"use-1",segment:"sp_movies_and_television,sp_documentary,sp_true_crime,sp_brand_safe,sp_movie_fans_silverpush_vl",total:1,success:1,matchedby:"C_IRIS",isbrandsafe:1,date:"2025-11-02"},
    {contentid:"iris_72cc0615801166b5",url:"CUSA05365",title:"",channel:"",region:"use-1",segment:"sp_brand_safe,sp_pg_brandsafety,sp_brandsafe_med_low_no_vl,sp_brand_safe_silverpush",total:2,success:2,matchedby:"R",isbrandsafe:1,date:"2025-11-02"},
    {contentid:"AMCNVR0000045281",url:"g22223020133",title:"",channel:"AMC",region:"use-1",segment:"sp_brand_safe,sp_pg_brandsafety,sp_brandsafe_med_low_no_vl,sp_brand_safe_silverpush",total:1,success:1,matchedby:"R",isbrandsafe:1,date:"2025-11-02"},
    {contentid:"a3e4afda8e5f3eb1ea88f21e4208308e",url:"151908",title:"",channel:"",region:"use-1",segment:"sp_movies_and_television,sp_nature_documentary,sp_documentary,sp_brand_safe,sp_curious_minds_silver_vl",total:13,success:13,matchedby:"C_ROKU",isbrandsafe:1,date:"2025-11-02"},
    {contentid:"68e0b681fa0f5ccff50c7567_68e0b682fa0f5ccff50c757f",url:"B00KDSGIPK",title:"",channel:"",region:"use-1",segment:"sp_movies_and_television,sp_drama,sp_movie_fans_silverpush_vl,sp_movies_television_int",total:5,success:5,matchedby:"G",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"d83c904f8d0e03c3de1893a14442b689",url:"151908",title:"",channel:"",region:"use-1",segment:"sp_brand_safe,sp_pg_brandsafety,sp_brandsafe_med_low_no_vl,sp_brand_safe_silverpush",total:4,success:4,matchedby:"R",isbrandsafe:1,date:"2025-11-02"},
    {contentid:"2_f7af663b84d7a14221039f45c3b083b1",url:"com.sling",title:"The Only Way Is Essex",channel:"So... Real",region:"use-1",segment:"sp_movies_and_television,sp_reality_tv_t2,sp_movie_fans_silverpush_vl,sp_millennials_silverpush_vl",total:1,success:1,matchedby:"CG",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"iris_284720740cd4239c",url:"74519",title:"",channel:"",region:"use-1",segment:"sp_movies_and_television,sp_reality_tv_t2,sp_highenergyoccasions,sp_movie_fans_silverpush_vl,sp_millennials_silverpush_vl",total:6,success:6,matchedby:"G",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"05c39d1d44a3c39eab2fbe11e0f67714",url:"ROKU",title:"",channel:"",region:"use-1",segment:"sp_movies_and_television,sp_drama,sp_war_and_history,sp_tv_series,sp_movie_fans_silverpush_vl",total:4,success:4,matchedby:"G",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"62509e1e7b9eaf001376d0a3_62509e217b9eaf001376d0a8",url:"tv.pluto.android",title:"",channel:"",region:"use-1",segment:"sp_brand_safe,sp_pg_brandsafety,sp_brandsafe_med_low_no_vl,sp_brand_safe_silverpush",total:3,success:3,matchedby:"R",isbrandsafe:1,date:"2025-11-02"},
    {contentid:"iris_37d110b1bfcae791",url:"457877",title:"",channel:"",region:"use-1",segment:"",total:1,success:0,matchedby:"",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"67ef2760b30226e551b42915",url:"13535",title:"",channel:"",region:"use-1",segment:"sp_brand_safe,sp_pg_brandsafety,sp_brandsafe_med_low_no_vl,sp_brand_safe_silverpush",total:4,success:4,matchedby:"R",isbrandsafe:1,date:"2025-11-02"},
    {contentid:"http://haystack.tv/id/JQPy2kUF",url:"172665",title:"",channel:"Haystack News",region:"use-1",segment:"sp_brand_safe,sp_pg_brandsafety,sp_brandsafe_med_low_no_vl,sp_brand_safe_silverpush",total:7,success:7,matchedby:"R",isbrandsafe:1,date:"2025-11-02"},
    {contentid:"646e0d36649e97001b5c09ff_646e0d36649e97001b5c0a14",url:"G18229011675",title:"PlutoTV: Frösche",channel:"5d767ae7b456c8cf265ce922",region:"use-1",segment:"sp_movies_and_television,sp_documentary,sp_brand_safe,sp_curious_minds_silver_vl",total:1,success:1,matchedby:"CG",isbrandsafe:1,date:"2025-11-02"},
    {contentid:"4_5e7e858b950c951afde19a2635c4aff3",url:"B01MQTVN2T",title:"EPG WFTV 9 Orlando, FL",channel:"EPG WFTV 9 Orlando, FL",region:"use-1",segment:"sp_movies_and_television,sp_news_and_talk_shows,sp_news_viewers_silverpush_vl",total:14,success:14,matchedby:"G",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"67e6956bf795b4ce8d465367",url:"com.plexapp.desktop",title:"",channel:"No Reservations",region:"use-1",segment:"sp_movies_and_television,sp_documentary,sp_movie_fans_silverpush_vl,sp_curious_minds_silver_vl",total:1,success:1,matchedby:"CG",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"e703db5129eb6119b011094b580da9a7",url:"B089QXRRHD",title:"",channel:"",region:"use-1",segment:"sp_movies_and_television,sp_brand_safe,sp_action_and_adventure_t2,sp_survival_action,sp_movie_fans_silverpush_vl",total:8,success:8,matchedby:"C_ROKU",isbrandsafe:1,date:"2025-11-02"},
    {contentid:"009f347cd0999e9e3c8526e5c3cb8a908d0abb03",url:"tv.vidaa.ui.plus",title:"FoodieBoy",channel:"newkfood",region:"use-1",segment:"",total:1,success:0,matchedby:"",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"iris_60987e5d804161e0",url:"B07W8FXWKK",title:"",channel:"Fawesome - Free Awesome TV & Movies",region:"use-1",segment:"sp_movies_and_television,sp_comedy,sp_movie_fans_silverpush_vl",total:1,success:1,matchedby:"CG",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"EP014707060789",url:"WBD_Streaming",title:"",channel:"WBD_Streaming",region:"use-1",segment:"",total:1,success:0,matchedby:"",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"1c1b4298668adbaaeeb52f524e08b111",url:"ROKU",title:"",channel:"",region:"use-1",segment:"sp_brand_safe,sp_pg_brandsafety,sp_brandsafe_med_low_no_vl,sp_brand_safe_silverpush",total:60,success:60,matchedby:"R",isbrandsafe:1,date:"2025-11-02"},
    {contentid:"1_32fefd26ab4bc6d548b600529d51d3e1",url:"1473398077",title:"",channel:"",region:"use-1",segment:"sp_movies_and_television,sp_drama,sp_movie_fans_silverpush_vl,sp_movies_television_int",total:1,success:1,matchedby:"G",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"d57a5dfbe75986b587e7562bd8e91a03",url:"151908",title:"",channel:"",region:"use-1",segment:"sp_movies_and_television,sp_crime_and_mystery,sp_documentary,sp_brand_safe,sp_curious_minds_silver_vl",total:2,success:2,matchedby:"C_ROKU",isbrandsafe:1,date:"2025-11-02"},
    {contentid:"8_a7b21154a4567439d7c6678a81e96921",url:"140474",title:"",channel:"trutv",region:"use-1",segment:"sp_movies_and_television,sp_tv_series,sp_movie_fans_silverpush_vl",total:1,success:1,matchedby:"G",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"iris_4888107bed4c4b87",url:"600757",title:"",channel:"Fawesome - Free Movies and TV Shows",region:"use-1",segment:"sp_movies_and_television,sp_crime_and_mystery,sp_movie_fans_silverpush_vl",total:1,success:1,matchedby:"CG",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"iris_c9651db83e2eff8e",url:"B07BKPFXTJ",title:"",channel:"ae",region:"use-1",segment:"sp_movies_and_television,sp_reality_tv_t2,sp_crime_and_mystery,sp_movie_fans_silverpush_vl,sp_millennials_silverpush_vl",total:8,success:8,matchedby:"CG",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"efe2dd7e9830c5e931e00eb839f6711d",url:"151908",title:"",channel:"",region:"use-1",segment:"sp_movies_and_television,sp_animation,sp_comedy,sp_brand_safe,sp_movie_fans_silverpush_vl",total:8,success:8,matchedby:"C_ROKU",isbrandsafe:1,date:"2025-11-02"},
    {contentid:"2_702203d9a606a38fcee6a86778dae8aa",url:"552828",title:"",channel:"",region:"use-1",segment:"sp_movies_and_television,sp_crime_and_mystery,sp_drama,sp_movie_fans_silverpush_vl",total:7,success:7,matchedby:"G",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"iris_90dba475a2e0b9d2",url:"com.univision.prendetv",title:"",channel:"ViX",region:"use-1",segment:"sp_brand_safe,sp_pg_brandsafety,sp_brandsafe_med_low_no_vl,sp_brand_safe_silverpush",total:1,success:1,matchedby:"R",isbrandsafe:1,date:"2025-11-02"},
    {contentid:"a60077d579a65ae97ffb1d30a11d4e86c1ef984c",url:"196460",title:"",channel:"tlc",region:"use-1",segment:"sp_movies_and_television,sp_reality_tv_t2,sp_highenergyoccasions,sp_movie_fans_silverpush_vl,sp_millennials_silverpush_vl",total:8,success:8,matchedby:"G",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"2_7b90d9a6a86693e2e97a963bc749fa62",url:"vizio.watchfree",title:"",channel:"",region:"use-1",segment:"sp_brand_safe,sp_pg_brandsafety,sp_brandsafe_med_low_no_vl,sp_brand_safe_silverpush",total:14,success:14,matchedby:"R",isbrandsafe:1,date:"2025-11-02"},
    {contentid:"iris_de9210ba6f78243f",url:"74519",title:"",channel:"",region:"use-1",segment:"",total:1,success:0,matchedby:"",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"b81f8799064843e28a09fd26d1e2c050",url:"151908",title:"",channel:"",region:"use-1",segment:"sp_movies_and_television,sp_competition_shows,sp_brand_safe,sp_movie_fans_silverpush_vl,sp_family_focus_silverpush_vl",total:18,success:18,matchedby:"C_ROKU",isbrandsafe:1,date:"2025-11-02"},
    {contentid:"d178a80116060a337c3f69bd27cecbfa",url:"151908",title:"vod",channel:"",region:"use-1",segment:"sp_movies_and_television,sp_scientific_exploration,sp_documentary,sp_brand_safe,sp_curious_minds_silver_vl",total:14,success:14,matchedby:"C_ROKU",isbrandsafe:1,date:"2025-11-02"},
    {contentid:"cf8c060c9689355582ac8ca37d827271",url:"G18183011458",title:"vod",channel:"",region:"use-1",segment:"sp_movies_and_television,sp_action_and_adventure_t2,sp_drama,sp_comedy,sp_movie_fans_silverpush_vl",total:2,success:2,matchedby:"G",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"iris_ac57441f69060551",url:"vizio.xumoplay",title:"",channel:"Wu Tang Collection",region:"use-1",segment:"sp_movies_and_television,sp_tv_series,sp_movie_fans_silverpush_vl",total:2,success:2,matchedby:"G",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"ae0ca69b82f9be7f92b151b94a4ac8d6",url:"ROKU",title:"",channel:"",region:"use-1",segment:"sp_movies_and_television,sp_reality_tv_t2,sp_highenergyoccasions,sp_movie_fans_silverpush_vl,sp_millennials_silverpush_vl",total:16,success:16,matchedby:"G",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"5_727f12885270effe38da914608e18bab",url:"13535",title:"",channel:"",region:"use-1",segment:"sp_movies_and_television,sp_action_and_adventure_t2,sp_movie_fans_silverpush_vl,sp_event_seekers_silverpush_vl",total:9,success:9,matchedby:"G",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"4_2e213ee2ae5a7b83f34815b754c5b081",url:"97955",title:"EPG KITV Hyperlocal Honolulu",channel:"EPG KITV Hyperlocal Honolulu",region:"use-1",segment:"sp_movies_and_television,sp_news_and_talk_shows,sp_news_viewers_silverpush_vl",total:21,success:21,matchedby:"G",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"iris_336baa9b5f73e512",url:"firetv.filmrise",title:"",channel:"FilmRise - Free Movies and TV Shows",region:"use-1",segment:"",total:1,success:0,matchedby:"",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"5a8d3a6016eea1e654a455bb93021bc8bd389201",url:"G22223020133",title:"",channel:"cooking",region:"use-1",segment:"sp_movies_and_television,sp_reality_tv_t2,sp_movie_fans_silverpush_vl,sp_millennials_silverpush_vl",total:3,success:3,matchedby:"CG",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"iris_78d32933d9f194c9",url:"LG_Streaming",title:"",channel:"vod",region:"use-1",segment:"sp_movies_and_television,sp_documentary,sp_movie_fans_silverpush_vl,sp_curious_minds_silver_vl",total:4,success:4,matchedby:"CG",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"iris_11aa910a67351f06",url:"B076X8FKXP",title:"",channel:"Fawesome - Free Awesome TV & Movies",region:"use-1",segment:"sp_movies_and_television,sp_romance,sp_family_and_children,sp_drama,sp_brand_safe",total:78,success:78,matchedby:"C_IRIS",isbrandsafe:1,date:"2025-11-02"},
    {contentid:"HDNC8cUm",url:"vizio.watchfree",title:"Standing Ground",channel:"812",region:"use-1",segment:"sp_movies_and_television,sp_documentary,sp_movie_fans_silverpush_vl,sp_curious_minds_silver_vl",total:1,success:1,matchedby:"G",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"10_9c2232f64e46e5a9871edd895f5603ce",url:"1087412",title:"Die Welt am Mittag",channel:"n24",region:"use-1",segment:"",total:1,success:0,matchedby:"",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"iris_a708a01d956df9ab",url:"48630",title:"",channel:"",region:"use-1",segment:"sp_movies_and_television,sp_action_and_adventure_t2,sp_thriller,sp_war_and_history,sp_brand_safe",total:9,success:9,matchedby:"C_IRIS",isbrandsafe:1,date:"2025-11-02"},
    {contentid:"EP036047720046",url:"Peacock_AX",title:"",channel:"bravo",region:"use-1",segment:"sp_movies_and_television,sp_reality_tv_t2,sp_tv_series,sp_brand_safe,sp_movie_fans_silverpush_vl",total:22,success:22,matchedby:"C_FUBO",isbrandsafe:1,date:"2025-11-02"},
    {contentid:"224eb25972cc3062c962eb0d189d5ffd",url:"ROKU",title:"",channel:"",region:"use-1",segment:"sp_movies_and_television,sp_reality_tv_t2,sp_movie_fans_silverpush_vl,sp_millennials_silverpush_vl",total:14,success:14,matchedby:"G",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"10_a9f4da2adc822f1b6f543ec9cafa6dce",url:"1244756",title:"",channel:"lifetime",region:"use-1",segment:"sp_movies_and_television,sp_biography,sp_documentary,sp_movie_fans_silverpush_vl,sp_curious_minds_silver_vl",total:1,success:1,matchedby:"CG",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"10_3eae82f6052c24365a8f2a978963a654",url:"vizio.philo",title:"",channel:"amc",region:"use-1",segment:"sp_brand_safe,sp_pg_brandsafety,sp_brandsafe_med_low_no_vl,sp_brand_safe_silverpush",total:5,success:5,matchedby:"R",isbrandsafe:1,date:"2025-11-02"},
    {contentid:"MV003793250000",url:"1074449",title:"Catch .44",channel:"Lionsgate",region:"use-1",segment:"sp_movies_and_television,sp_crime_and_mystery,sp_sensitive_category,sp_drugs",total:1,success:1,matchedby:"TS",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"LoneRanger_EP000026560213",url:"tv.pluto.comcastx1",title:"",channel:"",region:"use-1",segment:"",total:1,success:0,matchedby:"",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"http://haystack.tv/id/e22H6BnV",url:"g19033012474",title:"",channel:"Haystack News",region:"use-1",segment:"sp_brand_safe,sp_pg_brandsafety,sp_brandsafe_med_low_no_vl,sp_brand_safe_silverpush",total:4,success:4,matchedby:"R",isbrandsafe:1,date:"2025-11-02"},
    {contentid:"iris_44e3120ff515bdb6",url:"com.xumo.comcastx1",title:"",channel:"Xumo Free Comedy TV",region:"use-1",segment:"sp_movies_and_television,sp_comedy,sp_movie_fans_silverpush_vl",total:2,success:2,matchedby:"CG",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"1b6b70f064cf03747f3d59153f317f6e",url:"151908",title:"",channel:"",region:"use-1",segment:"sp_movies_and_television,sp_drama,sp_movie_fans_silverpush_vl",total:1,success:1,matchedby:"G",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"XM01FUACKYF574",url:"96065",title:"",channel:"Movies Page - DRM",region:"use-1",segment:"sp_movies_and_television,sp_action_and_adventure_t2,sp_movie_fans_silverpush_vl,sp_event_seekers_silverpush_vl",total:2,success:2,matchedby:"CG",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"iris_a73c2d13842ac108",url:"B076X8FKXP",title:"",channel:"",region:"use-1",segment:"sp_movies_and_television,sp_tv_series,sp_crime_and_mystery,sp_science_fiction,sp_movie_fans_silverpush_vl",total:5,success:5,matchedby:"G",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"1_4a05f29c83ad2e92c4ff66762e7656a9",url:"ROKU",title:"",channel:"",region:"use-1",segment:"sp_movies_and_television,sp_reality_tv_t2,sp_movie_fans_silverpush_vl,sp_millennials_silverpush_vl",total:2,success:2,matchedby:"G",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"a9f26614d4d411de195580ea17db2ec5",url:"ROKU",title:"",channel:"",region:"use-1",segment:"sp_movies_and_television,sp_drama,sp_movie_fans_silverpush_vl",total:2,success:2,matchedby:"G",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"iris_74d19434f5e9de79",url:"48630",title:"",channel:"Fawesome - Free Movies and TV Shows",region:"use-1",segment:"sp_movies_and_television,sp_crime_and_mystery,sp_drama,sp_movie_fans_silverpush_vl",total:18,success:18,matchedby:"CG",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"2_97cd4355b5959fd80cd95bf133b883d2",url:"vizio.tubitv",title:"",channel:"",region:"use-1",segment:"sp_movies_and_television,sp_horror,sp_fantasy,sp_movie_fans_silverpush_vl",total:15,success:15,matchedby:"G",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"iris_daa6a6892ca97532",url:"com.cbs.ott",title:"",channel:"",region:"use-1",segment:"sp_movies_and_television,sp_reality_tv_t2,sp_highenergyoccasions,sp_movie_fans_silverpush_vl,sp_millennials_silverpush_vl",total:4,success:4,matchedby:"G",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"10_de0b3942a7911f2c5f2f851663f6387d",url:"com.philo.philo.google",title:"",channel:"vh1",region:"use-1",segment:"sp_brand_safe,sp_pg_brandsafety,sp_brandsafe_med_low_no_vl,sp_brand_safe_silverpush",total:8,success:8,matchedby:"R",isbrandsafe:1,date:"2025-11-02"},
    {contentid:"4ba262a45b2d54059b7c10edb6aebba3",url:"151908",title:"vod",channel:"",region:"use-1",segment:"sp_movies_and_television,sp_cooking_and_food,sp_documentary,sp_brand_safe,sp_curious_minds_silver_vl",total:1,success:1,matchedby:"C_ROKU",isbrandsafe:1,date:"2025-11-02"},
    {contentid:"10_faf6e6a382a5a389ccde6448393dffd9",url:"196460",title:"",channel:"amcthrillers",region:"use-1",segment:"sp_movies_and_television,sp_science_fiction,sp_action_and_adventure_t2,sp_thriller,sp_movie_fans_silverpush_vl",total:3,success:3,matchedby:"G",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"5e3c8cb486e96850bcc49e7a_5e4f27539f21a9001a3664a7",url:"tv.pluto.android",title:"",channel:"",region:"use-1",segment:"sp_movies_and_television,sp_action_and_adventure_t2,sp_movies,sp_movie_fans_silverpush_vl,sp_event_seekers_silverpush_vl",total:14,success:14,matchedby:"C_PLUTO",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"690406b5b7382c6fd0078c18",url:"com.plexapp.android",title:"",channel:"",region:"use-1",segment:"",total:2,success:0,matchedby:"",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"SH046705430000",url:"420455839",title:"",channel:"spectrum news",region:"use-1",segment:"sp_movies_and_television,sp_news_and_talk_shows,sp_news_viewers_silverpush_vl",total:3,success:3,matchedby:"CG",isbrandsafe:0,date:"2025-11-02"},
    {contentid:"4_bed9f86de467dc261d350f9cbe32482e",url:"151908",title:"",channel:"FilmRise Classic TV",region:"use-1",segment:"sp_brand_safe,sp_pg_brandsafety,sp_brandsafe_med_low_no_vl,sp_brand_safe_silverpush",total:5,success:5,matchedby:"R",isbrandsafe:1,date:"2025-11-02"},
    {contentid:"68fd6ce6c4d87db7f4373012",url:"B004Y1WCDE",title:"",channel:"Wendy Williams",region:"use-1",segment:"",total:1,success:0,matchedby:"",isbrandsafe:0,date:"2025-11-02"}
  ];

  const PLATFORM_URL_MAP = [
    {platform:"Crave",url:"B0789RWQK1"},{platform:"Crave",url:"ca.bellmedia.cravetv"},{platform:"Crave",url:"942568279"},{platform:"Crave",url:"650682"},{platform:"Crave",url:"3201506003488"},{platform:"Crave",url:"B07DPRZ7NH"},{platform:"Crave",url:"ca.ctv.ctvgo"},{platform:"Crave",url:"9nx1x6th2grt"},{platform:"Crave",url:"461749483"},{platform:"Crave",url:"3201506003486"},{platform:"Crave",url:"B09C929HZP"},{platform:"Crave",url:"com.vmediagroup.noovo"},{platform:"Crave",url:"9ndjsb7lp64d"},{platform:"Crave",url:"1476103084"},{platform:"Crave",url:"675097"},{platform:"Crave",url:"B0BJMLLVJ6"},
    {platform:"Fawesome",url:"120421"},{platform:"Fawesome",url:"B08WH4GB19"},{platform:"Fawesome",url:"B07PK46HNQ"},{platform:"Fawesome",url:"B0C624FGDD"},{platform:"Fawesome",url:"B07PLKTCVK"},{platform:"Fawesome",url:"B07MV91SZF"},{platform:"Fawesome",url:"B07W9JYQ53"},{platform:"Fawesome",url:"B08P5D6KS2"},{platform:"Fawesome",url:"77025"},{platform:"Fawesome",url:"619734"},{platform:"Fawesome",url:"111266"},{platform:"Fawesome",url:"B0BWF8Z1Y7"},{platform:"Fawesome",url:"B0CJJLXX8M"},{platform:"Fawesome",url:"B07W4GZFVN"},{platform:"Fawesome",url:"57896"},{platform:"Fawesome",url:"40031"},{platform:"Fawesome",url:"B07WLKRYC3"},{platform:"Fawesome",url:"96322"},{platform:"Fawesome",url:"B07WD2JF8S"},{platform:"Fawesome",url:"93243"},{platform:"Fawesome",url:"B08WJ2KD5V"},{platform:"Fawesome",url:"B08ZNMWRW7"},{platform:"Fawesome",url:"B00IWJ03H6"},{platform:"Fawesome",url:"1069420445"},{platform:"Fawesome",url:"75081"},{platform:"Fawesome",url:"688845"},{platform:"Fawesome",url:"51213"},{platform:"Fawesome",url:"B07W8FXWKK"},{platform:"Fawesome",url:"B00P2FQ9EY"},{platform:"Fawesome",url:"1063891742"},{platform:"Fawesome",url:"B0963TS8H7"},{platform:"Fawesome",url:"629930"},{platform:"Fawesome",url:"B00OYUM5FK"},{platform:"Fawesome",url:"600853"},{platform:"Fawesome",url:"B08P4C6L5W"},{platform:"Fawesome",url:"75080"},{platform:"Fawesome",url:"30966"},{platform:"Fawesome",url:"630734"},{platform:"Fawesome",url:"B08PFF99F2"},{platform:"Fawesome",url:"90751"},{platform:"Fawesome",url:"72891"},{platform:"Fawesome",url:"101042"},{platform:"Fawesome",url:"51209"},{platform:"Fawesome",url:"51207"},{platform:"Fawesome",url:"B08WHGQRJ8"},{platform:"Fawesome",url:"761972"},{platform:"Fawesome",url:"B076X8FKXP"},{platform:"Fawesome",url:"73347"},{platform:"Fawesome",url:"B014D6RXLU"},{platform:"Fawesome",url:"600844"},{platform:"Fawesome",url:"B07MV2NFRT"},{platform:"Fawesome",url:"524013816"},{platform:"Fawesome",url:"600843"},{platform:"Fawesome",url:"36949"},{platform:"Fawesome",url:"46267"},{platform:"Fawesome",url:"782375"},{platform:"Fawesome",url:"B08V5J5QQH"},{platform:"Fawesome",url:"B07TMNWPBP"},{platform:"Fawesome",url:"B095KSRMM1"},{platform:"Fawesome",url:"95420"},{platform:"Fawesome",url:"B07NZZW6LP"},{platform:"Fawesome",url:"B07W9K238B"},{platform:"Fawesome",url:"48626"},{platform:"Fawesome",url:"48103"},{platform:"Fawesome",url:"B0C2J7LP38"},{platform:"Fawesome",url:"83507"},{platform:"Fawesome",url:"46560"},{platform:"Fawesome",url:"60733"},{platform:"Fawesome",url:"60383"},{platform:"Fawesome",url:"57895"},{platform:"Fawesome",url:"51208"},{platform:"Fawesome",url:"51432"},{platform:"Fawesome",url:"80489"},{platform:"Fawesome",url:"B0C622XVQZ"},{platform:"Fawesome",url:"77007"},{platform:"Fawesome",url:"121363"},{platform:"Fawesome",url:"B0DPLDD6BQ"},{platform:"Fawesome",url:"42727"},{platform:"Fawesome",url:"600757"},{platform:"Fawesome",url:"458741"},{platform:"Fawesome",url:"57901"},{platform:"Fawesome",url:"85344"},{platform:"Fawesome",url:"38097"},{platform:"Fawesome",url:"B07MV261QJ"},{platform:"Fawesome",url:"608333"},{platform:"Fawesome",url:"34532"},{platform:"Fawesome",url:"773609"},{platform:"Fawesome",url:"B00P2FPV0C"},{platform:"Fawesome",url:"619716"},{platform:"Fawesome",url:"G20239015429"},{platform:"Fawesome",url:"38095"},{platform:"Fawesome",url:"621441"},{platform:"Fawesome",url:"B00G1YIN5S"},{platform:"Fawesome",url:"B07PK88DJJ"},{platform:"Fawesome",url:"B0C2H7GZ2V"},{platform:"Fawesome",url:"B07MV91F6J"},{platform:"Fawesome",url:"93242"},{platform:"Fawesome",url:"649726"},{platform:"Fawesome",url:"84461"},{platform:"Fawesome",url:"B08P5F3HP5"},{platform:"Fawesome",url:"38096"},{platform:"Fawesome",url:"121374"},{platform:"Fawesome",url:"48628"},{platform:"Fawesome",url:"B0DB6HYC3B"},{platform:"Fawesome",url:"com.future.moviesByFawesomeAndroidTV"},{platform:"Fawesome",url:"B00G23GRPQ"},{platform:"Fawesome",url:"623144"},{platform:"Fawesome",url:"713152"},{platform:"Fawesome",url:"95421"},{platform:"Fawesome",url:"85346"},{platform:"Fawesome",url:"623143"},{platform:"Fawesome",url:"51433"},{platform:"Fawesome",url:"b07wlkryc3"},{platform:"Fawesome",url:"b08znmwrw7"},{platform:"Fawesome",url:"com.roku.spaintravelbyfawesome.tv"},{platform:"Fawesome",url:"b0963ts8h7"},{platform:"Fawesome",url:"b07wd2jf8s"},{platform:"Fawesome",url:"DramaMovies"},{platform:"Fawesome",url:"com.future.FamilyMoviesbyFawesometv"},{platform:"Fawesome",url:"b08pff99f2"},{platform:"Fawesome",url:"b07pk46hnq"},{platform:"Fawesome",url:"b014d6rxlu"},{platform:"Fawesome",url:"b08v5j5qqh"},{platform:"Fawesome",url:"b07plktcvk"},{platform:"Fawesome",url:"b095ksrmm1"},{platform:"Fawesome",url:"tv.ifood"},{platform:"Fawesome",url:"b07nzzw6lp"},{platform:"Fawesome",url:"b0bwf8z1y7"},{platform:"Fawesome",url:"ThrillerMovies"},{platform:"Fawesome",url:"b08p4c6l5w"},{platform:"Fawesome",url:"com.roku.mexicotravelbytripsmart.tv"},{platform:"Fawesome",url:"tv.moviesbyfawesome"},{platform:"Fawesome",url:"b08wh4gb19"},{platform:"Fawesome",url:"ActionMovies"},{platform:"Fawesome",url:"b07mv2nfrt"},{platform:"Fawesome",url:"firetv.fawesome.tv"},{platform:"Fawesome",url:"lg.Fawesome"},{platform:"Fawesome",url:"b08wj2kd5v"},{platform:"Fawesome",url:"com.future.moviesbyfawesomeandroidtv"},{platform:"Fawesome",url:"b07w9jyq53"},{platform:"Fawesome",url:"b07mv261qj"},{platform:"Fawesome",url:"b08p5d6ks2"},{platform:"Fawesome",url:"b076x8fkxp"},{platform:"Fawesome",url:"b08p5f3hp5"},{platform:"Fawesome",url:"48630"},{platform:"Fawesome",url:"b07w4gzfvn"},
    {platform:"Fubo",url:"43465"},{platform:"Fubo",url:"905401434"},{platform:"Fubo",url:"B019DCHDZK"},{platform:"Fubo",url:"G19068012619"},{platform:"Fubo",url:"fubo.firetv.screen"},{platform:"Fubo",url:"tv.fubo"},{platform:"Fubo",url:"vizio.own"},{platform:"Fubo",url:"com.fubotv.roku.investigationdiscovery"},{platform:"Fubo",url:"5030"},{platform:"Fubo",url:"com.fubotv.roku.fubosportsnetwork"},{platform:"Fubo",url:"com.fubo.firetv.screen"},{platform:"Fubo",url:"com.fubotv.roku.comedycentral"},{platform:"Fubo",url:"com.fubotv.firetv.investigationdiscovery"},{platform:"Fubo",url:"com.tubitv"},{platform:"Fubo",url:"vizio.fubo"},{platform:"Fubo",url:"b019dchdzk"},{platform:"Fubo",url:"com.fubotv.ctv.roku.pop"},{platform:"Fubo",url:"https://channelstore.roku.com/details/43465/fubotv"},{platform:"Fubo",url:"roku.popcornflix"},{platform:"Fubo",url:"tv.fubo.mobile"},{platform:"Fubo",url:"vizio.travel"},{platform:"Fubo",url:"com.fubotv.vix"},{platform:"Fubo",url:"com.fubotv.roku.hgtv"},{platform:"Fubo",url:"com.fubotv.roku.tlc"},{platform:"Fubo",url:"com.fubotv.roku.foodnetwork"},{platform:"Fubo",url:"com.fubotv.ctv.roku.bet"},{platform:"Fubo",url:"vizio.fubotv"},{platform:"Fubo",url:"com.fubotv.roku.espn"},{platform:"Fubo",url:"com.fubotv.ctv.roku.tastemade"},{platform:"Fubo",url:"IFC"},{platform:"Fubo",url:"com.fubotv.roku.msnbc"},{platform:"Fubo",url:"com.fubotv.roku.foxsports1"},{platform:"Fubo",url:"com.fubotv.ctv.roku.paramount.network"},
    {platform:"JoyN",url:"B00XAF0UH0"},{platform:"JoyN",url:"at.zappn"},{platform:"JoyN",url:"B07KWXB6V3"},{platform:"JoyN",url:"826510222"},{platform:"JoyN",url:"de.prosiebensat1digital.seventv"}
  ];

  /* ================================================================
     SECTION 2 — HELPERS
  ================================================================ */
  const _platformMap = new Map(PLATFORM_URL_MAP.map(r => [r.url.toLowerCase(), r.platform]));

  function getPlatformName(url) {
    return _platformMap.get((url || '').toLowerCase()) || url || '—';
  }

  function getMatchType(matchedby) {
    if (!matchedby) return 'unmatched';
    if (matchedby.startsWith('C_')) return 'deep';
    return 'shallow';
  }

  function getMaxDate(data) {
    return data.reduce((max, r) => r.date > max ? r.date : max, '0000-00-00');
  }

  function addDays(dateStr, days) {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function filterByDate(data, filter) {
    if (filter === 'all') return data;
    const maxDate = getMaxDate(data);
    const cutoff = filter === 'today' ? maxDate
      : filter === '7d'  ? addDays(maxDate, -6)
      : addDays(maxDate, -29);
    return data.filter(r => r.date >= cutoff);
  }

  function fmt(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(n);
  }

  function pct(a, b) { return b === 0 ? 0 : Math.round((a / b) * 100); }

  function destroyChart(key) {
    if (charts[key]) { charts[key].destroy(); delete charts[key]; }
  }

  /* ================================================================
     SECTION 3 — STATE
  ================================================================ */
  const state = {
    dateFilter: 'all',
    locationFilter: 'all',
    diagPlatform: 'all',
    diagChannel: 'all',
    diagStatus: 'all',
    diagBrand: 'all',
    sortCol: 'failureRate',
    sortDir: 'desc'
  };

  const charts = {};

  /* ================================================================
     SECTION 4 — DATA FILTERING
  ================================================================ */
  function getBaseData() {
    let d = filterByDate(CTV_STATS, state.dateFilter);
    if (state.locationFilter !== 'all') d = d.filter(r => r.region === state.locationFilter);
    return d;
  }

  function getDiagnoseData() {
    let d = getBaseData();
    if (state.diagPlatform !== 'all') d = d.filter(r => getPlatformName(r.url) === state.diagPlatform);
    if (state.diagChannel  !== 'all') d = d.filter(r => r.channel === state.diagChannel);
    if (state.diagStatus === 'failed')  d = d.filter(r => r.success === 0);
    if (state.diagStatus === 'success') d = d.filter(r => r.success > 0);
    if (state.diagBrand !== 'all') d = d.filter(r => String(r.isbrandsafe) === state.diagBrand);
    return d;
  }

  /* ================================================================
     SECTION 5 — POPULATE FILTER DROPDOWNS
  ================================================================ */
  function populateLocationFilter(data) {
    const sel = document.getElementById('filter-location');
    const regions = [...new Set(data.map(r => r.region).filter(Boolean))].sort();
    regions.forEach(reg => {
      const opt = document.createElement('option');
      opt.value = reg; opt.textContent = reg;
      sel.appendChild(opt);
    });
  }

  function populateDiagnoseFilters(data) {
    const platforms = [...new Set(data.map(r => getPlatformName(r.url)))].sort();
    const channels  = [...new Set(data.map(r => r.channel).filter(Boolean))].sort();
    const pSel = document.getElementById('diag-platform');
    const cSel = document.getElementById('diag-channel');
    pSel.innerHTML = '<option value="all">All Platforms</option>';
    cSel.innerHTML = '<option value="all">All Channels</option>';
    platforms.forEach(p => { const o = document.createElement('option'); o.value = p; o.textContent = p; pSel.appendChild(o); });
    channels.forEach(c  => { const o = document.createElement('option'); o.value = c; o.textContent = c; cSel.appendChild(o); });
  }

  /* ================================================================
     SECTION 6 — OVERVIEW: KPI CARDS
  ================================================================ */
  function renderKPICards(data) {
    const totalIDs    = data.length;
    const totalReqs   = data.reduce((s, r) => s + r.total, 0);
    const successRows = data.filter(r => r.success > 0).length;
    const failedRows  = data.filter(r => r.success === 0).length;
    const brandSafe   = data.filter(r => r.isbrandsafe === 1).length;

    const successRate = pct(successRows, totalIDs);
    const brandPct    = pct(brandSafe, totalIDs);

    const cards = [
      { label: 'Total Content IDs', value: fmt(totalIDs), cls: '' },
      { label: 'Total Requests',    value: fmt(totalReqs), cls: '' },
      { label: 'Success Rate',      value: successRate + '%', cls: 'green' },
      { label: 'Failed Content IDs',value: fmt(failedRows), cls: failedRows > 0 ? 'red' : 'green' },
      { label: 'Brand Safe',        value: brandPct + '%', cls: 'green' }
    ];

    document.getElementById('kpi-row').innerHTML = cards.map(c =>
      `<div class="kpi-card">
        <div class="kpi-card__label">${c.label}</div>
        <div class="kpi-card__value ${c.cls}">${c.value}</div>
      </div>`
    ).join('');
  }

  /* ================================================================
     SECTION 7 — OVERVIEW: CHARTS ROW 2
  ================================================================ */
  function renderFailuresByPlatform(data) {
    const failed = data.filter(r => r.success === 0);
    const counts = {};
    failed.forEach(r => {
      const p = getPlatformName(r.url);
      counts[p] = (counts[p] || 0) + 1;
    });
    const sorted = Object.entries(counts).sort((a,b) => b[1]-a[1]).slice(0,10);
    destroyChart('failPlatform');
    const ctx = document.getElementById('chart-failures-platform').getContext('2d');
    charts.failPlatform = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: sorted.map(e => e[0]),
        datasets: [{ label: 'Failed Content IDs', data: sorted.map(e => e[1]),
          backgroundColor: '#EF4444', borderRadius: 4 }]
      },
      options: {
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: { x: { grid: { color: '#F1F5F9' } }, y: { grid: { display: false } } }
      }
    });
  }

  function renderMatchedByBreakdown(data) {
    const deep     = data.filter(r => getMatchType(r.matchedby) === 'deep').length;
    const shallow  = data.filter(r => getMatchType(r.matchedby) === 'shallow').length;
    const unmatched= data.filter(r => getMatchType(r.matchedby) === 'unmatched').length;
    destroyChart('matchedBy');
    const ctx = document.getElementById('chart-matchedby').getContext('2d');
    charts.matchedBy = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Deep Match (C_*)', 'Shallow Match', 'Unmatched'],
        datasets: [{ data: [deep, shallow, unmatched],
          backgroundColor: ['#22C55E', '#F59E0B', '#EF4444'],
          borderWidth: 2, borderColor: '#fff' }]
      },
      options: {
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 12 } } },
          tooltip: {
            callbacks: {
              label: ctx => {
                const total = ctx.dataset.data.reduce((a,b)=>a+b,0);
                return ` ${ctx.label}: ${ctx.parsed} (${pct(ctx.parsed,total)}%)`;
              }
            }
          }
        }
      }
    });
  }

  /* ================================================================
     SECTION 8 — OVERVIEW: CHARTS ROW 3
  ================================================================ */
  function renderTopFailingChannels(data) {
    const failed = data.filter(r => r.success === 0 && r.channel);
    const counts = {};
    failed.forEach(r => { counts[r.channel] = (counts[r.channel] || 0) + 1; });
    const sorted = Object.entries(counts).sort((a,b) => b[1]-a[1]).slice(0,10);
    destroyChart('failChannels');
    const ctx = document.getElementById('chart-failing-channels').getContext('2d');
    charts.failChannels = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: sorted.map(e => e[0]),
        datasets: [{ label: 'Failed', data: sorted.map(e => e[1]),
          backgroundColor: '#F59E0B', borderRadius: 4 }]
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { maxRotation: 30, font: { size: 11 } } },
          y: { grid: { color: '#F1F5F9' } }
        }
      }
    });
  }

  function renderSegmentCoverage(data) {
    const withSeg    = data.filter(r => r.segment && r.segment.trim()).length;
    const withoutSeg = data.length - withSeg;
    destroyChart('segCoverage');
    const ctx = document.getElementById('chart-segment-coverage').getContext('2d');
    charts.segCoverage = new Chart(ctx, {
      type: 'pie',
      data: {
        labels: ['Has Segments', 'No Segments'],
        datasets: [{ data: [withSeg, withoutSeg],
          backgroundColor: ['#22C55E', '#E2E8F0'], borderWidth: 2, borderColor: '#fff' }]
      },
      options: {
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 12 } } },
          tooltip: {
            callbacks: {
              label: ctx => {
                const total = ctx.dataset.data.reduce((a,b)=>a+b,0);
                return ` ${ctx.label}: ${ctx.parsed} (${pct(ctx.parsed,total)}%)`;
              }
            }
          }
        }
      }
    });
  }

  /* ================================================================
     SECTION 9 — OVERVIEW: MATCH DEPTH (ROW 4)
  ================================================================ */
  function renderMatchDepthKPIs(data) {
    const total     = data.length || 1;
    const deep      = data.filter(r => getMatchType(r.matchedby) === 'deep').length;
    const shallow   = data.filter(r => getMatchType(r.matchedby) === 'shallow').length;
    const unmatched = data.filter(r => getMatchType(r.matchedby) === 'unmatched').length;
    const cards = [
      { label: 'Deep Match %',    value: pct(deep, total) + '%',      cls: 'green' },
      { label: 'Shallow Match %', value: pct(shallow, total) + '%',   cls: '' },
      { label: 'Unmatched %',     value: pct(unmatched, total) + '%', cls: unmatched > 0 ? 'red' : 'green' }
    ];
    document.getElementById('match-depth-kpis').innerHTML = cards.map(c =>
      `<div class="kpi-card">
        <div class="kpi-card__label">${c.label}</div>
        <div class="kpi-card__value ${c.cls}">${c.value}</div>
      </div>`
    ).join('');
  }

  function renderMatchDepthByPlatform(data) {
    const byPlatform = {};
    data.forEach(r => {
      const p = getPlatformName(r.url);
      if (!byPlatform[p]) byPlatform[p] = { deep: 0, shallow: 0, unmatched: 0, total: 0 };
      byPlatform[p][getMatchType(r.matchedby)]++;
      byPlatform[p].total++;
    });
    const sorted = Object.entries(byPlatform).sort((a,b) => b[1].total - a[1].total).slice(0,10);
    const labels   = sorted.map(e => e[0]);
    const deepD    = sorted.map(e => e[1].deep);
    const shallowD = sorted.map(e => e[1].shallow);
    const unmatchD = sorted.map(e => e[1].unmatched);
    destroyChart('matchDepth');
    const ctx = document.getElementById('chart-match-depth-platform').getContext('2d');
    charts.matchDepth = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Deep (C_*)',  data: deepD,    backgroundColor: '#22C55E', borderRadius: 2 },
          { label: 'Shallow',     data: shallowD, backgroundColor: '#F59E0B', borderRadius: 2 },
          { label: 'Unmatched',   data: unmatchD, backgroundColor: '#EF4444', borderRadius: 2 }
        ]
      },
      options: {
        indexAxis: 'y',
        scales: {
          x: { stacked: true, grid: { color: '#F1F5F9' } },
          y: { stacked: true, grid: { display: false } }
        },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 12 } } } }
      }
    });
  }

  /* ================================================================
     SECTION 10 — DIAGNOSE: RCA TABLE
  ================================================================ */
  function renderRCATable(data) {
    const failed = data.filter(r => r.success === 0);
    if (!failed.length) {
      document.getElementById('rca-table').innerHTML = '<div class="empty-state">No failures in current filter.</div>';
      return;
    }

    const totalFailedReqs = failed.reduce((s, r) => s + r.total, 0);

    const groups = {
      BOTH:        failed.filter(r => !r.segment.trim() && !r.matchedby),
      UNMATCHED:   failed.filter(r =>  r.segment.trim() && !r.matchedby),
      NO_SEGMENTS: failed.filter(r => !r.segment.trim() &&  r.matchedby === '' && r.segment === '')
    };
    // recalculate: UNMATCHED = no matchedby regardless of segment (minus BOTH)
    // BOTH = no segment AND no matchedby
    // NO_SEGMENTS = has matchedby somehow but no segment (edge case) — in practice all failed have no matchedby
    // Simpler: group all failed by root cause combination
    const rcaMap = {};
    failed.forEach(r => {
      const noSeg  = !r.segment || !r.segment.trim();
      const noMatch= !r.matchedby;
      const key = (noSeg && noMatch) ? 'BOTH' : noMatch ? 'UNMATCHED' : noSeg ? 'NO SEGMENTS' : 'OTHER';
      if (!rcaMap[key]) rcaMap[key] = { count: 0, requests: 0 };
      rcaMap[key].count++;
      rcaMap[key].requests += r.total;
    });

    const actions = {
      'BOTH':        'Enrich segment data AND add content IDs to matcher DB — highest priority',
      'UNMATCHED':   'Add these content IDs to the matcher database (segments exist)',
      'NO SEGMENTS': 'Enrich segment/targeting data for these content IDs',
      'OTHER':       'Investigate individually'
    };

    const rows = Object.entries(rcaMap)
      .sort((a,b) => b[1].requests - a[1].requests)
      .map(([cause, { count, requests }], i) => ({
        rank: i + 1, cause, count, requests,
        sharePct: pct(requests, totalFailedReqs),
        action: actions[cause] || 'Investigate'
      }));

    const badgeCls = { BOTH: 'badge--danger', UNMATCHED: 'badge--warn', 'NO SEGMENTS': 'badge--blue', OTHER: 'badge--gray' };

    document.getElementById('rca-table').innerHTML = `
      <table>
        <thead><tr>
          <th>#</th><th>Root Cause</th><th>Failed IDs</th>
          <th>Requests at Risk</th><th>% of Failures</th><th>Recommended Action</th>
        </tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td><strong>${r.rank}</strong></td>
              <td><span class="badge ${badgeCls[r.cause] || 'badge--gray'}">${r.cause}</span></td>
              <td class="danger-val">${r.count}</td>
              <td class="danger-val">${fmt(r.requests)}</td>
              <td>${r.sharePct}%</td>
              <td style="color:var(--text-secondary);font-size:12px">${r.action}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  /* ================================================================
     SECTION 11 — DIAGNOSE: MAIN TABLE
  ================================================================ */
  function getRootCauseBadges(row) {
    const badges = [];
    if (!row.segment || !row.segment.trim()) badges.push('<span class="badge badge--blue">NO SEGMENTS</span>');
    if (!row.matchedby) badges.push('<span class="badge badge--danger">UNMATCHED</span>');
    return badges.join(' ') || '—';
  }

  function getFailureRateColor(rate) {
    if (rate >= 1) return '#EF4444';
    if (rate > 0)  return '#F59E0B';
    return '#22C55E';
  }

  function renderDiagnoseTable(data) {
    let sorted = [...data];
    const col = state.sortCol;
    const dir = state.sortDir === 'asc' ? 1 : -1;

    const colMap = {
      contentid:   r => r.contentid,
      platform:    r => getPlatformName(r.url),
      channel:     r => r.channel,
      total:       r => r.total,
      success:     r => r.success,
      failureRate: r => r.total > 0 ? (r.total - r.success) / r.total : 0,
      matchedby:   r => r.matchedby,
      isbrandsafe: r => r.isbrandsafe
    };

    if (colMap[col]) sorted.sort((a,b) => {
      const va = colMap[col](a), vb = colMap[col](b);
      return va < vb ? -dir : va > vb ? dir : 0;
    });

    const cols = [
      { key:'contentid',   label:'Content ID' },
      { key:'platform',    label:'Platform' },
      { key:'channel',     label:'Channel' },
      { key:'total',       label:'Total' },
      { key:'success',     label:'Success' },
      { key:'failureRate', label:'Failure Rate' },
      { key:'matchedby',   label:'Matched By' },
      { key:'isbrandsafe', label:'Brand Safe' },
      { key:'rootcause',   label:'Root Cause' }
    ];

    const ths = cols.map(c => {
      const sortable = c.key !== 'rootcause';
      const cls = [sortable ? 'sortable' : '', state.sortCol === c.key ? 'sort-' + state.sortDir : ''].filter(Boolean).join(' ');
      return `<th class="${cls}" ${sortable ? `data-col="${c.key}"` : ''}>${c.label}<span class="sort-icon"></span></th>`;
    }).join('');

    const trs = sorted.map(r => {
      const rate = r.total > 0 ? (r.total - r.success) / r.total : 0;
      const color = getFailureRateColor(rate);
      return `<tr>
        <td><div class="content-id" title="${r.contentid}">${r.contentid}</div></td>
        <td>${getPlatformName(r.url)}</td>
        <td>${r.channel || '—'}</td>
        <td>${r.total}</td>
        <td class="${r.success > 0 ? 'success-val' : 'danger-val'}">${r.success}</td>
        <td>
          <div class="rate-bar-wrap">
            <div class="rate-bar"><div class="rate-bar__fill" style="width:${Math.round(rate*100)}%;background:${color}"></div></div>
            <span style="color:${color};font-weight:600;font-size:12px;min-width:34px">${Math.round(rate*100)}%</span>
          </div>
        </td>
        <td>${r.matchedby || '—'}</td>
        <td>${r.isbrandsafe ? '<span class="badge badge--success">Yes</span>' : '<span class="badge badge--gray">No</span>'}</td>
        <td>${getRootCauseBadges(r)}</td>
      </tr>`;
    }).join('');

    document.getElementById('diagnose-table-wrap').innerHTML =
      `<div class="table-wrap"><table><thead><tr>${ths}</tr></thead><tbody>${trs || '<tr><td colspan="9"><div class="empty-state">No data</div></td></tr>'}</tbody></table></div>`;

    document.querySelectorAll('thead th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const c = th.dataset.col;
        if (state.sortCol === c) {
          state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortCol = c;
          state.sortDir = 'desc';
        }
        renderDiagnoseTable(getDiagnoseData());
      });
    });
  }

  /* ================================================================
     SECTION 12 — RENDER ORCHESTRATION
  ================================================================ */
  function renderOverview(data) {
    renderKPICards(data);
    renderFailuresByPlatform(data);
    renderMatchedByBreakdown(data);
    renderTopFailingChannels(data);
    renderSegmentCoverage(data);
    renderMatchDepthKPIs(data);
    renderMatchDepthByPlatform(data);
  }

  function renderDiagnose() {
    const data = getDiagnoseData();
    renderRCATable(data);
    renderDiagnoseTable(data);
  }

  function render() {
    const base = getBaseData();
    renderOverview(base);
    renderDiagnose();
  }

  /* ================================================================
     SECTION 13 — EVENT WIRING + INIT
  ================================================================ */
  function init() {
    populateLocationFilter(CTV_STATS);
    populateDiagnoseFilters(CTV_STATS);

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      });
    });

    // Global filters
    document.getElementById('filter-date').addEventListener('change', e => {
      state.dateFilter = e.target.value;
      populateDiagnoseFilters(getBaseData());
      render();
    });
    document.getElementById('filter-location').addEventListener('change', e => {
      state.locationFilter = e.target.value;
      populateDiagnoseFilters(getBaseData());
      render();
    });

    // Diagnose filters
    document.getElementById('diag-platform').addEventListener('change', e => { state.diagPlatform = e.target.value; renderDiagnose(); });
    document.getElementById('diag-channel').addEventListener('change',  e => { state.diagChannel  = e.target.value; renderDiagnose(); });
    document.getElementById('diag-status').addEventListener('change',   e => { state.diagStatus   = e.target.value; renderDiagnose(); });
    document.getElementById('diag-brand').addEventListener('change',    e => { state.diagBrand    = e.target.value; renderDiagnose(); });

    render();
  }

  init();
  </script>
</body>
</html>
```

- [ ] **Step 2: Open in browser and verify**

Open `index.html` in Chrome/Safari. Check:
- Header shows "Silverpush · CTV" with green dot logo
- Two global filter dropdowns visible (Date, Location)
- Two tabs: Overview and Diagnose
- Overview tab shows 5 KPI cards with data
- 4 charts render (Failures by Platform, Matched By Breakdown, Top Failing Channels, Segment Coverage)
- Match Depth section shows 3 KPI cards + 1 stacked bar chart
- Clicking Diagnose tab shows filters, RCA table, and sortable content table

Expected console errors: none. If Chart.js fails to load, check internet connection (CDN dependency).

- [ ] **Step 3: Verify console assertions**

Open browser console and run:
```js
// Platform lookup
console.assert(getPlatformName('B076X8FKXP') === 'Fawesome', 'Platform lookup');
console.assert(getPlatformName('48630') === 'Fawesome', 'Fawesome 48630');
console.assert(getPlatformName('unknown-xyz') === 'unknown-xyz', 'Fallback to raw URL');

// Match type
console.assert(getMatchType('C_IRIS') === 'deep', 'C_IRIS is deep');
console.assert(getMatchType('G') === 'shallow', 'G is shallow');
console.assert(getMatchType('') === 'unmatched', 'empty is unmatched');

// Failure count (from raw data: rows with success===0)
const failed = CTV_STATS.filter(r => r.success === 0);
console.log('Failed rows:', failed.length); // expect ~14
console.log('Failed contentids:', failed.map(r => r.contentid));

// KPI math
const successRate = Math.round(CTV_STATS.filter(r => r.success > 0).length / CTV_STATS.length * 100);
console.log('Success rate:', successRate + '%');
```

- [ ] **Step 4: Verify table sorting**

In the Diagnose tab:
1. Click "Failure Rate" column header — rows should sort descending (failed rows first)
2. Click again — sort ascending (successful rows first)
3. Click "Total" — rows sort by total requests

- [ ] **Step 5: Verify global filters affect all panels**

1. Change Date to "Today" — all charts and KPIs update (with mock data all dated 2025-11-02, "Today" treats max date as today so all data shows)
2. Change Location to "use-1" — data remains the same (all rows are use-1)
3. Change Location to "All" — data remains the same

---

## Self-Review Checklist

After completing Task 1, verify against spec:

| Spec requirement | Implemented |
|---|---|
| Single shareable HTML file | ✓ |
| Global Date filter (Today/7d/30d) | ✓ |
| Global Location filter from region column | ✓ |
| Overview: 5 KPI cards with correct metrics | ✓ |
| Success Rate = count(success>0) / count(rows) | ✓ |
| Failed = success=0 strictly | ✓ |
| Failures by Platform (top 10, resolved names) | ✓ |
| Matched By Breakdown (Deep/Shallow/Unmatched) | ✓ |
| Top Failing Channels | ✓ |
| Segment Coverage pie | ✓ |
| Match Depth KPI strip (3 cards) | ✓ |
| Match Depth by Platform stacked bar (top 10) | ✓ |
| Diagnose tab-local filters | ✓ |
| RCA table sorted by Requests at Risk | ✓ |
| Content table: sortable, root cause badges | ✓ |
| NO SEGMENTS + UNMATCHED badges only | ✓ |
| Failure Rate color coding | ✓ |
| Silverpush design system (dark table header, green primary) | ✓ |
| platform_url_map integrated + fallback to raw URL | ✓ |
