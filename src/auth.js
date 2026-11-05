const jwt = require('jsonwebtoken');
const { oid, col } = require('./db');

const COOKIE = 'tgf_token';
const WEEK = 7 * 24 * 60 * 60 * 1000;

function setSession(res, userId) {
  const token = jwt.sign({ uid: String(userId) }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: WEEK,
  });
}

function clearSession(res) {
  res.clearCookie(COOKIE);
}

async function requireAuth(req, res, next) {
  try {
    const token = req.cookies[COOKIE];
    if (!token) return res.status(401).json({ error: 'Login required' });
    const { uid } = jwt.verify(token, process.env.JWT_SECRET);
    const _id = oid(uid);
    const user = _id && (await col('users').findOne({ _id }));
    if (!user) return res.status(401).json({ error: 'Login required' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Login required' });
  }
}

// simple in-memory rate limit: 10 attempts / 15 min per IP
const hits = new Map();
function authLimiter(req, res, next) {
  const now = Date.now();
  const key = req.ip;
  const list = (hits.get(key) || []).filter((t) => now - t < 15 * 60 * 1000);
  if (list.length >= 10) return res.status(429).json({ error: 'Bahut attempts, 15 minute baad try karo' });
  list.push(now);
  hits.set(key, list);
  next();
}

module.exports = { setSession, clearSession, requireAuth, authLimiter };
