const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { col, oid } = require('./db');
const { setSession, clearSession, requireAuth, authLimiter } = require('./auth');
const { verifyChannel } = require('./telegram');
const { isMailerConfigured, sendVerificationEmail, sendPasswordResetEmail } = require('./mailer');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CHAT_RE = /^(@[A-Za-z0-9_]{5,32}|-?\d{5,20})$/;

const adminEmails = () => new Set(
  (process.env.ADMIN_EMAILS || '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean),
);
const isAdmin = (user) => user.emailVerified !== false && adminEmails().has(String(user.email).toLowerCase());
const publicUser = (u) => ({
  id: u._id,
  name: u.name,
  email: u.email,
  settings: u.settings,
  isAdmin: isAdmin(u),
});
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const createToken = () => crypto.randomBytes(32).toString('hex');
const mailUnavailable = (res) => bad(res, 'Email service is not configured. Ask the administrator to configure SMTP.', 503);

/* ---------- AUTH ---------- */
router.post('/auth/register', authLimiter, async (req, res) => {
  const name = str(req.body.name, 60);
  const email = str(req.body.email, 120).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!name) return bad(res, 'Naam daalo');
  if (!EMAIL_RE.test(email)) return bad(res, 'Valid email daalo');
  if (password.length < 8 || password.length > 100) return bad(res, 'Password 8 se 100 characters ka hona chahiye');
  if (!isMailerConfigured()) return mailUnavailable(res);

  const verificationToken = createToken();
  const doc = {
    name,
    email,
    passwordHash: await bcrypt.hash(password, 12),
    emailVerified: false,
    emailVerificationTokenHash: hashToken(verificationToken),
    emailVerificationExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    settings: { forwardingEnabled: true, promotionEnabled: true, keepForwardTag: false },
    createdAt: new Date(),
  };
  let userId;
  try {
    const r = await col('users').insertOne(doc);
    userId = r.insertedId;
  } catch (e) {
    if (e.code === 11000) return bad(res, 'Is email se account pehle se hai', 409);
    throw e;
  }

  try {
    await sendVerificationEmail(email, verificationToken);
  } catch (e) {
    console.error('verification email failed:', e.message);
    await col('users').deleteOne({ _id: userId, emailVerified: false });
    return bad(res, 'Verification email could not be sent. Check SMTP settings and try again.', 503);
  }
  res.status(202).json({ message: 'Account created. Check your email to verify the address before logging in.' });
});

router.post('/auth/login', authLimiter, async (req, res) => {
  const email = str(req.body.email, 120).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const user = await col('users').findOne({ email });
  const ok = user && (await bcrypt.compare(password, user.passwordHash));
  if (!ok) return bad(res, 'Email ya password galat hai', 401);
  if (user.emailVerified === false) {
    return res.status(403).json({
      error: 'Login se pehle apna email verify karein.',
      emailVerificationRequired: true,
    });
  }
  setSession(res, user._id);
  res.json({ user: publicUser(user) });
});

router.post('/auth/verify-email', authLimiter, async (req, res) => {
  const token = str(req.body.token, 128);
  if (!token) return bad(res, 'Verification link invalid ya expire ho gaya hai', 400);
  const result = await col('users').updateOne(
    { emailVerificationTokenHash: hashToken(token), emailVerificationExpiresAt: { $gt: new Date() } },
    {
      $set: { emailVerified: true },
      $unset: { emailVerificationTokenHash: '', emailVerificationExpiresAt: '' },
    },
  );
  if (!result.matchedCount) return bad(res, 'Verification link invalid ya expire ho gaya hai', 400);
  res.json({ message: 'Email verified. You can now log in.' });
});

