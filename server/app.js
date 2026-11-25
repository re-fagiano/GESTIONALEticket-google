import { existsSync } from 'node:fs'
import path from 'node:path'
import express from 'express'
import { HttpError } from './lib/errors.js'
import { createAuth } from './middleware/auth.js'
import { clientIp, createRateLimiter, httpsRedirect, securityHeaders } from './middleware/security.js'
import { adminRoutes } from './routes/admin.js'
import { aiRoutes } from './routes/ai.js'
import { authRoutes } from './routes/auth.js'
import { calendarRoutes } from './routes/calendar.js'
import { customerRoutes } from './routes/customers.js'
import { interventionRoutes } from './routes/interventions.js'
import { inventoryImportRoute, inventoryRoutes } from './routes/inventory.js'
import { legacyRoutes } from './routes/legacy.js'
import { ticketRoutes } from './routes/tickets.js'

// Crea l'applicazione Express. Tutte le dipendenze sono passate dall'esterno (database, Google,
// backup, logger) così i test possono usare un database di prova e servizi finti.
export const createApp = ({ db, config, logger, backup, google, settings, extensions = [], fetchImpl }) => {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 1)

  const auth = createAuth(config)
  const rateLimit = createRateLimiter(db, logger)
  const deps = { db, config, logger, backup, google, settings, auth, rateLimit, fetchImpl, hooks: {}, jobs: [] }

  app.use(securityHeaders(config))
  app.use(httpsRedirect(config))

  app.get('/healthz', async (req, res) => {
    try {
      await db.query('SELECT 1')
      res.json({ ok: true, database: true, time: new Date().toISOString() })
    } catch {
      res.status(503).json({ ok: false, database: false, time: new Date().toISOString() })
    }
  })

  // Gli allegati degli interventi viaggiano come base64 dentro additionalData: serve un limite ampio.
  app.use('/api', express.json({ limit: '30mb' }))

  app.use('/api/auth', authRoutes(deps))

  const api = express.Router()
  api.use(auth.requireUser, auth.requireCsrf, auth.viewerReadOnly)
  api.use(rateLimit({
    scope: 'api',
    windowMs: config.API_RATE_LIMIT_WINDOW_MS,
    max: config.API_RATE_LIMIT_MAX,
    keyFn: (req) => req.user?.id || clientIp(req),
  }))

  api.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }))
  api.use('/customers', customerRoutes(deps))
  api.use('/clienti', customerRoutes(deps))
  api.use('/tickets', ticketRoutes(deps))
  const interventionHooks = { onChange: (...args) => deps.hooks?.interventions?.(...args) }
  api.use('/', interventionRoutes({ ...deps, hooks: interventionHooks }))
  api.post('/inventory/import', auth.requireRole('ADMIN', 'OPERATOR'), inventoryImportRoute(deps))
  api.use('/inventory', inventoryRoutes(deps))
  api.use('/magazzino', inventoryRoutes(deps))
  const calendarHooks = { onChange: (...args) => deps.hooks?.calendar?.(...args) }
  api.use('/calendar', calendarRoutes({ ...deps, hooks: calendarHooks }))
  api.use('/admin', auth.requireRole('ADMIN'), adminRoutes(deps))
  api.use('/', aiRoutes(deps))
  api.use('/', legacyRoutes(deps))
  // Moduli aggiuntivi (es. integrazione Google Calendar) registrati dall'esterno.
  for (const extension of extensions) extension({ app, api, deps })

  app.use('/api', api)
  app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint non trovato.', code: 'not_found' }))

  // Frontend compilato (Vite) con fallback SPA.
  if (existsSync(config.DIST_DIR)) {
    app.use('/assets', express.static(path.join(config.DIST_DIR, 'assets'), { immutable: true, maxAge: '1y', fallthrough: false }))
    app.use(express.static(config.DIST_DIR, { index: false, maxAge: '1h' }))
    app.get('*', (req, res) => {
      res.setHeader('Cache-Control', 'no-cache')
      res.sendFile(path.join(config.DIST_DIR, 'index.html'))
    })
  }

  // Gestore errori unico: risposte JSON coerenti, nessun dettaglio interno in produzione.
  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    if (error?.type === 'entity.too.large') error = new HttpError(413, 'Richiesta troppo grande.', 'payload_too_large')
    if (error?.type === 'entity.parse.failed') error = new HttpError(400, 'Invalid JSON', 'invalid_json')
    if (error?.status === 404 && req.path.startsWith('/assets/')) return res.status(404).json({ error: 'Risorsa non trovata.' })
    const status = Number.isInteger(error?.status) ? error.status : 500
    if (status >= 500) logger.error('request_failed', { path: req.path, method: req.method, status, error: error?.message, stack: error?.stack })
    else if (status !== 401) logger.warn('request_rejected', { path: req.path, method: req.method, status, code: error?.code })
    const message = status >= 500 && config.isProduction ? 'Errore interno' : (error?.message || 'Errore interno del server.')
    if (res.headersSent) return res.end()
    return res.status(status).json({ error: message, code: error?.code || 'internal_error', ...(error?.extra || {}) })
  })

  app.locals.deps = deps
  return app
}
