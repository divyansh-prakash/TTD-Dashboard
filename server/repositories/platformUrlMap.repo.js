const { queryPostgres } = require('../db/postgres');

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let cache      = null;
let cachedAt   = 0;

async function getAllPlatformUrlMappings() {
  if (cache && Date.now() - cachedAt < CACHE_TTL_MS) return cache;
  const rows = await queryPostgres('SELECT url, platform FROM platform_url_mapping');
  cache    = new Map(rows.map(r => [r.url, r.platform]));
  cachedAt = Date.now();
  console.log(`[REPO:platformUrlMap] Loaded ${cache.size} URL→platform mappings`);
  return cache;
}

async function getDistinctPlatforms() {
  console.log('[REPO:platformUrlMap] getDistinctPlatforms');
  const rows = await queryPostgres(
    "SELECT DISTINCT platform FROM platform_url_mapping WHERE platform IS NOT NULL AND platform <> '' ORDER BY platform ASC"
  );
  console.log(`[REPO:platformUrlMap] getDistinctPlatforms → ${rows.length} platforms`);
  return rows.map(r => r.platform);
}

module.exports = { getAllPlatformUrlMappings, getDistinctPlatforms };