router.post('/auth/resend-verification', authLimiter, async (req, res) => {
  if (!isMailerConfigured()) return mailUnavailable(res);
  const email = str(req.body.email, 120).toLowerCase();
  if (EMAIL_RE.test(email)) {
    const user = await col('users').findOne({ email, emailVerified: false });
    if (user) {
      const token = createToken();
      await col('users').updateOne(
        { _id: user._id, emailVerified: false },
        {
          $set: {
            emailVerificationTokenHash: hashToken(token),
            emailVerificationExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        },
      );
      try {
        await sendVerificationEmail(email, token);
      } catch (e) {
        console.error('verification email resend failed:', e.message);
      }
    }
  }
  res.json({ message: 'If this address has an unverified account, a verification email will be sent.' });
});

router.post('/auth/forgot-password', authLimiter, async (req, res) => {
  if (!isMailerConfigured()) return mailUnavailable(res);
  const email = str(req.body.email, 120).toLowerCase();
  if (EMAIL_RE.test(email)) {
    const user = await col('users').findOne({ email, emailVerified: { $ne: false } });
    if (user) {
      const token = createToken();
      await col('users').updateOne(
        { _id: user._id },
        {
          $set: {
            passwordResetTokenHash: hashToken(token),
            passwordResetExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
          },
        },
      );
      try {
        await sendPasswordResetEmail(email, token);
      } catch (e) {
        console.error('password reset email failed:', e.message);
        await col('users').updateOne(
          { _id: user._id, passwordResetTokenHash: hashToken(token) },
          { $unset: { passwordResetTokenHash: '', passwordResetExpiresAt: '' } },
        );
      }
    }
  }
  res.json({ message: 'If an account exists for this address, password reset instructions will be sent.' });
});

router.post('/auth/reset-password', authLimiter, async (req, res) => {
  const token = str(req.body.token, 128);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (password.length < 8 || password.length > 100) {
    return bad(res, 'Password 8 se 100 characters ka hona chahiye');
  }
  if (!token) return bad(res, 'Reset link invalid ya expire ho gaya hai', 400);
  const tokenHash = hashToken(token);
  const user = await col('users').findOne({
    passwordResetTokenHash: tokenHash,
    passwordResetExpiresAt: { $gt: new Date() },
  });
  if (!user) return bad(res, 'Reset link invalid ya expire ho gaya hai', 400);
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await col('users').updateOne(
    { _id: user._id, passwordResetTokenHash: tokenHash, passwordResetExpiresAt: { $gt: new Date() } },
    {
      $set: { passwordHash },
      $unset: { passwordResetTokenHash: '', passwordResetExpiresAt: '' },
    },
  );
  if (!result.matchedCount) return bad(res, 'Reset link invalid ya expire ho gaya hai', 400);
  res.json({ message: 'Password reset ho gaya. Ab naye password se login karein.' });
});

router.post('/auth/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

router.use(requireAuth);

function requireAdmin(req, res, next) {
  if (!isAdmin(req.user)) return bad(res, 'Admin access required', 403);
  next();
}

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

/* ---------- ADMIN ---------- */
router.get('/admin/summary', requireAdmin, async (req, res) => {
  const now = new Date();
  const since24 = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const since30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [totalUsers, newUsers30d, logTotals, blockedSources, pendingReports] = await Promise.all([
    col('users').countDocuments(),
    col('users').countDocuments({ createdAt: { $gte: since30 } }),
    col('logs').aggregate([
      { $match: { createdAt: { $gte: since30 } } },
      {
        $group: {
          _id: null,
          sent30d: { $sum: { $cond: [{ $eq: ['$status', 'sent'] }, 1, 0] } },
          failed30d: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
          sent24h: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'sent'] }, { $gte: ['$createdAt', since24] }] }, 1, 0] } },
          failed24h: { $sum: { $cond: [{ $and: [{ $eq: ['$status', 'failed'] }, { $gte: ['$createdAt', since24] }] }, 1, 0] } },
        },
      },
    ]).toArray(),
    col('sourceBlocklist').countDocuments(),
    col('channelReports').countDocuments({ status: 'pending' }),
  ]);
  res.json({
    totalUsers,
    newUsers30d,
    sent30d: logTotals[0]?.sent30d || 0,
    failed30d: logTotals[0]?.failed30d || 0,
    sent24h: logTotals[0]?.sent24h || 0,
    failed24h: logTotals[0]?.failed24h || 0,
    blockedSources,
    pendingReports,
    revenue: { available: false, amount: null, reason: 'No billing or payment provider is configured.' },
    usageWindowDays: 30,
    riskRules: { highVolumeSent24h: 1000, minimumAttempts24h: 20, highFailureRate: 0.25 },
  });
});

router.get('/admin/users', requireAdmin, async (req, res) => {
  const since24 = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const users = await col('logs').aggregate([
      { $match: { createdAt: { $gte: since24 }, status: { $in: ['sent', 'failed'] } } },
      {
        $group: {
          _id: '$userId',
          sent24h: { $sum: { $cond: [{ $eq: ['$status', 'sent'] }, 1, 0] } },
          failed24h: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
        },
      },
      { $addFields: { attempts24h: { $add: ['$sent24h', '$failed24h'] } } },
      { $sort: { attempts24h: -1 } },
      { $limit: 50 },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'account' } },
      { $unwind: '$account' },
      {
        $project: {
          _id: 0,
          id: '$account._id',
          name: '$account.name',
          email: '$account.email',
          createdAt: '$account.createdAt',
          emailVerified: { $ne: ['$account.emailVerified', false] },
          sent24h: 1,
          failed24h: 1,
        },
      },
    ]).toArray();
  res.json({
    users: users.map((user) => {
      const attempts24h = user.sent24h + user.failed24h;
      const failureRate24h = attempts24h ? user.failed24h / attempts24h : 0;
      const riskSignals = [];
      if (user.sent24h >= 1000) riskSignals.push('High forwarding volume in 24h');
      if (attempts24h >= 20 && failureRate24h >= 0.25) riskSignals.push('High delivery failure rate');
      return {
        emailVerified: user.emailVerified !== false,
        ...user,
        failureRate24h,
        riskSignals,
      };
    }),
  });
});

