const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PG_HOST || '64.225.60.113',
  port: parseInt(process.env.PG_PORT || '4132'),
  user: process.env.PG_USER || 'readonly_user',
  password: process.env.PG_PASSWORD || 'QPIh51xpGVZbjFKX7bCvPrf',
  database: process.env.PG_DATABASE || 'ttd_dmp',
  ssl: false,
  max: 10,
  idleTimeoutMillis: 30000,
});

async function queryPostgres(sql, params = []) {
  const preview = sql.trim().replace(/\s+/g, ' ').slice(0, 120);
  console.log(`[PG] query | ${preview}${params.length ? ` | params: ${JSON.stringify(params)}` : ''}`);
  const t = Date.now();
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    console.log(`[PG] done rows=${result.rows.length} (${Date.now() - t}ms)`);
    return result.rows;
  } catch (err) {
    console.error(`[PG] error after ${Date.now() - t}ms:`, err.message);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { queryPostgres };
