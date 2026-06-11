/**
 * In-memory cache of all content IDs from platform-named tables in dpttd.
 * Built once at startup with a single UNION ALL query across all 11 tables.
 *
 * globalMap:   Map<contentId, platformName>  (first-platform-wins)
 * perPlatform: Map<platformName, Set<contentId>>  (for per-platform counts)
 */
const { queryClickHouse } = require('../db/clickhouse');

const PLATFORM_TABLES = [
  { table: 'roku_data_v2',      name: 'Roku'     },
  { table: 'tubi_full_data_v2', name: 'Tubi'     },
  { table: 'pluto_data_v2',     name: 'Pluto'    },
  { table: 'crave_data',        name: 'Crave'    },
  { table: 'philo_data_v2',     name: 'Philo'    },
  { table: 'fawesome_data_v2',  name: 'Fawesome' },
  { table: 'fubo_data_v2',      name: 'Fubo'     },
  { table: 'joyn_data_v2',      name: 'Joyn'     },
  { table: 'tvmaze_data_v2',    name: 'TVmaze'   },
  { table: 'plex_data_v2',      name: 'Plex'     },
  { table: 'sbs_data_v2',       name: 'SBS'      },
];

const DB = 'dpttd';

let globalMap   = null;
let perPlatform = null;
let loading     = null;

async function buildCache() {
  console.log('[contentIdMap] Building content-ID cache via single UNION ALL query…');
  const t = Date.now();

  const unionSql = PLATFORM_TABLES
    .map(({ table, name }) => `SELECT contentid, '${name}' AS platform FROM ${table}`)
    .join('\nUNION ALL\n');

  const rows = await queryClickHouse(unionSql, DB);

  globalMap   = new Map();
  perPlatform = new Map(PLATFORM_TABLES.map(({ name }) => [name, new Set()]));

  for (const { contentid, platform } of rows) {
    if (!globalMap.has(contentid)) globalMap.set(contentid, platform);
    perPlatform.get(platform).add(contentid);
  }

  const ms = Date.now() - t;
  console.log(`[contentIdMap] Cached ${globalMap.size} distinct content IDs across ${PLATFORM_TABLES.length} tables in ${ms}ms`);
}

async function getContentIdCache() {
  if (globalMap) return { globalMap, perPlatform };
  if (!loading)  loading = buildCache().finally(() => { loading = null; });
  await loading;
  return { globalMap, perPlatform };
}

function isCacheReady() { return globalMap !== null; }

module.exports = { getContentIdCache, isCacheReady, PLATFORM_TABLES };
