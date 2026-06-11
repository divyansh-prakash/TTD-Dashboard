require('dotenv').config();
const express = require('express');
const cors = require('cors');

// Prevent unhandled promise rejections (e.g. ClickHouse timeout / stream abort) from killing the process
process.on('unhandledRejection', (err) => {
  console.error('[UNHANDLED REJECTION]', err?.message || err);
});

const failureQueueRouter = require('./routes/failure-queue');
const { getAllPlatformUrlMappings } = require('./repositories/platformUrlMap.repo');
const { getContentIdCache } = require('./repositories/contentIdMap.repo');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: 'http://localhost:4208' }));
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

console.log('[STARTUP] Pre-loading caches…');
Promise.all([
  getAllPlatformUrlMappings(),
])
  .then(() => {
    console.log('[STARTUP] Caches warm. Starting server…');
    app.listen(PORT, () => {
      console.log(`[STARTUP] Server running on http://localhost:${PORT}`);
      // Build dpttd content-ID cache in the background — Panel 2 awaits it on first request.
      getContentIdCache().then(() => console.log('[STARTUP] dpttd content-ID cache ready'));
    });
  })
  .catch((err) => {
    console.error('[STARTUP] Cache load failed, starting anyway:', err.message);
    app.listen(PORT, () => {
      console.log(`[STARTUP] Server running on http://localhost:${PORT}`);
      getContentIdCache().then(() => console.log('[STARTUP] dpttd content-ID cache ready'));
    });
  });
