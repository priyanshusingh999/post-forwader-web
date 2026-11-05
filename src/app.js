const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const { connect } = require('./db');
const { router } = require('./routes');
const {
  WEBHOOK_PATH,
  getBotConfig,
  isValidWebhookSecret,
  handleUpdate,
} = require('./bot');

function createApp({ serverless = false } = {}) {
  for (const key of ['MONGODB_URI', 'JWT_SECRET', 'BOT_TOKEN']) {
    if (!process.env[key]) throw new Error(`Missing environment variable: ${key}`);
  }

  const botConfig = getBotConfig();
  if (serverless && botConfig.mode !== 'webhook') {
    throw new Error('Vercel serverless functions require BOT_MODE=webhook; polling requires a persistent server');
  }

  const app = express();
  app.locals.botConfig = botConfig;
  app.disable('x-powered-by');
  app.use(cookieParser());
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
    });
    next();
  });

  app.post(
    WEBHOOK_PATH,
    (req, res, next) => {
      if (botConfig.mode !== 'webhook') return res.sendStatus(404);
      if (!isValidWebhookSecret(req.get('x-telegram-bot-api-secret-token'), botConfig.webhookSecret)) {
        return res.sendStatus(403);
      }
      return next();
    },
    express.json({ limit: '1mb' }),
    async (req, res, next) => {
      if (!req.body || !Number.isSafeInteger(req.body.update_id)) {
        return res.status(400).json({ error: 'Invalid Telegram update' });
      }
      try {
        await connect();
        await handleUpdate(req.body);
        return res.sendStatus(200);
      } catch (err) {
        return next(err);
      }
    },
  );
  app.use(express.json({ limit: '50kb' }));

  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/api', async (req, res, next) => {
    try {
      await connect();
      next();
    } catch (err) {
      next(err);
    }
  }, router);
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((err, req, res, next) => {
    console.error(err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Server error' });
  });

  return app;
}

const app = createApp({ serverless: Boolean(process.env.VERCEL) });
module.exports = app;
module.exports.createApp = createApp;
