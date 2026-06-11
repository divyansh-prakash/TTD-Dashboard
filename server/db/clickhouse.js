const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

const LOG_FILE = path.join(__dirname, '..', 'queries.log');

function logQuery(entry) {
  const line = JSON.stringify(entry) + '\n';
  fs.appendFileSync(LOG_FILE, line, 'utf8');
}

/**
 * Execute a ClickHouse SQL query.
 *
 * @param {string} sql       - The query string (without FORMAT clause)
 * @param {string} database  - ClickHouse database name
 * @param {object} [conn]    - Optional connection override { host, user, password }
 *                             Defaults to TTD credentials if omitted.
 */
async function queryClickHouse(sql, database, conn = {}) {
  // conn values come from databases.js (loaded from .env)
  const host     = conn.host     || process.env.CH_TTD_HOST;
  const user     = conn.user     || process.env.CH_TTD_USER;
  const password = conn.password || process.env.CH_TTD_PASS;

  const cleanSql = sql.trim().replace(/\s+/g, ' ');
  const preview  = cleanSql.slice(0, 120);
  console.log(`[CH] query db=${database} | ${preview}...`);
  const t = Date.now();

  logQuery({ ts: new Date().toISOString(), db: database, sql: cleanSql });

  const params = new URLSearchParams({ database, user, password });
  try {
    const response = await axios.post(
      `${host}/?${params.toString()}`,
      sql + ' FORMAT JSONEachRow',
      { headers: { 'Content-Type': 'text/plain' }, responseType: 'text', timeout: 120000 }
    );

    const raw   = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    const lines = raw.trim().split('\n').filter(Boolean);
    const ms    = Date.now() - t;
    console.log(`[CH] done rows=${lines.length} (${ms}ms)`);
    logQuery({ ts: new Date().toISOString(), db: database, rows: lines.length, ms });
    return lines.map((line) => JSON.parse(line));
  } catch (err) {
    const ms = Date.now() - t;
    console.error(`[CH] error after ${ms}ms:`, err.message);
    logQuery({ ts: new Date().toISOString(), db: database, error: err.message, ms });
    throw err;
  }
}

module.exports = { queryClickHouse };
