const { col } = require('./db');
const { tg, sleep } = require('./telegram');
const { timingSafeEqual } = require('crypto');

const TEXT_LIMIT = 4096;
const CAPTION_LIMIT = 1024;
const WEBHOOK_PATH = '/telegram/webhook';
const ACCOUNT_MESSAGE = [
  'Namaste! 👋',
  '',
  'Telegram channel posts automatically forward karne ke liye hamari website par account banayein.',
  '',
  '1. Account create ya login karein',
  '2. Bot ko apne source aur destination channels mein admin banayein',
  '3. Channels connect karke forwarding shuru karein',
  '',
  'Account banane ya login karne ka link:',
].join('\n');

function getAccountUrl() {
  if (!process.env.APP_URL) return null;
  const url = new URL(process.env.APP_URL);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('APP_URL must use HTTP or HTTPS');
  }
  if (['localhost', '127.0.0.1', '::1'].includes(url.hostname)) return null;
  return new URL('/', url).toString();
}

async function handleIncomingMessage(msg) {
  if (!msg.chat || msg.chat.type !== 'private' || msg.from?.is_bot) return;
  const accountUrl = getAccountUrl();
  const params = {
    chat_id: msg.chat.id,
    text: accountUrl
      ? `${ACCOUNT_MESSAGE}\n${accountUrl}`
      : `${ACCOUNT_MESSAGE}\nWebsite link abhi configure nahi hai. Admin se public website URL lein.`,
    reply_to_message_id: msg.message_id,
  };
  if (accountUrl) {
    params.reply_markup = {
      inline_keyboard: [[{ text: 'Create account / Login', url: accountUrl }]],
    };
  }
  await tg('sendMessage', params);
}

async function log(userId, doc) {
  try {
    await col('logs').insertOne({ userId, createdAt: new Date(), ...doc });
  } catch (e) {
    console.error('log failed:', e.message);
  }
}

// Ek post ko ek destination par bhejo (promotion ke saath ya bina)
async function deliver(msg, destChatId, user, promoText) {
  const chatId = msg.chat.id;

  if (user.settings.keepForwardTag && !promoText) {
    return tg('forwardMessage', { chat_id: destChatId, from_chat_id: chatId, message_id: msg.message_id });
  }

  if (promoText && msg.text) {
    const full = `${msg.text}\n\n${promoText}`;
    if (full.length <= TEXT_LIMIT) {
      return tg('sendMessage', {
        chat_id: destChatId,
        text: full,
        entities: msg.entities, // append hone se offsets same rehte hain
        link_preview_options: { is_disabled: false },
      });
    }
  }

  const params = { chat_id: destChatId, from_chat_id: chatId, message_id: msg.message_id };
  if (promoText && !msg.text && (msg.photo || msg.video || msg.document || msg.audio || msg.animation || msg.voice)) {
    const full = `${msg.caption || ''}\n\n${promoText}`.trim();
    if (full.length <= CAPTION_LIMIT) {
      params.caption = full;
      if (msg.caption_entities) params.caption_entities = msg.caption_entities;
    }
  }
  return tg('copyMessage', params);
}

async function handlePost(msg) {
  const sourceId = String(msg.chat.id);
  const blocked = await col('sourceBlocklist').findOne({ chatId: sourceId }, { projection: { _id: 1 } });
  if (blocked) return;
  const sources = await col('channels').find({ chatId: sourceId, role: 'source', enabled: true }).toArray();

  for (const source of sources) {
    const user = await col('users').findOne({ _id: source.userId });
    if (!user || !user.settings.forwardingEnabled) continue;

    const destinations = await col('channels')
      .find({ userId: user._id, sourceId: source._id, role: 'destination', enabled: true })
      .toArray();
    if (!destinations.length) continue;

    let promoText = '';
    if (user.settings.promotionEnabled) {
      const promos = await col('promotions').find({
        userId: user._id,
        enabled: true,
        $or: [{ sourceId: source._id }, { sourceId: { $exists: false } }],
      }).toArray();
      if (promos.length) promoText = promos[Math.floor(Math.random() * promos.length)].text;
    }

    for (const dest of destinations) {
      if (dest.chatId === sourceId) continue; // loop se bachao
      const base = {
        sourceTitle: source.title,
        destTitle: dest.title,
        messageId: msg.message_id,
        promoted: Boolean(promoText),
      };
      try {
        await deliver(msg, dest.chatId, user, promoText);
        await log(user._id, { ...base, status: 'sent' });
      } catch (e) {
        await log(user._id, { ...base, status: 'failed', error: String(e.message).slice(0, 200) });
      }
      await sleep(60);
    }
  }
}

function getBotConfig() {
  const mode = (process.env.BOT_MODE || 'polling').trim().toLowerCase();
  if (mode !== 'polling' && mode !== 'webhook') {
    throw new Error('BOT_MODE must be polling or webhook');
  }
  if (mode === 'polling') return { mode };

  const rawUrl = process.env.TELEGRAM_WEBHOOK_URL;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('TELEGRAM_WEBHOOK_URL must be an absolute HTTPS URL');
  }
  if (
    url.protocol !== 'https:'
    || url.pathname !== WEBHOOK_PATH
    || url.search
    || url.hash
    || url.username
    || url.password
  ) {
    throw new Error(`TELEGRAM_WEBHOOK_URL must be HTTPS and end with ${WEBHOOK_PATH}`);
  }
  if (!secret || !/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
    throw new Error('TELEGRAM_WEBHOOK_SECRET must be 1-256 letters, numbers, underscores, or hyphens');
  }
  return { mode, webhookUrl: url.toString(), webhookSecret: secret };
}

function isValidWebhookSecret(value, expected) {
  if (typeof value !== 'string' || typeof expected !== 'string') return false;
  const provided = Buffer.from(value);
  const configured = Buffer.from(expected);
  return provided.length === configured.length && timingSafeEqual(provided, configured);
}

async function handleUpdate(update) {
  if (update.message) await handleIncomingMessage(update.message);
  if (update.channel_post) await handlePost(update.channel_post);
}

async function startBot(config = getBotConfig()) {
  if (config.mode === 'webhook') {
    await tg('setWebhook', {
      url: config.webhookUrl,
      secret_token: config.webhookSecret,
      allowed_updates: ['message', 'channel_post'],
      drop_pending_updates: false,
    });
    console.log(`Telegram bot webhook registered at ${new URL(config.webhookUrl).pathname}`);
    return;
  }

  let offset = 0;
  let webhookRemoved = false;
  console.log('Telegram bot polling started');
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      if (!webhookRemoved) {
        await tg('deleteWebhook', { drop_pending_updates: false });
        webhookRemoved = true;
      }
      const updates = await tg('getUpdates', {
        offset,
        timeout: 30,
        allowed_updates: ['message', 'channel_post'],
      });
      for (const u of updates) {
        offset = u.update_id + 1;
        handleUpdate(u).catch((e) => console.error('handleUpdate:', e.message));
      }
    } catch (e) {
      console.error('polling error:', e.message);
      await sleep(5000);
    }
  }
}

module.exports = {
  WEBHOOK_PATH,
  getBotConfig,
  isValidWebhookSecret,
  startBot,
  handleIncomingMessage,
  handleUpdate,
};
