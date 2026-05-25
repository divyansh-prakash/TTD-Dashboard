const { queryClickHouse } = require('../db/clickhouse');

const DB = 'dpttd';

// Cached in memory after first load — this table rarely changes
let cache = null;

async function getAllAppMappings() {
  if (cache) return cache;
  const rows = await queryClickHouse('SELECT appid, app_title FROM req_app_mapping', DB);
  cache = new Map(rows.map(r => [r.appid, r.app_title]));
  console.log(`Loaded ${cache.size} app mappings from req_app_mapping`);
  return cache;
}

module.exports = { getAllAppMappings };
