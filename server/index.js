require('dotenv').config();
const express = require('express');
const cors = require('cors');

const failureQueueRouter = require('./routes/failure-queue');
const { getAllPlatformUrlMappings } = require('./repositories/platformUrlMap.repo');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: 'http://localhost:4200' }));
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/failure-queue', failureQueueRouter);

// Pre-load platform URL mappings before accepting requests so the cache is
// warm and never competes with live ClickHouse queries.
getAllPlatformUrlMappings()
  .then(() => {
    app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('Failed to load platform URL mappings, starting anyway:', err.message);
    app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
  });
