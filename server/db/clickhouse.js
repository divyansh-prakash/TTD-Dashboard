const axios = require('axios');

const CH_URL = process.env.CLICKHOUSE_URL || 'http://54.81.93.97:8123';
const CH_USER = process.env.CLICKHOUSE_USERNAME || 'readonly_user';
const CH_PASS = process.env.CLICKHOUSE_PASSWORD || 'TTD486545DFherefdg';

async function queryClickHouse(sql, database) {
  const params = new URLSearchParams({ database, user: CH_USER, password: CH_PASS });
  const response = await axios.post(
    `${CH_URL}/?${params.toString()}`,
    sql + ' FORMAT JSONEachRow',
    { headers: { 'Content-Type': 'text/plain' }, responseType: 'text', timeout: 60000 }
  );

  const raw = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
  const lines = raw.trim().split('\n').filter(Boolean);
  return lines.map((line) => JSON.parse(line));
}

module.exports = { queryClickHouse };
