import crypto from 'node:crypto'
import { Router } from 'express'
import { asyncHandler, HttpError, notFound } from '../lib/errors.js'
import { str } from '../lib/format.js'
import { newId } from '../db.js'
import { clientIp } from '../middleware/security.js'
import { SHOP_DEFAULTS } from './reports.js'

const TYPE_LABEL = { chiamata: 'Intervento a domicilio', riparazione: 'Riparazione in laboratorio', ordine_ricambi: 'Ordine ricambi', preventivo: 'Preventivo' }
const LINK_TTL_AFTER_CLOSE_DAYS = 180
const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/

const newToken = () => crypto.randomBytes(16).toString('base64url')

// Momento in cui l'intervento è passato a un certo stato (dallo storico).
const statusAt = (logs, status) => logs.find((log) => log.action === 'status_changed' && log.note === `Nuovo stato: ${status}`)?.createdAt || null

export const buildSteps = (row, logs) => {
  const data = row.additionalData || {}
  const status = row.status
  const working = statusAt(logs, 'in_lavorazione')
  const done = row.closedAt || statusAt(logs, 'completato')
  const rank = { pendente: 0, in_lavorazione: 1, completato: 2, annullato: -1 }[status] ?? 0
  if (row.type === 'ordine_ricambi') {
    const order = ['ordinato', 'in_arrivo', 'arrivato', 'consegnato']
    const current = status === 'completato' ? 3 : Math.max(0, order.indexOf(data.orderStatus || 'ordinato'))
    return [['Ordinato', row.createdAt], ['In arrivo', null], ['Arrivato in negozio', null], ['Consegnato', done]]
      .map(([label, at], i) => ({ label, at: i <= current ? at : null, done: i < current || (i === current && i === 3), current: i === current && i !== 3 }))
  }
  if (row.type === 'preventivo') {
    const outcome = { accettato: 'Accettato', rifiutato: 'Non accettato' }[data.quoteStatus]
    return [
      { label: 'Richiesta ricevuta', at: row.createdAt, done: true, current: false },
      { label: 'Preventivo pronto', at: row.openedAt, done: Boolean(outcome), current: !outcome },
      ...(outcome ? [{ label: outcome, at: row.updatedAt, done: true, current: false }] : []),
    ]
  }
  const labels = row.type === 'chiamata'
    ? [['Richiesta ricevuta', row.createdAt], ['Tecnico al lavoro', working], ['Intervento completato', done]]
    : [['Apparecchio ricevuto in laboratorio', row.createdAt], ['In riparazione', working], ['Pronto per il ritiro', done]]
  return labels.map(([label, at], i) => ({ label, at: i <= rank ? at : null, done: i < rank || (i === 2 && rank === 2), current: i === rank && rank !== 2 }))
}

