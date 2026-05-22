const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const config = require('./config');

const app = express();

// ── Middleware ──
app.use(cors());
app.use(express.json());
if (config.isDev) {
  app.use(morgan('dev'));
} else {
  app.use(morgan('short'));
}

// ── Health check ──
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    version: '0.1.0',
    app: 'aha-english',
    env: config.nodeEnv,
    uptime: process.uptime(),
  });
});

// ── Routes ──
app.use('/api/v1/auth', require('./routes/auth'));
app.use('/api/v1/entries', require('./routes/entries'));
app.use('/api/v1/learning', require('./routes/learning'));
app.use('/api/v1/books', require('./routes/books'));
app.use('/api/v1/dict', require('./routes/dict'));

// TODO: AI routes when Anthropic API key is configured
// app.use('/api/v1/ai', require('./routes/ai'));

// ── 404 ──
app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'not_found' });
});

// ── Error handler ──
app.use((err, req, res, _next) => {
  console.error('[error]', err);
  const status = err.status || 500;
  res.status(status).json({
    ok: false,
    error: config.isDev ? err.message : 'internal_error',
  });
});

module.exports = app;
