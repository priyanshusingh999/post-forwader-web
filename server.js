require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const { connect } = require('./src/db');
const { router } = require('./src/routes');
const {
  WEBHOOK_PATH,
  getBotConfig,
  isValidWebhookSecret,
  startBot,
  handleUpdate,
} = require('./src/bot');

for (const key of ['MONGODB_URI', 'JWT_SECRET', 'BOT_TOKEN']) {
  if (!process.env[key]) {
    console.error(`Missing environment variable: ${key}`);
    process.exit(1);
  }
}

const app = express();
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

let botConfig;
let webhookUpdateQueue = Promise.resolve();
app.post(
  WEBHOOK_PATH,
  (req, res, next) => {
    if (botConfig?.mode !== 'webhook') return res.sendStatus(404);
    if (!isValidWebhookSecret(req.get('x-telegram-bot-api-secret-token'), botConfig.webhookSecret)) {
      return res.sendStatus(403);
    }
    return next();
  },
  express.json({ limit: '1mb' }),
  (req, res) => {
    if (!req.body || !Number.isSafeInteger(req.body.update_id)) {
      return res.status(400).json({ error: 'Invalid Telegram update' });
    }

    const update = req.body;
    res.sendStatus(200);
    webhookUpdateQueue = webhookUpdateQueue
      .then(() => handleUpdate(update))
      .catch((err) => console.error(`Webhook update ${update.update_id} failed:`, err.message));
  },
);
app.use(express.json({ limit: '50kb' }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api', router);
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Server error' });
});

(async () => {
  botConfig = getBotConfig();
  await connect();
  const port = process.env.PORT || 3000;
  await new Promise((resolve, reject) => {
    const server = app.listen(port, resolve);
    server.once('error', reject);
  });
  console.log(`Web app running on port ${port}`);
  await startBot(botConfig);
})().catch((e) => {
  console.error('Startup failed:', e.message);
  process.exit(1);
});
