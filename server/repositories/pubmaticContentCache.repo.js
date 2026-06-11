/**
 * Builds an all-time Pubmatic content-ID coverage report at startup.
 *
 * Strategy: instead of pulling all Pubmatic content_ids (causes ECONNRESET on
 * large tables), we flip the direction:
 *   1. Get total distinct count via uniq() aggregate — fast, single row
 *   2. For each dpttd platform Set, send that platform's content_ids to
 *      Pubmatic CH in 50K-chunk IN-list queries and count matches.
 *
 * This is equivalent to |PubmaticIDs ∩ PlatformIDs| per platform (set
 * intersection is commutative) but avoids pulling millions of rows.
 *
 * Result is computed once at startup; every request returns it instantly.
 */
const { queryClickHouse } = require('../db/clickhouse');
const { getPartnerConfig } = require('../db/databases');
const { getContentIdCache, PLATFORM_TABLES } = require('./contentIdMap.repo');

const PUB    = getPartnerConfig('Pubmatic');
const CHUNK  = 50_000;
const sq     = s => `'${s.replace(/'/g, "\\'")}'`;

let cachedResult = null;
let loading      = null;

async function queryPub(sql) {
  return queryClickHouse(sql, 'ctv', { host: PUB.host, user: PUB.user, password: PUB.password });
}

async function buildCoverage() {
  console.log('[pubmaticContentCache] Building content-ID coverage…');
  const t = Date.now();

  // dpttd cache must be ready first
  const { perPlatform } = await getContentIdCache();

  // 1. Total distinct Pubmatic content_ids (fast aggregate — single row back)
  const [{ total }] = await queryPub(
    "SELECT uniq(content_id) AS total FROM ctv_agg_data"
  );
  const totalContentIds = Number(total);
  console.log(`[pubmaticContentCache] Total Pubmatic content IDs: ${totalContentIds}`);

  // 2. Per-platform: count matches via chunked IN-list queries to Pubmatic CH
  const platformResults = await Promise.all(
    PLATFORM_TABLES.map(async ({ name }) => {
      const ids    = [...(perPlatform.get(name) ?? [])];
      let matched  = 0;

      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        const inList = chunk.map(sq).join(',');
        const [{ cnt }] = await queryPub(
          `SELECT uniq(content_id) AS cnt FROM ctv_agg_data WHERE content_id IN (${inList})`
        );
        matched += Number(cnt);
      }

      console.log(`[pubmaticContentCache] ${name}: ${matched} matches`);
      return { platform: name, count: matched };
    })
  );

  const breakdown    = platformResults.filter(p => p.count > 0).sort((a, b) => b.count - a.count);
  const knownCount   = breakdown.reduce((s, p) => s + p.count, 0);
  const unknownCount = Math.max(0, totalContentIds - knownCount);

  const ms = Date.now() - t;
  console.log(`[pubmaticContentCache] Done — ${knownCount}/${totalContentIds} matched in ${ms}ms`);

  cachedResult = { totalContentIds, knownCount, unknownCount, breakdown };
  return cachedResult;
}

async function getPubmaticContentCoverage() {
  if (cachedResult) return cachedResult;
  if (!loading)     loading = buildCoverage().finally(() => { loading = null; });
  await loading;
  return cachedResult;
}

module.exports = { getPubmaticContentCoverage };
