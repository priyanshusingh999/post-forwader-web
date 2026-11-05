require('dotenv').config({ path: process.env.ENV_FILE || '.env' });
const { tg } = require('../src/telegram');
const { getBotConfig } = require('../src/bot');

async function main() {
  const command = process.argv[2];
  if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN is required');

  if (command === 'set') {
    const config = getBotConfig();
    if (config.mode !== 'webhook') throw new Error('Set BOT_MODE=webhook before registering a webhook');
    await tg('setWebhook', {
      url: config.webhookUrl,
      secret_token: config.webhookSecret,
      allowed_updates: ['message', 'channel_post'],
      drop_pending_updates: false,
    });
    console.log(`Telegram webhook registered: ${config.webhookUrl}`);
    return;
  }

  if (command === 'delete') {
    await tg('deleteWebhook', { drop_pending_updates: false });
    console.log('Telegram webhook removed; pending updates were kept.');
    return;
  }

  if (command === 'info') {
    const info = await tg('getWebhookInfo');
    console.log(JSON.stringify({
      registered: Boolean(info.url),
      url: info.url || null,
      pendingUpdateCount: info.pending_update_count,
      allowedUpdates: info.allowed_updates,
      lastError: info.last_error_message || null,
      lastErrorDate: info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : null,
    }, null, 2));
    return;
  }

  throw new Error('Usage: node scripts/telegram-webhook.js <set|delete|info>');
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
