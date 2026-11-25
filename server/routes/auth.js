import { Router } from 'express'
import { asyncHandler, badRequest, HttpError } from '../lib/errors.js'
import { str } from '../lib/format.js'
import { generateOperatorCode, hashPassword, hashToken, normalizeRole, parseCookies, publicUser, verifyPassword } from '../middleware/auth.js'
import { clientIp } from '../middleware/security.js'
import { newId } from '../db.js'

const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
const isActive = (user) => Boolean(user.approved) && ['active', 'pending'].includes(user.status || 'active')

export const authRoutes = ({ db, config, auth, rateLimit }) => {
  const router = Router()

  const storeRefresh = (refreshId, userId, refreshToken) => db.query(
    `INSERT INTO "refresh_tokens" ("id", "userId", "tokenHash", "expiresAt", "createdAt")
     VALUES ($1, $2, $3, NOW() + ($4 || ' seconds')::interval, NOW())`,
    [refreshId, userId, hashToken(refreshToken), String(config.REFRESH_TOKEN_TTL_SECONDS)],
  )

  const startSession = async (res, user) => {
    const tokens = auth.issueTokens(user)
    await storeRefresh(tokens.refreshId, user.id, tokens.refreshToken)
    auth.setCookies(res, tokens)
  }

  const loginLimiter = rateLimit({
    scope: 'login',
    windowMs: config.LOGIN_RATE_LIMIT_WINDOW_MS,
    max: config.LOGIN_RATE_LIMIT_MAX,
    keyFn: (req) => `${clientIp(req)}:${str(req.body?.email).toLowerCase() || 'anon'}`,
    message: 'Troppi tentativi di login. Riprova tra qualche minuto.',
  })

  router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
    const email = str(req.body?.email).toLowerCase()
    const password = str(req.body?.password)
    if (!email || !password) throw badRequest('Email e password sono obbligatorie.', 'missing_credentials')
    if (!isEmail(email)) throw badRequest('Email non valida.', 'invalid_email')

    const row = await db.one('SELECT * FROM "users" WHERE "email" = $1', [email])
    // Stesso messaggio per utente inesistente e password errata: non riveliamo quali email esistono.
    if (!row || !(await verifyPassword(password, row.passwordHash))) throw new HttpError(401, 'Credenziali errate.', 'invalid_credentials')
    if (!row.approved) throw new HttpError(403, 'Utente non approvato.', 'user_not_approved')
    if (!isActive(row)) throw new HttpError(403, 'Utente non attivo.', 'user_inactive')

    const user = publicUser(row)
    await startSession(res, user)
    res.json({ user })
  }))

  router.post('/register', loginLimiter, asyncHandler(async (req, res) => {
    const email = str(req.body?.email).toLowerCase()
    const password = str(req.body?.password)
    if (!email || !password) throw badRequest('Email e password sono obbligatorie.', 'missing_credentials')
    if (!isEmail(email)) throw badRequest('Email non valida.', 'invalid_email')
    if (password.length < 8) throw badRequest('La password deve avere almeno 8 caratteri.', 'weak_password')
    if (await db.one('SELECT "id" FROM "users" WHERE "email" = $1', [email])) throw new HttpError(409, 'Utente già registrato.', 'user_exists')

    const created = await db.one(
      `INSERT INTO "users" ("id", "email", "passwordHash", "role", "operatorCode", "status", "approved", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'OPERATOR', $4, 'pending', false, NOW(), NOW()) RETURNING *`,
      [newId(), email, await hashPassword(password), generateOperatorCode()],
    )
    res.status(201).json({ pendingApproval: true, user: publicUser(created) })
  }))

  router.post('/refresh', auth.requireCsrf, asyncHandler(async (req, res) => {
    const refreshToken = parseCookies(req.headers.cookie).refresh_token || ''
    const payload = auth.verify(refreshToken, config.JWT_REFRESH_SECRET, 'refresh')
    const fail = (message = 'Sessione scaduta.', code = 'session_expired') => {
      auth.clearCookies(res)
      throw new HttpError(401, message, code)
    }
    if (!payload?.jti) fail()
    const record = await db.one('SELECT * FROM "refresh_tokens" WHERE "id" = $1', [payload.jti])
    if (!record || record.revokedAt || record.tokenHash !== hashToken(refreshToken) || new Date(record.expiresAt) <= new Date()) fail()
    const row = await db.one('SELECT * FROM "users" WHERE "id" = $1', [record.userId])
    if (!row || !isActive(row)) fail('Sessione non valida.', 'session_invalid')

    await db.query('UPDATE "refresh_tokens" SET "revokedAt" = NOW() WHERE "id" = $1', [record.id])
    const user = publicUser(row)
    await startSession(res, user)
    res.json({ user })
  }))

  router.post('/logout', auth.requireCsrf, asyncHandler(async (req, res) => {
    const payload = auth.verify(parseCookies(req.headers.cookie).refresh_token, config.JWT_REFRESH_SECRET, 'refresh')
    if (payload?.jti) await db.query('UPDATE "refresh_tokens" SET "revokedAt" = NOW() WHERE "id" = $1', [payload.jti])
    auth.clearCookies(res)
    res.json({ ok: true })
  }))

  router.get('/me', (req, res) => {
    res.json({ user: auth.readUser(req) })
  })

  router.post('/operator-code/regenerate', auth.requireUser, auth.requireCsrf, asyncHandler(async (req, res) => {
    const row = await db.one('UPDATE "users" SET "operatorCode" = $1, "updatedAt" = NOW() WHERE "id" = $2 RETURNING "operatorCode"', [generateOperatorCode(), req.user.id])
    res.json({ operatorCode: row?.operatorCode })
  }))

  return router
}

// Allinea l'utente admin alle variabili ADMIN_EMAIL / ADMIN_PASSWORD all'avvio.
export const ensureAdminUser = async ({ db, config, logger }) => {
  if (!config.ADMIN_EMAIL || !config.ADMIN_PASSWORD) {
    logger.warn('admin_seed_skipped', { reason: 'missing_admin_env' })
    return
  }
  const existing = await db.one('SELECT * FROM "users" WHERE "email" = $1', [config.ADMIN_EMAIL])
  if (!existing) {
    await db.query(
      `INSERT INTO "users" ("id", "email", "passwordHash", "role", "operatorCode", "status", "approved", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'ADMIN', $4, 'active', true, NOW(), NOW())`,
      [newId(), config.ADMIN_EMAIL, await hashPassword(config.ADMIN_PASSWORD), generateOperatorCode()],
    )
    logger.info('admin_seed_created')
    return
  }
  const passwordOk = await verifyPassword(config.ADMIN_PASSWORD, existing.passwordHash)
  if (normalizeRole(existing.role) !== 'ADMIN' || !passwordOk || !existing.approved || existing.status !== 'active') {
    await db.query(
      `UPDATE "users" SET "role" = 'ADMIN', "approved" = true, "status" = 'active', "passwordHash" = $2, "updatedAt" = NOW() WHERE "id" = $1`,
      [existing.id, passwordOk ? existing.passwordHash : await hashPassword(config.ADMIN_PASSWORD)],
    )
    logger.info('admin_seed_aligned')
  }
}
