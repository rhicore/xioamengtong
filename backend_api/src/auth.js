const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const SESSION_COOKIE = 'admin_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function publicAccount(account) {
  return {
    id: account._id,
    username: account.username,
    role: account.role || 'operator',
    disabled: account.disabled === true,
    created_at: account.created_at || null,
    updated_at: account.updated_at || null
  };
}

function parseCookies(header) {
  return String(header || '').split(';').reduce((cookies, item) => {
    const separator = item.indexOf('=');
    if (separator < 0) return cookies;
    const key = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

async function hashPassword(password) {
  return bcrypt.hash(String(password), 12);
}

async function verifyPassword(password, passwordHash) {
  if (!passwordHash) return false;
  return bcrypt.compare(String(password), passwordHash);
}

function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 3 || value.length > 128) {
    const error = new Error('密码长度必须为 3 到 128 位');
    error.status = 400;
    throw error;
  }
  return value;
}

async function authenticateRequest(req, store, now) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;

  const tokenHash = hashSessionToken(token);
  const session = await store.getSessionByTokenHash(tokenHash);
  if (!session || session.revoked_at || new Date(session.expires_at) <= now) return null;

  const account = await store.getAccountById(session.staff_account_id);
  if (!account || account.disabled === true) {
    await store.revokeSession(tokenHash);
    return null;
  }

  await store.touchSession(session._id, now);
  return { token, tokenHash, session, account };
}

async function login(store, username, password, now) {
  const account = await store.getAccountByUsername(normalizeUsername(username));
  if (!account || account.disabled === true || !(await verifyPassword(password, account.password_hash))) {
    return null;
  }

  const token = crypto.randomBytes(32).toString('base64url');
  await store.createSession({
    token_hash: hashSessionToken(token),
    staff_account_id: account._id,
    created_at: now,
    expires_at: new Date(now.getTime() + SESSION_TTL_MS),
    revoked_at: null,
    last_seen_at: now
  });
  return { token, account };
}

module.exports = {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  normalizeUsername,
  hashSessionToken,
  publicAccount,
  hashPassword,
  verifyPassword,
  validatePassword,
  authenticateRequest,
  login
};
