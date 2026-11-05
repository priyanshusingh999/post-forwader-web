const express = require('express');
const bcrypt = require('bcryptjs');
const { col, oid } = require('./db');
const { setSession, clearSession, requireAuth, authLimiter } = require('./auth');
const { verifyChannel } = require('./telegram');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CHAT_RE = /^(@[A-Za-z0-9_]{5,32}|-?\d{5,20})$/;

const publicUser = (u) => ({ id: u._id, name: u.name, email: u.email, settings: u.settings });
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/* ---------- AUTH ---------- */
router.post('/auth/register', authLimiter, async (req, res) => {
  const name = str(req.body.name, 60);
  const email = str(req.body.email, 120).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!name) return bad(res, 'Naam daalo');
  if (!EMAIL_RE.test(email)) return bad(res, 'Valid email daalo');
  if (password.length < 8 || password.length > 100) return bad(res, 'Password 8 se 100 characters ka hona chahiye');
  try {
    const doc = {
      name,
      email,
      passwordHash: await bcrypt.hash(password, 12),
      settings: { forwardingEnabled: true, promotionEnabled: true, keepForwardTag: false },
      createdAt: new Date(),
    };
    const r = await col('users').insertOne(doc);
    setSession(res, r.insertedId);
    res.json({ user: publicUser({ ...doc, _id: r.insertedId }) });
  } catch (e) {
    if (e.code === 11000) return bad(res, 'Is email se account pehle se hai', 409);
    throw e;
  }
});

router.post('/auth/login', authLimiter, async (req, res) => {
  const email = str(req.body.email, 120).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const user = await col('users').findOne({ email });
  const ok = user && (await bcrypt.compare(password, user.passwordHash));
  if (!ok) return bad(res, 'Email ya password galat hai', 401);
  setSession(res, user._id);
  res.json({ user: publicUser(user) });
});

router.post('/auth/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

router.use(requireAuth);

router.get('/me', (req, res) => res.json({ user: publicUser(req.user) }));

router.patch('/me/settings', async (req, res) => {
  const set = {};
  for (const k of ['forwardingEnabled', 'promotionEnabled', 'keepForwardTag']) {
    if (typeof req.body[k] === 'boolean') set[`settings.${k}`] = req.body[k];
  }
  if (!Object.keys(set).length) return bad(res, 'Kuch change nahi hua');
  await col('users').updateOne({ _id: req.user._id }, { $set: set });
  const user = await col('users').findOne({ _id: req.user._id });
  res.json({ user: publicUser(user) });
});

router.post('/me/password', authLimiter, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 100)
    return bad(res, 'Naya password 8 se 100 characters ka ho');
  if (!(await bcrypt.compare(String(oldPassword || ''), req.user.passwordHash))) return bad(res, 'Purana password galat hai', 401);
  await col('users').updateOne({ _id: req.user._id }, { $set: { passwordHash: await bcrypt.hash(newPassword, 12) } });
  res.json({ ok: true });
});

/* ---------- CHANNELS ---------- */
router.get('/channels', async (req, res) => {
  const list = await col('channels').find({ userId: req.user._id }).sort({ createdAt: -1 }).toArray();
  res.json({ channels: list });
});

router.post('/channels', async (req, res) => {
  const label = str(req.body.label, 80);
  const input = str(req.body.chat, 80);
  const role = req.body.role === 'destination' ? 'destination' : 'source';
  let sourceId;
  if (role === 'destination') {
    sourceId = oid(req.body.sourceId);
    if (!sourceId) return bad(res, 'Destination ke liye source channel chunein');
    const source = await col('channels').findOne({ _id: sourceId, userId: req.user._id, role: 'source' });
    if (!source) return bad(res, 'Chuna hua source channel nahi mila', 404);
  }
  if (!CHAT_RE.test(input)) return bad(res, 'Channel @username ya numeric ID (-100...) daalo');
  let info;
  try {
    info = await verifyChannel(input, role === 'destination');
  } catch (e) {
    return bad(res, `Channel verify nahi hua: ${e.message}`);
  }
  const doc = {
    userId: req.user._id,
    chatId: info.chatId,
    username: info.username,
    title: info.title,
    label: label || info.title,
    role,
    enabled: true,
    createdAt: new Date(),
  };
  if (sourceId) doc.sourceId = sourceId;
  try {
    const r = await col('channels').insertOne(doc);
    res.json({ channel: { ...doc, _id: r.insertedId } });
  } catch (e) {
    if (e.code === 11000) return bad(res, 'Ye channel is role me pehle se added hai', 409);
    throw e;
  }
});

