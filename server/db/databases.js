/**
 * Partner → ClickHouse connection config.
 * Each partner may use a different host, database, credentials, and table name.
 */
const PARTNERS = {
  TTD: {
    host:     process.env.CH_TTD_HOST,
    user:     process.env.CH_TTD_USER,
    password: process.env.CH_TTD_PASS,
    database: process.env.CH_TTD_DB,
    table:    'ctv_stats',
    // Column name mappings (field → SQL column)
    cols: {
      contentid:  'contentid',
      url:        'url',
      total:      'total',
      matchedby:  'matchedby',
      segment:    'segment',
      title:      'title',
      series:     'series',
      season:     'season',
      episode:    'episode',
      isbrandsafe:'isbrandsafe',
      region:     'region',
      date:       'date',
      timestamp:  'timestamp',
      success:    'success',          // TTD has explicit success column
    },
    // success condition
    successCondition: (op) => op === '>'  ? 'success > 0'  : 'success = 0',
  },

  Pubmatic: {
    host:     process.env.CH_PUB_HOST,
    user:     process.env.CH_PUB_USER,
    password: process.env.CH_PUB_PASS,
    database: process.env.CH_PUB_DB,
    table:    'ctv_agg_data',
    cols: {
      contentid:  'content_id',
      url:        'appid',
      total:      'total_count',
      matchedby:  'matchedby',
      segment:    "arrayStringConcat(categories,',')",  // Array → comma string
      title:      'content_title',
      series:     'content_series',
      season:     'content_season',
      episode:    'content_episode',
      isbrandsafe:'1',              // not available — treat all as brand-safe
      region:     'region',
      date:       'process_date',   // Pubmatic uses process_date as the date column
      timestamp:  'process_date',
      success:    null,             // no success column
    },
    // success = matched (matchedby is not empty)
    successCondition: (op) => op === '>'
      ? "(matchedby != '' AND matchedby IS NOT NULL)"
      : "(matchedby = '' OR matchedby IS NULL)",
  },
};

const DEFAULT_PARTNER = 'TTD';

function getPartnerConfig(partner) {
  return PARTNERS[partner] || PARTNERS[DEFAULT_PARTNER];
}

/**
 * Returns the ClickHouse database name for a given partner.
 */
function resolveDb(partner) {
  return getPartnerConfig(partner).database;
}

module.exports = { getPartnerConfig, resolveDb, PARTNERS, DEFAULT_PARTNER };
