require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const { connect } = require('./src/db');
const { router } = require('./src/routes');
const { startBot } = require('./src/bot');

for (const key of ['MONGODB_URI', 'JWT_SECRET', 'BOT_TOKEN']) {
  if (!process.env[key]) {
    console.error(`Missing environment variable: ${key}`);
    process.exit(1);
  }
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '50kb' }));
app.use(cookieParser());
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
  });
  next();
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api', router);
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Server error' });
});

(async () => {
  await connect();
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Web app running on port ${port}`));
  startBot();
})().catch((e) => {
  console.error('Startup failed:', e.message);
  process.exit(1);
});
