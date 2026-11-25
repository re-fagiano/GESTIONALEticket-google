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
const PENDING_KEY = 'google.oauth.pending'
const CONSENT_MINUTES = 30
const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex')
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

  // Backup del Google Calendar dentro il backup quotidiano su Drive (anche con sincronizzazione spenta).
  const calendarBackupFiles = async (context = {}) => {
    if ((await google.getMode()) === 'none') return []
    const account = await settings.get(ACCOUNT_KEY)
    if (account && account.calendar === false) return []
    const cfg = await sync.getConfig()
    const calendarId = context.calendarId || cfg.calendarId
    const { events, ics } = await sync.exportCalendar(calendarId)
    const day = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '')
    return [
      { fileName: `calendario-${day}.ics`, buffer: Buffer.from(ics, 'utf-8'), mimeType: 'text/calendar' },
      { fileName: `calendario-${day}.json`, buffer: Buffer.from(JSON.stringify({ calendarId, exportedAt: new Date().toISOString(), events })), mimeType: 'application/json' },
    ]
  }
  deps.backup?.addProvider?.(calendarBackupFiles)

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

  router.get('/connect', adminOnly, asyncHandler(async (req, res) => {
    if (!google.hasOAuthClient) throw new HttpError(400, 'Configura GOOGLE_OAUTH_CLIENT_ID e GOOGLE_OAUTH_CLIENT_SECRET su Railway.', 'oauth_not_configured')
    const state = crypto.randomBytes(24).toString('base64url')
    // Il consenso su Google può richiedere più dei 15 minuti di validità dell'accesso al gestionale:
    // ricordiamo lato server chi ha avviato il collegamento, così il ritorno non dipende dalla sessione.
    await settings.set(PENDING_KEY, { stateHash: sha256(state), userEmail: req.user.email, expiresAt: Date.now() + CONSENT_MINUTES * 60_000 })
    res.setHeader('Set-Cookie', `${STATE_COOKIE}=${state}; Path=/api/google; HttpOnly; SameSite=Lax; Max-Age=${CONSENT_MINUTES * 60}${config.isProduction ? '; Secure' : ''}`)
    res.json({ url: google.buildConsentUrl({ redirectUri: redirectUri(req), state, scopes: OAUTH_SCOPES }) })
  }))

  // Ritorno dal consenso Google (navigazione del browser, non fetch): rispondiamo con un redirect all'app.
  // Non richiede la sessione: vale solo se lo "state" coincide sia con il cookie del browser che ha
  // avviato il collegamento sia con quello registrato sul server da un amministratore (max 30 minuti).
  app.get('/api/google/callback', async (req, res) => {
    const back = (params) => res.redirect(`/#/impostazioni?tab=google&${new URLSearchParams(params)}`)
    try {
      const expected = parseCookies(req.headers.cookie)[STATE_COOKIE]
      res.append('Set-Cookie', `${STATE_COOKIE}=; Path=/api/google; HttpOnly; SameSite=Lax; Max-Age=0`)
      if (req.query.error) return back({ error: str(req.query.error) })
      const pending = await settings.get(PENDING_KEY)
      const state = str(req.query.state)
      if (!expected || expected !== state || !pending || pending.stateHash !== sha256(state)) return back({ error: 'state_non_valido' })
      await settings.remove(PENDING_KEY)
      if (Date.now() > Number(pending.expiresAt)) return back({ error: 'collegamento_scaduto' })
      const tokens = await google.exchangeAuthCode({ code: str(req.query.code), redirectUri: redirectUri(req) })
      if (!tokens.refresh_token) return back({ error: 'refresh_token_mancante' })
      const grantedScopes = String(tokens.scope || '').split(' ')
      await settings.setSecret(REFRESH_KEY, tokens.refresh_token)
      await settings.set(ACCOUNT_KEY, {
        email: decodeJwtPayload(tokens.id_token)?.email || null,
        connectedAt: new Date().toISOString(),
        connectedBy: pending.userEmail,
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
    // Prima di accendere la sincronizzazione (o di passare da solo lettura a scrittura) salviamo
    // una copia completa del calendario su Drive. Se il backup non riesce, non attiviamo nulla.
    const willEnable = Boolean(req.body?.enabled ?? before.enabled)
    const willWrite = willEnable && !(req.body?.readOnly ?? before.readOnly)
    const wasWriting = before.enabled && !before.readOnly
    if ((willEnable && !before.enabled) || (willWrite && !wasWriting)) {
      const target = typeof req.body?.calendarId === 'string' && req.body.calendarId.trim() ? req.body.calendarId.trim() : before.calendarId
      const result = await deps.backup.perform({ triggeredBy: 'pre-calendar-sync', context: { calendarId: target } })
      if (!result.ok || result.mode !== 'drive' || !result.extraFiles?.some((f) => f.fileName.endsWith('.ics'))) {
        throw new HttpError(503, `Backup del calendario non riuscito, sincronizzazione NON attivata: ${result.message || 'Google Drive non disponibile'}`, 'calendar_backup_failed')
      }
    }
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

  // Scarica subito una copia del calendario (.ics) da conservare o reimportare in Google Calendar.
  router.get('/calendar/export.ics', adminOnly, asyncHandler(async (req, res) => {
    if ((await google.getMode()) === 'none') throw badRequest('Account Google non collegato.', 'not_connected')
    const cfg = await sync.getConfig()
    const { ics } = await sync.exportCalendar(cfg.calendarId)
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="calendario-${new Date().toISOString().slice(0, 10)}.ics"`)
    res.send(ics)
  }))

  // Link all'evento Google (per il pulsante "Apri in Google Calendar"): visibile a tutti gli utenti.
  router.get('/calendar/link/:entityType/:id', asyncHandler(async (req, res) => {
    const type = req.params.entityType === 'calendar_item' ? 'calendar_item' : 'intervention'
    res.json({ htmlLink: await sync.htmlLinkFor(type, req.params.id) })
  }))

  api.use('/google', router)
  return app
}
