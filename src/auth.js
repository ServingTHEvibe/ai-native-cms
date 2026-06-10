'use strict';
const crypto = require('crypto');
const config = require('./config');

/**
 * Password hashing (scrypt) for per-site client passwords.
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), salt, 32).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const derived = crypto.scryptSync(String(password), salt, 32).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(derived, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Stateless signed tokens (HMAC). Works on serverless with no session store.
 * Payload examples:
 *   { role: 'owner' }
 *   { role: 'client', siteId: '...' }
 */
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlJson(obj) { return b64url(JSON.stringify(obj)); }

function signToken(payload, ttlSeconds = 60 * 60 * 24 * 7) {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const data = b64urlJson(body);
  const sig = b64url(crypto.createHmac('sha256', config.serverSecret).update(data).digest());
  return `${data}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  const expected = b64url(crypto.createHmac('sha256', config.serverSecret).update(data).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); }
  catch (_) { return null; }
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

/**
 * Reads the bearer token (Authorization header or token cookie) into req.auth.
 */
function authContext(req, _res, next) {
  let token = '';
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) token = header.slice(7);
  if (!token && req.headers.cookie) {
    const m = /(?:^|;\s*)cms_token=([^;]+)/.exec(req.headers.cookie);
    if (m) token = decodeURIComponent(m[1]);
  }
  req.auth = token ? verifyToken(token) : null;
  next();
}

function requireOwner(req, res, next) {
  if (req.auth && req.auth.role === 'owner') return next();
  return res.status(401).json({ error: 'Owner authorization required' });
}

/** Owner may touch any site; a client may only touch their own site. */
function requireSiteAccess(getSiteId) {
  return (req, res, next) => {
    const siteId = getSiteId(req);
    if (!req.auth) return res.status(401).json({ error: 'Login required' });
    if (req.auth.role === 'owner') return next();
    if (req.auth.role === 'client' && req.auth.siteId === siteId) return next();
    return res.status(403).json({ error: 'You do not have access to this site' });
  };
}

module.exports = {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  authContext,
  requireOwner,
  requireSiteAccess,
};
