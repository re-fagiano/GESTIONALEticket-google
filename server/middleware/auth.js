import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { HttpError, forbidden } from '../lib/errors.js'
import { str } from '../lib/format.js'

export const USER_ROLES = new Set(['ADMIN', 'OPERATOR', 'VIEWER'])
const LEGACY_ROLE_MAP = { admin: 'ADMIN', operatore: 'OPERATOR', operator: 'OPERATOR', tech: 'OPERATOR', read: 'VIEWER', reader: 'VIEWER', viewer: 'VIEWER' }
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export const normalizeRole = (value, fallback = 'OPERATOR') => {
  const raw = str(value)
  if (USER_ROLES.has(raw)) return raw
  return LEGACY_ROLE_MAP[raw.toLowerCase()] || fallback
}

export const hashPassword = (password) => bcrypt.hash(String(password || ''), 12)

export const verifyPassword = async (password, storedHash) => {
  if (!storedHash || typeof storedHash !== 'string') return false
  try {
    if (storedHash.startsWith('scrypt$')) {
      // Formato di riserva del vecchio server (quando bcrypt non era disponibile).
      const [, saltHex, keyHex] = storedHash.split('$')
      const computed = crypto.scryptSync(String(password || ''), Buffer.from(saltHex, 'hex'), 64)
      const expected = Buffer.from(keyHex, 'hex')
      return computed.length === expected.length && crypto.timingSafeEqual(computed, expected)
    }
    return await bcrypt.compare(String(password || ''), storedHash)
  } catch {
    return false
  }
}

export const hashToken = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex')
export const generateOperatorCode = () => `OP-${crypto.randomBytes(4).toString('hex').toUpperCase()}`

export const parseCookies = (header = '') => Object.fromEntries(
  String(header || '').split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=')
    const key = index === -1 ? part : part.slice(0, index)
    const raw = index === -1 ? '' : part.slice(index + 1)
    try { return [key, decodeURIComponent(raw)] } catch { return [key, raw] }
  }),
)

export const publicUser = (row) => ({
  id: row.id,
  email: row.email,
  username: row.email,
  role: normalizeRole(row.role),
  operatorCode: row.operatorCode,
  approved: Boolean(row.approved),
  status: row.status || (row.approved ? 'active' : 'pending'),
})

export const createAuth = (config) => {
  const sameSite = config.COOKIE_STRICT_MODE ? 'Strict' : 'Lax'
  const cookie = (name, value, maxAge, httpOnly = true) => [
    `${name}=${encodeURIComponent(value)}`, 'Path=/', httpOnly ? 'HttpOnly' : null, `SameSite=${sameSite}`, `Max-Age=${maxAge}`,
    config.isProduction ? 'Secure' : null,
  ].filter(Boolean).join('; ')

  const issueTokens = (user) => {
    const refreshId = crypto.randomUUID()
    const accessToken = jwt.sign(
      { sub: user.id, role: user.role, email: user.email, operatorCode: user.operatorCode, type: 'access' },
      config.JWT_SECRET, { expiresIn: config.ACCESS_TOKEN_TTL_SECONDS },
    )
    const refreshToken = jwt.sign({ sub: user.id, role: user.role, type: 'refresh', jti: refreshId }, config.JWT_REFRESH_SECRET, { expiresIn: config.REFRESH_TOKEN_TTL_SECONDS })
    const csrfToken = crypto.randomBytes(32).toString('base64url')
    return { accessToken, refreshToken, refreshId, csrfToken }
  }

  const setCookies = (res, { accessToken, refreshToken, csrfToken }) => {
    res.setHeader('Set-Cookie', [
      cookie('access_token', accessToken, config.ACCESS_TOKEN_TTL_SECONDS),
      cookie('refresh_token', refreshToken, config.REFRESH_TOKEN_TTL_SECONDS),
      cookie('csrf_token', csrfToken, config.REFRESH_TOKEN_TTL_SECONDS, false),
    ])
  }

  const clearCookies = (res) => {
    res.setHeader('Set-Cookie', [cookie('access_token', '', 0), cookie('refresh_token', '', 0), cookie('csrf_token', '', 0, false)])
  }

  const verify = (token, secret, type) => {
    if (!token || !secret) return null
    try {
      const payload = jwt.verify(token, secret)
      return payload?.type === type ? payload : null
    } catch {
      return null
    }
  }

  const readUser = (req) => {
    const payload = verify(parseCookies(req.headers.cookie).access_token, config.JWT_SECRET, 'access')
    if (!payload?.sub) return null
    const role = normalizeRole(payload.role, '')
    if (!USER_ROLES.has(role)) return null
    return { id: payload.sub, role, email: str(payload.email), operatorCode: str(payload.operatorCode) }
  }

  // Richiede un utente autenticato; per i metodi che modificano dati verifica anche il token CSRF.
  const requireUser = (req, res, next) => {
    const user = readUser(req)
    if (!user) return next(new HttpError(401, 'Access token mancante o non valido.', 'unauthorized'))
    req.user = user
    return next()
  }

  const requireCsrf = (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) return next()
    const cookieToken = str(parseCookies(req.headers.cookie).csrf_token)
    const headerToken = str(req.headers['x-csrf-token'])
    if (!cookieToken || !headerToken || cookieToken.length !== headerToken.length
      || !crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken))) {
      return next(new HttpError(403, 'Token CSRF non valido.', 'invalid_csrf'))
    }
    return next()
  }

  // VIEWER può solo leggere, come nel vecchio server.
  const viewerReadOnly = (req, res, next) => {
    if (req.user?.role === 'VIEWER' && !SAFE_METHODS.has(req.method)) return next(forbidden())
    return next()
  }

  const requireRole = (...roles) => (req, res, next) => (roles.includes(req.user?.role) ? next() : next(forbidden()))

  return { issueTokens, setCookies, clearCookies, verify, readUser, requireUser, requireCsrf, viewerReadOnly, requireRole }
}
