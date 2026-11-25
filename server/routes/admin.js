import { Router } from 'express'
import { asyncHandler, badRequest, HttpError, notFound } from '../lib/errors.js'
import { str, toCsv } from '../lib/format.js'
import { normalizeRole } from '../middleware/auth.js'

const adminUser = (row) => ({
  id: row.id,
  email: row.email,
  username: row.email,
  role: normalizeRole(row.role),
  status: row.status || (row.approved ? 'active' : 'pending'),
  approved: Boolean(row.approved),
  operatorCode: row.operatorCode,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export const adminRoutes = ({ db, backup }) => {
  const router = Router()

  router.get('/users', asyncHandler(async (req, res) => {
    const rows = await db.query('SELECT * FROM "users" ORDER BY "createdAt" DESC')
    res.json({ users: rows.map(adminUser) })
  }))

  router.patch('/users/:id', asyncHandler(async (req, res) => {
    const targetId = str(req.params.id)
    const role = normalizeRole(req.body?.role, '')
    if (!role) throw badRequest('Ruolo utente non valido.', 'invalid_role')
    if (targetId === req.user.id && role !== 'ADMIN') {
      throw badRequest('Non puoi rimuovere il ruolo ADMIN dal tuo account.', 'self_demotion_not_allowed')
    }
    const approved = Boolean(req.body?.approved)
    const status = str(req.body?.status, approved ? 'active' : 'pending')
    if (!['active', 'pending', 'disabled'].includes(status)) throw badRequest('Stato utente non valido.', 'invalid_status')
    if (targetId === req.user.id && (status === 'disabled' || !approved)) {
      throw badRequest('Non puoi disabilitare il tuo account.', 'self_disable_not_allowed')
    }
    const row = await db.one(
      'UPDATE "users" SET "role" = $2, "approved" = $3, "status" = $4, "updatedAt" = NOW() WHERE "id" = $1 RETURNING *',
      [targetId, role, approved, status],
    )
    if (!row) throw notFound('Utente non trovato.', 'user_not_found')
    // Un utente disabilitato perde subito le sessioni attive.
    if (status === 'disabled' || !approved) await db.query('UPDATE "refresh_tokens" SET "revokedAt" = NOW() WHERE "userId" = $1 AND "revokedAt" IS NULL', [targetId])
    res.json({ user: adminUser(row) })
  }))

  router.post('/backup', asyncHandler(async (req, res) => {
    const result = await backup.perform({ triggeredBy: 'manual-api' })
    const lastRun = await backup.lastRun()
    if (!result.ok) throw new HttpError(503, 'Backup non riuscito.', 'backup_failed', { detail: result.message, lastRun })
    res.json({ message: result.mode === 'drive' ? 'Backup completato.' : result.message, result, lastRun })
  }))

  router.get('/backup/latest', asyncHandler(async (req, res) => {
    res.json({ lastRun: await backup.lastRun() })
  }))

  router.get('/export/json', asyncHandler(async (req, res) => {
    const payload = await backup.buildPayload()
    res.setHeader('Content-Disposition', `attachment; filename="backup-${payload.exportedAt.slice(0, 10)}.json"`)
    res.json(payload)
  }))

  router.get('/export/csv', asyncHandler(async (req, res) => {
    const rows = await db.query(
      `SELECT i.*, c."name" AS "customerName" FROM "interventions" i LEFT JOIN "customers" c ON c."id" = i."customerId" ORDER BY i."openedAt"`,
    )
    const csv = toCsv([
      { key: 'code', label: 'Codice' },
      { key: 'type', label: 'Tipo' },
      { key: 'status', label: 'Stato' },
      { key: 'priority', label: 'Urgenza' },
      { key: 'customerName', label: 'Cliente' },
      { key: 'description', label: 'Descrizione' },
      { key: 'openedAt', label: 'Aperto il' },
      { key: 'closedAt', label: 'Chiuso il' },
      { key: 'id', label: 'ID' },
    ], rows)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="export-interventi.csv"')
    res.send(csv)
  }))

  return router
}
