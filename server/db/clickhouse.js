const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

const CH_URL = process.env.CLICKHOUSE_URL || 'http://54.81.93.97:8123';
const CH_USER = process.env.CLICKHOUSE_USERNAME || 'readonly_user';
const CH_PASS = process.env.CLICKHOUSE_PASSWORD || 'TTD486545DFherefdg';

const LOG_FILE = path.join(__dirname, '..', 'queries.log');

function logQuery(entry) {
  const line = JSON.stringify(entry) + '\n';
  fs.appendFileSync(LOG_FILE, line, 'utf8');
}

async function queryClickHouse(sql, database) {
  const cleanSql = sql.trim().replace(/\s+/g, ' ');
  const preview  = cleanSql.slice(0, 120);
  console.log(`[CH] query db=${database} | ${preview}...`);
  const t = Date.now();

  logQuery({ ts: new Date().toISOString(), db: database, sql: cleanSql });

  const params = new URLSearchParams({ database, user: CH_USER, password: CH_PASS });
  try {
    const response = await axios.post(
      `${CH_URL}/?${params.toString()}`,
      sql + ' FORMAT JSONEachRow',
      { headers: { 'Content-Type': 'text/plain' }, responseType: 'text', timeout: 120000 }
    );

    const raw = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    const lines = raw.trim().split('\n').filter(Boolean);
    const ms = Date.now() - t;
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
