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
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

module.exports = { queryPostgres };
