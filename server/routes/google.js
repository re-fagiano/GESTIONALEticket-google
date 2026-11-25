import crypto from 'node:crypto'
import { Router } from 'express'
import { asyncHandler, badRequest, HttpError } from '../lib/errors.js'
import { str } from '../lib/format.js'
import { parseCookies } from '../middleware/auth.js'
import { GOOGLE_SCOPES } from '../services/google.js'
import { createCalendarSync } from '../services/calendarSync.js'

const REFRESH_KEY = 'google.oauth.refreshToken'
const ACCOUNT_KEY = 'google.oauth.account'
const STATE_COOKIE = 'google_oauth_state'
const OAUTH_SCOPES = ['openid', 'email', GOOGLE_SCOPES.calendar, GOOGLE_SCOPES.drive]

const decodeJwtPayload = (token) => {
  try { return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8')) } catch { return null }
}

// Estensione: collegamento account Google (OAuth) + ponte Google Calendar.
export const googleExtension = ({ app, api, deps }) => {
  const { db, config, google, settings, logger, auth } = deps
  const sync = createCalendarSync({ db, google, settings, config, logger })
  deps.calendarSync = sync

  // Ogni modifica a interventi ed eventi viene messa in coda per Google Calendar.
  deps.hooks.interventions = (event, id) => sync.enqueue('intervention', id)
  deps.hooks.calendar = (event, id) => sync.enqueue('calendar_item', id)
  deps.jobs.push({ start: sync.start, stop: sync.stop })

  const redirectUri = (req) => `${config.PUBLIC_URL || `${req.protocol}://${req.get('host')}`}/api/google/callback`

  const router = Router()
  const adminOnly = auth.requireRole('ADMIN')

  router.get('/status', adminOnly, asyncHandler(async (req, res) => {
    const account = await settings.get(ACCOUNT_KEY)
    res.json({
      mode: await google.getMode(),
      oauthClientConfigured: google.hasOAuthClient,
      serviceAccountEmail: google.hasServiceAccount ? google.serviceAccountEmail : null,
      account: account || null,
      redirectUri: redirectUri(req),
      calendar: await sync.status(),
    })
  }))

  router.get('/connect', adminOnly, (req, res, next) => {
    if (!google.hasOAuthClient) return next(new HttpError(400, 'Configura GOOGLE_OAUTH_CLIENT_ID e GOOGLE_OAUTH_CLIENT_SECRET su Railway.', 'oauth_not_configured'))
    const state = crypto.randomBytes(24).toString('base64url')
    res.setHeader('Set-Cookie', `${STATE_COOKIE}=${state}; Path=/api/google; HttpOnly; SameSite=Lax; Max-Age=600${config.isProduction ? '; Secure' : ''}`)
    return res.json({ url: google.buildConsentUrl({ redirectUri: redirectUri(req), state, scopes: OAUTH_SCOPES }) })
  })

  // Ritorno dal consenso Google (navigazione del browser, non fetch): rispondiamo con un redirect all'app.
  router.get('/callback', adminOnly, async (req, res) => {
    const back = (params) => res.redirect(`/#/impostazioni?tab=google&${new URLSearchParams(params)}`)
    try {
      const expected = parseCookies(req.headers.cookie)[STATE_COOKIE]
      res.append('Set-Cookie', `${STATE_COOKIE}=; Path=/api/google; HttpOnly; SameSite=Lax; Max-Age=0`)
      if (req.query.error) return back({ error: str(req.query.error) })
      if (!expected || expected !== str(req.query.state)) return back({ error: 'state_non_valido' })
      const tokens = await google.exchangeAuthCode({ code: str(req.query.code), redirectUri: redirectUri(req) })
      if (!tokens.refresh_token) return back({ error: 'refresh_token_mancante' })
      const grantedScopes = String(tokens.scope || '').split(' ')
      await settings.setSecret(REFRESH_KEY, tokens.refresh_token)
      await settings.set(ACCOUNT_KEY, {
        email: decodeJwtPayload(tokens.id_token)?.email || null,
        connectedAt: new Date().toISOString(),
        connectedBy: req.user.email,
        calendar: grantedScopes.includes(GOOGLE_SCOPES.calendar),
        drive: grantedScopes.includes(GOOGLE_SCOPES.drive),
      })
      google.clearCache()
      logger.info('google_connected')
      return back({ connected: '1' })
    } catch (error) {
      logger.error('google_callback_failed', { error: error.message })
      return back({ error: 'scambio_codice_fallito' })
    }
  })

  router.post('/disconnect', adminOnly, asyncHandler(async (req, res) => {
    const token = await settings.getSecret(REFRESH_KEY)
    if (token) {
      await (deps.fetchImpl || fetch)('https://oauth2.googleapis.com/revoke', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }),
      }).catch(() => {})
    }
    await settings.remove(REFRESH_KEY)
    await settings.remove(ACCOUNT_KEY)
    await sync.updateSettings({ enabled: false })
    google.clearCache()
    res.json({ ok: true })
  }))

  router.get('/calendars', adminOnly, asyncHandler(async (req, res) => {
    if ((await google.getMode()) === 'none') throw badRequest('Account Google non collegato.', 'not_connected')
    const data = await google.request({ scopes: GOOGLE_SCOPES.calendar, url: '/calendar/v3/users/me/calendarList?minAccessRole=writer&maxResults=250' })
    res.json((data.items || []).map((c) => ({ id: c.id, summary: c.summaryOverride || c.summary, primary: Boolean(c.primary), backgroundColor: c.backgroundColor })))
  }))

  router.put('/calendar/settings', adminOnly, asyncHandler(async (req, res) => {
    const before = await sync.getConfig()
    const next = await sync.updateSettings(req.body || {})
    // Appena attivato (o cambiato calendario) facciamo subito un giro completo.
    if (next.enabled && (!before.enabled || before.calendarId !== next.calendarId || JSON.stringify(before.pushTypes) !== JSON.stringify(next.pushTypes))) {
      sync.syncNow().catch((error) => logger.warn('calendar_initial_sync_failed', { error: error.message }))
    }
    res.json(next)
  }))

  router.post('/calendar/sync', adminOnly, asyncHandler(async (req, res) => {
    res.json(await sync.syncNow({ recreateDeleted: Boolean(req.body?.recreateDeleted) }))
  }))

  // Link all'evento Google (per il pulsante "Apri in Google Calendar"): visibile a tutti gli utenti.
  router.get('/calendar/link/:entityType/:id', asyncHandler(async (req, res) => {
    const type = req.params.entityType === 'calendar_item' ? 'calendar_item' : 'intervention'
    res.json({ htmlLink: await sync.htmlLinkFor(type, req.params.id) })
  }))

  api.use('/google', router)
  return app
}
