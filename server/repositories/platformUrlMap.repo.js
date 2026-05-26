const { queryPostgres } = require('../db/postgres');

let cache = null;

async function getAllPlatformUrlMappings() {
  if (cache) return cache;
  const rows = await queryPostgres('SELECT url, platform FROM platform_url_mapping');
  cache = new Map(rows.map(r => [r.url, r.platform]));
  console.log(`Loaded ${cache.size} URL→platform mappings from platform_url_mapping`);
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