// Pagina di stato per il cliente: nessun login, solo i dati minimi (niente indirizzo, telefono o note interne).
export const publicStatusRoutes = ({ db, settings, rateLimit, logger }) => {
  const router = Router()
  router.use(rateLimit({ scope: 'public', windowMs: 60_000, max: 60, keyFn: (req) => clientIp(req) }))
  router.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Robots-Tag', 'noindex'); next() })

  const resolve = async (token) => {
    if (!TOKEN_RE.test(token)) throw notFound('Link non valido.')
    const link = await db.one('SELECT * FROM "public_links" WHERE "token" = $1', [token])
    if (!link || link.revokedAt) throw notFound('Link non valido o disattivato.')
    const row = await db.one('SELECT * FROM "interventions" WHERE "id" = $1', [link.interventionId])
    if (!row) throw notFound('Link non valido.')
    if (row.closedAt && Date.now() - new Date(row.closedAt).getTime() > LINK_TTL_AFTER_CLOSE_DAYS * 86_400_000) {
      throw new HttpError(410, 'Questo link è scaduto. Contatta il negozio.', 'link_expired')
    }
    return { link, row }
  }
  const shopProfile = async () => ({ ...SHOP_DEFAULTS, ...((await settings.get('shop.profile')) || {}) })

  router.get('/status/:token', asyncHandler(async (req, res) => {
    const { link, row } = await resolve(req.params.token)
    const logs = await db.query(`SELECT "action", "note", "createdAt" FROM "intervento_logs" WHERE "interventoId" = $1 ORDER BY "createdAt"`, [row.id])
    const shop = await shopProfile()
    const data = row.additionalData || {}
    db.query('UPDATE "public_links" SET "views" = "views" + 1, "lastViewedAt" = NOW() WHERE "token" = $1', [link.token]).catch((error) => logger.warn('public_link_view_failed', { error: error.message }))
    res.json({
      shop: { name: shop.name, phone: shop.phone, email: shop.email, address: shop.address, hasLogo: Boolean(shop.logoFileId) },
      code: row.code,
      type: row.type,
      typeLabel: TYPE_LABEL[row.type] || row.type,
      status: row.status,
      cancelled: row.status === 'annullato',
      appliance: [data.applianceBrand, data.applianceModel].filter(Boolean).join(' '),
      appointmentAt: row.type === 'chiamata' && row.status !== 'completato' && row.status !== 'annullato' ? row.openedAt : null,
      openedAt: row.openedAt,
      closedAt: row.closedAt,
      updatedAt: row.updatedAt,
      steps: buildSteps(row, logs),
      quote: row.type === 'preventivo' ? { items: str(data.quoteItems), total: Number(data.quoteTotal) || 0, validUntil: data.quoteValidUntil || null, status: data.quoteStatus || 'proposto' } : null,
      report: data.report?.pdfFileId ? { number: data.report.number, total: data.report.total, signedAt: data.report.signedAt } : null,
    })
  }))

  const sendFile = async (res, fileId, disposition = 'inline') => {
    const file = fileId ? await db.one('SELECT "fileName", "mimeType", "size", "data" FROM "files" WHERE "id" = $1', [fileId]) : null
    if (!file) throw notFound('File non disponibile.')
    res.setHeader('Content-Type', file.mimeType)
    res.setHeader('Content-Length', String(file.size))
    res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`)
    res.end(file.data)
  }

  router.get('/status/:token/report.pdf', asyncHandler(async (req, res) => {
    const { row } = await resolve(req.params.token)
    await sendFile(res, row.additionalData?.report?.pdfFileId)
  }))

  router.get('/status/:token/logo', asyncHandler(async (req, res) => {
    await resolve(req.params.token)
    await sendFile(res, (await shopProfile()).logoFileId)
  }))

  return router
}

// Lato gestionale: crea/legge/revoca il link e registra i messaggi inviati al cliente.
export const publicLinkRoutes = ({ db, auth }) => {
  const router = Router()
  const writer = auth.requireRole('ADMIN', 'OPERATOR')

  const active = (interventionId) => db.one('SELECT * FROM "public_links" WHERE "interventionId" = $1 AND "revokedAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1', [interventionId])
  const shape = (link) => (link ? { token: link.token, path: `/s/${link.token}`, createdAt: link.createdAt, views: link.views, lastViewedAt: link.lastViewedAt } : null)

  router.get('/interventions/:id/public-link', asyncHandler(async (req, res) => res.json(shape(await active(req.params.id)))))

  router.post('/interventions/:id/public-link', writer, asyncHandler(async (req, res) => {
    if (!(await db.one('SELECT 1 FROM "interventions" WHERE "id" = $1', [req.params.id]))) throw notFound('Intervento non trovato.')
    const existing = await active(req.params.id)
    if (existing) return res.json(shape(existing))
    const link = await db.one(
      'INSERT INTO "public_links" ("token", "interventionId", "createdBy", "createdAt") VALUES ($1, $2, $3, NOW()) RETURNING *',
      [newToken(), req.params.id, req.user.id],
    )
    res.status(201).json(shape(link))
  }))

  router.delete('/interventions/:id/public-link', writer, asyncHandler(async (req, res) => {
    await db.query('UPDATE "public_links" SET "revokedAt" = NOW() WHERE "interventionId" = $1 AND "revokedAt" IS NULL', [req.params.id])
    res.status(204).end()
  }))

  // Il messaggio parte dal telefono/PC del tecnico (WhatsApp, email, SMS): qui lo annotiamo nello storico.
  router.post('/interventions/:id/customer-message', writer, asyncHandler(async (req, res) => {
    const channel = ['whatsapp', 'email', 'sms', 'copia'].includes(str(req.body?.channel)) ? str(req.body.channel) : 'altro'
    const template = str(req.body?.template).slice(0, 60)
    if (!(await db.one('SELECT 1 FROM "interventions" WHERE "id" = $1', [req.params.id]))) throw notFound('Intervento non trovato.')
    await db.query(
      'INSERT INTO "intervento_logs" ("id", "interventoId", "userId", "action", "note", "createdAt") VALUES ($1, $2, $3, $4, $5, NOW())',
      [newId(), req.params.id, req.user.id, 'cliente_avvisato', `${channel}${template ? ` · ${template}` : ''}`],
    )
    res.status(201).json({ ok: true })
  }))

  return router
}
