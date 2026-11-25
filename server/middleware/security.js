import { HttpError } from '../lib/errors.js'

const CSP = [
  "default-src 'self'",
  "script-src 'self' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

export const securityHeaders = (config) => (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()')
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
  res.setHeader('Content-Security-Policy', CSP)
  if (config.isProduction) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  next()
}

export const httpsRedirect = (config) => (req, res, next) => {
  if (!config.isProduction || !config.ENFORCE_HTTPS) return next()
  const proto = String(req.headers['x-forwarded-proto'] || '').toLowerCase()
  if (proto && proto !== 'https' && req.headers.host) return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`)
  return next()
}

export const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown'

// Rate limit condiviso su Postgres (funziona anche con più istanze), con ripiego in memoria.
export const createRateLimiter = (db, logger) => {
  const memory = new Map()
  setInterval(() => {
    const now = Date.now()
    memory.forEach((entry, key) => { if (entry.resetAt <= now) memory.delete(key) })
  }, 60_000).unref()

  const hitMemory = (key, windowMs) => {
    const now = Date.now()
    const entry = memory.get(key)
    if (!entry || entry.resetAt <= now) {
      memory.set(key, { count: 1, resetAt: now + windowMs })
      return 1
    }
    entry.count += 1
    return entry.count
  }

  const hit = async (scope, key, windowMs) => {
    try {
      const row = await db.one(
        `INSERT INTO "rate_limits" ("scope", "key", "count", "reset_at", "updated_at")
         VALUES ($1, $2, 1, NOW() + ($3 || ' milliseconds')::interval, NOW())
         ON CONFLICT ("scope", "key") DO UPDATE SET
           "count" = CASE WHEN "rate_limits"."reset_at" <= NOW() THEN 1 ELSE "rate_limits"."count" + 1 END,
           "reset_at" = CASE WHEN "rate_limits"."reset_at" <= NOW() THEN EXCLUDED."reset_at" ELSE "rate_limits"."reset_at" END,
           "updated_at" = NOW()
         RETURNING "count"`,
        [scope, key, String(windowMs)],
      )
      return Number(row?.count || 1)
    } catch (error) {
      logger.warn('rate_limit_db_unavailable', { error: error.message })
      return hitMemory(`${scope}:${key}`, windowMs)
    }
  }

  return ({ scope, windowMs, max, keyFn, message }) => async (req, res, next) => {
    try {
      const count = await hit(scope, keyFn(req), windowMs)
      if (count > max) return next(new HttpError(429, message || 'Troppe richieste, riprova più tardi.', 'rate_limited'))
      return next()
    } catch (error) {
      return next(error)
    }
  }
}
