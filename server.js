require('dotenv').config();
const { connect } = require('./src/db');
const { createApp } = require('./src/app');
const { startBot } = require('./src/bot');

async function startServer() {
  const app = createApp();
  await connect();

  const port = process.env.PORT || 3000;
  await new Promise((resolve, reject) => {
    const server = app.listen(port, resolve);
    server.once('error', reject);
  });
  console.log(`Web app running on port ${port}`);

  const botStart = startBot(app.locals.botConfig);
  if (app.locals.botConfig.mode === 'webhook') {
    await botStart;
  } else {
    botStart.catch((err) => console.error('Bot startup failed:', err.message));
  }
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error('Startup failed:', err.message);
    process.exit(1);
  });
}

module.exports = { startServer };