router.put('/channels/:id', async (req, res) => {
  const _id = oid(req.params.id);
  const existing = _id && (await col('channels').findOne({ _id, userId: req.user._id }));
  if (!existing) return bad(res, 'Channel nahi mila', 404);
  const set = {};
  if (req.body.label !== undefined) set.label = str(req.body.label, 80) || existing.title;
  if (typeof req.body.enabled === 'boolean') set.enabled = req.body.enabled;
  const newRole = req.body.role === 'source' || req.body.role === 'destination' ? req.body.role : existing.role;
  if (newRole === 'destination') {
    if (req.body.sourceId !== undefined) {
      const sourceId = oid(req.body.sourceId);
      if (!sourceId) return bad(res, 'Destination ke liye source channel chunein');
      const source = await col('channels').findOne({ _id: sourceId, userId: req.user._id, role: 'source' });
      if (!source) return bad(res, 'Chuna hua source channel nahi mila', 404);
      set.sourceId = sourceId;
    } else if (newRole !== existing.role) {
      return bad(res, 'Destination ke liye source channel chunein');
    }
  } else if (existing.role === 'destination') {
    set.sourceId = null;
  }
  const chatInput = str(req.body.chat, 80);
  const chatChanged = chatInput && chatInput !== existing.chatId && chatInput !== `@${existing.username}`;
  if (chatChanged || newRole !== existing.role) {
    const target = chatChanged ? chatInput : existing.chatId;
    if (!CHAT_RE.test(target)) return bad(res, 'Channel @username ya numeric ID daalo');
    try {
      const info = await verifyChannel(target, newRole === 'destination');
      Object.assign(set, { chatId: info.chatId, username: info.username, title: info.title, role: newRole });
    } catch (e) {
      return bad(res, `Channel verify nahi hua: ${e.message}`);
    }
  }
  try {
    await col('channels').updateOne({ _id }, { $set: set });
  } catch (e) {
    if (e.code === 11000) return bad(res, 'Ye channel is role me pehle se added hai', 409);
    throw e;
  }
  res.json({ channel: await col('channels').findOne({ _id }) });
});

router.delete('/channels/:id', async (req, res) => {
  const _id = oid(req.params.id);
  const channel = _id && (await col('channels').findOne({ _id, userId: req.user._id }));
  if (!channel) return bad(res, 'Channel nahi mila', 404);
  if (channel.role === 'source') {
    await col('channels').updateMany(
      { userId: req.user._id, role: 'destination', sourceId: _id },
      { $unset: { sourceId: '' } },
    );
    await col('promotions').updateMany(
      { userId: req.user._id, sourceId: _id },
      { $set: { sourceId: null } },
    );
  }
  const r = await col('channels').deleteOne({ _id, userId: req.user._id });
  if (!r || !r.deletedCount) return bad(res, 'Channel nahi mila', 404);
  res.json({ ok: true });
});

/* ---------- PROMOTIONS ---------- */
router.get('/promotions', async (req, res) => {
  const list = await col('promotions').find({ userId: req.user._id }).sort({ createdAt: -1 }).toArray();
  res.json({ promotions: list });
});

function promoFields(body) {
  const name = str(body.name, 60);
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, 500) : '';
  return { name, text };
}

router.post('/promotions', async (req, res) => {
  const { name, text } = promoFields(req.body);
  if (!name || !text) return bad(res, 'Promotion name and text are required');
  const sourceId = oid(req.body.sourceId);
  if (!sourceId) return bad(res, 'Select a source channel for this promotion');
  const source = await col('channels').findOne({ _id: sourceId, userId: req.user._id, role: 'source' });
  if (!source) return bad(res, 'Selected source channel was not found', 404);
  const doc = { userId: req.user._id, sourceId, name, text, enabled: true, createdAt: new Date() };
  const r = await col('promotions').insertOne(doc);
  res.json({ promotion: { ...doc, _id: r.insertedId } });
});

router.put('/promotions/:id', async (req, res) => {
  const _id = oid(req.params.id);
  const existing = _id && (await col('promotions').findOne({ _id, userId: req.user._id }));
  if (!existing) return bad(res, 'Promotion nahi mila', 404);
  const set = {};
  if (req.body.name !== undefined || req.body.text !== undefined) {
    const f = promoFields({ name: req.body.name ?? existing.name, text: req.body.text ?? existing.text });
    if (!f.name || !f.text) return bad(res, 'Promotion name and text are required');
    Object.assign(set, f);
  }
  if (req.body.sourceId !== undefined) {
    const sourceId = oid(req.body.sourceId);
    if (!sourceId) return bad(res, 'Select a source channel for this promotion');
    const source = await col('channels').findOne({ _id: sourceId, userId: req.user._id, role: 'source' });
    if (!source) return bad(res, 'Selected source channel was not found', 404);
    set.sourceId = sourceId;
  }
  if (typeof req.body.enabled === 'boolean') set.enabled = req.body.enabled;
  await col('promotions').updateOne({ _id }, { $set: set });
  res.json({ promotion: await col('promotions').findOne({ _id }) });
});

router.delete('/promotions/:id', async (req, res) => {
  const _id = oid(req.params.id);
  const r = _id && (await col('promotions').deleteOne({ _id, userId: req.user._id }));
  if (!r || !r.deletedCount) return bad(res, 'Promotion nahi mila', 404);
  res.json({ ok: true });
});

/* ---------- LOGS & STATS ---------- */
router.get('/logs', async (req, res) => {
  const logs = await col('logs').find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(50).toArray();
  res.json({ logs });
});

router.get('/stats', async (req, res) => {
  const userId = req.user._id;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [sources, destinations, promotions, sent24, failed24] = await Promise.all([
    col('channels').countDocuments({ userId, role: 'source' }),
    col('channels').countDocuments({ userId, role: 'destination' }),
    col('promotions').countDocuments({ userId }),
    col('logs').countDocuments({ userId, status: 'sent', createdAt: { $gte: since } }),
    col('logs').countDocuments({ userId, status: 'failed', createdAt: { $gte: since } }),
  ]);
  res.json({ sources, destinations, promotions, sent24, failed24 });
});

// async errors -> error handler (Express 4)
for (const layer of router.stack) {
  if (!layer.route) continue;
  for (const l of layer.route.stack) {
    const fn = l.handle;
    l.handle = (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  }
}

module.exports = { router };
