require('dotenv').config();
const express = require('express');
const cors = require('cors');

const failureQueueRouter = require('./routes/failure-queue');
const { getAllPlatformUrlMappings } = require('./repositories/platformUrlMap.repo');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: 'http://localhost:4200' }));
app.use(express.json());

app.use((req, _res, next) => {
  req._startAt = Date.now();
  const qs = Object.keys(req.query).length ? ` | query: ${JSON.stringify(req.query)}` : '';
  console.log(`[REQ] ${req.method} ${req.path}${qs}`);
  next();
});

app.use((req, res, next) => {
  const orig = res.json.bind(res);
  res.json = (body) => {
    const ms = Date.now() - req._startAt;
    console.log(`[RES] ${req.method} ${req.path} → ${res.statusCode} (${ms}ms)`);
    return orig(body);
  };
  next();
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/failure-queue', failureQueueRouter);

// Pre-load platform URL mappings before accepting requests so the cache is
// warm and never competes with live ClickHouse queries.
console.log('[STARTUP] Pre-loading platform URL mappings...');
getAllPlatformUrlMappings()
  .then(() => {
    console.log('[STARTUP] Cache warm. Starting server...');
    app.listen(PORT, () => console.log(`[STARTUP] Server running on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('[STARTUP] Failed to load platform URL mappings, starting anyway:', err.message);
    app.listen(PORT, () => console.log(`[STARTUP] Server running on http://localhost:${PORT}`));
  });
