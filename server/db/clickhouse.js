const axios = require('axios');

const CH_URL = process.env.CLICKHOUSE_URL || 'http://54.81.93.97:8123';
const CH_USER = process.env.CLICKHOUSE_USERNAME || 'readonly_user';
const CH_PASS = process.env.CLICKHOUSE_PASSWORD || 'TTD486545DFherefdg';

async function queryClickHouse(sql, database) {
  const preview = sql.trim().replace(/\s+/g, ' ').slice(0, 120);
  console.log(`[CH] query db=${database} | ${preview}...`);
  const t = Date.now();

  const params = new URLSearchParams({ database, user: CH_USER, password: CH_PASS });
  try {
    const response = await axios.post(
      `${CH_URL}/?${params.toString()}`,
      sql + ' FORMAT JSONEachRow',
      { headers: { 'Content-Type': 'text/plain' }, responseType: 'text', timeout: 120000 }
    );

    const raw = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    const lines = raw.trim().split('\n').filter(Boolean);
    console.log(`[CH] done rows=${lines.length} (${Date.now() - t}ms)`);
    return lines.map((line) => JSON.parse(line));
  } catch (err) {
    console.error(`[CH] error after ${Date.now() - t}ms:`, err.message);
    throw err;
  }
}

module.exports = { queryClickHouse };
