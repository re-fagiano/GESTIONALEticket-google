import crypto from 'node:crypto';
import express from 'express';
import db from '../db/database.js';

const router = express.Router();

const sessions = new Map();
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

const now = () => Date.now();

const pruneSessions = () => {
  const ts = now();
  for (const [token, session] of sessions.entries()) {
    if (!session || session.expiresAt <= ts) sessions.delete(token);
  }
};

const createToken = () => crypto.randomBytes(32).toString('hex');

const setAuthCookies = (res, token) => {
  const maxAge = SESSION_TTL_MS;
  const secure = process.env.NODE_ENV === 'production';
  res.cookie('auth_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge,
    path: '/',
  });
  res.cookie('csrf_token', token, {
    httpOnly: false,
    sameSite: 'lax',
    secure,
    maxAge,
    path: '/',
  });
};

const clearAuthCookies = (res) => {
  res.clearCookie('auth_token', { path: '/' });
  res.clearCookie('csrf_token', { path: '/' });
};

const getSessionFromRequest = (req) => {
  pruneSessions();
  const bearer = String(req.headers.authorization || '').trim();
  const bearerToken = bearer.startsWith('Bearer ') ? bearer.slice(7) : '';
  const cookieToken = req.cookies?.auth_token || '';
  const token = bearerToken || cookieToken;
  if (!token) return null;
  const session = sessions.get(token);
  if (!session || session.expiresAt <= now()) {
    sessions.delete(token);
    return null;
  }
  return { token, session };
};

const toUserPayload = (user) => ({
  id: String(user.id),
  email: user.email,
  username: user.email,
  role: user.role || 'operator',
});

router.post('/register', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '').trim();

  if (!email || !password) {
    return res.status(400).json({ error: 'Email e password obbligatorie.' });
  }

  const existing = db.prepare('SELECT id FROM utenti WHERE email = ?').get(email);
  if (existing) {
    return res.status(409).json({ error: 'Utente già registrato.' });
  }

  const countRow = db.prepare('SELECT COUNT(*) AS count FROM utenti').get();
  const role = Number(countRow?.count || 0) === 0 ? 'admin' : 'operator';

  const result = db.prepare('INSERT INTO utenti (email, password, role) VALUES (?, ?, ?)').run(email, password, role);
  const user = db.prepare('SELECT id, email, role FROM utenti WHERE id = ?').get(result.lastInsertRowid);

  const token = createToken();
  sessions.set(token, { userId: user.id, expiresAt: now() + SESSION_TTL_MS });
  setAuthCookies(res, token);

  return res.status(201).json({ user: toUserPayload(user), accessToken: token });
});

router.post('/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '').trim();

  if (!email || !password) {
    return res.status(400).json({ error: 'Email e password obbligatorie.' });
  }

  const user = db.prepare('SELECT id, email, role, password FROM utenti WHERE email = ?').get(email);
  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Credenziali non valide.', code: 'session_invalid' });
  }

  const token = createToken();
  sessions.set(token, { userId: user.id, expiresAt: now() + SESSION_TTL_MS });
  setAuthCookies(res, token);

  return res.json({ user: toUserPayload(user), accessToken: token });
});

router.get('/me', (req, res) => {
  const found = getSessionFromRequest(req);
  if (!found) {
    return res.status(401).json({ error: 'Sessione non valida.', code: 'session_invalid' });
  }
  const user = db.prepare('SELECT id, email, role FROM utenti WHERE id = ?').get(found.session.userId);
  if (!user) {
    sessions.delete(found.token);
    return res.status(401).json({ error: 'Sessione scaduta.', code: 'session_expired' });
  }
  return res.json({ user: toUserPayload(user) });
});

router.post('/refresh', (req, res) => {
  const found = getSessionFromRequest(req);
  if (!found) {
    return res.status(401).json({ error: 'Sessione scaduta.', code: 'session_expired' });
  }

  const newToken = createToken();
  sessions.delete(found.token);
  sessions.set(newToken, { ...found.session, expiresAt: now() + SESSION_TTL_MS });
  setAuthCookies(res, newToken);
  return res.json({ accessToken: newToken });
});

router.post('/logout', (req, res) => {
  const found = getSessionFromRequest(req);
  if (found) sessions.delete(found.token);
  clearAuthCookies(res);
  return res.status(204).send();
});

export default router;
