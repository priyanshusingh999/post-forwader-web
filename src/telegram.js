const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tg(method, params = {}, retries = 2) {
  const res = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({}));
  if (data.ok) return data.result;
  if (data.error_code === 429 && retries > 0) {
    await sleep(((data.parameters && data.parameters.retry_after) || 1) * 1000 + 200);
    return tg(method, params, retries - 1);
  }
  const err = new Error(data.description || 'Telegram error');
  err.code = data.error_code;
  throw err;
}

// Channel verify: bot channel me admin hona chahiye
async function verifyChannel(chatIdOrUsername, needPost) {
  const chat = await tg('getChat', { chat_id: chatIdOrUsername });
  if (chat.type !== 'channel') throw new Error('Ye channel nahi hai (sirf Telegram channels supported)');
  const me = await tg('getMe');
  const member = await tg('getChatMember', { chat_id: chat.id, user_id: me.id });
  if (member.status !== 'administrator' && member.status !== 'creator') {
    throw new Error('Bot ko is channel me admin banao');
  }
  if (needPost && member.can_post_messages === false) {
    throw new Error('Destination channel me bot ko "Post messages" permission do');
  }
  return { chatId: String(chat.id), title: chat.title, username: chat.username || null };
}

module.exports = { tg, verifyChannel, sleep };