router.get('/admin/reports', requireAdmin, async (req, res) => {
  const status = ['pending', 'blocked', 'dismissed'].includes(req.query.status) ? req.query.status : 'pending';
  const reports = await col('channelReports').find({ status }).sort({ createdAt: -1 }).limit(100).toArray();
  res.json({ reports });
});

router.post('/admin/reports/:id/block', requireAdmin, async (req, res) => {
  const _id = oid(req.params.id);
  const report = _id && await col('channelReports').findOne({ _id, status: 'pending' });
  if (!report) return bad(res, 'Pending report nahi mila', 404);
  const now = new Date();
  try {
    await col('sourceBlocklist').updateOne(
      { chatId: report.chatId },
      {
        $setOnInsert: {
          chatId: report.chatId,
          title: report.title,
          username: report.username || null,
          reason: report.reason,
          blockedAt: now,
          blockedBy: req.user._id,
          reportId: report._id,
        },
      },
      { upsert: true },
    );
  } catch (err) {
    if (err.code !== 11000) throw err;
  }
  await col('channels').updateMany(
    { chatId: report.chatId, role: 'source' },
    { $set: { enabled: false } },
  );
  await col('channelReports').updateOne(
    { _id: report._id, status: 'pending' },
    { $set: { status: 'blocked', reviewedAt: now, reviewedBy: req.user._id } },
  );
  res.json({ ok: true });
});

router.post('/admin/reports/:id/dismiss', requireAdmin, async (req, res) => {
  const _id = oid(req.params.id);
  const result = _id && await col('channelReports').updateOne(
    { _id, status: 'pending' },
    { $set: { status: 'dismissed', reviewedAt: new Date(), reviewedBy: req.user._id } },
  );
  if (!result || !result.matchedCount) return bad(res, 'Pending report nahi mila', 404);
  res.json({ ok: true });
});

router.get('/admin/blocklist', requireAdmin, async (req, res) => {
  const channels = await col('sourceBlocklist').find({}).sort({ blockedAt: -1 }).limit(100).toArray();
  res.json({ channels });
});

router.delete('/admin/blocklist/:chatId', requireAdmin, async (req, res) => {
  const chatId = str(req.params.chatId, 20);
  if (!/^-?\d{5,20}$/.test(chatId)) return bad(res, 'Invalid Telegram channel ID');
  const result = await col('sourceBlocklist').deleteOne({ chatId });
  if (!result.deletedCount) return bad(res, 'Blocked source nahi mila', 404);
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
  if (role === 'source' && await col('sourceBlocklist').findOne({ chatId: info.chatId }, { projection: { _id: 1 } })) {
    return bad(res, 'Ye source channel system-wide block kiya gaya hai', 403);
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
  const targetChatId = set.chatId || existing.chatId;
  const willEnable = typeof req.body.enabled === 'boolean' ? req.body.enabled : existing.enabled;
  if (newRole === 'source' && (willEnable || newRole !== existing.role)) {
    const blocked = await col('sourceBlocklist').findOne({ chatId: targetChatId }, { projection: { _id: 1 } });
    if (blocked) return bad(res, 'Ye source channel system-wide block kiya gaya hai', 403);
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

router.post('/channels/:id/report', async (req, res) => {
  const _id = oid(req.params.id);
  const channel = _id && await col('channels').findOne({ _id, userId: req.user._id, role: 'source' });
  if (!channel) return bad(res, 'Source channel nahi mila', 404);
  const pending = await col('channelReports').findOne({
    chatId: channel.chatId,
    reporterUserId: req.user._id,
    status: 'pending',
  });
  if (pending) return bad(res, 'Aapki report pehle se review ke liye pending hai', 409);
  const report = {
    chatId: channel.chatId,
    title: channel.title,
    username: channel.username || null,
    reporterUserId: req.user._id,
    reporterEmail: req.user.email,
    reason: str(req.body.reason, 500),
    status: 'pending',
    createdAt: new Date(),
  };
  await col('channelReports').insertOne(report);
  res.status(201).json({ message: 'Report admin review ke liye bhej di gayi hai.' });
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
